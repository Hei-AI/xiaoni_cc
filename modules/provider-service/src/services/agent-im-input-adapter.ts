import {
  FinalizedInboundContext,
  InboundContext,
  InboundMentionedUser,
} from '../types';
import { QQ_FACE_NAMES } from '../data/qq-face-names';

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

type RenderedMessage = {
  rawBody: string;
  commandBody: string;
  media: RenderedMedia[];
  mentionedUserIds: string[];
  mentionLabels: Map<string, string>;
  replyMessageId?: string;
};

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

function isMessageMeaningful(rawBody: string, replyMessageId?: string, media?: RenderedMedia[], hasRawReply?: boolean) {
  return rawBody.trim().length > 0 || Boolean(replyMessageId) || Boolean(media && media.length > 0) || Boolean(hasRawReply);
}

function extractReplyMessageIdFromRaw(rawMessage: string | undefined) {
  if (!rawMessage) {
    return undefined;
  }

  const match = rawMessage.match(/\[CQ:reply,id=(\d+)\]/);
  return match?.[1];
}

// 从一组 NTQQ elements 里找出 replyElement 并整形成引用元数据。
// 被引用原消息的昵称在 raw.records[] 里（record.sendNickName），按
// replyElement.sourceMsgIdInRecords === record.msgId 关联；replyElement 自身
// 只带裸号（senderUid/Uin），单用会渲染成「引用 1129974489:」而非「引用 小腻:」。
function extractReplyFromElements(
  elements: unknown,
  records: Record<string, unknown>[],
): { senderId?: string; senderName?: string; text?: string; nativeMsgId?: string; nativeMsgSeq?: string } | undefined {
  if (!Array.isArray(elements)) {
    return undefined;
  }
  for (const elementValue of elements) {
    const element = sanitizeRawRecord(elementValue);
    const replyElement = sanitizeRawRecord(element?.replyElement);
    if (!replyElement) {
      continue;
    }

    // NTQQ msgId of the quoted message — the only handle a raw-only reply carries
    // (OneBot message[] is absent). Used downstream to resolve the quoted row via
    // napcat_msg_id across both tables when the OneBot reply id is missing.
    const sourceMsgId = asNonEmptyString(replyElement.sourceMsgIdInRecords);
    const quotedRecord = (sourceMsgId
      ? records.find((r) => asNonEmptyString(r.msgId) === sourceMsgId)
      : undefined) || records[0];

    const senderId = asNonEmptyString(replyElement.senderUin)
      || asNonEmptyString(replyElement.senderUid)
      || asNonEmptyString(quotedRecord?.senderUin);
    const senderName = asNonEmptyString(quotedRecord?.sendNickName)
      || asNonEmptyString(quotedRecord?.sendRemarkName)
      || asNonEmptyString(quotedRecord?.sendMemberName)
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
      nativeMsgId: sourceMsgId,
      // NTQQ per-conversation sequence of the quoted message — bridges to the OneBot
      // message_id via conversation history (real_seq). Lets us jump to a quoted
      // message we can't otherwise address (esp. 小腻's own outbound).
      nativeMsgSeq: asNonEmptyString(replyElement.replayMsgSeq),
    };
  }
  return undefined;
}

