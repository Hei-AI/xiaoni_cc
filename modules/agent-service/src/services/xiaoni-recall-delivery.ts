// 被动浮现【投递闸】—— 把召回结果真的送到小腻面前。
//
// 在此之前全链 shadow-only(只写 xiaoni_recall_shadow_log + 管理端观察面)。本模块是唯一
// 的投递出口,默认 **OFF**(XIAONI_PASSIVE_RECALL_DELIVERY_ENABLED)。
//
// ── 为什么只投这两条腿 ────────────────────────────────────────────────────
// 2026-08-07 真库(近 7 天 surfaced)按腿统计「浮了多少次 / 多少个不同 ref」:
//   association        666 / 666  = 100%   ← 投
//   open_loop           82 /  63  =  77%   ← 投
//   peer_message      2369 / 862  =  36%
//   file_chunk        4226 / 949  =  22.5%
//   diary_event        646 /  83  =  12.8%
//   db_file_provenance 648 /  10  =   1.5%
// 唯一率低 = 同一块砖反复砸 = 复读机。向量腿刚补上 per-cue 冷却(见
// xiaoni-recall-ingest.js),但那是**新装的闸,还没有活体分布**;先只放高唯一率的两条腿,
// 等冷却在 shadow 里跑出稳定唯一率再逐条加。
//
// ── 为什么走 Notify Bucket 而不是 turn 尾注入 ────────────────────────────
// 设计文档(XIAONI_PASSIVE_RECALL_SURFACING.md §Deferred)原本写的是 turn-input 尾注入 +
// cache_volatile。改走 Notify Bucket 是有意的:那条路径的缓存安全**已经在线验过** ——
// 正文在 enqueue 时刻冻结进 payload.systemReminder.reminder,下一 run 的 stack replay 从
// 同一字段读回同样的字节,逐字节可重建(同 enqueueCoreMemoryCompressionDoneNotify /
// enqueueExternalNotify)。缓存安全是**继承**来的,不是在这里重新推导的。
// 代价:notify 会唤醒主 loop —— 所以有硬日额(下面 DAILY_CAP)。
//
// ── 幂等 ──────────────────────────────────────────────────────────────────
// dedupeKey = `recall-surface:<leg>:<ref>`,同一段记忆**永远**只投一次:
// agent_queue_messages.dedupe_key 有唯一索引,enqueueAgentQueueMessage 撞了就返回既有行
// (不重复入队)。队列行自 2026-03 起从不清理,所以这条幂等是长期成立的,不需要另建投递账本。

import * as persistence from '@qq-bot/persistence';
import { agentConfig, databaseConfig, getGlobalPromptContextSessionKey } from '../config';
import { logger } from '../utils/logger';
import { renderXiaoniPromptTemplate } from '../prompts/xiaoni-prompt-files';

const moduleLogger = logger.createModuleLogger('xiaoni-recall-delivery');
const IDENTITY_KEY = 'xiaoni';
const DEDUPE_PREFIX = 'recall-surface:';

// 只投这两条腿(理由见文件头)。顺序即优先级:承诺(还没了的事)比联想(旧事重提)更该说。
const DELIVERABLE_LEGS: Array<{ leg: string; queryRef: string }> = [
  { leg: 'open_loop', queryRef: 'open_loop_scan' },
  { leg: 'association', queryRef: 'association_scan' }
];

const envNum = (name: string, dflt: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : dflt;
};

// 默认 OFF。打开前请先确认 shadow 里这两条腿的唯一率仍然是 100% / 77%。
const ENABLED = process.env.XIAONI_PASSIVE_RECALL_DELIVERY_ENABLED === 'true';
// 一天最多几条。notify 会唤醒主 loop —— 这是「别吵」的硬闸,不是软建议。
// 6 条 ≈ 每 4 小时一条;association 腿一天产 ~95 条候选,即约 16 选 1。
const DAILY_CAP = Math.max(0, envNum('XIAONI_PASSIVE_RECALL_DELIVERY_DAILY_CAP', 6));
// 每次 tick 最多投 1 条(设计里的「每次落地最多 1 块」在投递侧的对应物)。
const PER_TICK_LIMIT = 1;
// 往回看几条 shadow 扫描行找没投过的 lead。两条腿都是 30min 一轮,20 行 ≈ 10 小时。
const SHADOW_LOOKBACK = Math.max(1, envNum('XIAONI_PASSIVE_RECALL_DELIVERY_LOOKBACK', 20));

