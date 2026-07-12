const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyRuntimePath,
  extractPassiveRecallCueFromActionStreamItem,
  extractRuntimePaths
} = require('../xiaoni-passive-recall-extractor');

test('passive recall extractor treats qq_usage exec_command as a transient cue only', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'tool-exec:qq-1',
    source: 'tool_execution',
    kind: 'exec_command',
    title: 'tool: exec_command',
    body: '<IM_INBOX_WINDOW>用户说：我今天看了一部电影</IM_INBOX_WINDOW>',
    timestamp: '2026-06-24T12:00:00.000Z',
    metadata: {
      toolName: 'exec_command',
      toolArgumentsPreview: JSON.stringify({
        cmd: 'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_private 2294133947'
      }),
      toolResultPreview: '<IM_INBOX_WINDOW>用户说：我今天看了一部电影</IM_INBOX_WINDOW>'
    },
    tags: [
      { key: 'source:tool_execution' },
      { key: 'tool:exec_command' }
    ]
  });

  assert.equal(cue.cueClass, 'db_life_cue');
  assert.equal(cue.memoryCandidate, null);
  assert.deepEqual(cue.qqUsage, {
    mode: 'focus_private',
    peerId: '2294133947'
  });
  assert.ok(cue.features.includes('skill:qq_usage'));
  assert.ok(cue.features.includes('im:focus_private'));
  assert.ok(cue.features.includes('peer:2294133947'));
  assert.match(cue.safeEmbeddingText, /xiaoni qq usage cue/);
  assert.doesNotMatch(cue.safeEmbeddingText, /我今天看了一部电影/);
});

test('passive recall extractor detects whitelisted Xiaoni runtime file writes', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'tool-exec:file-1',
    source: 'tool_execution',
    kind: 'exec_command',
    title: 'tool: exec_command',
    timestamp: '2026-06-24T12:05:00.000Z',
    metadata: {
      toolName: 'exec_command',
      toolArgumentsPreview: JSON.stringify({
        cmd: "cat > /xiaoni-runtime/notes/2026-06-24/iron-fist-education-first-watch-card.md <<'EOF'\n# card\nEOF"
      })
    },
    tags: [
      { key: 'source:tool_execution' },
      { key: 'tool:exec_command' }
    ]
  });

  assert.equal(cue.cueClass, 'db_file_provenance');
  assert.equal(cue.memoryCandidate, 'file_memory');
  assert.equal(cue.runtimePaths.length, 1);
  assert.equal(cue.runtimePaths[0].path, '/xiaoni-runtime/notes/2026-06-24/iron-fist-education-first-watch-card.md');
  assert.equal(cue.runtimePaths[0].runtimeDir, 'notes');
  assert.equal(cue.runtimePaths[0].indexable, true);
  assert.equal(cue.runtimePaths[0].operation, 'write');
  assert.ok(cue.features.includes('runtime_dir:notes'));
  assert.ok(cue.features.includes('file_op:write'));
  assert.match(cue.safeEmbeddingText, /iron fist education first watch card/);
});

test('passive recall extractor omits runtime directories from returned cue paths', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'tool-exec:file-dir-1',
    source: 'tool_execution',
    kind: 'exec_command',
    timestamp: '2026-06-24T12:07:00.000Z',
    metadata: {
      toolName: 'exec_command',
      toolArgumentsPreview: JSON.stringify({
        cmd: "mkdir -p /xiaoni-runtime/notes/2026-06-24 && cat > /xiaoni-runtime/notes/2026-06-24/card.md <<'EOF'\n# card\nEOF"
      })
    },
    tags: [{ key: 'source:tool_execution' }]
  });

  assert.equal(cue.cueClass, 'db_file_provenance');
  assert.deepEqual(cue.runtimePaths.map((entry) => entry.path), [
    '/xiaoni-runtime/notes/2026-06-24/card.md'
  ]);
});

test('passive recall extractor treats Xiaoni visible sends as scoped spoken fragments', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'life:42',
    source: 'life_event',
    kind: 'qq_self_message',
    title: '发出消息',
    body: '我刚又看了下，停在第一集 5 分多钟那里。',
    timestamp: '2026-06-24T12:10:00.000Z',
    tags: [
      { key: 'source:life_event' },
      { key: 'event:visible_delivery_committed' }
    ]
  });

  assert.equal(cue.cueClass, 'db_spoken_fragment');
  assert.equal(cue.memoryCandidate, 'spoken_fragment');
  assert.equal(cue.privacyScope, 'self_private');
  assert.match(cue.safeEmbeddingText, /xiaoni spoken fragment/);
  assert.match(cue.safeEmbeddingText, /停在第一集 5 分多钟/);
});

test('passive recall extractor skips operational traces as candidate cues', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'llm-slice:slice_1',
    source: 'llm_request',
    kind: 'llm_request_slice',
    title: 'LLM 请求',
    body: 'provider wire payload',
    timestamp: '2026-06-24T12:15:00.000Z',
    tags: [{ key: 'source:llm_request' }]
  });

  assert.equal(cue, null);
});

test('passive recall extractor skips generic lifecycle events without recall-bearing terms', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'life:24680',
    source: 'life_event',
    kind: 'phone_notification',
    title: '手机 QQ 通知',
    timestamp: '2026-06-24T12:16:00.000Z',
    tags: [
      { key: 'source:life_event' },
      { key: 'event:phone_notification' }
    ]
  });

  assert.equal(cue, null);
});

