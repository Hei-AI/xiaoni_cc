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

import { createHash } from 'node:crypto';

import * as persistence from '@qq-bot/persistence';

import { callRecallLlm, type RecallPrompt } from './xiaoni-recall-llm-client';
import { agentConfig, databaseConfig, getGlobalPromptContextSessionKey } from '../config';
import { logger } from '../utils/logger';
import { renderXiaoniPromptTemplate } from '../prompts/xiaoni-prompt-files';

const moduleLogger = logger.createModuleLogger('xiaoni-recall-delivery');
const IDENTITY_KEY = 'xiaoni';
const DEDUPE_PREFIX = 'recall-surface:';

// 只投这两条腿(理由见文件头)。**腿间轮转**,不是固定优先级:
// 2026-08-07 首日活体观察 —— 固定优先级(open_loop 在前)下,6 条日额**全被 open_loop 吃光**,
// association 一条没轮到。因为她常年有 20 条开放承诺,那条腿永远有货,排在前面就永远不让位。
// 首发放两条腿、实际只跑一条,等于把当初「association 唯一率 100%,质量最高」的理由作废了。
// 一个目的一个池子:不在她当前请求字节里的都是候选(见 CONTEXT.md「召回」)。
//
// **欠账(open_loop)撤出召回** —— 它有完成态、有标签、她自己有一份清单,让她去看清单比把
// 条目挑出来推给她更直接(CONTEXT.md:「欠账**不走召回**」)。改由定时指针通知承担,
// 见 xiaoni-open-loops-notify.ts。
//
// landing 腿 = 落地驱动的那两条(file_chunk / peer_message)。它们服务的是同一个目的:
// 「材料不在上下文」就是「她不知道自己做过」,不是另一件事。合成一条而不是两条,是因为
// 它们共用同一批 shadow 行(每次落地一条),分成两个轮转槽没有意义。
//   它的 shadow 行 queryRef 是每次落地变的 `stack:<id>` —— 推不下去,所以按前缀在读回来的
//   行里筛(这张表 ~97% 是这条腿写的,lookback 很快就能拿满)。
const LANDING_REF_PREFIX = 'stack:';
const DELIVERABLE_LEGS: Array<{ leg: string; queryRef?: string; refPrefix?: string }> = [
  { leg: 'association', queryRef: 'association_scan' },
  { leg: 'landing', refPrefix: LANDING_REF_PREFIX }
];

// dedupe_key 形如 `recall-surface:<leg>:<hash>` —— 腿名就编在键里,不必另存游标。
function legFromDedupeKey(key: string | undefined): string | null {
  if (typeof key !== 'string' || !key.startsWith(DEDUPE_PREFIX)) {
    return null;
  }
  const rest = key.slice(DEDUPE_PREFIX.length);
  const idx = rest.indexOf(':');
  return idx > 0 ? rest.slice(0, idx) : null;
}

// 上一条投的是哪条腿,这一拍就把另一条排前面。某条没货 → 自然落回另一条(不是死等),
// 下一拍再换回来。状态从队列现读,supervisor 保持无状态、重启即续。
function rotateLegs(lastLeg: string | null): typeof DELIVERABLE_LEGS {
  const idx = lastLeg ? DELIVERABLE_LEGS.findIndex((entry) => entry.leg === lastLeg) : -1;
  if (idx < 0) {
    return DELIVERABLE_LEGS;
  }
  return [...DELIVERABLE_LEGS.slice(idx + 1), ...DELIVERABLE_LEGS.slice(0, idx + 1)];
}

// 开关与日额的**唯一真理源是 agent_runtime_control**(管理端可改、每拍热读、无重启)。
// 不留 env 兜底:两个真理源会让「页面上关了但它还在投」变成可能,而这是一个会主动
// 打扰她的通道 —— 关得掉必须是结构性事实。默认 OFF / 6,库里没行也一样。
// 每次 tick 最多投 1 条(设计里的「每次落地最多 1 块」在投递侧的对应物)。
const PER_TICK_LIMIT = 1;
// 往回看几条 shadow 扫描行找没投过的 lead。两条腿都是 30min 一轮,20 行 ≈ 10 小时。
const SHADOW_LOOKBACK = 20;

