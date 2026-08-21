'use strict';

// 召回候选的 importance —— 「她的投入痕迹」。
//
// 形状抄斯坦福小镇(Generative Agents, arXiv 2304.03442):检索分 =
// recency + importance + relevance 三项归一等权。但**不抄它写入时的 LLM 打分**:
// 那套里 importance 由模型在记忆创建时打 1-10,能成立是因为他们的记忆是玩具世界里的通用
// 观察(「刷牙」=2、「约暗恋对象」=8),任何模型都判得出。她的不是 —— 「楠楠说了一句 stay」
// 是 2 还是 8,取决于楠楠是谁、她这阵子在扛什么。见 docs/adr/0006。
//
// 我们的替代信号是她自己的书写行为。但 2026-08-19 真库实测(4000 条候选)发现:
// **这些证据只在她写的东西上成立**,套到入站消息上四个因子全塌 ——
//
//   因子            inbound   diary   topics  people
//   introspection    0.016    0.075   0.018   0.196
//   peer             0.030    0.337   0.230   0.294
//   effort           0.011    0.372   0.164   0.388
//   prose            1.000    0.990   1.000   1.000
//
// 三种坏法各不相同,结论也各不相同:
//   · prose 全类别恒 1 → 零信息,**弃用**(它量的是「正文里 bullet 占比」,为日记那种
//     「一段话 vs 日内小目录」设计;文件切块之后根本没有 bullet-majority 结构)。
//   · effort 在 inbound 上 0.011 → 不是「投入低」是恒 0:阈值 EFFORT_MIN_CHARS=60 按她的
//     日记正文长度校准,而入站消息普遍不到 60 字。
//   · introspection / peer 在 inbound 上塌,根因不是阈值 —— 它们量的是**她**的投入,
//     而入站消息是别人写的。
//
// 所以 importance 的**证据按类别不同**,而这带来一条纪律:
//
//   两类的 importance 不在同一把尺子上,**绝不跨类比大小**。
//   importance 只决定「同类候选里谁先」;跨类的比较交给 relevance 和 recency
//   —— 那两个是真正跨类同尺的量。调用方据此分类选拔,别把它们加进一个总分里排。

const {
  INTROSPECTION_RE,
  effortScoreOf,
  titleSpecificityOf,
  MIN_PEER_NAME_CHARS
} = require('./xiaoni-recall-association');

// 候选的两个类别。判据是**谁写的**,不是存在哪张表 —— 这是上面那张表的直接结论。
const AUTHORED_BY_HER = 'authored_by_her'; // 日记条目 / 人物档案 / 专题 / 身份锚点
const AUTHORED_BY_PEER = 'authored_by_peer'; // 入站消息

// 她写的那几类文件(与 xiaoni-recall-store 的 RECALL_SCOPE_SQL 文件 allowlist 对应)。
const HER_FILE_RE = /\/notes\/(diary|people|topics)\/|long-term\.md|xiaoni-identity-anchor/;

function classifyCandidate(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const provenance = c.provenance && typeof c.provenance === 'object' ? c.provenance : {};
  const sourceKind = typeof c.sourceKind === 'string' ? c.sourceKind : provenance.sourceKind;
  if (sourceKind === 'inbound') {
    return AUTHORED_BY_PEER;
  }
  const ref = typeof c.sourceRef === 'string' ? c.sourceRef : '';
  const path = typeof provenance.path === 'string' ? provenance.path : '';
  if (HER_FILE_RE.test(ref) || HER_FILE_RE.test(path)) {
    return AUTHORED_BY_HER;
  }
  // 兜底归她那一类:动作流里剩下的是 db_spoken_fragment(她自己说的话)。
  return provenance.cueClass === 'db_life_cue' && provenance.peer ? AUTHORED_BY_PEER : AUTHORED_BY_HER;
}

// 标题优先从 provenance.heading 读 —— chunker 现在给每块都补上了所属小节的标题
// (见 xiaoni-recall-file-chunker.js:chunkRuntimeFile),文本里也有一份。
// 存量行(补标题之前入的库)没有这个字段,退回从文本首行解析;两处都拿不到 → 记中性值,
// 既不奖励也不惩罚(缺标题是切块的产物,不是她写得含糊)。存量随 reindex 重切后自然消失。
const HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*$/;
const NEUTRAL_TITLE_SPECIFICITY = 0.5;

function headingOf(text) {
  const first = (typeof text === 'string' ? text : '').split(/\r?\n/, 1)[0] || '';
  const m = HEADING_RE.exec(first);
  return m ? m[1] : null;
}

