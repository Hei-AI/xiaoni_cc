// 欠账的定时指针通知 —— 召回腿的替代品。
//
// CONTEXT.md:「**欠账不走召回**。它有完成态、有标签、她自己有一份清单;让她去看清单比把
// 条目挑出来推给她更直接。」在此之前欠账是投递里的一条腿,而且实测会把日额吃光
// (2026-08-07:6 条全被它拿走,association 一条没轮到)。
//
// 为什么只给指针 + 计数,不列条目:一列具体条目就又变成待办推送,而且会重新引入我们
// 刚甩掉的那一整套(挑哪几条、怎么排序、怎么去重、重投窗号)。计数是唯一值得给的信息,
// 因为那是她自己看不到的**总量感** —— 菜单里没有这个数。
//
// 频率可调(XIAONI_OPEN_LOOPS_NOTIFY_INTERVAL_HOURS)。与作息绑定留后。

import fs from 'node:fs/promises';
import path from 'node:path';

import * as persistence from '@qq-bot/persistence';

import { agentConfig, databaseConfig, getGlobalPromptContextSessionKey } from '../config';
import { logger } from '../utils/logger';
import { renderXiaoniPromptTemplate } from '../prompts/xiaoni-prompt-files';

const moduleLogger = logger.createModuleLogger('xiaoni-open-loops-notify');
const IDENTITY_KEY = 'xiaoni';
const DEDUPE_PREFIX = 'open-loops-pointer:';
const RUNTIME_ROOT = process.env.XIAONI_RUNTIME_ROOT || '/xiaoni-runtime';
const OPEN_LOOPS_REL = 'notes/diary/open-loops.md';

const envNum = (name: string, dflt: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : dflt;
};

// 开关的唯一真理源是 agent_runtime_control(管理端可改、每拍现读),不是 env。
// 这条通道会**主动唤醒主 loop**,ADR-0005 把「别吵」的责任放在闸门上 ——
// 那么「关得掉」就必须是结构性事实,不能是「改 compose 再重启整个 agent-service」。
// 读失败 → fail-closed 当关着。
const INTERVAL_HOURS = envNum('XIAONI_OPEN_LOOPS_NOTIFY_INTERVAL_HOURS', 24);
// 少于这个数不提 —— 清单本来就短的时候,提醒只是噪音。
const MIN_OPEN_TO_NOTIFY = envNum('XIAONI_OPEN_LOOPS_NOTIFY_MIN_OPEN', 5);

export interface OpenLoopsNotifyDeps {
  listRecentAgentQueueDedupeKeys(params: { prefix: string; since: Date; limit?: number }, config?: unknown): Promise<string[]>;
  enqueueAgentQueueMessage(input: Record<string, unknown>, config?: unknown): Promise<{ created?: boolean } | null>;
}

export interface OpenLoopsNotifyOptions {
  /** 现读开关。默认走 agent_runtime_control.open_loops_notify_enabled。 */
  readEnabled?: () => Promise<boolean>;
  intervalHours?: number;
  minOpen?: number;
  now?: () => Date;
  readOpenLoops?: () => Promise<string | null>;
}

// 活动窗(东八区)。与投递闸同一个理由:notify 会唤醒主 loop,而 00:00 前后正是她收尾
// 睡觉的窗口 —— 2026-08-13 实测过,那个时段投出去的 24 条只换来「记着。明天处理。」。
// 槽位按东八零点滚动,所以不加这道闸的话,跨日后第一拍(15 分钟内)就会在半夜把她叫醒。
const ACTIVE_WINDOW_START_HOUR = 9;
const ACTIVE_WINDOW_END_HOUR = 23;

export function isWithinActiveWindow(now: Date): boolean {
  const east8Hour = new Date(now.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
  return east8Hour >= ACTIVE_WINDOW_START_HOUR && east8Hour < ACTIVE_WINDOW_END_HOUR;
}

// 槽位 = 从东八区纪元起的第 N 个 interval。键在槽上 → 整条腿幂等且无状态:
// 漏一拍只是跳过一个槽,重复一拍被 dedupe_key 唯一索引吞,重启即续。
export function slotIdOf(now: Date, intervalHours: number): string {
  const EAST8_MS = 8 * 60 * 60 * 1000;
  const slotMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
  return String(Math.floor((now.getTime() + EAST8_MS) / slotMs));
}

export function countOpenLoops(markdown: string | null): number {
  if (typeof markdown !== 'string') {
    return 0;
  }
  // 与 xiaoni-memory-write 的 loops 子命令同口径:`- [ ]` 未完成,`- [x]` / `- [-]` 已了。
  return (markdown.match(/^\s*-\s*\[ \]/gm) || []).length;
}

async function defaultReadOpenLoops(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(RUNTIME_ROOT, OPEN_LOOPS_REL), 'utf8');
  } catch {
    return null;
  }
}