// ── 投递节奏:把日额摊到白天,别在她收尾睡觉的那一小时里烧光 ──────────────
// 实测 2026-08-08..08-13 六天:24 条投递**全部**落在 00:07–00:57。成因是
// 「计数按东八零点归零 + 10 分钟一拍 + 每拍 1 条 + 无最小间隔」= 六拍烧光,其余 23 小时全 capped。
// 而 00:00 正好是她收尾睡觉的窗口:那几拍的栈里是连着六七次 recover_energy(「够了。睡了。」),
// 投进去的结果是「记着。明天处理。」然后再也不提(旧幂等下「明天」在机制上不存在)。
// 唯一一次投在她清醒干活时(08-07 16:05)她 12 秒后就动手了。
//
// 摊开用**槽位**而不是「距上次多久」:后者要存/查上次投递时刻,这个 supervisor 是无状态的。
// 槽位只用已有的 deliveredToday 计数 + 当前时刻就能算,重启即续,漏拍自愈。
const EAST8_OFFSET_MS = 8 * 60 * 60 * 1000;
// 活动窗(东八区小时)。窗外一律不投 —— 这就是「避开凌晨」,不需要另设开关。
const ACTIVE_WINDOW_START_HOUR = 9;
const ACTIVE_WINDOW_END_HOUR = 23;
// 承诺账本。投递前现读它做「还没做完吗」的复核 —— 权威在这个文件的勾选状态,
// 不在投递账本里。容器挂载见 docker-compose.yml(agent-service 也挂 /xiaoni-runtime)。
// 仍未做完的承诺,隔多少天可以再提一次。
// 旧行为是「同一段记忆永不重投」,幂等挂在 dedupe_key 唯一索引上,对**三条腿**一视同仁。
// 但 open_loop 腿的「该不该再提」权威是 open-loops.md 的勾选状态:已 [x]/[-] 的在
// parseOpenLoops 那一层就被 state !== 'open' 滤掉了,压根进不了候选池 —— 幂等对它们是多余的。
// 幂等实际唯一挡住的,是**没做完的那些**。实测 2026-08-13:当前 29 条 [ ] 未完成的承诺里
// 18 条已投过 → 永久不会再被提起,其中两条带硬截止(HWC 8/19、Taper Prime 8/17)。
// association / diary_event 不放松:它们的候选是日记条目,没有「完成」这个状态,幂等在那里是对的。

type ShadowRow = {
  occurredAt?: string | null;
  surfaced?: unknown;
};

type Lead = { leg: string; identity: string; text: string; occurredAt: string | null; ageDays: number | null };

// 依赖注入(同 createRecallIngest 的形状):真跑时是 @qq-bot/persistence,测试时是假件。
export interface RecallDeliveryDeps {
  listRecallShadowLog(params: Record<string, unknown>, config?: unknown): Promise<unknown>;
  listRecentAgentQueueDedupeKeys(params: { prefix: string; since: Date; limit?: number }, config?: unknown): Promise<string[]>;
  enqueueAgentQueueMessage(input: Record<string, unknown>, config?: unknown): Promise<{ queueId?: number; status?: string; created?: boolean } | null>;
}

// 每拍现读的运行时闸门(来自 agent_runtime_control)。测试直接注入,免得跑 DB。
export interface RecallDeliveryGate {
  enabled: boolean;
  dailyCap: number;
}

// 判官:从算术选出的候选里挑该冒的 + 把钩子写成人话。不注入 → 沿用模板钩子、按原顺序投
// 第一条没投过的(改动前的行为)。它坐在**投递闸**上,一天十几次 —— 检索侧每次落地那
// ~985 次仍是纯算术,回归集才成立(docs/adr/0006)。
export type RecallDeliveryJudge = (prompt: RecallPrompt) => Promise<string>;

export interface RecallDeliveryOptions {
  judge?: RecallDeliveryJudge;
  // 不传 = 每拍从 agent_runtime_control 现读(生产路径)。
  readGate?: () => Promise<RecallDeliveryGate>;
  lookback?: number;
  now?: () => Date;
}

