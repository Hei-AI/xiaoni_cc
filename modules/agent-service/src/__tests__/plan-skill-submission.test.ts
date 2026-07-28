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
  extractPlanQueuedId,
  extractPlanFailedReason,
  isAllowedSubconsciousCommand,
  XIAONI_PLAN_SKILL_BIN,
  setIdlePlanSkillSubmissionEnabled,
  isIdlePlanSkillSubmissionEnabledForTest,
  renderSubconsciousForkReminderForTest,
  renderSubconsciousPlanCorrectionForTest,
  renderSelfContinuationReminderForTest
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

test('plan marker：QUEUED 只认纯数字，FAILED 带原因', () => {
  assert.equal(extractPlanQueuedId({ stdout: 'XIAONI_PLAN_QUEUED=33858\n' }), '33858');
  assert.equal(extractPlanQueuedId({ stdout: 'XIAONI_PLAN_QUEUED=abc\n' }), null);
  assert.equal(extractPlanFailedReason({ stdout: 'XIAONI_PLAN_FAILED=http_500:enqueue_failed\n' }), 'http_500:enqueue_failed');
  assert.equal(extractPlanFailedReason({ stdout: 'XIAONI_PLAN_QUEUED=1\n' }), null);
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

test('纠正提示随开关换口径，两种口径都非空', () => {
  setIdlePlanSkillSubmissionEnabled(false);
  const offText = renderSubconsciousPlanCorrectionForTest();
  assert.ok(offText.includes('xiaoni_plan'), 'OFF 时应还是「写进 <xiaoni_plan>」的口径');
  setIdlePlanSkillSubmissionEnabled(true);
  const onText = renderSubconsciousPlanCorrectionForTest();
  assert.ok(onText.includes('xiaoni-plan post'), 'ON 时应是「用 skill 交」的口径');
  assert.notEqual(offText, onText);
  setIdlePlanSkillSubmissionEnabled(false);
});