export function createOpenLoopsNotify(deps: OpenLoopsNotifyDeps, options: OpenLoopsNotifyOptions = {}) {
  const readEnabled = options.readEnabled ?? defaultReadEnabled;
  const intervalHours = Math.max(1, options.intervalHours ?? INTERVAL_HOURS);
  const minOpen = Math.max(0, options.minOpen ?? MIN_OPEN_TO_NOTIFY);
  const clock = options.now ?? (() => new Date());
  const readOpenLoops = options.readOpenLoops ?? defaultReadOpenLoops;

  async function notifyOnce(): Promise<'disabled' | 'outside_window' | 'too_few' | 'already_sent' | 'sent' | 'unreadable'> {
    // 每拍现读:管理端关掉后最多一拍就停,不用重启。
    if (!(await readEnabled().catch(() => false))) {
      return 'disabled';
    }
    const markdown = await readOpenLoops().catch(() => null);
    if (markdown === null) {
      return 'unreadable'; // 读不到就不提,不猜数
    }
    const openCount = countOpenLoops(markdown);
    if (openCount < minOpen) {
      return 'too_few';
    }
    const now = clock();
    if (!isWithinActiveWindow(now)) {
      return 'outside_window';
    }
    const slot = slotIdOf(now, intervalHours);
    const dedupeKey = `${DEDUPE_PREFIX}${slot}`;

    // 本槽投过没有 —— 靠队列里的键判,不另存游标。
    const sent = await deps.listRecentAgentQueueDedupeKeys({
      prefix: DEDUPE_PREFIX,
      since: new Date(now.getTime() - intervalHours * 2 * 60 * 60 * 1000),
      limit: 50
    }, databaseConfig).catch(() => [] as string[]);
    if (Array.isArray(sent) && sent.includes(dedupeKey)) {
      return 'already_sent';
    }

    const text = renderXiaoniPromptTemplate('open_loops_pointer_notify.md', {
      OPEN_COUNT: openCount
    }).trimEnd();
    if (!text) {
      return 'too_few';
    }

    const botAccountId = agentConfig.botAccountId;
    const sessionKey = getGlobalPromptContextSessionKey();
    // trace_id 显式给足:空 trace_id 会让 stack 的 runtime-input event_id 塌到 runId 兜底,
    // 同 run 两条撞 ON CONFLICT 被吞 → 下个 run replay 变短 → run 边界缓存击穿
    // (docs/CACHE_CONTRACT.md §3)。
    const traceId = `runtrace_${now.getTime()}_ol${slot.slice(-6)}`;
    const inboundContext = {
      Body: text, BodyForAgent: text, BodyForCommands: text, RawBody: text, CommandBody: text,
      From: botAccountId, To: botAccountId, SessionKey: sessionKey, AccountId: botAccountId,
      ChatType: 'direct', ConversationLabel: IDENTITY_KEY, SenderName: IDENTITY_KEY,
      SenderId: botAccountId, Timestamp: now.getTime(), Provider: 'runtime',
      Surface: 'system_reminder', WasMentioned: false, NativeChannelId: sessionKey,
      CommandAuthorized: false
    };
    const result = await deps.enqueueAgentQueueMessage({
      message: {
        traceId,
        source: 'system_reminder',
        messageSid: dedupeKey,
        dedupeKey,
        chatType: 'direct',
        sessionKey,
        peerId: IDENTITY_KEY,
        peerName: IDENTITY_KEY,
        senderId: botAccountId,
        senderName: IDENTITY_KEY,
        accountId: botAccountId,
        bodyForAgent: text,
        rawPayload: { reason: 'open_loops_pointer', open_count: openCount, slot },
        inboundContext
      },
      payload: {
        messageId: dedupeKey,
        rawBody: text,
        commandBody: text,
        receivedAt: now.toISOString(),
        // 正文在**此刻**冻结进这里;下一 run 的 stack replay 从同一字段逐字节读回。
        systemReminder: {
          reminder: text,
          reason: 'open_loops_pointer',
          openCount,
          createdAt: now.toISOString()
        }
      },
      availableAt: now
    }, databaseConfig);

    if (result?.created === true) {
      moduleLogger.info('Sent open-loops pointer notify', { openCount, slot, intervalHours });
      return 'sent';
    }
    return 'already_sent';
  }

  return { notifyOnce };
}

