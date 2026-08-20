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

const ENABLED = process.env.XIAONI_OPEN_LOOPS_NOTIFY_ENABLED === 'true';
const INTERVAL_HOURS = envNum('XIAONI_OPEN_LOOPS_NOTIFY_INTERVAL_HOURS', 24);
// 少于这个数不提 —— 清单本来就短的时候,提醒只是噪音。
const MIN_OPEN_TO_NOTIFY = envNum('XIAONI_OPEN_LOOPS_NOTIFY_MIN_OPEN', 5);

export interface OpenLoopsNotifyDeps {
  countAgentQueueMessagesSince?: unknown;
  listRecentAgentQueueDedupeKeys(params: { prefix: string; since: Date; limit?: number }, config?: unknown): Promise<string[]>;
  enqueueAgentQueueMessage(input: Record<string, unknown>, config?: unknown): Promise<{ created?: boolean } | null>;
}

export interface OpenLoopsNotifyOptions {
  enabled?: boolean;
  intervalHours?: number;
  minOpen?: number;
  now?: () => Date;
  readOpenLoops?: () => Promise<string | null>;
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
  const enabled = options.enabled ?? ENABLED;
  const intervalHours = Math.max(1, options.intervalHours ?? INTERVAL_HOURS);
  const minOpen = Math.max(0, options.minOpen ?? MIN_OPEN_TO_NOTIFY);
  const clock = options.now ?? (() => new Date());
  const readOpenLoops = options.readOpenLoops ?? defaultReadOpenLoops;

  async function notifyOnce(): Promise<'disabled' | 'too_few' | 'already_sent' | 'sent' | 'unreadable'> {
    if (!enabled) {
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

const defaultNotify = createOpenLoopsNotify(persistence as unknown as OpenLoopsNotifyDeps);

export function sendOpenLoopsPointerNotifyOnce() {
  return defaultNotify.notifyOnce();
}

export const openLoopsNotifyConfig = { enabled: ENABLED, intervalHours: INTERVAL_HOURS };
