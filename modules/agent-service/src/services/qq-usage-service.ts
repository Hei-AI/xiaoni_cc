import type {
  QqUsageThreadList,
  QqUsageThreadSummary,
  QqUsageThreadWindow
} from '@qq-bot/persistence';
import type { RuntimeStore } from './runtime-store';
import { formatEast8Timestamp } from './east8-time';

const WINDOW_SIZE = 10;

function escapeXmlAttr(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlText(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatTaggedBlock(tag: string, attrs: Record<string, unknown>, body = '') {
  const renderedAttrs = Object.entries(attrs)
    .filter(([, value]) => value !== null && typeof value !== 'undefined' && value !== '')
    .map(([key, value]) => `${key}="${escapeXmlAttr(value)}"`)
    .join(' ');
  const open = renderedAttrs ? `<${tag} ${renderedAttrs}>` : `<${tag}>`;
  return body ? `${open}\n${body}\n</${tag}>` : `${open}</${tag}>`;
}

// Render QQ message timestamps in East-8, matching every other timestamp that
// enters Xiaoni's context (wake reminders, event timeline, time broadcast). The
// stored value stays a UTC instant; only the rendered display is East-8 so she
// never sees a UTC clock next to an East-8 one. (No "Z" suffix — bare East-8.)
function toDateTime(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return formatEast8Timestamp(date);
}

// 把 East8 "YYYY-MM-DD HH:MM:SS" 拆成日期头 + 时刻。会话窗口把日期提到 `── 日期 ──`
// 分隔行（同一天不重复），每条消息只带 time="HH:MM:SS"——发送时间不丢，日期不刷屏。
// 解析失败（空/非标准）时 day 为空、time 回落到原串，绝不吞掉时间信息。
function splitEast8(value: unknown): { day: string; time: string } {
  const full = toDateTime(value);
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(full);
  return match ? { day: match[1], time: match[2] } : { day: '', time: full };
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeMediaAssets(message: Record<string, unknown>) {
  const inboundContext = parseRecord(message.inbound_context);
  const assets = inboundContext.MediaAssets;
  return Array.isArray(assets)
    ? assets.filter((asset): asset is Record<string, unknown> => Boolean(asset && typeof asset === 'object' && !Array.isArray(asset)))
    : [];
}

function mediaKind(asset: Record<string, unknown>) {
  const type = String(asset.mediaType || asset.type || '').toLowerCase();
  if (type.includes('image')) return '图片';
  if (type.includes('face') || type.includes('emoji')) return '表情';
  return '文件';
}

function mediaHash(asset: Record<string, unknown>, index: number) {
  const raw = String(asset.id || asset.assetId || asset.mediaAssetId || asset.mediaTag || asset.fileId || asset.fileName || asset.locator || `pic_${index + 1}`);
  return raw.replace(/^\[?图片[:：]?/u, '').replace(/\]?$/u, '').slice(0, 64) || `pic_${index + 1}`;
}

function normalizePreview(message: Record<string, unknown> | null) {
  if (!message) return '';
  const text = String(message.raw_body || message.body_for_agent || '').trim();
  if (text) {
    return Array.from(text.replace(/\s+/g, ' ')).slice(0, 20).join('');
  }
  const asset = normalizeMediaAssets(message)[0];
  return asset ? `[${mediaKind(asset)}]` : '';
}

function renderMessageBody(message: Record<string, unknown>) {
  const text = String(message.raw_body || message.body_for_agent || '').trim();
  const assets = normalizeMediaAssets(message);
  const mediaBodies = assets.map((asset, index) => {
    const kind = mediaKind(asset);
    return kind === '图片' ? `[图片:${mediaHash(asset, index)}]` : `[${kind}]`;
  });
  return [text, ...mediaBodies].filter(Boolean).join('\n') || '(空消息)';
}

function displayName(thread: QqUsageThreadSummary) {
  return thread.peerName || thread.peerId || thread.threadKey;
}

function senderLabel(message: Record<string, unknown> | null) {
  if (!message) return '';
  // 出站 = 小腻自己发的。渲染成「我」，这样单独的 direction 字段就没信息了（可删）。
  if (message.direction === 'outgoing') return '我';
  const name = String(message.sender_name || '').trim();
  const id = String(message.sender_id || '').trim();
  if (name && id && name !== id) return `${name}(${id})`;
  return name || id;
}

function renderThread(thread: QqUsageThreadSummary) {
  // 精简：删 thread_key(内部id,SKILL叫她别用)、focus_target(chat_type+peer_id 已足够,
  // SKILL 已教 focus_private/group,一屏10行重复浪费)。群专属三件套仅群聊渲染,私聊恒0/无意义。
  const isGroup = thread.chatType === 'group';
  return formatTaggedBlock('THREAD', {
    chat_type: isGroup ? '群聊' : '私聊',
    peer_id: thread.peerId,
    display_name: displayName(thread),
    ...(isGroup ? {
      notification_muted: String(thread.notificationMuted === true),
      notification_mode: thread.notificationMode || 'all',
      notification_aggregation_seconds: thread.notificationAggregationSeconds,
      direct_mentions: thread.directMentions
    } : {}),
    unread_count: thread.unreadCount,
    latest_sender: senderLabel(thread.latestMessage),
    latest_preview: normalizePreview(thread.latestMessage)
  });
}

function renderThreadListWindow(result: QqUsageThreadList) {
  // 精简：删 surface(恒定)、offset/window_size(内部分页,她用 older/newer 翻)。
  // query/chat_type 无值时 formatTaggedBlock 已自动省略。
  return formatTaggedBlock('IM_INBOX_WINDOW', {
    mode: result.searchQuery ? 'search_results' : 'thread_list',
    query: result.searchQuery,
    chat_type: result.chatType,
    has_older_threads: String(result.hasOlderThreads),
    has_newer_threads: String(result.hasNewerThreads)
  }, result.threads.map(renderThread).join('\n'));
}

// Bounded reply preview per「只给必要信息 + 必要信息触达所有路径」:
// - reply_to carries the quoted row's INTERNAL id (reply_to_message_id) — the same
//   namespace as message_id, so she can `focus_private <user_id> <id>` to open it.
// - a short inline snippet lets her know WHAT was quoted without a round-trip.
// - the snippet is marker-free ONLY when it is the entire quoted text; otherwise it
//   says so (…截断 / 非文字消息 / 原消息已不在记录) so she never mistakes a partial
//   preview for the whole thing, and knows whether a reachable path exists.
const REPLY_SNIPPET_MAX = 40;
// 无跳转锚点时（如引用小腻自己的 outbound，拿不到 focus 句柄）她无法跳过去看全文，
// 内联多显示一些，让不跳也能完整识别被引用内容。有锚点则保持短，她可 focus 跳。
const REPLY_SNIPPET_MAX_NO_ANCHOR = 200;
function renderReplyPreview(message: Record<string, unknown>): { attr: string | null; line: string | null } {
  // reply_to_handle = the quoted message's OneBot id (message_sid / delivery_message_id),
  // resolved cross-table in persistence (attachReplyJumpHandles). It shares the
  // message_id namespace 小腻 sees, so `focus_* <peer> <reply_to>` lands on it.
  // null when the quoted row can't be resolved (e.g. 小腻's outbound whose NTQQ id
  // hasn't been backfilled yet) — then we show the body inline without a jump attr.
  const anchorId = typeof message.reply_to_handle === 'string' && message.reply_to_handle.trim() !== ''
    ? message.reply_to_handle.trim()
    : null;
  const hasReply = anchorId !== null
    || (typeof message.reply_to_id === 'string' && message.reply_to_id.trim() !== '')
    || (typeof message.reply_to_body === 'string' && message.reply_to_body.trim() !== '');
  if (!hasReply) {
    return { attr: null, line: null };
  }
  const sender = typeof message.reply_to_sender === 'string' && message.reply_to_sender.trim()
    ? message.reply_to_sender.trim()
    : '';
  const bodyRaw = typeof message.reply_to_body === 'string'
    ? message.reply_to_body.replace(/\s+/g, ' ').trim()
    : '';
  const snippetMax = anchorId === null ? REPLY_SNIPPET_MAX_NO_ANCHOR : REPLY_SNIPPET_MAX;
  let preview: string;
  if (!bodyRaw) {
    preview = '(非文字消息)';
  } else {
    const chars = Array.from(bodyRaw);
    preview = chars.length > snippetMax
      ? `${chars.slice(0, snippetMax).join('')}…(截断)`
      : bodyRaw;
  }
  // Reachability:
  // - anchorId present → reply_to attr 是可跳 focus_* 句柄。
  // - anchorId 空但有正文 → 原消息可能仍在（如小腻自己的 outbound），只是没建跳转索引；
  //   直接给正文，不喊「原消息已不在记录」（那会误导，消息其实还在窗口里）。
  // - anchorId 空且无正文 → 真的什么都定位不到。
  const gone = anchorId === null && !bodyRaw ? '（原消息已不在记录）' : '';
  const senderPart = sender ? `${sender}: ` : '';
  return { attr: anchorId, line: `「引用 ${senderPart}${preview}${gone}」` };
}

function renderMessage(message: Record<string, unknown>) {
  // outgoing = 小腻自己发的（来自 agent_outbound_messages，见 persistence 合并）。
  const direction = message.direction === 'outgoing' ? 'outgoing' : 'incoming';
  // 回复引用预览只对 incoming（别人引用了某条）——outbound 行不带 reply_to_body /
  // reply_to_message_id，无法正确渲染，跳过以免在她自己的消息上误显示「原消息已不在记录」。
  const reply = direction === 'incoming' ? renderReplyPreview(message) : { attr: null, line: null };
  const wasMentioned = Number(message.was_mentioned) === 1;
  const body = renderMessageBody(message);
  const bodyWithReply = reply.line ? `${reply.line}\n${body}` : body;
  // message_id = the QQ/OneBot message id (message_sid inbound / delivery_message_id
  // outbound), resolved in persistence as onebot_id. Globally unique across both
  // tables + same namespace as reply_to, so `focus_* <peer> <message_id>` is a
  // usable handle. Fallback to internal id only if onebot_id is somehow absent.
  const displayId = typeof message.onebot_id === 'string' && message.onebot_id.trim() !== ''
    ? message.onebot_id.trim()
    : message.id;
  // 精简（不丢信息）：
  // - direction 删——sender="我" 已经标出是她自己发的。
  // - read_state 删——已读/未读改由窗口级单条分界/浮标标记（见 renderConversationWindow）。
  // - timestamp 全量拆成 time="HH:MM:SS" + 窗口级 `── 日期 ──` 分隔行，日期不再逐条重复。
  // - message_id / sender / mentions_xiaoni / reply_to 全保留（reply-locate、@、引用都要）。
  const { time } = splitEast8(message.message_timestamp || message.received_at);
  return formatTaggedBlock('MESSAGE', {
    time,
    message_id: displayId,
    sender: senderLabel(message),
    ...(wasMentioned ? { mentions_xiaoni: 'true' } : {}),
    ...(reply.attr ? { reply_to: reply.attr } : {})
  }, escapeXmlText(bodyWithReply));
}

// 从内部 threadKey 解出她真正要用的干净 id：群 -> 群号，私聊 -> 对方 QQ 号。
// 这是 SKILL 叫她用的「QQ id/群 id」，不是被删掉的内部 thread_key。
function threadIdentity(threadKey: string): { chatType: 'group' | 'direct'; peerId: string } {
  if (typeof threadKey === 'string' && threadKey.startsWith('qq:group:')) {
    return { chatType: 'group', peerId: threadKey.slice('qq:group:'.length) };
  }
  const parts = typeof threadKey === 'string' ? threadKey.split(':') : [];
  return { chatType: 'direct', peerId: parts[parts.length - 1] || '' };
}

// 把手机 QQ 会话「屏幕」原样序列化。未读只用两个 UI 元素，对应两种边界位置：
//   A 边界在本屏（unreadBefore==0 且窗口内有未读）→ 首条未读前插 `———— 以下为未读（N）————`
//   B 边界在本屏上方（unreadBefore>0）→ 顶部 `———— ↑ 上方还有 N 条未读 ————`，提示她 scroll older 补看
// 「下方还有未读」不单独出浮标：qq_usage 打开即会话级标读、默认锚最新尾块，unreadAfter>0 只在
// 定位旧消息（focus around）这一 niche 出现，且它与真·app 的「N 条新消息」到达浮标语义不同，
// 留着只添乱——下方有更新消息由 more:newer/both 表达；未读总数仍算进 A 的分界线计数（含 after）不丢。
// 未读是最新连续尾块（会话级标读 + watermark 保证），所以「首条未读」就是边界，无空洞。
function renderConversationWindow(result: QqUsageThreadWindow) {
  // 精简：删掉纯内部记账字段——surface(恒定)、thread_key(内部id且SKILL叫她别用)、
  // cursor_anchor(内部id对,翻页不靠它)、window_size(可数)。
  // 保留干净的 chat_type + peer_id（她后续 scroll_/jump_/put_away/send 都要这个 id），
  // 外加 peer_name（群名/对方昵称，避免只看到裸号）。
  // has_older/has_newer 三个导航布尔合成一个可选 more 字段。
  const identity = threadIdentity(result.threadKey);
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const before = Number(result.unreadBeforeWindow || 0);
  const after = Number(result.unreadAfterWindow || 0);
  // 首条仍未读的消息下标（is_read !== 1）。unread 是连续尾块 → 这就是读/未读边界。
  const firstUnreadIdx = messages.findIndex((message) => Number(message.is_read) !== 1);

  const lines: string[] = [];
  let lastDay = '';
  const pushDayHeader = (day: string) => {
    if (day && day !== lastDay) {
      lines.push(`── ${day} ──`);
      lastDay = day;
    }
  };

  // Case B：未读一直延伸到本屏上方——顶部浮标，流内不再插分界线。
  if (before > 0) {
    lines.push(`———— ↑ 上方还有 ${before} 条未读 ————`);
  }
  messages.forEach((message, idx) => {
    const { day } = splitEast8(message.message_timestamp || message.received_at);
    pushDayHeader(day);
    // Case A：边界正好落在本屏（上方无未读）——首条未读前插单条分界线。
    if (before === 0 && firstUnreadIdx >= 0 && idx === firstUnreadIdx) {
      const unreadBelow = (messages.length - firstUnreadIdx) + after;
      lines.push(`———— 以下为未读（${unreadBelow}）————`);
    }
    lines.push(renderMessage(message));
  });

  const more = result.hasOlderMessages && result.hasNewerMessages
    ? 'both'
    : result.hasOlderMessages
      ? 'older'
      : result.hasNewerMessages
        ? 'newer'
        : '';

  return formatTaggedBlock('IM_INBOX_WINDOW', {
    mode: 'conversation',
    chat_type: identity.chatType === 'group' ? '群聊' : '私聊',
    peer_id: identity.peerId,
    peer_name: result.peerName || '',
    ...(more ? { more } : {})
  }, lines.join('\n'));
}

function renderError(action: string, args: Record<string, unknown>, reason: string) {
  return formatTaggedBlock('QQ_USAGE_ERROR', {
    action,
    arguments: JSON.stringify(args),
    reason
  });
}

export type QqUsageToolResult = {
  qq_usage: true;
  action: string;
  content: string;
  failed?: boolean;
  thread_key?: string | null;
  inbox_offset?: number;
  earliest_message_id?: number | null;
  latest_message_id?: number | null;
};

type QqUsageThreadRuntimeState = {
  earliestMessageId: number | null;
  latestMessageId: number | null;
};

type QqUsageSkillRuntimeState = {
  inboxOffset: number;
  inboxQuery: string | null;
  inboxChatType: 'direct' | 'group' | null;
  activeThreadKey: string | null;
  threads: Map<string, QqUsageThreadRuntimeState>;
};

export type QqUsageSkillRuntimeOptions = {
  botAccountId?: string | null;
};

export type QqUsageActionContext = {
  traceId?: string | null;
  runId?: string | null;
  batchId?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  sessionKey?: string | null;
};

const QQ_USAGE_ACTION_LABELS: Record<string, string> = {
  open_inbox: 'qq_usage.open_inbox',
  scroll_inbox: 'qq_usage.scroll_inbox',
  focus_private: 'qq_usage.focus_private',
  focus_group: 'qq_usage.focus_group',
  search_inbox: 'qq_usage.search_inbox',
  scroll_private: 'qq_usage.scroll_private',
  scroll_group: 'qq_usage.scroll_group',
  jump_private_to_latest: 'qq_usage.jump_private_to_latest',
  jump_group_to_latest: 'qq_usage.jump_group_to_latest',
  put_private_away: 'qq_usage.put_private_away',
  put_group_away: 'qq_usage.put_group_away',
  put_qq_away: 'qq_usage.put_qq_away',
  set_group_notification_mode: 'qq_usage.set_group_notification_mode',
  set_group_notification_delay: 'qq_usage.set_group_notification_delay'
};

function normalizeIdentifier(value: unknown) {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getPrivateId(args: Record<string, unknown>) {
  return normalizeIdentifier(args.user_id ?? args.userId ?? args.peer_id ?? args.peerId ?? args.qq ?? args.qq_id ?? args.qqId);
}

function resolvePrivateThreadKey(args: Record<string, unknown>, botAccountId: string) {
  const raw = getPrivateId(args);
  if (!raw) return '';
  if (raw.startsWith('qq:')) {
    throw new Error('user_id must be the other person QQ id, not an internal QQ thread key');
  }
  return `qq:direct:${botAccountId}:${raw}`;
}

function getGroupId(args: Record<string, unknown>) {
  return normalizeIdentifier(args.group_id ?? args.groupId ?? args.peer_id ?? args.peerId ?? args.qq_group ?? args.qqGroup);
}

function resolveGroupThreadKey(args: Record<string, unknown>) {
  const groupId = getGroupId(args);
  if (!groupId) return '';
  if (groupId.startsWith('qq:')) {
    throw new Error('group_id must be the QQ group id, not an internal QQ thread key');
  }
  return `qq:group:${groupId}`;
}

function normalizeDirection(value: unknown): 'older' | 'newer' {
  return value === 'newer' ? 'newer' : 'older';
}

// Optional focus target: the internal message_id 小腻 sees on a <MESSAGE> (and in a
// reply_to attribute). Positive integer or null. She never passes a QQ message_sid.
function normalizeMessageId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeGroupNotificationMode(value: unknown): 'all' | 'mentions_only' {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'mentions' || normalized === 'mention_only') {
    return 'mentions_only';
  }
  if (normalized === 'all' || normalized === 'mentions_only') {
    return normalized;
  }
  throw new Error('mode must be all or mentions_only');
}

function normalizeAggregationSeconds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error('seconds must be a number from 0 to 86400');
  }
  return Math.max(0, Math.min(86400, Math.floor(numeric)));
}

function inferChatTypeFromThreadKey(threadKey: string): 'direct' | 'group' {
  return threadKey.startsWith('qq:group:') ? 'group' : 'direct';
}

function inferPeerIdFromThreadKey(threadKey: string, messages: Record<string, unknown>[]) {
  const latest = messages[messages.length - 1] || {};
  const fromMessage = normalizeIdentifier(latest.peer_id || latest.peerId);
  if (fromMessage) return fromMessage;
  if (threadKey.startsWith('qq:group:')) {
    return threadKey.slice('qq:group:'.length);
  }
  const parts = threadKey.split(':');
  return parts[parts.length - 1] || '';
}

export class QqUsageService {
  constructor(private readonly store: RuntimeStore) {}

  async ambientUnread() {
    // 精简：app/surface 都是恒定值，标签名 PHONE_NOTIFICATION 已表意，删掉。
    const summary = await this.store.getQqUsageUnreadSummary();
    return formatTaggedBlock('PHONE_NOTIFICATION', {
      unread_count: summary.unreadCount,
      direct_mentions: summary.directMentions
    });
  }

  async openInbox(offset = 0): Promise<QqUsageToolResult> {
    await this.store.clearQqUsageActiveSurface();
    const result = await this.store.listQqUsageThreads({ limit: WINDOW_SIZE, offset });
    return {
      qq_usage: true,
      action: 'qq_usage.open_inbox',
      content: renderThreadListWindow(result),
      inbox_offset: result.offset
    };
  }

  async scrollInbox(direction: 'older' | 'newer', currentOffset = 0, query?: string | null, chatType?: 'direct' | 'group' | null): Promise<QqUsageToolResult> {
    const nextOffset = direction === 'newer'
      ? Math.max(0, currentOffset - WINDOW_SIZE)
      : currentOffset + WINDOW_SIZE;
    const trimmedQuery = typeof query === 'string' ? query.trim() : '';
    const result = trimmedQuery
      ? await this.store.searchQqUsageThreads({ query: trimmedQuery, chatType: chatType || undefined, limit: WINDOW_SIZE, offset: nextOffset })
      : await this.store.listQqUsageThreads({ limit: WINDOW_SIZE, offset: nextOffset });
    return {
      qq_usage: true,
      action: 'qq_usage.scroll_inbox',
      content: renderThreadListWindow(result),
      inbox_offset: result.offset
    };
  }

  async searchInbox(query: string, chatType?: 'direct' | 'group'): Promise<QqUsageToolResult> {
    const trimmedQuery = typeof query === 'string' ? query.trim() : '';
    if (!trimmedQuery) {
      throw new Error('search query is required');
    }
    await this.store.clearQqUsageActiveSurface();
    const result = await this.store.searchQqUsageThreads({
      query: trimmedQuery,
      chatType,
      limit: WINDOW_SIZE,
      offset: 0
    });
    return {
      qq_usage: true,
      action: 'qq_usage.search_inbox',
      content: renderThreadListWindow(result),
      inbox_offset: result.offset
    };
  }

  async focusThread(threadKey: string, context: QqUsageActionContext = {}, actionLabel = 'qq_usage.focus_thread', atMessageId: number | null = null): Promise<QqUsageToolResult> {
    // atMessageId set (e.g. the id a reply quotes) → open centered on that message
    // so she lands in context and scroll_* continues from there. If the anchor is
    // gone/unknown, fall back to latest and say so — honest, never a phantom window.
    let result;
    let anchorMissing = false;
    if (atMessageId != null) {
      result = await this.store.listQqUsageThreadWindow({ threadKey, mode: 'around', anchorMessageId: atMessageId, limit: WINDOW_SIZE });
      if ((result as { anchorMissing?: boolean }).anchorMissing) {
        anchorMissing = true;
        result = await this.store.listQqUsageThreadWindow({ threadKey, mode: 'latest', limit: WINDOW_SIZE });
      }
    } else {
      result = await this.store.listQqUsageThreadWindow({ threadKey, mode: 'latest', limit: WINDOW_SIZE });
    }
    await this.store.recordQqUsageThreadSeen(result, actionLabel, context).catch(() => undefined);
    await this.store.setQqUsageActiveSurface({
      threadKey: result.threadKey,
      chatType: inferChatTypeFromThreadKey(result.threadKey),
      peerId: inferPeerIdFromThreadKey(result.threadKey, result.messages),
      accountId: normalizeIdentifier(result.messages[result.messages.length - 1]?.account_id || result.messages[result.messages.length - 1]?.accountId)
    });
    const window = renderConversationWindow(result);
    return {
      qq_usage: true,
      action: actionLabel,
      content: anchorMissing
        ? `<QQ_USAGE_NOTE reason="定位的消息已不在记录里，已打开最新窗口"></QQ_USAGE_NOTE>\n${window}`
        : window,
      thread_key: result.threadKey,
      earliest_message_id: result.earliestMessageId,
      latest_message_id: result.latestMessageId
    };
  }

  async scrollThread(threadKey: string, direction: 'older' | 'newer', anchorMessageId: number | string | null, context: QqUsageActionContext = {}, actionLabel = 'qq_usage.scroll_thread'): Promise<QqUsageToolResult> {
    const result = await this.store.listQqUsageThreadWindow({
      threadKey,
      mode: direction,
      anchorMessageId,
      limit: WINDOW_SIZE
    });
    await this.store.recordQqUsageThreadSeen(result, actionLabel, context).catch(() => undefined);
    return {
      qq_usage: true,
      action: actionLabel,
      content: renderConversationWindow(result),
      thread_key: result.threadKey,
      earliest_message_id: result.earliestMessageId,
      latest_message_id: result.latestMessageId
    };
  }

  async jumpToLatest(threadKey: string, context: QqUsageActionContext = {}, actionLabel = 'qq_usage.jump_to_latest'): Promise<QqUsageToolResult> {
    const result = await this.store.listQqUsageThreadWindow({ threadKey, mode: 'latest', limit: WINDOW_SIZE });
    await this.store.recordQqUsageThreadSeen(result, actionLabel, context).catch(() => undefined);
    await this.store.setQqUsageActiveSurface({
      threadKey: result.threadKey,
      chatType: inferChatTypeFromThreadKey(result.threadKey),
      peerId: inferPeerIdFromThreadKey(result.threadKey, result.messages),
      accountId: normalizeIdentifier(result.messages[result.messages.length - 1]?.account_id || result.messages[result.messages.length - 1]?.accountId)
    });
    return {
      qq_usage: true,
      action: actionLabel,
      content: renderConversationWindow(result),
      thread_key: result.threadKey,
      earliest_message_id: result.earliestMessageId,
      latest_message_id: result.latestMessageId
    };
  }

  async putAway(threadKey?: string | null): Promise<QqUsageToolResult> {
    if (threadKey && threadKey.trim()) {
      // 手机 QQ 交互：放下/关闭不清未读——未读在「打开会话」那一刻就清了（见
      // recordQqUsageThreadSeen）。这里只释放 active surface。没打开看过的会话仍留未读。
      await this.store.clearQqUsageActiveSurface({ threadKey: threadKey.trim() });
      return {
        qq_usage: true,
        action: 'qq_usage.put_qq_away',
        thread_key: threadKey.trim(),
        content: formatTaggedBlock('IM_INBOX_WINDOW', {
          mode: 'closed'
        }, 'QQ 已放下。未读以你打开看过的为准——没打开的会话仍留未读。')
      };
    }
    await this.store.clearQqUsageActiveSurface();
    return {
      qq_usage: true,
      action: 'qq_usage.put_qq_away',
      thread_key: null,
      content: formatTaggedBlock('IM_INBOX_WINDOW', {
        mode: 'closed',
        cleared_unread_badge: String(false),
        cleared_count: 0
      }, 'QQ 列表已关闭。')
    };
  }

  async setGroupNotificationMode(groupId: string, mode: 'all' | 'mentions_only'): Promise<QqUsageToolResult> {
    const result = await this.store.setQqUsageGroupNotificationMode({ groupId, mode });
    const body = result.notificationMode === 'mentions_only'
      ? '已切到只提醒明确喊我的群消息。普通群消息会继续收进 QQ inbox，但不会再用状态栏反复敲我。'
      : '已切回全部群消息提醒。普通群消息也会重新进入状态栏提醒。';
    return {
      qq_usage: true,
      action: 'qq_usage.set_group_notification_mode',
      content: formatTaggedBlock('QQ_GROUP_NOTIFICATION_MODE', {
        group_id: result.groupId,
        mode: result.notificationMode
      }, body)
    };
  }

  async setGroupNotificationDelay(groupId: string, seconds: number): Promise<QqUsageToolResult> {
    const result = await this.store.setQqUsageGroupNotificationAggregationSeconds({ groupId, seconds });
    const body = result.notificationAggregationSeconds > 0
      ? `已设置普通群消息聚合 ${result.notificationAggregationSeconds} 秒后再提醒。人在这个群里时不会额外提醒。`
      : '已关闭普通群消息聚合延迟，后续按当前群通知模式立即处理。';
    return {
      qq_usage: true,
      action: 'qq_usage.set_group_notification_delay',
      content: formatTaggedBlock('QQ_GROUP_NOTIFICATION_DELAY', {
        group_id: result.groupId,
        seconds: result.notificationAggregationSeconds
      }, body)
    };
  }

  error(action: string, args: Record<string, unknown>, reason: string): QqUsageToolResult {
    return {
      qq_usage: true,
      action,
      failed: true,
      content: renderError(action, args, reason)
    };
  }
}

export class QqUsageSkillRuntime {
  private readonly state: QqUsageSkillRuntimeState = {
    inboxOffset: 0,
    inboxQuery: null,
    inboxChatType: null,
    activeThreadKey: null,
    threads: new Map()
  };

  private readonly botAccountId: string;

  constructor(private readonly service: QqUsageService, options: QqUsageSkillRuntimeOptions = {}) {
    this.botAccountId = normalizeIdentifier(options.botAccountId) || '1129974489';
  }

  private rememberWindow(result: QqUsageToolResult) {
    if (typeof result.inbox_offset === 'number' && Number.isFinite(result.inbox_offset)) {
      this.state.inboxOffset = result.inbox_offset;
    }
    if (result.action === 'qq_usage.put_qq_away') {
      return;
    }
    if (typeof result.thread_key === 'string' && result.thread_key.trim()) {
      this.state.activeThreadKey = result.thread_key;
      this.state.threads.set(result.thread_key, {
        earliestMessageId: typeof result.earliest_message_id === 'number' ? result.earliest_message_id : null,
        latestMessageId: typeof result.latest_message_id === 'number' ? result.latest_message_id : null
      });
    }
  }

  async execute(action: string, args: Record<string, unknown> = {}, context: QqUsageActionContext = {}): Promise<QqUsageToolResult> {
    try {
      let result: QqUsageToolResult;
      if (action === 'open_inbox') {
        this.state.inboxQuery = null;
        this.state.inboxChatType = null;
        result = await this.service.openInbox(0);
      } else if (action === 'scroll_inbox') {
        result = await this.service.scrollInbox(
          normalizeDirection(args.direction),
          this.state.inboxOffset,
          this.state.inboxQuery,
          this.state.inboxChatType
        );
      } else if (action === 'search_inbox') {
        const query = normalizeIdentifier(args.query ?? args.q ?? args.keyword);
        this.state.inboxQuery = query || null;
        this.state.inboxChatType = null;
        result = await this.service.searchInbox(query);
      } else if (action === 'focus_private') {
        const threadKey = resolvePrivateThreadKey(args, this.botAccountId);
        if (!threadKey) throw new Error('user_id is required');
        const atMessageId = normalizeMessageId(args.message_id ?? args.messageId);
        if (this.state.activeThreadKey && this.state.activeThreadKey !== threadKey) {
          await this.service.putAway(this.state.activeThreadKey);
        }
        result = await this.service.focusThread(threadKey, context, 'qq_usage.focus_private', atMessageId);
      } else if (action === 'focus_group') {
        const threadKey = resolveGroupThreadKey(args);
        if (!threadKey) throw new Error('group_id is required');
        const atMessageId = normalizeMessageId(args.message_id ?? args.messageId);
        if (this.state.activeThreadKey && this.state.activeThreadKey !== threadKey) {
          await this.service.putAway(this.state.activeThreadKey);
        }
        result = await this.service.focusThread(threadKey, context, 'qq_usage.focus_group', atMessageId);
      } else if (action === 'scroll_private') {
        const threadKey = resolvePrivateThreadKey(args, this.botAccountId);
        if (!threadKey) throw new Error('user_id is required');
        const direction = normalizeDirection(args.direction);
        const threadState = this.state.threads.get(threadKey);
        if (!threadState) throw new Error('focus_private or jump_private_to_latest must open this private chat before scrolling');
        const anchor = direction === 'newer' ? threadState.latestMessageId : threadState.earliestMessageId;
        if (!anchor) throw new Error('no visible message anchor is available for this private chat');
        result = await this.service.scrollThread(threadKey, direction, anchor, context, 'qq_usage.scroll_private');
      } else if (action === 'scroll_group') {
        const threadKey = resolveGroupThreadKey(args);
        if (!threadKey) throw new Error('group_id is required');
        const direction = normalizeDirection(args.direction);
        const threadState = this.state.threads.get(threadKey);
        if (!threadState) throw new Error('focus_group or jump_group_to_latest must open this group before scrolling');
        const anchor = direction === 'newer' ? threadState.latestMessageId : threadState.earliestMessageId;
        if (!anchor) throw new Error('no visible message anchor is available for this group');
        result = await this.service.scrollThread(threadKey, direction, anchor, context, 'qq_usage.scroll_group');
      } else if (action === 'jump_private_to_latest') {
        const threadKey = resolvePrivateThreadKey(args, this.botAccountId);
        if (!threadKey) throw new Error('user_id is required');
        result = await this.service.jumpToLatest(threadKey, context, 'qq_usage.jump_private_to_latest');
      } else if (action === 'jump_group_to_latest') {
        const threadKey = resolveGroupThreadKey(args);
        if (!threadKey) throw new Error('group_id is required');
        result = await this.service.jumpToLatest(threadKey, context, 'qq_usage.jump_group_to_latest');
      } else if (action === 'put_private_away') {
        const threadKey = resolvePrivateThreadKey(args, this.botAccountId);
        if (!threadKey) throw new Error('user_id is required');
        result = await this.service.putAway(threadKey);
        this.state.threads.delete(threadKey);
        if (this.state.activeThreadKey === threadKey) {
          this.state.activeThreadKey = null;
        }
      } else if (action === 'put_group_away') {
        const threadKey = resolveGroupThreadKey(args);
        if (!threadKey) throw new Error('group_id is required');
        result = await this.service.putAway(threadKey);
        this.state.threads.delete(threadKey);
        if (this.state.activeThreadKey === threadKey) {
          this.state.activeThreadKey = null;
        }
      } else if (action === 'put_qq_away') {
        const threadKey = this.state.activeThreadKey;
        result = await this.service.putAway(threadKey);
        if (threadKey) {
          this.state.threads.delete(threadKey);
          this.state.activeThreadKey = null;
        }
      } else if (action === 'set_group_notification_mode') {
        const groupId = getGroupId(args);
        if (!groupId) throw new Error('group_id is required');
        result = await this.service.setGroupNotificationMode(groupId, normalizeGroupNotificationMode(args.mode));
      } else if (action === 'set_group_notification_delay') {
        const groupId = getGroupId(args);
        if (!groupId) throw new Error('group_id is required');
        result = await this.service.setGroupNotificationDelay(groupId, normalizeAggregationSeconds(args.seconds ?? args.delay_seconds ?? args.delaySeconds));
      } else {
        throw new Error(`Unsupported qq_usage action: ${action}`);
      }
      this.rememberWindow(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.service.error(QQ_USAGE_ACTION_LABELS[action] || `qq_usage.${action || 'unknown'}`, args, message);
    }
  }
}