async function defaultReadEnabled(): Promise<boolean> {
  const control = await persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' }, databaseConfig);
  return control.openLoopsNotifyEnabled === true;
}

const defaultNotify = createOpenLoopsNotify(persistence as unknown as OpenLoopsNotifyDeps);

// ── 在等别人的条目 ────────────────────────────────────────────────────────────
// 行内字段 `⏳在等谁` 是正式标记(memory_write.py loops wait / add --waiting-on 写的)。
// 兜底:她新记「等X回」时可能忘了带 --waiting-on,正文以「等」开头、或写着「等…回 / 回复 / 开口 / 接 / 答」的也算在等。
const OPEN_LINE_RE = /^\s*[-*]\s*\[ \]\s*(.*)$/;
const WAITING_MARK = '⏳';
const WAITING_FIELD_RE = /\s*⏳[^#]*?(?=\s+#[^\s#()（）]|\s*[（(]\s*\d{1,2}\s*\/\s*\d{1,2}|\s*$)/u;
const TRAILING_TAGS_DATES_RE = /(?:\s+#[^\s#()（）]+|\s*[（(]\s*\d{1,2}\s*\/\s*\d{1,2}[^)）]*[)）])+\s*$/u;
const WAITING_HINT_RE = /^等|等[^。；;，,]{0,24}?(?:回|回复|开口|接|答)/u;
const NUDGE_ITEM_MAX_CHARS = 60;

function openLineBody(line: string): string | null {
  const matched = OPEN_LINE_RE.exec(line);
  return matched ? matched[1]!.trim() : null;
}

// 给她看的那一句:去掉在等字段、行尾的 #标签 和 (日期),太长截断。
export function displayOpenLoopBody(body: string): string {
  const text = body.replace(WAITING_FIELD_RE, ' ').replace(TRAILING_TAGS_DATES_RE, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  return chars.length > NUDGE_ITEM_MAX_CHARS ? `${chars.slice(0, NUDGE_ITEM_MAX_CHARS).join('')}…` : text;
}

export function isWaitingOpenLoopBody(body: string): boolean {
  if (body.includes(WAITING_MARK)) {
    return true;
  }
  return WAITING_HINT_RE.test(displayOpenLoopBody(body));
}

// 不阻塞的条目(开着、不在等别人),给她看的那一句。
export function listActionableOpenLoops(markdown: string | null): string[] {
  if (typeof markdown !== 'string') {
    return [];
  }
  return markdown.split('\n')
    .map(openLineBody)
    .filter((body): body is string => body !== null && body.length > 0 && !isWaitingOpenLoopBody(body))
    .map(displayOpenLoopBody)
    .filter((text) => text.length > 0);
}

// 按 seed 出的确定性随机数(mulberry32)。seed 用 runId+turn:同一个点重算抽到的是同一组,事后好对。
export function seededRandom(seed: string): () => number {
  let state = 0;
  for (const ch of seed) {
    state = (Math.imul(state, 31) + ch.codePointAt(0)!) >>> 0;
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 洗牌后取前 count 条(不足全取)。
export function pickOpenLoopsForNudge(items: string[], count: number, random: () => number): string[] {
  const pool = items.slice();
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }
  return pool.slice(0, Math.max(0, count));
}

// 读不到文件 → null(不续跑,交给潜意识 fork);读得到 → 不阻塞的条目(可能是空的)。
export async function readOpenLoopsActionableLines(): Promise<string[] | null> {
  const markdown = await defaultReadOpenLoops();
  return typeof markdown === 'string' ? listActionableOpenLoops(markdown) : null;
}

// todo 工具 list 用:没划掉的那几行原样返回,分成能推的和在等别人的。读不到 = 空。
export async function readOpenLoopsOpenLines(): Promise<{ actionable: string[]; waiting: string[] }> {
  const markdown = await defaultReadOpenLoops();
  const result = { actionable: [] as string[], waiting: [] as string[] };
  if (typeof markdown !== 'string') {
    return result;
  }
  for (const line of markdown.split('\n')) {
    const body = openLineBody(line);
    if (body === null) {
      continue;
    }
    (isWaitingOpenLoopBody(body) ? result.waiting : result.actionable).push(line.trim());
  }
  return result;
}

export function sendOpenLoopsPointerNotifyOnce() {
  return defaultNotify.notifyOnce();
}

export const openLoopsNotifyConfig = { intervalHours: INTERVAL_HOURS };