type ShadowRow = {
  occurredAt?: string | null;
  surfaced?: unknown;
};

type Lead = { leg: string; ref: string; text: string; occurredAt: string | null };

// 依赖注入(同 createRecallIngest 的形状):真跑时是 @qq-bot/persistence,测试时是假件。
export interface RecallDeliveryDeps {
  listRecallShadowLog(params: Record<string, unknown>, config?: unknown): Promise<unknown>;
  countAgentQueueMessagesByDedupePrefix(params: { prefix: string; since: Date }, config?: unknown): Promise<number>;
  enqueueAgentQueueMessage(input: Record<string, unknown>, config?: unknown): Promise<{ queueId?: number; status?: string; created?: boolean } | null>;
}

export interface RecallDeliveryOptions {
  enabled?: boolean;
  dailyCap?: number;
  lookback?: number;
  now?: () => Date;
}

// shadow 行里的 surfaced 项 → 可投递的 lead。第二/三/四腿的形状是
// { kind, ref, lead, ... }(lead 是渲染好的整句);拿不到 ref 或 lead 的一律跳过 ——
// 没有稳定 ref 就没有幂等,宁可不投。
function leadsFromRow(leg: string, row: ShadowRow): Lead[] {
  const surfaced = Array.isArray(row?.surfaced) ? row.surfaced : [];
  const out: Lead[] = [];
  for (const raw of surfaced) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const item = raw as Record<string, unknown>;
    const ref = typeof item.ref === 'string' && item.ref.trim() ? item.ref.trim() : null;
    const text = typeof item.lead === 'string' && item.lead.trim() ? item.lead.trim() : null;
    if (!ref || !text) {
      continue;
    }
    out.push({
      leg,
      ref,
      text,
      occurredAt: typeof row.occurredAt === 'string' ? row.occurredAt : null
    });
  }
  return out;
}

function dedupeKeyFor(lead: Lead): string {
  return `${DEDUPE_PREFIX}${lead.leg}:${lead.ref}`;
}

function startOfEast8Day(now: Date): Date {
  const EAST8_MS = 8 * 60 * 60 * 1000;
  const shifted = now.getTime() + EAST8_MS;
  return new Date(Math.floor(shifted / 86_400_000) * 86_400_000 - EAST8_MS);
}

// 正文只有 lead 本句。renderSystemReminder 在消费时刻套 <system_reminder> 外壳,
// 这里不自己加框 —— 被动浮现是「冒出来的念头」,不是系统公告,更不是待办指令。
function renderSurfaceNotifyText(lead: Lead): string {
  return renderXiaoniPromptTemplate('passive_recall_surface_notify.md', { LEAD: lead.text }).trimEnd();
}

