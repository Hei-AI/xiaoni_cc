import {
  FinalizedInboundContext,
  InboundContext,
  InboundMentionedUser,
} from '../types';

type OneBotMessageSegment = {
  type?: string;
  data?: Record<string, unknown>;
};

type OneBotSender = {
  user_id?: number | string;
  nickname?: string;
  card?: string;
  role?: string;
  [key: string]: unknown;
};

export type OneBotMessageEvent = {
  post_type?: string;
  sub_type?: string;
  message_type?: 'private' | 'group';
  self_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  raw_message?: string;
  message?: string | OneBotMessageSegment[];
  time?: number;
  message_id?: number | string;
  sender?: OneBotSender;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
};

type BuildNapcatInboundContextParams = {
  event: OneBotMessageEvent;
  fallbackBotAccountId: string;
  replyCache?: RecentMessageCache;
};

type BuildSimulationInboundContextParams = {
  messageType: 'private' | 'group';
  userId: string;
  groupId?: string;
  text: string;
  atBot?: boolean;
  botAccountId: string;
  rawPayload?: Record<string, unknown>;
};

type RenderedMedia = {
  type: 'image' | 'audio' | 'video' | 'file';
  placeholder: string;
  locator?: string;
  mimeType?: string;
  mediaTag?: string;
  fileId?: string;
  fileName?: string;
  fileSize?: string;
};

type RecentMessageRecord = {
  messageId: string;
  senderId?: string;
  senderName?: string;
  rawBody: string;
  isBot: boolean;
  timestamp?: number;
};

