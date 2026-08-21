'use strict';

const crypto = require('crypto');

const XIAONI_RUNTIME_ROOT = '/xiaoni-runtime';
const HOST_XIAONI_RUNTIME_ROOT = '/home/liahua/.qqbot-local/xiaoni-runtime';

const INDEXABLE_RUNTIME_DIRS = new Set([
  'forever',
  'notes',
  'reading',
  'toys'
]);

const EXCLUDED_RUNTIME_DIRS = new Set([
  'git-archives',
  'logs',
  'media',
  'picture',
  'sessions'
]);

const OPERATIONAL_SOURCES = new Set([
  'llm_request',
  'llm_stack_item',
  'compression_fork_llm_request',
  'compression_fork_item',
  'compression_fork_tool_execution',
  'core_memory_compression_fork',
  'subconscious_agent_fork',
  'subconscious_fork_llm_request',
  'subconscious_fork_item',
  'subconscious_fork_tool_execution',
  'image_vision_fork',
  'image_vision_fork_observation',
  'image_vision_fork_llm_request',
  'cache_heartbeat'
]);

const SPOKEN_KINDS = new Set([
  'qq_self_message',
  'send_in_group',
  'send_in_private'
]);

// 她自己不是「别人」。动作流投影里 peerName 会**回退到 session_key**
// (xiaoni-activity.js:501 `firstString(payload.peer_name, row.session_key)`),她主 loop 的
// session_key 就是 'xiaoni' —— 于是她自己的 runtime_input / 工具调用全带上 peer='xiaoni',
// 被渲染成「xiaoni 提过：…」(她被告知自己说过自己的 plan),并且因 cueClass=db_life_cue 落进
// **他人域**,把真正的 Nova/阿花/帕秋莉挤出 top-K。
// 真库实测(2026-08-07,近 7 天 shadow):peer_message 共 2369 条,其中 1899 条 peer='xiaoni'
// (runtime_input 1100 + tool_execution 799)= 80%,真人只剩 ~350 条。
// 判据用名字而不是 actor 字段:动作流各投影分支的 actor 取值不统一('xiaoni'/'system'/'human'),
// peer 名字才是渲染进 lead 的那一个,治它才治到位。
const SELF_IDENTITY_NAMES = new Set(['xiaoni', '小腻']);

function isSelfPeerName(value) {
  return typeof value === 'string' && SELF_IDENTITY_NAMES.has(value.trim().toLowerCase());
}