async function enqueueSurfaceNotify(deps: RecallDeliveryDeps, lead: Lead, now: Date): Promise<boolean> {
  const dedupeKey = dedupeKeyFor(lead);
  const reminderText = renderSurfaceNotifyText(lead);
  if (!reminderText) {
    return false;
  }
  const botAccountId = agentConfig.botAccountId;
  const sessionKey = getGlobalPromptContextSessionKey();
  // trace_id 显式给足,不走 enqueueAgentQueueMessage 的兜底。空 trace_id 会让 stack 的
  // runtime-input event_id 塌到 runId 兜底,同一 run 两条撞 ON CONFLICT 被吞 → 下个 run
  // replay 变短 → run 边界缓存击穿(docs/CACHE_CONTRACT.md §3)。
  const traceId = `runtrace_${now.getTime()}_${Math.abs(hashString(dedupeKey)).toString(36)}`;
  const rawPayload = {
    reason: 'passive_recall_surface',
    recall_leg: lead.leg,
    recall_ref: lead.ref,
    notify_template: 'passive_recall_surface_notify.md'
  };
  const inboundContext = {
    Body: reminderText,
    BodyForAgent: reminderText,
    BodyForCommands: reminderText,
    RawBody: reminderText,
    CommandBody: reminderText,
    From: botAccountId,
    To: botAccountId,
    SessionKey: sessionKey,
    AccountId: botAccountId,
    ChatType: 'direct',
    ConversationLabel: IDENTITY_KEY,
    SenderName: IDENTITY_KEY,
    SenderId: botAccountId,
    Timestamp: now.getTime(),
    Provider: 'runtime',
    Surface: 'system_reminder',
    WasMentioned: false,
    NativeChannelId: sessionKey,
    CommandAuthorized: false
  };
  const payload = {
    messageId: dedupeKey,
    rawBody: reminderText,
    commandBody: reminderText,
    receivedAt: now.toISOString(),
    // 正文在**此刻**冻结进这里;下一 run 的 stack replay 从同一字段读回同样字节。
    systemReminder: {
      reminder: reminderText,
      reason: 'passive_recall_surface',
      recallLeg: lead.leg,
      recallRef: lead.ref,
      createdAt: now.toISOString()
    }
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
      bodyForAgent: reminderText,
      rawPayload,
      inboundContext
    },
    payload,
    availableAt: now
  }, databaseConfig);
  // created=false ⇔ 撞了 dedupe_key ⇔ 这段记忆早就投过 → 当作没投,继续看下一条。
  // 不能用 status 判:既有行没被消费时同样是 'pending'。
  return result?.created === true;
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return h;
}

export type RecallDeliveryOutcome = 'disabled' | 'capped' | 'none' | 'delivered';

// supervisor tick。无状态、幂等:漏一拍只是晚一点投,重复一拍被唯一索引吞掉,重启即续。
export function createPassiveRecallDelivery(deps: RecallDeliveryDeps, options: RecallDeliveryOptions = {}) {
  const enabled = options.enabled ?? ENABLED;
  const dailyCap = Math.max(0, options.dailyCap ?? DAILY_CAP);
  const lookback = Math.max(1, options.lookback ?? SHADOW_LOOKBACK);
  const clock = options.now ?? (() => new Date());

  async function deliverOnce(): Promise<RecallDeliveryOutcome> {
    if (!enabled || dailyCap === 0) {
      return 'disabled';
    }
    const now = clock();
    const deliveredToday = await deps.countAgentQueueMessagesByDedupePrefix({
      prefix: DEDUPE_PREFIX,
      since: startOfEast8Day(now)
    }, databaseConfig);
    if (deliveredToday >= dailyCap) {
      return 'capped';
    }

    // 新的先投:两条腿都是「时间到了该提」的性质,旧 lead 早就被更旧的 tick 消化过。
    const candidates: Lead[] = [];
    for (const { leg, queryRef } of DELIVERABLE_LEGS) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await deps.listRecallShadowLog({
        identityKey: IDENTITY_KEY,
        queryRef,
        limit: lookback,
        onlySurfaced: true
      }, databaseConfig) as ShadowRow[];
      for (const row of Array.isArray(rows) ? rows : []) {
        candidates.push(...leadsFromRow(leg, row));
      }
    }
    if (candidates.length === 0) {
      return 'none';
    }

    let delivered = 0;
    for (const lead of candidates) {
      if (delivered >= PER_TICK_LIMIT) {
        break;
      }
      // 幂等靠 dedupe_key 唯一索引兜底:早投过的 created=false → 不算新投递,继续看下一条。
      // eslint-disable-next-line no-await-in-loop
      const isNew = await enqueueSurfaceNotify(deps, lead, clock());
      if (isNew) {
        delivered += 1;
        moduleLogger.info('Delivered passive recall surface notify', {
          leg: lead.leg,
          ref: lead.ref,
          deliveredToday: deliveredToday + delivered,
          dailyCap
        });
      }
    }
    return delivered > 0 ? 'delivered' : 'none';
  }

  return { deliverOnce };
}

const defaultDelivery = createPassiveRecallDelivery(persistence as unknown as RecallDeliveryDeps);

export function deliverPassiveRecallSurfaceOnce(): Promise<RecallDeliveryOutcome> {
  return defaultDelivery.deliverOnce();
}

export const passiveRecallDeliveryConfig = {
  enabled: ENABLED,
  dailyCap: DAILY_CAP,
  legs: DELIVERABLE_LEGS.map((entry) => entry.leg)
};