// 候选的标题:provenance.heading 优先,退回文本首行。
function candidateHeadingOf(candidate, text) {
  const provenance = candidate && typeof candidate.provenance === 'object' && candidate.provenance
    ? candidate.provenance
    : {};
  if (typeof provenance.heading === 'string' && provenance.heading.trim()) {
    const m = HEADING_RE.exec(provenance.heading.trim());
    return m ? m[1] : provenance.heading.trim();
  }
  return headingOf(text);
}

function mean(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

// 她写的东西:力气 / 有没有写「当时」那一层 / 标题指不指得出是哪件事 / 有没有真人在里面。
function importanceOfHers(candidate, text, ctx) {
  const heading = candidateHeadingOf(candidate, text);
  const body = headingOf(text) ? text.slice(text.indexOf('\n') + 1) : text;
  const peerNames = Array.isArray(ctx.peerNames) ? ctx.peerNames : [];
  const factors = {
    effort: effortScoreOf(body),
    introspection: INTROSPECTION_RE.test(body) ? 1 : 0,
    titleSpecificity: heading === null ? NEUTRAL_TITLE_SPECIFICITY : titleSpecificityOf(heading),
    peer: peerNames.some((name) => typeof name === 'string'
      && name.length >= MIN_PEER_NAME_CHARS
      && text.includes(name)) ? 1 : 0
  };
  return { importance: mean(Object.values(factors)), factors: { ...factors, titleMissing: heading === null } };
}

// 别人写的东西:她这一侧没有书写痕迹可量,但有一个**她特意做过的动作** ——
// 给这个人建过档案没有。`notes/people/<id>.md` 存在 ⟺ 她坐下来把这个人写下来了。
// 真库实测(近 30 天 10077 条入站):36% 来自有档案的发信人(44 个发信人里 11 个有档案),
// 私聊占 28%。这两个是 inbound 上仅有的有区分度的信号 ——
//   · was_mentioned 恒 0(那一列从来没被写过,是死列,别去够它)
//   · is_read 在候选里恒 1(未读的早被 filterInboundBricksByPresence 硬挡在外,
//     「未读 = 从没进过她脑子 = 不是记忆」),当因子等于常数
//   · reply_to 只有 3%,太稀疏
function importanceOfPeers(candidate, ctx) {
  const provenance = candidate.provenance && typeof candidate.provenance === 'object' ? candidate.provenance : {};
  // inbound cue 的 provenance 只带发信人**名字**(`peer`),没有 QQ 号 —— 所以「有没有档案」
  // 按名字比,表来自她自己维护的人物菜单(notes/people/INDEX.md,reindex 侧 readPeerNames)。
  // 一份名字表同时喂 peer 与 profiledPeer 两个因子,不另建第二份。
  const peerNames = Array.isArray(ctx.peerNames) ? ctx.peerNames : [];
  const sender = typeof provenance.peer === 'string' ? provenance.peer.trim() : '';
  const factors = {
    profiledPeer: sender && peerNames.some((name) => typeof name === 'string'
      && name.length >= MIN_PEER_NAME_CHARS
      && (name === sender || sender.includes(name))) ? 1 : 0,
    // 私聊 vs 群:真库 4144 / 7916。`kind` 与 `privacyScope` 一一对应,认 kind。
    direct: provenance.kind === 'inbound_direct' ? 1 : 0
  };
  return { importance: mean(Object.values(factors)), factors };
}

// 单条候选的 importance。返回 { klass, importance ∈ [0,1], factors }。
// 铁律(见文件头):**不同 klass 的 importance 不可比**,调用方只能在同 klass 内用它排序。
function scoreCandidateImportance(candidate, ctx = {}) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const klass = classifyCandidate(c);
  const text = typeof c.embeddingText === 'string' ? c.embeddingText : '';
  const scored = klass === AUTHORED_BY_PEER
    ? importanceOfPeers(c, ctx)
    : importanceOfHers(c, text, ctx);
  return { klass, importance: scored.importance, factors: scored.factors };
}

// 按 klass 分组。调用方用它做「类内按 importance 选拔 → 跨类按 relevance/recency 比」。
function groupCandidatesByAuthor(candidates, ctx = {}) {
  const groups = new Map([[AUTHORED_BY_HER, []], [AUTHORED_BY_PEER, []]]);
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const scored = scoreCandidateImportance(candidate, ctx);
    groups.get(scored.klass).push({ candidate, ...scored });
  }
  for (const list of groups.values()) {
    list.sort((x, y) => y.importance - x.importance);
  }
  return groups;
}

module.exports = {
  AUTHORED_BY_HER,
  AUTHORED_BY_PEER,
  classifyCandidate,
  headingOf,
  scoreCandidateImportance,
  groupCandidatesByAuthor
};