// 一条 surfaced 项的**身份**——幂等全靠它,所以必须是「同一段记忆跨扫描不变」的东西。
// 各腿的身份概念不同,这里沿用每条腿**自己冷却时用的那一个**,不另造:
//   association / diary_event → `ref`(日记文件 + 段号,scanDiaryEventsToShadow 按它冷却)
//   open_loop                 → `text`(承诺正文;它压根没有 ref 字段,
//                                scanOpenLoopsToShadow 的冷却就是按 recentTexts 去重的)
// 绝不能用 `lead`:open_loop 的 lead 里带「放了 N 天了」,天数每天变 → 同一件事会被反复投。
function leadIdentityOf(item: Record<string, unknown>): string | null {
  const ref = typeof item.ref === 'string' && item.ref.trim() ? item.ref.trim() : null;
  if (ref) {
    return ref;
  }
  const text = typeof item.text === 'string' && item.text.trim() ? item.text.trim() : null;
  return text;
}

// shadow 行里的 surfaced 项 → 可投递的 lead。形状是 { kind, lead, ref?, text?, ... }
// (lead 是渲染好的整句)。拿不到身份或 lead 的一律跳过 —— 没有稳定身份就没有幂等,宁可不投。
function leadsFromRow(leg: string, row: ShadowRow): Lead[] {
  const surfaced = Array.isArray(row?.surfaced) ? row.surfaced : [];
  const out: Lead[] = [];
  for (const raw of surfaced) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const item = raw as Record<string, unknown>;
    // 两种 surfaced 形状:
    //   扫描腿  { kind, ref?/text?, lead: '<整句>' , ageDays? }
    //   落地腿  { cos, domain, sourceRef, provenance, lead: { kind, text, pointer, ... } }
    // 后者的 lead 是对象、身份是 sourceRef。两种都收,不为形状差异另开一条腿。
    const leadObj = item.lead && typeof item.lead === 'object' ? item.lead as Record<string, unknown> : null;
    const identity = leadObj
      ? (typeof item.sourceRef === 'string' && item.sourceRef.trim() ? item.sourceRef.trim() : null)
      : leadIdentityOf(item);
    const text = leadObj
      ? (typeof leadObj.text === 'string' && leadObj.text.trim() ? leadObj.text.trim() : null)
      : (typeof item.lead === 'string' && item.lead.trim() ? item.lead.trim() : null);
    if (!identity || !text) {
      continue;
    }
    out.push({
      leg,
      identity,
      text,
      occurredAt: typeof row.occurredAt === 'string' ? row.occurredAt : null,
      // 承诺搁置了多久 —— 重投窗按它算(见 dedupeKeyFor),不按墙钟,所以无状态。
      ageDays: Number.isFinite(Number(item.ageDays)) ? Number(item.ageDays) : null
    });
  }
  return out;
}