function parseRawReplyMetadata(event: OneBotMessageEvent) {
  const raw = sanitizeRawRecord(event.raw);
  const records = (Array.isArray(raw?.records) ? raw.records : [])
    .map((value) => sanitizeRawRecord(value))
    .filter((value): value is Record<string, unknown> => Boolean(value));

  // 主源：引用消息自身顶层 raw.elements[] 里的 replyElement —— NapCat 对每条引用都给
  // （真库实测 964/964 命中），且不依赖 OneBot message[] 是否带 reply 段（那个会缺）。
  const fromTop = extractReplyFromElements(raw?.elements, records);
  if (fromTop) {
    return fromTop;
  }
  // 回退：老的 raw.records[].elements[] 扫描（真库 0/300 命中，仅留作嵌套引用兜底）。
  for (const record of records) {
    const fromRecord = extractReplyFromElements(record.elements, records);
    if (fromRecord) {
      return fromRecord;
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

function normalizeFaceName(value: string | undefined): string | undefined {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return undefined;
  }
  // NapCat 的 data.raw.faceText 与 QQ face_config 的 QDes 都带前导 '/'(如 '/流泪'),
  // QQ 客户端渲染成 '[流泪]'。剥掉斜杠后我们统一包成 [名字]。
  const stripped = trimmed.replace(/^\/+/, '').trim();
  return stripped.length > 0 ? stripped : undefined;
}

function renderFaceById(faceId: string | undefined): string | undefined {
  if (!faceId) {
    return undefined;
  }
  const mapped = QQ_FACE_NAMES[faceId];
  if (mapped) {
    return `[${mapped}]`;
  }
  // 未知 id 也绝不再暴露裸数字(接收端会当成暗号,见 124 之谜)。
  return `[表情:${faceId}]`;
}

function renderEmojiPlaceholder(data?: Record<string, unknown>) {
  // 部分 emoji 段自带可读文本。
  const explicit = asNonEmptyString(data?.text) || asNonEmptyString(data?.name);
  if (explicit) {
    return explicit;
  }
  // NapCat 只在部分新表情上回填 data.raw.faceText;经典表情(124=OK、182=笑哭…)为空。
  const rawRecord = sanitizeRawRecord(data?.raw);
  const faceText = normalizeFaceName(asNonEmptyString(rawRecord?.faceText));
  if (faceText) {
    return `[${faceText}]`;
  }
  // 经典表情靠静态权威表还原;彻底不再落到裸数字。
  return renderFaceById(asNonEmptyString(data?.id)) || '[Emoji]';
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
      // Capture NapCat's local file handle (the NT cache name, e.g. "<HASH>.webp"
      // in `data.file`) alongside the CDN url. The direct QQ image url can 400 on
      // our bare fetch — gchat.qpic.cn rejects it even with a fresh rkey — leaving
      // the image unmaterialized and later "过期看不到". With fileId set,
      // resolveInboundMediaBytes falls back to napcatClient.getFile(<name>), which
      // makes NapCat re-download the original via its authenticated QQ session and
      // materialize it locally for the provider to read through the shared mount.
      return {
        type: 'image',
        placeholder: '[Image]',
        locator,
        mimeType: mimeType || 'image/*',
        fileId: asNonEmptyString(data.file),
        fileName,
      };
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
      .replace(/\[CQ:(?:face|emoji),([^\]]*)\]/g, (_match, params) => {
        const faceId = /(?:^|,)id=(\d+)/.exec(String(params || ''))?.[1];
        return renderFaceById(faceId) || '[Emoji]';
      })
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
  const rawMentionNicknames = extractMentionNicknamesFromRawPayload(event);
  const mentionedUsers = buildMentionedUsers(rendered.mentionedUserIds, rendered.mentionLabels);
  const botLabels = [
    rendered.mentionLabels.get(botAccountId),
    rawMentionNicknames.get(botAccountId),
    botAccountId,
  ].filter((value): value is string => Boolean(value));
  // reply-mention：别人引用小腻的消息应唤醒她。旧写法用 `replyMessageId &&` 做闸，
  // 但 raw-only 引用（NapCat 没把 reply 段放进 message[]）时 replyMessageId 为空 →
  // 整个分支死掉，群里引用小腻不唤醒（真实事故行 id 29876）。改用「有任一引用信号」。
  // 这里只看事件自带的 raw 元数据；被引用消息的库内解析（含「引用的是小腻自己」的
  // 唤醒升级）在 index.ts 入站链路里 resolveQuotedMessageFromStore 补齐。
  const wasMentioned = messageType === 'group'
    ? rendered.mentionedUserIds.includes(botAccountId)
      || Boolean((replyMessageId || rawReplyMetadata) && rawReplyMetadata?.senderId === botAccountId)
    : false;

  const commandBody = stripBotMentionsAndMedia(rendered.commandBody, botAccountId, botLabels);
  const rawBody = rendered.rawBody;

  if (!isMessageMeaningful(rawBody, replyMessageId, rendered.media, Boolean(rawReplyMetadata))) {
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
    // NativeMsgId: this row's own NTQQ-native msgId (raw.msgId). Stored as
    // napcat_msg_id so a raw-only reply can later resolve to it across tables.
    NativeMsgId: asNonEmptyString(sanitizeRawRecord(event.raw)?.msgId),
    ReplyToId: replyMessageId,
    // NativeReplyMsgId: NTQQ msgId of the quoted message (raw-only replies carry
    // only this, not the OneBot reply id). Used to resolve the quoted row.
    NativeReplyMsgId: rawReplyMetadata?.nativeMsgId,
    // NativeReplyMsgSeq: NTQQ per-conversation seq of the quoted message. Bridged to
    // the OneBot message_id via history (real_seq) at ingest → sets ReplyToId.
    NativeReplyMsgSeq: rawReplyMetadata?.nativeMsgSeq,
    // 正文/发送者这里只取事件自带的 raw 元数据；查库解析（单一真理源）在
    // index.ts 的 resolveQuotedMessageFromStore 里补齐，不再依赖内存缓存。
    ReplyToBody: rawReplyMetadata?.text,
    ReplyToSender: rawReplyMetadata?.senderName || rawReplyMetadata?.senderId,
    ReplyToSenderId: rawReplyMetadata?.senderId,
    ReplyToSenderName: rawReplyMetadata?.senderName,
    ReplyToIsQuote: (replyMessageId || rawReplyMetadata) ? true : undefined,
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