test('runtime path classifier excludes generated and media paths', () => {
  assert.equal(classifyRuntimePath('/xiaoni-runtime/notes/a.md').indexable, true);
  assert.equal(classifyRuntimePath('/home/liahua/.qqbot-local/xiaoni-runtime/reading/book/card.md').path, '/xiaoni-runtime/reading/book/card.md');
  assert.equal(classifyRuntimePath('/xiaoni-runtime/notes/2026-06-24').indexable, false);
  assert.equal(classifyRuntimePath('/xiaoni-runtime/picture/a.png').indexable, false);
  assert.equal(classifyRuntimePath('/xiaoni-runtime/toys/demo/dist/index.html').indexable, false);

  const paths = extractRuntimePaths('cat /xiaoni-runtime/notes/a.md && cat /xiaoni-runtime/notes/a.md');
  assert.equal(paths.length, 1);
});

test('normalizeRecallText:剥样板/脚手架,留信号(闲聊+她真plan不动)', () => {
  const { normalizeRecallText } = require('../xiaoni-passive-recall-extractor');
  // 纯工具输出 → 废
  assert.strictEqual(normalizeRecallText('External URLs ignored.\nGenerated by /x/check_markdown_local_paths.py.'), '');
  assert.strictEqual(normalizeRecallText('Markdown local path check — actual 2026-06-17\nsource: /x'), '');
  // system_reminder 注入模板 → 整块移除
  assert.strictEqual(normalizeRecallText('当前输入 <system_reminder> 模板文 xxx </system_reminder>'), '');
  // xiaoni_plan 包壳 → 剥壳留她真 plan
  assert.strictEqual(
    normalizeRecallText('当前输入 <xiaoni_plan> 歇了一下，脑子里冒出来接下来想干嘛的念头（要不要照做随你）： 去把ch86读了'),
    '去把ch86读了'
  );
  // 闲聊 = 信号,原样
  assert.strictEqual(normalizeRecallText('兄弟对面少个人'), '兄弟对面少个人');
  assert.strictEqual(normalizeRecallText(''), '');
  assert.strictEqual(normalizeRecallText(null), '');
});

// 真库 shadow_log 取的运营脚手架样本(P1):这些当 query 100% 触发召回、全噪音;当 cue 污染语料。
test('normalizeRecallText:剥运营信封(LLM切片标题/工具JSON/入站信封/通知壳),留她真内容', () => {
  const { normalizeRecallText } = require('../xiaoni-passive-recall-extractor');

  // LLM 请求切片标题 → 整条废(真库 102 条全触发)
  assert.strictEqual(normalizeRecallText('anthropic/messages · claude-opus-4-6 · turn 10 · 147900->2 tokens'), '');
  assert.strictEqual(normalizeRecallText('anthropic/messages · claude-opus-4-6 · turn 1 · 248803->457 tokens'), '');

  // 入站信封 JSON {"user_id":..,"message":"X"} → 留 X(别整条丢,message 是别人真说的话)
  assert.strictEqual(
    normalizeRecallText('{"user_id":3548435475,"message":"又撞了哈哈 手心是热的"}'),
    '又撞了哈哈 手心是热的'
  );

  // 工具调用 JSON {"cmd":"# 意图\n机械命令"} → 抽注释意图(她的思考落点),丢机械壳
  assert.strictEqual(
    normalizeRecallText('{"cmd":"# 找\\"从一把葱到两把葱\\"\\ngrep -n scallion file.md"}'),
    '找"从一把葱到两把葱"'
  );
  // 纯机械命令(无注释)→ '' (无记忆价值,宁静默勿噪音)
  assert.strictEqual(normalizeRecallText('{"cmd":"grep -rn foo /xiaoni-runtime/notes | head"}'), '');

  // "请求工具: exec_command {…}" 前缀壳 → 剥壳后再拆 JSON 抽意图
  assert.strictEqual(
    normalizeRecallText('请求工具: exec_command {"cmd":"# 补 relay 文件第四段\\ncat >> x.md"}'),
    '补 relay 文件第四段'
  );

  // "等待处理消息 chat_label=…" 通知壳 → 整条废(入站真内容另有 inbound cue,不双记)
  assert.strictEqual(normalizeRecallText('等待处理消息 chat_label=私聊 橙橙🍊(3548435475) 有新消息'), '');

  // 真实召回信号必须存活(真库里冒出来的好 lead):她自己的过去 + 别人说过
  assert.strictEqual(
    normalizeRecallText('干了快三十个小时了一直在自己的站和别人的站之间跳来跳去，脑子全是冰箱味'),
    '干了快三十个小时了一直在自己的站和别人的站之间跳来跳去，脑子全是冰箱味'
  );
});

test('isOperationalTraceText / extractHumanFromShellCommand 单元', () => {
  const { isOperationalTraceText, extractHumanFromShellCommand } = require('../xiaoni-passive-recall-extractor');
  assert.strictEqual(isOperationalTraceText('anthropic/messages · claude-opus-4-6 · turn 8 · 1->2 tokens'), true);
  assert.strictEqual(isOperationalTraceText('去把ch86读了'), false);
  // 注释意图抽取;heredoc/机械标记注释(# PY / #!/bin/bash)不算意图
  assert.strictEqual(extractHumanFromShellCommand('# 她的404页面写了\ncat x.md'), '她的404页面写了');
  assert.strictEqual(extractHumanFromShellCommand('python3 - <<PY\n# PY\nprint(1)\nPY'), '');
  assert.strictEqual(extractHumanFromShellCommand('#!/bin/bash\ngrep foo bar'), '');
  // URL 里的 # 不误伤(无前置空白)
  assert.strictEqual(extractHumanFromShellCommand('curl -sL "https://aoi.homes/about#top"'), '');
});