// dedupe_key 是 VARCHAR(255),而身份可能是一整句承诺正文 → 统一哈希,长度有界且形状一致。
// 可读性不丢:原始身份原样存进 rawPayload.recall_ref。
function dedupeKeyFor(lead: Lead): string {
  const digest = createHash('sha256').update(`${lead.leg}\u0000${lead.identity}`).digest('hex').slice(0, 32);
  return `${DEDUPE_PREFIX}${lead.leg}:${digest}`;
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
  const traceId = `runtrace_${now.getTime()}_${dedupeKey.slice(-8)}`;
  const rawPayload = {
    reason: 'passive_recall_surface',
    recall_leg: lead.leg,
    recall_ref: lead.identity,
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
      recallRef: lead.identity,
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

// 东八区当前小时(含小数)。startOfEast8Day 已经在用同一个偏移量,这里沿用同一套算术。
function east8HourOf(now: Date): number {
  const shifted = now.getTime() + EAST8_OFFSET_MS;
  return (shifted % 86_400_000) / 3_600_000;
}

// 到此刻为止,今天「应该」已经投到第几条。
// 活动窗按 dailyCap 等分成若干槽,每过一个槽放行一条 → 日额自然摊到全天,
// 而且完全由「当前时刻 + 已投条数」决定,不存任何游标。
// 窗外返回 0 = 一条都不该投(凌晨那一小时因此结构性地投不出来)。
function deliverableByNow(now: Date, dailyCap: number): number {
  const hour = east8HourOf(now);
  if (hour < ACTIVE_WINDOW_START_HOUR || hour >= ACTIVE_WINDOW_END_HOUR) {
    return 0;
  }
  const windowHours = ACTIVE_WINDOW_END_HOUR - ACTIVE_WINDOW_START_HOUR;
  const elapsed = hour - ACTIVE_WINDOW_START_HOUR;
  return Math.min(dailyCap, Math.floor((elapsed / windowHours) * dailyCap) + 1);
}

// 投递前现读承诺账本做复核。
// 为什么必须现读:候选是从最近 SHADOW_LOOKBACK=20 行扫描里捞的 ≈ 10 小时的陈旧快照,
// 期间她完全可能已经把这件事做完并打上勾。实测 2026-08-08..08-13 的 24 条投递里有 3 条
// (12.5%)投的是**已经关掉**的事 —— `who-am-i` 那条在投递前 41 分钟才被打勾。
// 权威是文件里的勾选状态(state === 'open'),不是投递账本。
// 读失败 / 解析不出 → 返回 null 表示「判不了」,调用方按放行处理:
// 复核是用来挡陈旧的,不该因为读不到文件就把整条腿停掉。

export type RecallDeliveryOutcome = 'disabled' | 'capped' | 'none' | 'delivered';

// supervisor tick。无状态、幂等:漏一拍只是晚一点投,重复一拍被唯一索引吞掉,重启即续。
export function createPassiveRecallDelivery(deps: RecallDeliveryDeps, options: RecallDeliveryOptions = {}) {
  const lookback = Math.max(1, options.lookback ?? SHADOW_LOOKBACK);
  const clock = options.now ?? (() => new Date());
  const readGate = options.readGate ?? defaultReadGate;
  const judge = options.judge ?? null;

  // 候选交给判官。id 用 dedupeKey —— 它已经是这段记忆的稳定身份,不另铸一套编号。
  // 锚点(她此刻在做的事)取最近一条向量腿 shadow 的 query_text:那条腿每次落地都写。
  async function runJudge(leads: Lead[]): Promise<{ parsed: boolean; picks: Array<{ id: string; hook: string }> } | null> {
    if (!judge || leads.length === 0) {
      return null;
    }
    const anchor = await readLatestAnchorText().catch(() => '');
    const items = leads.slice(0, persistence.MAX_CANDIDATES_IN_PROMPT).map((lead) => ({
      id: dedupeKeyFor(lead),
      text: lead.text,
      leg: lead.leg,
      // ageDays 必须传:buildJudgePrompt 里「N 天前」那一支靠它渲染,而「搁了多久」
      // 正是「她还记不记得」的主要线索。漏传过一次,code review 抓出来的。
      ageDays: lead.ageDays
    }));
    const raw = await judge(persistence.buildJudgePrompt(items, anchor));
    return persistence.parseJudgeVerdict(raw, items.map((i) => i.id));
  }

  // 「她此刻在做的事」只能取**向量腿**的 query_text —— 那条腿每次落地都写。
  // 不能不带 queryRef 取最新一条:扫描腿(association_scan / diary_resurface / open_loop_scan)
  // 写的是 queryText: null,取到就等于把锚点喂成空,判官只能瞎判。
  // 向量腿的 queryRef 是每次落地变的 `stack:<id>`,推不下去,所以取最近若干条里第一条带
  // queryText 的。
  const ANCHOR_LOOKBACK = 20;

  async function readLatestAnchorText(): Promise<string> {
    const rows = await deps.listRecallShadowLog({
      identityKey: IDENTITY_KEY,
      limit: ANCHOR_LOOKBACK
    }, databaseConfig) as Array<{ queryText?: unknown; queryRef?: unknown }>;
    for (const row of Array.isArray(rows) ? rows : []) {
      const ref = typeof row?.queryRef === 'string' ? row.queryRef : '';
      const txt = typeof row?.queryText === 'string' ? row.queryText.trim() : '';
      if (ref.startsWith('stack:') && txt) {
        return txt;
      }
    }
    return '';
  }

  async function deliverOnce(): Promise<RecallDeliveryOutcome> {
    // 每拍现读:管理端关掉后最多一拍(10min)就停,不用重启。读失败 → fail-closed 当关着,
    // 「读不到就别投」对一个能主动打扰她的通道是唯一安全的默认。
    const gate = await readGate().catch(() => ({ enabled: false, dailyCap: 0 }));
    const enabled = gate.enabled === true;
    const dailyCap = Math.max(0, Number.isFinite(gate.dailyCap) ? gate.dailyCap : 0);
    if (!enabled || dailyCap === 0) {
      return 'disabled';
    }
    const now = clock();
    // 一次读同时给出「今天投了几条」和「上一条是哪条腿」—— 日额与轮转共用同一份事实。
    const todaysKeys = await deps.listRecentAgentQueueDedupeKeys({
      prefix: DEDUPE_PREFIX,
      since: startOfEast8Day(now),
      limit: 500
    }, databaseConfig);
    const deliveredToday = Array.isArray(todaysKeys) ? todaysKeys.length : 0;
    if (deliveredToday >= dailyCap) {
      return 'capped';
    }
    // 节奏闸:今天到此刻为止「该」投到第几条。窗外 → 0 → 直接 capped(凌晨那一小时投不出来)。
    // 这一步只用已有的计数和当前时刻,不引入任何新状态。
    if (deliveredToday >= deliverableByNow(now, dailyCap)) {
      return 'capped';
    }
    const legOrder = rotateLegs(legFromDedupeKey(todaysKeys?.[0]));

    // 新的先投:两条腿都是「时间到了该提」的性质,旧 lead 早就被更旧的 tick 消化过。
    const candidates: Lead[] = [];
    for (const { leg, queryRef, refPrefix } of legOrder) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await deps.listRecallShadowLog({
        identityKey: IDENTITY_KEY,
        ...(queryRef ? { queryRef } : {}),
        limit: lookback,
        onlySurfaced: true
      }, databaseConfig) as ShadowRow[];
      for (const row of Array.isArray(rows) ? rows : []) {
        // 落地腿没法把 queryRef 推下去(每次落地都变),按前缀在读回来的行里筛。
        if (refPrefix) {
          const ref = typeof (row as { queryRef?: unknown }).queryRef === 'string'
            ? (row as { queryRef: string }).queryRef
            : '';
          if (!ref.startsWith(refPrefix)) {
            continue;
          }
        }
        candidates.push(...leadsFromRow(leg, row));
      }
    }
    if (candidates.length === 0) {
      return 'none';
    }

    // 判官。允许它说「一条都不值得」—— 那是正常结果,直接静默。
    // parsed=false(挂了/输出读不出)→ 退回判官之前的行为,别当成「它说不值得」,
    // 否则判官一挂整条投递腿会静默死掉且无迹可循。
    let ordered = candidates;
    if (judge) {
      const verdict = await runJudge(candidates).catch(() => null);
      if (verdict && verdict.parsed) {
        if (verdict.picks.length === 0) {
          return 'none';
        }
        const byKey = new Map(candidates.map((lead) => [dedupeKeyFor(lead), lead]));
        const picked: Lead[] = [];
        for (const pick of verdict.picks) {
          const lead = byKey.get(pick.id);
          if (lead) {
            picked.push({ ...lead, text: pick.hook });
          }
        }
        if (picked.length) {
          ordered = picked;
        }
      }
    }

    let delivered = 0;
    for (const lead of ordered) {
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
          identity: lead.identity,
          deliveredToday: deliveredToday + delivered,
          dailyCap
        });
      }
    }
    return delivered > 0 ? 'delivered' : 'none';
  }

  return { deliverOnce };
}

