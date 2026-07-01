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

function renderMessage(message: Record<string, unknown>) {
  const replyTo = typeof message.reply_to_id === 'string' && message.reply_to_id.trim()
    ? message.reply_to_id.trim()
    : null;
  // outgoing = 小腻自己发的（来自 agent_outbound_messages，见 persistence 合并）。
  // 默认 incoming 保持 inbound 行的历史行为不变。
  const direction = message.direction === 'outgoing' ? 'outgoing' : 'incoming';
  // message_id 保留：它是 reply_to 的对应锚（reply_to="X" 要能在窗口里找到 message_id="X"）。
  // read_state 只在未读时透出（读过是默认态）；mentions_xiaoni 只在被@时透出（否则恒 false 是噪音）。
  const isUnread = Number(message.is_read) !== 1;
  const wasMentioned = Number(message.was_mentioned) === 1;
  return formatTaggedBlock('MESSAGE', {
    message_id: message.id,
    timestamp: toDateTime(message.message_timestamp || message.received_at),
    sender: senderLabel(message),
    direction,
    ...(isUnread ? { read_state: 'unread' } : {}),
    ...(wasMentioned ? { mentions_xiaoni: 'true' } : {}),
    ...(replyTo ? { reply_to: replyTo } : {})
  }, escapeXmlText(renderMessageBody(message)));
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

function renderConversationWindow(result: QqUsageThreadWindow) {
  // 精简：删掉纯内部记账字段——surface(恒定)、thread_key(内部id且SKILL叫她别用)、
  // cursor_anchor(内部id对,翻页不靠它)、window_size(可数)、newer_available(与 has_newer_messages 重复)。
  // 翻页锚点走结果对象的 earliest/latest_message_id（runtime 内部 state），不受此渲染影响。
  // 逻辑闭环：保留干净的 chat_type + peer_id——她后续 scroll_/jump_/put_away/send 这条会话都要这个 id。
  // 群会话里成员各说各的，群号只能从这里拿；私聊也一并给出，窗口自成闭环、不依赖跨轮记忆。
  const identity = threadIdentity(result.threadKey);
  return formatTaggedBlock('IM_INBOX_WINDOW', {
    mode: 'conversation',
    chat_type: identity.chatType === 'group' ? '群聊' : '私聊',
    peer_id: identity.peerId,
    unread_before_window: result.unreadBeforeWindow,
    unread_after_window: result.unreadAfterWindow,
    reached_read_history: String(result.reachedReadHistory),
    has_older_messages: String(result.hasOlderMessages),
    has_newer_messages: String(result.hasNewerMessages)
  }, result.messages.map(renderMessage).join('\n'));
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

  async focusThread(threadKey: string, context: QqUsageActionContext = {}, actionLabel = 'qq_usage.focus_thread'): Promise<QqUsageToolResult> {
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
      const result = await this.store.markQqUsageThreadRead({ threadKey: threadKey.trim() });
      await this.store.clearQqUsageActiveSurface({ threadKey: threadKey.trim() });
      return {
        qq_usage: true,
        action: 'qq_usage.put_qq_away',
        thread_key: result.threadKey,
        content: formatTaggedBlock('IM_INBOX_WINDOW', {
          mode: 'closed',
          cleared_unread_badge: String(true),
          cleared_count: result.clearedCount
        }, 'QQ 已放下。清掉未读角标不等于已经看过未显示的消息。')
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
        if (this.state.activeThreadKey && this.state.activeThreadKey !== threadKey) {
          await this.service.putAway(this.state.activeThreadKey);
        }
        result = await this.service.focusThread(threadKey, context, 'qq_usage.focus_private');
      } else if (action === 'focus_group') {
        const threadKey = resolveGroupThreadKey(args);
        if (!threadKey) throw new Error('group_id is required');
        if (this.state.activeThreadKey && this.state.activeThreadKey !== threadKey) {
          await this.service.putAway(this.state.activeThreadKey);
        }
        result = await this.service.focusThread(threadKey, context, 'qq_usage.focus_group');
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