// 动作流条目的**真** peer:她自己 → null。null 同时喂两处:
//   ① leadTemplateForItem 不再吐 peer_message(不会说「xiaoni 提过」)
//   ② recallDomainOf 据 provenance.peer 判他人域(没有 peer 的 db_life_cue 归自我域)
function resolvePeerNameForItem(item) {
  const metadata = item && typeof item.metadata === 'object' && item.metadata ? item.metadata : {};
  const peer = firstString(item?.senderName, item?.peerName, metadata.senderName, metadata.peerName);
  return isSelfPeerName(peer) ? null : peer;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function compactWhitespace(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function truncateText(value, maxLength = 480) {
  const compact = compactWhitespace(value);
  if (!compact) {
    return null;
  }
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

// 运营轨迹标题(LLM 请求切片 / provider trace,如 "anthropic/messages · claude-opus-4-6 ·
// turn 8 · 147900->2 tokens")= 零记忆价值。真库实测:这类标题当 query 100% 触发召回、全是噪音;
// 当 cue 会污染语料。既不当 query 也不当 cue。
function isOperationalTraceText(t) {
  if (typeof t !== 'string') {
    return false;
  }
  if (/^anthropic\/messages\s*·/.test(t)) {
    return true;
  }
  if (/·\s*turn\s*\d+\s*·[^\n]*\btokens\s*$/.test(t)) {
    return true;
  }
  return false;
}

// 从 shell 命令里抽她的「人类意图」——注释(# ...)是她思考的落点(真库里她大量写
// `# 找"从一把葱到两把葱"` 这种)。纯机械命令(grep/curl/cat 只带路径/管道)无记忆价值,返回 ''。
// 她 cat>file 的写入 provenance 另由 db_file_provenance 路径处理,不靠原始命令文本嵌入。
function extractHumanFromShellCommand(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) {
    return '';
  }
  const parts = [];
  for (const line of cmd.split('\n')) {
    // 行首或空白后的 # 注释(URL 里的 # 无前置空白,不误伤)。
    const m = line.match(/(?:^|\s)#\s?(.+)$/);
    if (m && m[1]) {
      const c = m[1].trim();
      // 排除纯机械/heredoc 标记注释(# PY / # EOF / # !/bin/bash 之类)。
      if (c.length > 1 && !/^[A-Z_]{1,8}$/.test(c) && !/^!\//.test(c)) {
        parts.push(c);
      }
    }
  }
  return parts.join(' ').trim();
}

// 围栏 + heredoc 命令外壳剥离。她提交 plan / skill 的动作在动作流里渲染成
//   ``` /app/modules/agent-service/skills-internal/xiaoni-plan/xiaoni-plan post <<'PLAN'
//   <她真写的正文>
//   PLAN ```
// 正文要留(那是她的念头),外面那层命令是**逐字不变的样板**——2026-08-07 真库核查:
// 每个自驱动 run 一条,上千条 plan cue 因为共享这段前缀互相成为最近邻,既当噪音 query
// 也当噪音砖。只剥壳不改正文。开标记必须在首行,避免误伤正文里出现的 << 。
function stripHeredocScaffold(value) {
  let t = typeof value === 'string' ? value.trim() : '';
  if (!t) {
    return '';
  }
  t = t.replace(/^```[a-z0-9_-]*[ \t]*\r?\n?/i, '').replace(/\r?\n?[ \t]*```$/, '');
  // 首行形如 `<命令…> <<'TAG'` / `<<-TAG`(TAG = 全大写标识符,heredoc 惯例)。
  const opener = t.match(/^[^\n]*?<<-?[ \t]*(['"]?)([A-Z][A-Z0-9_]*)\1[ \t]*(?:\r?\n|[ \t])/);
  if (!opener) {
    return t.trim();
  }
  t = t.slice(opener[0].length);
  // 收尾的结束标记(可能已被上面的围栏剥离带走一部分)。
  t = t.replace(new RegExp(`(?:\\r?\\n|[ \\t])${opener[2]}[ \\t]*$`), '');
  return t.trim();
}

// 召回文本清洗:剥掉脚手架/样板/注入模板/运营信封,让 embedding 只反映"信号"而非"结构"。
// 只作用于召回派生文本(cue 的 embedding_text + query 的 landedText),不碰小腻 agent 本体/指针。
// 真库诊断:上万条 cue/query 因共享样板(LLM 切片标题 / 工具调用 JSON 信封 / path-check 工具输出 /
// system_reminder 模板 / 当前输入包壳 / 请求工具·等待处理消息 通知壳)嵌成近似同向量、静默率仅 8%。
// 详见 docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md。返回 '' = "整条无记忆价值"(调用方据此不入库/不当 query)。
function normalizeRecallText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  let t = value.trim();
  if (!t) {
    return '';
  }
  // 0) 运营轨迹标题(LLM 切片 / provider trace)→ 整条废。
  if (isOperationalTraceText(t)) {
    return '';
  }
  // 1a) 文本包壳前缀先剥,露出里面可能的 JSON/正文:
  //     "请求工具: exec_command {…}" → 留 {…} 再进 JSON 拆壳;"当前输入 …" → 留正文。
  t = t.replace(/^请求工具[:：]\s*[^\s{[]+\s*/, '');
  t = t.replace(/^当前输入\s*/, '');
  // 1b) "等待处理消息 chat_label=…" 通知壳整条废(真正入站内容另有 inbound cue 路径,不双记)。
  if (/^等待处理消息/.test(t)) {
    return '';
  }
  // 1c) 围栏 + heredoc 命令外壳(plan/skill 提交)→ 只留正文。
  t = stripHeredocScaffold(t);
  if (!t) {
    return '';
  }
  // 2) JSON 信封拆壳:入站 {"user_id":..,"message":"X"} → 留 X;工具调用 {"cmd":"…"} → 抽注释意图。
  if (/^[{[]/.test(t)) {
    const parsed = parseJsonPreview(t);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        t = parsed.message.trim();
      } else if (firstString(parsed.xiaoni_os, parsed.reason)) {
        // xiaoni_plan / clock 这类自驱动工具的参数信封:{"clock":120,"reason":"…","xiaoni_os":"…"}。
        // 数字参数是机械的,reason/xiaoni_os 才是她当时写的话 —— 留话,丢壳。
        t = [firstString(parsed.xiaoni_os), firstString(parsed.reason)].filter(Boolean).join(' ');
      } else {
        const cmd = firstString(parsed.cmd, parsed.command, parsed.shell_command, parsed.shellCommand);
        if (cmd) {
          // 命令里可能还套着 plan 的 heredoc(exec_command 路径),先剥壳:剥出正文就用正文,
          // 剥不出(纯机械命令)再退回抽 # 注释意图。
          const inner = stripHeredocScaffold(cmd);
          t = inner && inner !== cmd.trim() ? inner : extractHumanFromShellCommand(cmd);
        }
      }
    }
  }
  if (!t.trim()) {
    return '';
  }
  // 3) 纯工具输出(check_markdown_local_paths.py 那几类)—— 零记忆价值,整条废。
  if (/^(External URLs (ignored|not checked)|Markdown local path check|Latest phase pointers path check)\b/.test(t)) {
    return '';
  }
  // 4) <system_reminder>…</system_reminder> = 注入模板(非她记忆)→ 整块移除(变量摘要另有 inbound cue)。
  t = t.replace(/<system_reminder>[\s\S]*?<\/system_reminder>/g, ' ');
  // 5) <xiaoni_plan> 包壳 + 固定模板句 → 剥壳,留她真 plan。
  t = t.replace(/<\/?xiaoni_plan>/g, ' ');
  t = t.replace(/歇了一下，脑子里冒出来接下来想干嘛的念头（要不要照做随你）：/g, ' ');
  // 6) 残留标签壳 + 二次 "当前输入" 包壳。
  t = t.replace(/^当前输入\s*/, '');
  t = t.replace(/<\/?(system_reminder|xiaoni_plan)>/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function parseJsonPreview(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeTagKey(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const key = value.trim().toLowerCase();
  return key || null;
}

function addFeature(features, seen, key) {
  const normalized = normalizeTagKey(key);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  features.push(normalized);
}

function actionStreamTagKeys(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  return tags
    .map((tag) => normalizeTagKey(typeof tag === 'string' ? tag : tag?.key))
    .filter(Boolean);
}

function normalizeRuntimePath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }
  let normalized = path.trim()
    .replace(/[),.;:]+$/g, '')
    .replace(/^['"]|['"]$/g, '');
  if (normalized.startsWith(HOST_XIAONI_RUNTIME_ROOT)) {
    normalized = `${XIAONI_RUNTIME_ROOT}${normalized.slice(HOST_XIAONI_RUNTIME_ROOT.length)}`;
  }
  if (!normalized.startsWith(`${XIAONI_RUNTIME_ROOT}/`)) {
    return null;
  }
  return normalized.replace(/\/+/g, '/');
}

function classifyRuntimePath(path) {
  const normalized = normalizeRuntimePath(path);
  if (!normalized) {
    return null;
  }
  const relativePath = normalized.slice(XIAONI_RUNTIME_ROOT.length + 1);
  const segments = relativePath.split('/').filter(Boolean);
  const runtimeDir = segments[0] || null;
  const basename = segments[segments.length - 1] || null;
  const extension = basename && basename.includes('.')
    ? basename.slice(basename.lastIndexOf('.') + 1).toLowerCase()
    : null;
  const excluded = !runtimeDir
    || EXCLUDED_RUNTIME_DIRS.has(runtimeDir)
    || segments.includes('dist')
    || segments.includes('node_modules');
  const indexable = !excluded
    && INDEXABLE_RUNTIME_DIRS.has(runtimeDir)
    && ['md', 'txt'].includes(extension);
  return {
    path: normalized,
    relativePath,
    runtimeDir,
    basename,
    extension,
    indexable,
    excluded
  };
}

function extractRuntimePaths(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }
  const matches = text.match(/(?:\/home\/liahua\/\.qqbot-local)?\/xiaoni-runtime\/[^\s'"`<>|;&]+/g) || [];
  const seen = new Set();
  const paths = [];
  for (const match of matches) {
    const classified = classifyRuntimePath(match);
    if (!classified || seen.has(classified.path)) {
      continue;
    }
    seen.add(classified.path);
    paths.push(classified);
  }
  return paths;
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferFileOperation(command, path) {
  if (!command || !path) {
    return 'reference';
  }
  const escaped = regexEscape(path);
  if (new RegExp(`(?:^|\\s)(?:cat\\s*)?>\\s*['"]?${escaped}`).test(command)
    || new RegExp(`(?:^|\\s)>>\\s*['"]?${escaped}`).test(command)
    || new RegExp(`\\btee\\s+(?:-a\\s+)?['"]?${escaped}`).test(command)) {
    return 'write';
  }
  if (new RegExp(`\\b(cat|sed|head|tail|rg|grep|wc|ls|stat)\\b[^\\n;|&]*['"]?${escaped}`).test(command)) {
    return 'read';
  }
  return 'reference';
}

function extractCommand(item) {
  const metadata = item?.metadata || {};
  const parsed = parseJsonPreview(metadata.toolArgumentsPreview)
    || parseJsonPreview(metadata.argumentsPreview)
    || parseJsonPreview(item?.body);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return firstString(
      parsed.cmd,
      parsed.command,
      parsed.shell_command,
      parsed.shellCommand,
      parsed.input,
      parsed.text
    );
  }
  return firstString(metadata.toolArgumentsPreview, metadata.argumentsPreview, item?.body);
}

function extractQqUsage(command) {
  if (typeof command !== 'string') {
    return null;
  }
  const match = command.match(/(?:^|\s)(?:python3?\s+)?(?:\/app\/modules\/agent-service\/skills\/qq-usage\/scripts\/)?qq_usage\.py\s+([a-z_]+)(?:\s+([^\s]+))?/);
  if (!match) {
    return null;
  }
  return {
    mode: match[1],
    peerId: match[2] || null
  };
}

function sourceKindForItem(item) {
  const source = firstString(item?.source);
  const kind = firstString(item?.kind);
  const toolName = firstString(item?.metadata?.toolName, source === 'tool_execution' ? kind : null);
  const command = toolName === 'exec_command' ? extractCommand(item) : null;
  const paths = extractRuntimePaths(command || '');
  const qqUsage = extractQqUsage(command);

  if (source === 'tool_execution' && toolName === 'exec_command' && paths.some((entry) => entry.indexable)) {
    return 'db_file_provenance';
  }
  if (qqUsage) {
    return 'db_life_cue';
  }
  if (SPOKEN_KINDS.has(kind) || (source === 'tool_execution' && SPOKEN_KINDS.has(toolName))) {
    return 'db_spoken_fragment';
  }
  // Generic tool lifecycle and provider trace rows are useful for debugging,
  // but they are too broad to become passive-recall candidates by themselves.
  // Later activation code can still consult those rows as side-channel weights.
  if (source === 'tool_execution' || (source && OPERATIONAL_SOURCES.has(source))) {
    return null;
  }
  return null;
}

function privacyScopeForItem(item, cueClass) {
  const kind = firstString(item?.kind);
  const toolName = firstString(item?.metadata?.toolName, item?.source === 'tool_execution' ? kind : null);
  if (kind === 'send_in_private' || toolName === 'send_in_private') {
    return 'private_peer';
  }
  if (kind === 'send_in_group' || toolName === 'send_in_group') {
    return 'group';
  }
  if (kind === 'qq_message_seen' || toolName === 'qq_usage' || cueClass === 'db_life_cue') {
    return 'transient_private';
  }
  if (cueClass === 'db_operational_trace') {
    return 'operator_only';
  }
  return 'self_private';
}

function memoryCandidateForCue(cueClass) {
  switch (cueClass) {
    case 'db_file_provenance':
      return 'file_memory';
    case 'db_spoken_fragment':
      return 'spoken_fragment';
    default:
      return null;
  }
}

function buildSafeEmbeddingText({ item, cueClass, features, runtimePaths, command, qqUsage }) {
  const source = firstString(item?.source);
  const kind = firstString(item?.kind);
  const title = firstString(item?.title);
  const body = firstString(item?.body);

  if (cueClass === 'db_operational_trace') {
    return null;
  }

  if (cueClass === 'db_file_provenance') {
    const pathText = runtimePaths
      .filter((entry) => entry.indexable)
      .map((entry) => `${entry.runtimeDir} ${entry.relativePath.replace(/[._/-]+/g, ' ')}`)
      .join('\n');
    return truncateText([
      'xiaoni runtime file provenance',
      pathText,
      features.join(' ')
    ].filter(Boolean).join('\n'), 1200);
  }

  if (qqUsage) {
    return truncateText([
      'xiaoni qq usage cue',
      `mode ${qqUsage.mode}`,
      qqUsage.peerId ? `peer ${qqUsage.peerId}` : null,
      features.join(' ')
    ].filter(Boolean).join('\n'), 800);
  }

  if (cueClass === 'db_spoken_fragment') {
    return truncateText([
      'xiaoni spoken fragment',
      title,
      body,
      features.join(' ')
    ].filter(Boolean).join('\n'), 1200);
  }

  if (source === 'runtime_input') {
    return truncateText([
      'xiaoni runtime input cue',
      title,
      features.join(' ')
    ].filter(Boolean).join('\n'), 800);
  }

  return truncateText([
    'xiaoni life cue',
    source,
    kind,
    title,
    features.join(' ')
  ].filter(Boolean).join('\n'), 800);
}

function extractPassiveRecallCueFromActionStreamItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const source = firstString(item.source);
  const kind = firstString(item.kind);
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const toolName = firstString(metadata.toolName, source === 'tool_execution' ? kind : null);
  const command = toolName === 'exec_command' ? extractCommand(item) : null;
  const qqUsage = extractQqUsage(command);
  const cueClass = sourceKindForItem(item);
  if (!cueClass) {
    return null;
  }
  const featureSet = new Set();
  const features = [];

  addFeature(features, featureSet, source ? `source:${source}` : null);
  addFeature(features, featureSet, kind ? `kind:${kind}` : null);
  addFeature(features, featureSet, toolName ? `tool:${toolName}` : null);
  for (const tagKey of actionStreamTagKeys(item)) {
    addFeature(features, featureSet, tagKey);
  }
  if (qqUsage) {
    addFeature(features, featureSet, 'skill:qq_usage');
    addFeature(features, featureSet, `im:${qqUsage.mode}`);
    addFeature(features, featureSet, qqUsage.peerId ? `peer:${qqUsage.peerId}` : null);
  }

  const runtimePaths = extractRuntimePaths(command || '')
    .map((entry) => ({
      ...entry,
      operation: inferFileOperation(command, entry.path)
    }))
    .filter((entry) => entry.indexable);
  for (const entry of runtimePaths) {
    addFeature(features, featureSet, `runtime_dir:${entry.runtimeDir}`);
    addFeature(features, featureSet, `file_op:${entry.operation}`);
  }

  const privacyScope = privacyScopeForItem(item, cueClass);
  return {
    cueClass,
    itemId: firstString(item.id, item.eventId),
    source,
    kind,
    timestamp: firstString(item.timestamp),
    runId: firstString(item.runId),
    traceId: firstString(item.traceId),
    toolName,
    qqUsage,
    runtimePaths,
    features,
    privacyScope,
    memoryCandidate: memoryCandidateForCue(cueClass),
    safeEmbeddingText: buildSafeEmbeddingText({
      item,
      cueClass,
      features,
      runtimePaths,
      command,
      qqUsage
    })
  };
}

function extractPassiveRecallCuesFromActionStream(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map(extractPassiveRecallCueFromActionStreamItem)
    .filter(Boolean);
}

// ── 召回语料 ingest 侧(黑名单排除,统一记录)────────────────────────────────
//
// 上面的 sourceKindForItem 是「白名单包含」——只认 file/qq_usage/spoken,其它 return null。
// 白名单永远补不全(自己看过/做过/别人做过…)。召回语料反过来:非 operator/debug 噪音的
// 每一条动作流条目都是 cue。kind 只用来选 lead 措辞(缺则通用),不是收不收的门。
// 详见 docs/XIAONI_PASSIVE_RECALL_SURFACING.md。

function contentHashOf(text) {
  return crypto.createHash('sha256').update(typeof text === 'string' ? text : '').digest('hex');
}

function indexableRuntimePathsForItem(item, command) {
  return extractRuntimePaths(command || '')
    .map((entry) => ({ ...entry, operation: inferFileOperation(command, entry.path) }))
    .filter((entry) => entry.indexable);
}

function leadTemplateForItem(item, { runtimePaths }) {
  const source = firstString(item.source);
  const kind = firstString(item.kind);
  const toolName = firstString(item?.metadata?.toolName, source === 'tool_execution' ? kind : null);
  if (SPOKEN_KINDS.has(kind) || (source === 'tool_execution' && SPOKEN_KINDS.has(toolName))) {
    return 'db_spoken_fragment';
  }
  if (runtimePaths.some((entry) => entry.indexable)) {
    return 'db_file_provenance';
  }
  // 入站/别人说过:有**真** sender/peer(她自己不算,见 resolvePeerNameForItem)。
  const peer = resolvePeerNameForItem(item);
  if (peer) {
    return 'peer_message';
  }
  return null; // → 通用兜底(她自己的动作流落这里:「你之前碰过和这个像的事 → …」)
}

// 机器参数,不是语言。
//
// 动作流里混着少量**纯参数**的工具调用 —— 典型是 computer_use 的
// `{"action":"scroll","coordinate":[400,300],"scroll_amount":5,"scroll_direction":"down"}`。
// 它进语料就是纯噪音:被动召回的命题是「她不知道自己做过」,而一次滚动**没有任何**
// 值得她想起来的内容。2026-08-21 回归集实测:这类行抢到过一个 top-1(挤掉一条日记条目)。
//
// 判据必须**窄**:同样是 JSON 形状的 `{"cmd":"# 不困。53分钟。\n# 在 synth 里继续…"}`
// 和 recover_energy 的 `{"reason":"一天半了。脑子在空转。…"}` 是她最好的材料之一,
// 一条都不能误伤;`{"path":"/xiaoni-runtime/reading/liangzhuang_full.txt","limit":100}`
// (她读了哪一段)也该留着。所以不按长度卡 —— 短的中文句子会被误杀 ——
// 而是按**形状**:payload 里每一个字符串值都是**裸枚举词**(纯 ASCII 字母/下划线、
// 不含空白、不含 CJK、不含路径分隔符)才算纯参数。scroll / down / key / Return 全中,
// 中文一个字都碰不到。真库 16545 条动作流里这条命中 11 条。
const BARE_ENUM_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function isMachineParamsOnly(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false; // 不是 payload 形状,不归这条管
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false; // 解不开就当散文处理(截断过的 payload 也走这条,宁可放进去)
  }
  const strings = [];
  const walk = (node) => {
    if (typeof node === 'string') {
      strings.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk); // 只看值,不看键 —— 键是 schema 不是内容
    }
  };
  walk(parsed);
  // 一个字符串值都没有(纯数字坐标)也是纯参数。
  return strings.every((value) => BARE_ENUM_TOKEN.test(value));
}

// 把任意动作流条目(非 operator 噪音)转成统一的可召回记忆记录,或 null。
// 返回 { sourceKind, sourceRef, occurredAt, embeddingText, provenance, contentHash }。
function buildRecallCueFromActionStreamItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const source = firstString(item.source);
  // 黑名单:operator/debug 轨迹(llm 请求 / provider payload / fork 内务)不进语料。
  if (source && OPERATIONAL_SOURCES.has(source)) {
    return null;
  }
  const sourceRef = firstString(item.id, item.eventId);
  if (!sourceRef) {
    return null; // 无稳定引用无法 upsert / 排除已在场。
  }
  const kind = firstString(item.kind);
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const toolName = firstString(metadata.toolName, source === 'tool_execution' ? kind : null);
  const command = toolName === 'exec_command' ? extractCommand(item) : null;
  const runtimePaths = indexableRuntimePathsForItem(item, command);

  const title = firstString(item.title);
  const body = firstString(item.body);
  const embeddingText = truncateText(normalizeRecallText([title, body].filter(Boolean).join('\n')), 1200);
  if (!embeddingText) {
    return null; // 没有可嵌内容。
  }
  if (isMachineParamsOnly(embeddingText)) {
    return null; // 纯参数(滚动坐标之类),没有可想起来的内容。
  }

  const cueClass = sourceKindForItem(item) || 'db_life_cue';
  const leadTemplate = leadTemplateForItem(item, { runtimePaths });
  const primaryPath = runtimePaths.find((entry) => entry.indexable) || null;

  const provenance = {
    source: source || null,
    kind: kind || null,
    toolName: toolName || null,
    peer: resolvePeerNameForItem(item), // 她自己 → null(域判定与 lead 措辞都据此)
    ts: firstString(item.timestamp),
    path: primaryPath ? primaryPath.path : null,
    privacyScope: privacyScopeForItem(item, cueClass),
    cueClass,
    leadTemplate
  };

  return {
    sourceKind: 'action_stream',
    sourceRef,
    occurredAt: firstString(item.timestamp),
    embeddingText,
    provenance,
    contentHash: contentHashOf(embeddingText)
  };
}

function buildRecallCuesFromActionStream(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map(buildRecallCueFromActionStreamItem).filter(Boolean);
}

// agent_inbound_messages 行 → recall cue(补「别人说过 X」这条腿)。
// 入站内容不是动作流条目(无 command/runtimePath),单独适配但复用同一 hash/截断/记录形状。
// sourceKind='inbound' 单独成桶(feed 按腿分组);leadTemplate='peer_message'(措辞「XX 提过」)。
// 返回 { sourceKind, sourceRef, occurredAt, embeddingText, provenance, contentHash } 或 null。
function buildRecallCueFromInboundMessage(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const rawId = row.id != null ? String(row.id) : null;
  const idRef = firstString(rawId, row.message_sid, row.messageSid);
  if (!idRef) {
    return null; // 无稳定引用无法 upsert / 在场排除。
  }
  const body = firstString(row.body_for_agent, row.bodyForAgent, row.raw_body, row.rawBody, row.body);
  const embeddingText = truncateText(normalizeRecallText(body), 1200);
  if (!embeddingText) {
    return null; // 没有可嵌内容(纯图片/纯指令等)。
  }
  const peer = firstString(row.sender_name, row.senderName, row.peer_name, row.peerName);
  const chatType = firstString(row.chat_type, row.chatType);
  const tsRaw = row.message_timestamp || row.messageTimestamp || row.received_at || row.receivedAt
    || row.created_at || row.createdAt || null;
  const ts = tsRaw instanceof Date ? tsRaw.toISOString() : firstString(tsRaw);
  const privacyScope = chatType === 'group' ? 'group' : 'private_peer';
  const provenance = {
    source: 'qq_inbound',
    kind: chatType ? `inbound_${chatType}` : 'inbound',
    toolName: null,
    peer: peer || null,
    ts,
    path: null,
    privacyScope,
    cueClass: 'db_life_cue',
    leadTemplate: 'peer_message'
  };
  return {
    sourceKind: 'inbound',
    sourceRef: `inbound:${idRef}`,
    occurredAt: ts,
    embeddingText,
    provenance,
    contentHash: contentHashOf(embeddingText)
  };
}

module.exports = {
  OPERATIONAL_SOURCES,
  classifyRuntimePath,
  contentHashOf,
  isOperationalTraceText,
  isSelfPeerName,
  resolvePeerNameForItem,
  stripHeredocScaffold,
  extractHumanFromShellCommand,
  extractPassiveRecallCueFromActionStreamItem,
  extractPassiveRecallCuesFromActionStream,
  extractRuntimePaths,
  buildRecallCueFromActionStreamItem,
  buildRecallCuesFromActionStream,
  isMachineParamsOnly,
  buildRecallCueFromInboundMessage,
  normalizeRecallText
};
