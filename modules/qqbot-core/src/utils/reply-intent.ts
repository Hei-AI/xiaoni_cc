import {
  OB11Segment,
  QQMessage,
  ReplyAddressTarget,
  ReplyIntentContext
} from '../types';

interface MentionTarget {
  user_id: number;
  nickname?: string;
}

interface RawReplyRecord {
  sender_id?: number;
  sender_nickname?: string;
  text?: string;
}

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

const normalizeNickname = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getMessageSegments = (message: QQMessage): OB11Segment[] => {
  if (Array.isArray(message.message)) {
    return message.message;
  }

  if (Array.isArray(message.segments)) {
    return message.segments;
  }

  return [];
};

const extractReplyMessageId = (message: QQMessage): number | undefined => {
  const segments = getMessageSegments(message);
  const replySegment = segments.find(segment => segment?.type === 'reply');
  const fromSegment = toFiniteNumber(replySegment?.data?.id);
  if (fromSegment !== undefined) {
    return fromSegment;
  }

  const candidates = [
    typeof message.raw_message === 'string'
      ? /\[CQ:reply,id=(\d+)\]/.exec(message.raw_message)?.[1]
      : undefined,
    (message as any)?.reply_to_message_id
  ];

  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
};

const extractMentionTargetsFromSegments = (message: QQMessage): MentionTarget[] => {
  const mentions: MentionTarget[] = [];
  const seen = new Set<number>();

  for (const segment of getMessageSegments(message)) {
    if (segment?.type !== 'at') {
      continue;
    }

    const userId = toFiniteNumber(segment.data?.qq);
    if (userId === undefined || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    mentions.push({
      user_id: userId,
      nickname: normalizeNickname(segment.data?.name)
    });
  }

  return mentions;
};

const extractMentionNicknamesFromRawPayload = (
  message: QQMessage
): Map<number, string> => {
  const nicknameMap = new Map<number, string>();
  const rawElements = (message as any)?.raw?.elements;

  if (!Array.isArray(rawElements)) {
    return nicknameMap;
  }

  for (const element of rawElements) {
    const textElement = element?.textElement;
    if (!textElement) {
      continue;
    }

    const userId = toFiniteNumber(textElement.atUid);
    const content = normalizeNickname(textElement.content);
    if (userId === undefined || !content || !content.startsWith('@')) {
      continue;
    }

    nicknameMap.set(userId, content.slice(1).trim() || content);
  }

  return nicknameMap;
};

const extractRawReplyRecord = (message: QQMessage): RawReplyRecord | undefined => {
  const records = (message as any)?.raw?.records;

  if (!Array.isArray(records)) {
    return undefined;
  }

  for (const record of records) {
    const elements = Array.isArray(record?.elements) ? record.elements : [];
    const replyElement = elements.find((element: any) => element?.replyElement)?.replyElement;

    if (!replyElement) {
      continue;
    }

    const senderId = toFiniteNumber(record?.senderUin)
      ?? toFiniteNumber(replyElement?.senderUin)
      ?? toFiniteNumber(replyElement?.senderUid);

    const senderNickname = normalizeNickname(record?.sendNickName)
      ?? normalizeNickname(record?.sendRemarkName)
      ?? normalizeNickname(record?.sendMemberName)
      ?? normalizeNickname(replyElement?.anonymousNickName);

    const sourceMsgText = normalizeNickname(replyElement?.sourceMsgText);
    const textFromElems = Array.isArray(replyElement?.sourceMsgTextElems)
      ? replyElement.sourceMsgTextElems
          .map((item: any) => normalizeNickname(item?.textElemContent))
          .filter((item: string | undefined): item is string => Boolean(item))
          .join('')
          .trim()
      : '';

    return {
      sender_id: senderId,
      sender_nickname: senderNickname,
      text: sourceMsgText || normalizeNickname(textFromElems)
    };
  }

  return undefined;
};

export function extractNormalizedMessageText(message: QQMessage): string {
  if (typeof message.normalized_text === 'string' && message.normalized_text.trim().length > 0) {
    return message.normalized_text.trim();
  }

  if (Array.isArray(message.message)) {
    return message.message
      .map(segment => {
        if (segment?.type === 'text') {
          return segment.data?.text || '';
        }
        if (segment?.type === 'at') {
          const mentionName = segment.data?.name || segment.data?.qq;
          return mentionName ? `@${mentionName}` : '@';
        }
        return '';
      })
      .join('')
      .trim();
  }

  const rawText = typeof message.message === 'string'
    ? message.message
    : typeof message.raw_message === 'string'
      ? message.raw_message
      : '';

  return rawText
    .replace(/\[CQ:reply,id=\d+\]/g, '')
    .replace(/\[CQ:at,qq=(\d+)(?:,[^\]]*?name=([^,\]]+))?\]/g, (_, qq, name) => `@${name || qq}`)
    .trim();
}

export function parseReplyIntentContext(
  message: QQMessage
): ReplyIntentContext | undefined {
  const replyMessageId = extractReplyMessageId(message);
  if (replyMessageId === undefined) {
    return undefined;
  }

  const rawReplyRecord = extractRawReplyRecord(message);
  const mentionNicknames = extractMentionNicknamesFromRawPayload(message);
  const mentionTargets = extractMentionTargetsFromSegments(message).map(target => ({
    ...target,
    nickname: target.nickname || mentionNicknames.get(target.user_id)
  }));

  const addressTarget: ReplyAddressTarget = (() => {
    if (mentionTargets.length > 0) {
      return {
        type: 'mention',
        user_id: mentionTargets[0].user_id,
        nickname: mentionTargets[0].nickname
      };
    }

    if (rawReplyRecord?.sender_id !== undefined) {
      return {
        type: 'quoted_sender',
        user_id: rawReplyRecord.sender_id,
        nickname: rawReplyRecord.sender_nickname
      };
    }

    return {
      type: 'group'
    };
  })();

  const interpretation = addressTarget.type === 'mention'
    ? 'The user is replying to the quoted message, but is currently addressing the mentioned user.'
    : addressTarget.type === 'quoted_sender'
      ? 'The user is directly replying to the quoted sender and quoted content.'
      : 'The user is replying to the quoted message in the shared group context.';

  return {
    message_kind: 'directed_reply',
    semantic_anchor: {
      message_id: replyMessageId,
      text: rawReplyRecord?.text,
      sender_id: rawReplyRecord?.sender_id,
      sender_nickname: rawReplyRecord?.sender_nickname
    },
    address_target: addressTarget,
    interpretation
  };
}