async function defaultReadGate(): Promise<RecallDeliveryGate> {
  const control = await persistence.getAgentRuntimeControl({ identityKey: IDENTITY_KEY }, databaseConfig);
  return {
    enabled: control.passiveRecallDeliveryEnabled === true,
    dailyCap: Number(control.passiveRecallDeliveryDailyCap)
  };
}

// 判官的模型调用收口在共用的 recall LLM client(见该文件头:独立请求,绝不克隆主请求)。
const JUDGE_MODEL = process.env.XIAONI_RECALL_JUDGE_MODEL || undefined;
const JUDGE_TIMEOUT_MS = Number.parseInt(process.env.XIAONI_RECALL_JUDGE_TIMEOUT_MS || '30000', 10);

const defaultJudge = (prompt: RecallPrompt) => callRecallLlm(prompt, {
  model: JUDGE_MODEL,
  maxTokens: 1024,
  timeoutMs: JUDGE_TIMEOUT_MS,
  label: 'recall-judge'
});

const defaultDelivery = createPassiveRecallDelivery(
  persistence as unknown as RecallDeliveryDeps,
  { judge: defaultJudge }
);

export function deliverPassiveRecallSurfaceOnce(): Promise<RecallDeliveryOutcome> {
  return defaultDelivery.deliverOnce();
}

export const passiveRecallDeliveryLegs = DELIVERABLE_LEGS.map((entry) => entry.leg);