type RenderedMessage = {
  rawBody: string;
  commandBody: string;
  media: RenderedMedia[];
  mentionedUserIds: string[];
  mentionLabels: Map<string, string>;
  replyMessageId?: string;
};

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 2000;
const RAW_MEDIA_TOKEN_REGEX = /\[(?:Image|Video|File:[^\]]+|Emoji)\]|<media:audio>/g;
const CQ_BOT_AT_REGEX = /\[CQ:at,qq=(\d+)(?:,[^\]]*?name=([^,\]]+))?\]/g;

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function sanitizeRawRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: string | undefined) {
  return (value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeMentionLabel(data: Record<string, unknown> | undefined) {
  return asNonEmptyString(data?.name)
    || asNonEmptyString(data?.nickname);
}

function resolveMentionLabel(
  userId: string | undefined,
  data: Record<string, unknown> | undefined,
  rawMentionNicknames: Map<string, string>
) {
  if (!userId) {
    return normalizeMentionLabel(data);
  }

  return normalizeMentionLabel(data)
    || rawMentionNicknames.get(userId)
    || userId;
}

function buildSessionKey(messageType: 'private' | 'group', botAccountId: string, userId: string, groupId?: string) {
  return messageType === 'group'
    ? `qq:group:${groupId || 'unknown'}`
    : `qq:direct:${botAccountId}:${userId}`;
}

function buildConversationLabel(messageType: 'private' | 'group', userId: string, senderName?: string, groupId?: string) {
  if (messageType === 'group') {
    return `群 ${groupId || 'unknown'}`;
  }

  return senderName || `QQ ${userId}`;
}

function buildGroupSubject(groupId?: string) {
  return groupId ? `群 ${groupId}` : undefined;
}

function isMessageMeaningful(rawBody: string, replyMessageId?: string, media?: RenderedMedia[]) {
  return rawBody.trim().length > 0 || Boolean(replyMessageId) || Boolean(media && media.length > 0);
}

function extractReplyMessageIdFromRaw(rawMessage: string | undefined) {
  if (!rawMessage) {
    return undefined;
  }

  const match = rawMessage.match(/\[CQ:reply,id=(\d+)\]/);
  return match?.[1];
}

function parseRawReplyMetadata(event: OneBotMessageEvent) {
  const rawRecords = Array.isArray(event.raw?.records) ? event.raw.records : [];
  for (const recordValue of rawRecords) {
    const record = sanitizeRawRecord(recordValue);
    if (!record) {
      continue;
    }

    const elements = Array.isArray(record.elements) ? record.elements : [];
    for (const elementValue of elements) {
      const element = sanitizeRawRecord(elementValue);
      const replyElement = sanitizeRawRecord(element?.replyElement);
      if (!replyElement) {
        continue;
      }

      const senderId = asNonEmptyString(record.senderUin)
        || asNonEmptyString(replyElement.senderUin)
        || asNonEmptyString(replyElement.senderUid);
      const senderName = asNonEmptyString(record.sendNickName)
        || asNonEmptyString(record.sendRemarkName)
        || asNonEmptyString(record.sendMemberName)
        || asNonEmptyString(replyElement.anonymousNickName);
      const text = asNonEmptyString(replyElement.sourceMsgText)
        || (Array.isArray(replyElement.sourceMsgTextElems)
          ? replyElement.sourceMsgTextElems
              .map((item) => sanitizeRawRecord(item))
              .map((item) => asNonEmptyString(item?.textElemContent) || '')
              .join('')
          : undefined);

      return {
        senderId,
        senderName,
        text: text ? normalizeWhitespace(normalizeText(text)) : undefined,
      };
    }
  }

  return undefined;
}

function pushText(parts: string[], value: string | undefined) {
  if (!value) {
    return;
  }
  const normalized = normalizeText(value);
  if (normalized.length > 0) {
    parts.push(normalized);
  }
}

function renderFilePlaceholder(fileName?: string) {
  return fileName ? `[File: ${fileName}]` : '[File: file]';
}

function inferImageMimeTypeFromFileName(fileName?: string) {
  const normalized = (fileName || '').toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  return undefined;
}

function isImageLikeFile(data: Record<string, unknown>, fileName?: string, mimeType?: string) {
  if (mimeType?.toLowerCase().startsWith('image/')) {
    return true;
  }
  if (inferImageMimeTypeFromFileName(fileName)) {
    return true;
  }
  return Boolean(asNonEmptyString(data.picWidth) || asNonEmptyString(data.picHeight));
}

function renderEmojiPlaceholder(data?: Record<string, unknown>) {
  return asNonEmptyString(data?.text)
    || asNonEmptyString(data?.name)
    || asNonEmptyString(data?.id)
    || '[Emoji]';
}

function renderJsonCardText(segment: OneBotMessageSegment): string | null {
  const raw = asString(segment.data?.data);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const detail = sanitizeRawRecord(parsed?.meta?.detail_1);
    const desc = asNonEmptyString(detail?.desc)
      || asNonEmptyString(detail?.title)
      || asNonEmptyString(parsed?.prompt);
    const rawUrl = asNonEmptyString(detail?.qqdocurl) || asNonEmptyString(detail?.url);
    const url = rawUrl?.split('?')[0];
    if (!desc && !url) return '[卡片]';
    return url ? `[卡片] ${desc ?? ''} ${url}`.trim() : `[卡片] ${desc}`;
  } catch {
    const prompt = asNonEmptyString(segment.data?.prompt);
    return prompt ? `[卡片] ${prompt}` : '[卡片]';
  }
}

function renderXmlCardText(segment: OneBotMessageSegment): string | null {
  const raw = asString(segment.data?.data);
  if (!raw) return null;
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(raw)?.[1]?.trim();
  const url = /<url[^>]*>([^<]+)<\/url>/i.exec(raw)?.[1]?.trim();
  const desc = /<des[^>]*>([^<]+)<\/des>/i.exec(raw)?.[1]?.trim();
  const label = title || desc;
  if (!label && !url) return '[卡片]';
  return url ? `[卡片] ${label ?? ''} ${url}`.trim() : `[卡片] ${label}`;
}

function renderShareText(segment: OneBotMessageSegment): string | null {
  const data = sanitizeRawRecord(segment.data) || {};
  const title = asNonEmptyString(data.title) || asNonEmptyString(data.content);
  const url = asNonEmptyString(data.url);
  if (!title && !url) return null;
  return url ? `[链接] ${title ?? ''} ${url}`.trim() : `[链接] ${title}`;
}

function renderMediaFromSegment(segment: OneBotMessageSegment): RenderedMedia | null {
  const data = sanitizeRawRecord(segment.data) || {};
  const fileName = asNonEmptyString(data.file) || asNonEmptyString(data.name);
  const locator = asNonEmptyString(data.url) || fileName;
  const mimeType = asNonEmptyString(data.mime)
    || asNonEmptyString(data.mimetype)
    || asNonEmptyString(data.content_type);

  switch (segment.type) {
    case 'image':
      return { type: 'image', placeholder: '[Image]', locator, mimeType: mimeType || 'image/*' };
    case 'record':
    case 'audio':
      return { type: 'audio', placeholder: '<media:audio>', locator, mimeType: mimeType || 'audio/*' };
    case 'video':
      return { type: 'video', placeholder: '[Video]', locator, mimeType: mimeType || 'video/*' };
    case 'file': {
      const fileId = asNonEmptyString(data.file_id) || asNonEmptyString(data.fileId);
      const fileSize = asNonEmptyString(data.file_size) || asNonEmptyString(data.fileSize);
      if (isImageLikeFile(data, fileName, mimeType)) {
        return {
          type: 'image',
          placeholder: '[Image]',
          locator,
          mimeType: mimeType || inferImageMimeTypeFromFileName(fileName) || 'image/*',
          fileId,
          fileName,
          fileSize,
        };
      }
      return {
        type: 'file',
        placeholder: renderFilePlaceholder(fileName),
        locator,
        mimeType: mimeType || 'application/octet-stream',
        fileId,
        fileName,
        fileSize,
      };
    }
    default:
      return null;
  }
}

function buildMentionedUsers(mentionedUserIds: string[], mentionLabels: Map<string, string>): InboundMentionedUser[] | undefined {
  if (mentionedUserIds.length === 0) {
    return undefined;
  }

  const users: InboundMentionedUser[] = [];
  const seen = new Set<string>();

  for (const userId of mentionedUserIds) {
    if (!userId || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    const label = mentionLabels.get(userId);
    users.push(label && label !== userId
      ? { userId, label }
      : { userId });
  }

  return users.length > 0 ? users : undefined;
}

function renderFromSegments(
  segments: OneBotMessageSegment[],
  botAccountId: string,
  rawMentionNicknames: Map<string, string>
): RenderedMessage {
  const rawParts: string[] = [];
  const commandParts: string[] = [];
  const media: RenderedMedia[] = [];
  const mentionedUserIds: string[] = [];
  const mentionLabels = new Map<string, string>();
  let replyMessageId: string | undefined;

  for (const segment of segments) {
    const data = sanitizeRawRecord(segment.data);
    switch (segment.type) {
      case 'text': {
        const text = asString(data?.text) || '';
        pushText(rawParts, text);
        pushText(commandParts, text);
        break;
      }
      case 'at': {
        const userId = asNonEmptyString(data?.qq);
        const label = resolveMentionLabel(userId, data, rawMentionNicknames) || 'someone';
        const mentionText = `@${label}`;
        pushText(rawParts, mentionText);
        if (userId) {
          mentionedUserIds.push(userId);
          mentionLabels.set(userId, label);
        }
        if (!userId || userId !== botAccountId) {
          pushText(commandParts, mentionText);
        }
        break;
      }
      case 'reply': {
        replyMessageId = asNonEmptyString(data?.id) || replyMessageId;
        break;
      }
      case 'face':
      case 'emoji': {
        const emojiText = renderEmojiPlaceholder(data);
        pushText(rawParts, emojiText);
        if (emojiText !== '[Emoji]') {
          pushText(commandParts, emojiText);
        }
        break;
      }
      case 'json': {
        const cardText = renderJsonCardText(segment);
        if (cardText) {
          pushText(rawParts, cardText);
          pushText(commandParts, cardText);
        }
        break;
      }
      case 'xml': {
        const xmlText = renderXmlCardText(segment);
        if (xmlText) {
          pushText(rawParts, xmlText);
          pushText(commandParts, xmlText);
        }
        break;
      }
      case 'share': {
        const shareText = renderShareText(segment);
        if (shareText) {
          pushText(rawParts, shareText);
          pushText(commandParts, shareText);
        }
        break;
      }
      default: {
        const renderedMedia = renderMediaFromSegment(segment);
        if (renderedMedia) {
          media.push(renderedMedia);
          pushText(rawParts, renderedMedia.placeholder);
        }
      }
    }
  }

  return {
    rawBody: normalizeWhitespace(rawParts.join('')),
    commandBody: normalizeWhitespace(commandParts.join('')),
    media,
    mentionedUserIds,
    mentionLabels,
    replyMessageId,
  };
}

function renderFromRawMessage(
  rawMessage: string,
  botAccountId: string,
  rawMentionNicknames: Map<string, string>
): RenderedMessage {
  const mentionLabels = new Map<string, string>();
  const mentionedUserIds: string[] = [];
  const replyMessageId = extractReplyMessageIdFromRaw(rawMessage);

  const rawBody = normalizeWhitespace(
    normalizeText(rawMessage)
      .replace(/\[CQ:reply,id=\d+\]/g, '')
      .replace(CQ_BOT_AT_REGEX, (_match, qq, name) => {
        const userId = String(qq);
        const label = typeof name === 'string' && name.trim()
          ? name.trim()
          : rawMentionNicknames.get(userId)
            || userId;
        mentionedUserIds.push(userId);
        mentionLabels.set(userId, label);
        return `@${label}`;
      })
      .replace(/\[CQ:image,[^\]]*\]/g, '[Image]')
      .replace(/\[CQ:(?:record|audio),[^\]]*\]/g, '<media:audio>')
      .replace(/\[CQ:video,[^\]]*\]/g, '[Video]')
      .replace(/\[CQ:file,[^\]]*?(?:name=([^,\]]+))?[^\]]*\]/g, (_match, name) => renderFilePlaceholder(name))
      .replace(/\[CQ:(?:face|emoji),[^\]]*\]/g, '[Emoji]')
  );

  const commandBody = normalizeWhitespace(
    rawBody
      .replace(new RegExp(`@${botAccountId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), '')
      .replace(RAW_MEDIA_TOKEN_REGEX, '')
  );

  return {
    rawBody,
    commandBody,
    media: [],
    mentionedUserIds,
    mentionLabels,
    replyMessageId,
  };
}

function extractMentionNicknamesFromRawPayload(event: OneBotMessageEvent) {
  const nicknameMap = new Map<string, string>();
  const rawElements = Array.isArray(event.raw?.elements) ? event.raw.elements : [];

  for (const element of rawElements) {
    const record = sanitizeRawRecord(element);
    const textElement = sanitizeRawRecord(record?.textElement);
    const userId = asNonEmptyString(textElement?.atUid);
    const content = asNonEmptyString(textElement?.content);
    if (!userId || !content || !content.startsWith('@')) {
      continue;
    }
    nicknameMap.set(userId, content.slice(1).trim() || content);
  }

  return nicknameMap;
}

function buildRenderedMessage(event: OneBotMessageEvent, botAccountId: string) {
  const rawMentionNicknames = extractMentionNicknamesFromRawPayload(event);
  if (Array.isArray(event.message)) {
    return renderFromSegments(event.message, botAccountId, rawMentionNicknames);
  }

  const rawCandidate = asString(event.raw_message) || asString(event.message) || '';
  return renderFromRawMessage(rawCandidate, botAccountId, rawMentionNicknames);
}

function buildMediaContext(media: RenderedMedia[], messageSid?: string) {
  if (media.length === 0) {
    return {};
  }

  const mediaAssets = media.map((entry, index) => {
    const mediaTag = entry.mediaTag || `${entry.type}_${index + 1}`;
    const asset = {
      mediaTag,
      placeholder: entry.placeholder,
      mediaType: entry.type,
      mimeType: entry.mimeType || 'application/octet-stream',
      locator: entry.locator,
      messageSid,
    };
    return {
      ...asset,
      ...(entry.fileId ? { fileId: entry.fileId } : {}),
      ...(entry.fileName ? { fileName: entry.fileName } : {}),
      ...(entry.fileSize ? { fileSize: entry.fileSize } : {}),
    };
  });
  const locators = mediaAssets.map((entry) => entry.locator).filter((value): value is string => Boolean(value));
  const mediaTypes = media.map((entry) => entry.mimeType || 'application/octet-stream');
  const primaryLocator = locators[0];

  return {
    MediaPath: primaryLocator,
    MediaUrl: primaryLocator,
    MediaType: mediaTypes[0],
    MediaPaths: locators.length > 0 ? locators : undefined,
    MediaUrls: locators.length > 0 ? locators : undefined,
    MediaTypes: mediaTypes,
    MediaAssets: mediaAssets,
  };
}

function stripBotMentionsAndMedia(text: string, botAccountId: string, labels: string[]) {
  let next = text;
  const candidates = Array.from(new Set([botAccountId, ...labels])).filter(Boolean);
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(`@${escaped}`, 'g'), '');
  }
  return normalizeWhitespace(next.replace(RAW_MEDIA_TOKEN_REGEX, ''));
}

function finalizeInboundContext(context: InboundContext): FinalizedInboundContext {
  const body = normalizeText(context.Body || '');
  const rawBody = normalizeText(context.RawBody !== undefined ? context.RawBody : body);
  const commandBody = normalizeText(context.CommandBody !== undefined ? context.CommandBody : (rawBody || body));
  const bodyForAgent = normalizeText(context.BodyForAgent !== undefined ? context.BodyForAgent : (rawBody || body));
  const bodyForCommands = normalizeText(
    context.BodyForCommands !== undefined ? context.BodyForCommands : (commandBody || rawBody || body)
  );

  return {
    ...context,
    Body: body,
    RawBody: rawBody,
    CommandBody: commandBody,
    BodyForAgent: bodyForAgent,
    BodyForCommands: bodyForCommands,
    CommandAuthorized: context.CommandAuthorized === true,
  };
}

export class RecentMessageCache {
  private readonly entries = new Map<string, RecentMessageRecord>();

  constructor(
    private readonly maxEntries = DEFAULT_CACHE_MAX_ENTRIES,
    private readonly ttlMs = DEFAULT_CACHE_TTL_MS,
  ) {}

  remember(entry: RecentMessageRecord) {
    const now = Date.now();
    this.prune(now);
    this.entries.delete(entry.messageId);
    this.entries.set(entry.messageId, entry);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  get(messageId: string) {
    const now = Date.now();
    this.prune(now);
    return this.entries.get(messageId);
  }

  private prune(now: number) {
    for (const [messageId, entry] of this.entries) {
      if (entry.timestamp && now - entry.timestamp > this.ttlMs) {
        this.entries.delete(messageId);
      }
    }
  }
}

export function rememberInboundContext(cache: RecentMessageCache, context: FinalizedInboundContext) {
  const messageId = asNonEmptyString(context.MessageSid);
  if (!messageId) {
    return;
  }

  cache.remember({
    messageId,
    senderId: context.SenderId,
    senderName: context.SenderName,
    rawBody: context.RawBody || context.BodyForAgent || context.Body,
    isBot: Boolean(context.SenderId && context.AccountId && context.SenderId === context.AccountId),
    timestamp: context.Timestamp,
  });
}

export function buildNapcatInboundContext(params: BuildNapcatInboundContextParams): FinalizedInboundContext | null {
  const { event } = params;
  if (event.post_type && event.post_type !== 'message') {
    return null;
  }
  const messageType = event.message_type === 'group' ? 'group' : 'private';
  const botAccountId = asNonEmptyString(event.self_id) || params.fallbackBotAccountId;
  const userId = asNonEmptyString(event.user_id);
  const groupId = asNonEmptyString(event.group_id);
  const messageId = asNonEmptyString(event.message_id);
  const sender = event.sender || {};
  const senderName = asNonEmptyString(sender.card) || asNonEmptyString(sender.nickname) || userId;
  const senderUsername = asNonEmptyString(sender.nickname);

  if (!botAccountId || !userId || !messageId) {
    return null;
  }

  if (messageType === 'group' && !groupId) {
    return null;
  }

  const rendered = buildRenderedMessage(event, botAccountId);
  const rawReplyMetadata = parseRawReplyMetadata(event);
  const replyMessageId = rendered.replyMessageId || asNonEmptyString((event as Record<string, unknown>).reply_to_message_id);
  const cachedReply = replyMessageId ? params.replyCache?.get(replyMessageId) : undefined;
  const rawMentionNicknames = extractMentionNicknamesFromRawPayload(event);
  const mentionedUsers = buildMentionedUsers(rendered.mentionedUserIds, rendered.mentionLabels);
  const botLabels = [
    rendered.mentionLabels.get(botAccountId),
    rawMentionNicknames.get(botAccountId),
    botAccountId,
  ].filter((value): value is string => Boolean(value));
  const wasMentioned = messageType === 'group'
    ? rendered.mentionedUserIds.includes(botAccountId)
      || Boolean(replyMessageId && (cachedReply?.isBot || rawReplyMetadata?.senderId === botAccountId))
    : false;

  const commandBody = stripBotMentionsAndMedia(rendered.commandBody, botAccountId, botLabels);
  const rawBody = rendered.rawBody;

  if (!isMessageMeaningful(rawBody, replyMessageId, rendered.media)) {
    return null;
  }

  const occurredAtMs = typeof event.time === 'number' && Number.isFinite(event.time)
    ? event.time * 1000
    : Date.now();
  const sessionKey = buildSessionKey(messageType, botAccountId, userId, groupId);
  const conversationLabel = buildConversationLabel(messageType, userId, senderName, groupId);
  const to = messageType === 'group' ? `group:${groupId}` : `user:${userId}`;
  const from = messageType === 'group' ? `qq:group:${groupId}` : `qq:${userId}`;

  return finalizeInboundContext({
    Body: rawBody,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: commandBody,
    BodyForCommands: commandBody,
    From: from,
    To: to,
    SessionKey: sessionKey,
    AccountId: botAccountId,
    ChatType: messageType === 'group' ? 'group' : 'direct',
    ConversationLabel: conversationLabel,
    GroupSubject: messageType === 'group' ? buildGroupSubject(groupId) : undefined,
    SenderName: senderName,
    SenderId: userId,
    SenderUsername: senderUsername,
    Provider: 'qq',
    Surface: 'napcat',
    MessageSid: messageId,
    ReplyToId: replyMessageId,
    ReplyToBody: cachedReply?.rawBody || rawReplyMetadata?.text,
    ReplyToSender: cachedReply?.senderName || rawReplyMetadata?.senderName || rawReplyMetadata?.senderId,
    ReplyToSenderId: cachedReply?.senderId || rawReplyMetadata?.senderId,
    ReplyToSenderName: cachedReply?.senderName || rawReplyMetadata?.senderName,
    ReplyToIsQuote: replyMessageId ? true : undefined,
    Timestamp: occurredAtMs,
    WasMentioned: messageType === 'group' ? wasMentioned : undefined,
    MentionedUsers: mentionedUsers,
    CommandAuthorized: false,
    OriginatingChannel: 'qq',
    OriginatingTo: to,
    NativeChannelId: messageType === 'group' ? groupId : userId,
    ...buildMediaContext(rendered.media, messageId),
  });
}

export function buildSimulationInboundContext(params: BuildSimulationInboundContextParams): FinalizedInboundContext {
  const rawBody = normalizeWhitespace(params.text);
  const commandBody = params.messageType === 'group' && params.atBot
    ? normalizeWhitespace(rawBody.replace(new RegExp(`@${params.botAccountId}`, 'g'), ''))
    : rawBody;
  const to = params.messageType === 'group' ? `group:${params.groupId}` : `user:${params.userId}`;

  return finalizeInboundContext({
    Body: rawBody,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: commandBody,
    BodyForCommands: commandBody,
    From: params.messageType === 'group' ? `qq:group:${params.groupId}` : `qq:${params.userId}`,
    To: to,
    SessionKey: buildSessionKey(params.messageType, params.botAccountId, params.userId, params.groupId),
    AccountId: params.botAccountId,
    ChatType: params.messageType === 'group' ? 'group' : 'direct',
    ConversationLabel: buildConversationLabel(params.messageType, params.userId, params.userId, params.groupId),
    GroupSubject: params.messageType === 'group' ? buildGroupSubject(params.groupId) : undefined,
    SenderName: params.userId,
    SenderId: params.userId,
    SenderUsername: params.userId,
    Provider: 'qq',
    Surface: 'simulator',
    MessageSid: `sim_${Date.now()}`,
    Timestamp: Date.now(),
    WasMentioned: params.messageType === 'group' ? Boolean(params.atBot) : undefined,
    CommandAuthorized: false,
    OriginatingChannel: 'qq',
    OriginatingTo: to,
    NativeChannelId: params.messageType === 'group' ? params.groupId : params.userId,
  });
}
