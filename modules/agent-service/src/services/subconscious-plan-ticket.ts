import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// 自驱动 plan 提交的一次性票据(docs/specs/xiaoni-plan-skill-submission.md)。
//
// 为什么走文件而不是把 token 塞进 prompt：token 每个 fork 都不一样，任何每轮变化的串一旦进了
// 请求就是缓存漂移面（CLAUDE.md 双缓存铁律）。落盘之后 token 一个字节都不进 LLM 请求 ——
// skill 自己去目录里捞最新一张未消费的票。两个容器共享 /xiaoni-runtime，所以 agent-service 写、
// xiaoni-executor 里跑的 skill 读，没有额外通道。
//
// 票据【不是】鉴权的全部：兑现时端点还要再验「这个 fork 当前确实在飞」(1A)。没有那一道，票据的
// 有效期就只跟「文件还在 + 没过期」挂钩，与 fork 死活无关 —— fork 崩了/超时了之后遗留票据仍能
// 在窗口内兑出一条没人负责的 plan notify，而 enqueueSubconsciousAgentNotify 会把一个早已死掉的
// forkRunId 记进 messageSid，溯源直接失真。

export const SUBCONSCIOUS_PLAN_TICKET_DIR = '/xiaoni-runtime/plan/inbox';
export const SUBCONSCIOUS_PLAN_TICKET_TTL_MS = 10 * 60 * 1000;

export type SubconsciousPlanTicket = {
  token: string;
  forkRunId: string;
  traceId: string;
  runId: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

function ticketPath(forkRunId: string, dir: string): string {
  // forkRunId 形如 `subconscious-fork:<runId>:<hex>`，冒号在文件名里合法但难看且易踩；统一换成 `_`。
  return path.join(dir, `${forkRunId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

function parseTicket(raw: string): SubconsciousPlanTicket | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const token = typeof parsed.token === 'string' ? parsed.token : '';
    const forkRunId = typeof parsed.fork_run_id === 'string' ? parsed.fork_run_id : '';
    if (!token || !forkRunId) {
      return null;
    }
    return {
      token,
      forkRunId,
      traceId: typeof parsed.trace_id === 'string' ? parsed.trace_id : '',
      runId: typeof parsed.run_id === 'string' ? parsed.run_id : '',
      issuedAtMs: Number(parsed.issued_at_ms) || 0,
      expiresAtMs: Number(parsed.expires_at_ms) || 0
    };
  } catch {
    return null;
  }
}

/** fork 启动前签发。同一个 forkRunId 重复签发会覆盖旧票（重试同一份 seed 时就是这个情况）。 */
export function issueSubconsciousPlanTicket(params: {
  forkRunId: string;
  traceId: string;
  runId: string;
  nowMs: number;
  dir?: string;
}): SubconsciousPlanTicket {
  const dir = params.dir ?? SUBCONSCIOUS_PLAN_TICKET_DIR;
  const ticket: SubconsciousPlanTicket = {
    token: crypto.randomUUID(),
    forkRunId: params.forkRunId,
    traceId: params.traceId,
    runId: params.runId,
    issuedAtMs: params.nowMs,
    expiresAtMs: params.nowMs + SUBCONSCIOUS_PLAN_TICKET_TTL_MS
  };
  fs.mkdirSync(dir, { recursive: true });
  const target = ticketPath(ticket.forkRunId, dir);
  // 原子落盘：先写 tmp 再 rename，避免 skill 读到写了一半的 JSON。
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({
    token: ticket.token,
    fork_run_id: ticket.forkRunId,
    trace_id: ticket.traceId,
    run_id: ticket.runId,
    issued_at_ms: ticket.issuedAtMs,
    expires_at_ms: ticket.expiresAtMs
  }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, target);
  return ticket;
}

/** 按 token 找票。同时顺手清掉已过期的孤儿票（fork 崩掉时留下的）。 */
export function findSubconsciousPlanTicket(params: {
  token: string;
  nowMs: number;
  dir?: string;
}): { ticket: SubconsciousPlanTicket; filePath: string } | null {
  const dir = params.dir ?? SUBCONSCIOUS_PLAN_TICKET_DIR;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let found: { ticket: SubconsciousPlanTicket; filePath: string } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(dir, entry);
    let ticket: SubconsciousPlanTicket | null = null;
    try {
      ticket = parseTicket(fs.readFileSync(filePath, 'utf8'));
    } catch {
      ticket = null;
    }
    if (!ticket) {
      continue;
    }
    if (ticket.expiresAtMs <= params.nowMs) {
      // 过期票就地清掉：没有 1A 之外的安全意义，但不清会一直堆(60 天约 44 张)。
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* 清理失败不影响兑现路径 */
      }
      continue;
    }
    if (!found && timingSafeEqualString(ticket.token, params.token)) {
      found = { ticket, filePath };
    }
  }
  return found;
}

export function consumeSubconsciousPlanTicket(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* 已经不在了也算消费掉 */
  }
}

// 常数时间比较：token 是凭据，普通 === 会按前缀早退，泄漏可猜测的时间信号。
function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
