import type {
  QqUsageThreadList,
  QqUsageThreadSummary,
  QqUsageThreadWindow
} from '@qq-bot/persistence';
import type { RuntimeStore } from './runtime-store';

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

function toDateTime(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
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
  return formatTaggedBlock('THREAD', {
    thread_key: thread.threadKey,
    chat_type: thread.chatType === 'group' ? '群聊' : '私聊',
    display_name: displayName(thread),
    unread_count: thread.unreadCount,
    direct_mentions: thread.directMentions,
    latest_sender: senderLabel(thread.latestMessage),
    latest_preview: normalizePreview(thread.latestMessage)
  });
}

function renderThreadListWindow(result: QqUsageThreadList) {
  return formatTaggedBlock('IM_INBOX_WINDOW', {
    mode: 'thread_list',
    surface: 'qq',
    offset: result.offset,
    window_size: result.limit,
    has_older_threads: String(result.hasOlderThreads),
    has_newer_threads: String(result.hasNewerThreads)
  }, result.threads.map(renderThread).join('\n'));
}

function renderMessage(message: Record<string, unknown>) {
  const replyTo = typeof message.reply_to_id === 'string' && message.reply_to_id.trim()
    ? message.reply_to_id.trim()
    : null;
  return formatTaggedBlock('MESSAGE', {
    message_id: message.id,
    timestamp: toDateTime(message.message_timestamp || message.received_at),
    sender: senderLabel(message),
    direction: 'incoming',
    read_state: Number(message.is_read) === 1 ? 'read' : 'unread',
    mentions_xiaoni: String(Number(message.was_mentioned) === 1),
    ...(replyTo ? { reply_to: replyTo } : {})
  }, escapeXmlText(renderMessageBody(message)));
}

function renderConversationWindow(result: QqUsageThreadWindow) {
  return formatTaggedBlock('IM_INBOX_WINDOW', {
    mode: 'conversation',
    surface: 'qq',
    thread_key: result.threadKey,
    cursor_anchor: result.cursorAnchor,
    window_size: result.windowSize,
    unread_before_window: result.unreadBeforeWindow,
    unread_after_window: result.unreadAfterWindow,
    reached_read_history: String(result.reachedReadHistory),
    has_older_messages: String(result.hasOlderMessages),
    has_newer_messages: String(result.hasNewerMessages),
    newer_available: result.newerAvailable
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
  scroll_private: 'qq_usage.scroll_private',
  scroll_group: 'qq_usage.scroll_group',
  jump_private_to_latest: 'qq_usage.jump_private_to_latest',
  jump_group_to_latest: 'qq_usage.jump_group_to_latest',
  put_private_away: 'qq_usage.put_private_away',
  put_group_away: 'qq_usage.put_group_away',
  put_qq_away: 'qq_usage.put_qq_away'
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

export class QqUsageService {
  constructor(private readonly store: RuntimeStore) {}

  async ambientUnread() {
    const summary = await this.store.getQqUsageUnreadSummary();
    return formatTaggedBlock('PHONE_NOTIFICATION', {
      app: 'qq',
      surface: 'status_bar',
      unread_count: summary.unreadCount,
      direct_mentions: summary.directMentions
    });
  }

  async openInbox(offset = 0): Promise<QqUsageToolResult> {
    const result = await this.store.listQqUsageThreads({ limit: WINDOW_SIZE, offset });
    return {
      qq_usage: true,
      action: 'qq_usage.open_inbox',
      content: renderThreadListWindow(result),
      inbox_offset: result.offset
    };
  }

  async scrollInbox(direction: 'older' | 'newer', currentOffset = 0): Promise<QqUsageToolResult> {
    const nextOffset = direction === 'newer'
      ? Math.max(0, currentOffset - WINDOW_SIZE)
      : currentOffset + WINDOW_SIZE;
    const result = await this.store.listQqUsageThreads({ limit: WINDOW_SIZE, offset: nextOffset });
    return {
      qq_usage: true,
      action: 'qq_usage.scroll_inbox',
      content: renderThreadListWindow(result),
      inbox_offset: result.offset
    };
  }

  async focusThread(threadKey: string, context: QqUsageActionContext = {}, actionLabel = 'qq_usage.focus_thread'): Promise<QqUsageToolResult> {
    const result = await this.store.listQqUsageThreadWindow({ threadKey, mode: 'latest', limit: WINDOW_SIZE });
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
      return {
        qq_usage: true,
        action: 'qq_usage.put_qq_away',
        thread_key: result.threadKey,
        content: formatTaggedBlock('IM_INBOX_WINDOW', {
          mode: 'closed',
          surface: 'qq',
          thread_key: result.threadKey,
          cleared_unread_badge: String(true),
          cleared_count: result.clearedCount
        }, 'QQ 已放下。清掉未读角标不等于已经看过未显示的消息。')
      };
    }
    return {
      qq_usage: true,
      action: 'qq_usage.put_qq_away',
      thread_key: null,
      content: formatTaggedBlock('IM_INBOX_WINDOW', {
        mode: 'closed',
        surface: 'qq',
        cleared_unread_badge: String(false),
        cleared_count: 0
      }, 'QQ 列表已关闭。')
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
        result = await this.service.openInbox(0);
      } else if (action === 'scroll_inbox') {
        result = await this.service.scrollInbox(normalizeDirection(args.direction), this.state.inboxOffset);
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
        result = await this.service.putAway(null);
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
