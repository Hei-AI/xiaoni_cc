import { FinalizedInboundContext, InboundMentionedUser, QueueBatchMessage, QueueMessagePayload } from '../types';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatIdentity(label?: string, id?: string) {
  const normalizedLabel = typeof label === 'string' ? label.trim() : '';
  const normalizedId = typeof id === 'string' ? id.trim() : '';

  if (normalizedLabel && normalizedId && normalizedLabel !== normalizedId) {
    return `{${normalizedLabel}(@${normalizedId})}`;
  }
  if (normalizedId) {
    return `{@${normalizedId}}`;
  }
  if (normalizedLabel) {
    return `{${normalizedLabel}}`;
  }
  return '{unknown}';
}

function formatReplyTarget(inboundContext: FinalizedInboundContext) {
  return formatIdentity(
    inboundContext.ReplyToSenderName || inboundContext.ReplyToSender,
    inboundContext.ReplyToSenderId
  );
}

function getMentionPatterns(mentionedUser: InboundMentionedUser) {
  const userId = typeof mentionedUser?.userId === 'string' ? mentionedUser.userId.trim() : '';
  const label = typeof mentionedUser?.label === 'string' ? mentionedUser.label.trim() : '';

  return [label ? `@${label}` : null, userId ? `@${userId}` : null]
    .filter((pattern): pattern is string => Boolean(pattern))
    .sort((left, right) => right.length - left.length);
}

function extractVisibleMessageText(message: QueueBatchMessage) {
  const rawBody = typeof message.rawBody === 'string' ? message.rawBody.trim() : '';
  if (rawBody) {
    return rawBody;
  }
  return typeof message.bodyForAgent === 'string' ? message.bodyForAgent.trim() : '';
}

function stripLeadingMentionToken(
  text: string,
  mentionedUsers: FinalizedInboundContext['MentionedUsers']
) {
  const trimmedStart = text.trimStart();
  const leadingWhitespace = text.length - trimmedStart.length;
  const replacements = Array.isArray(mentionedUsers) ? mentionedUsers : [];

  for (const mentionedUser of replacements) {
    for (const pattern of getMentionPatterns(mentionedUser)) {
      if (!trimmedStart.startsWith(pattern)) {
        continue;
      }

      const afterPattern = trimmedStart.slice(pattern.length).replace(/^[\s,，:：]+/u, '');
      return text.slice(0, leadingWhitespace) + afterPattern;
    }
  }

  return text;
}

function toDisplayTimestamp(message: QueueBatchMessage) {
  const value = message.messageTimestamp || message.receivedAt;
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function renderRuntimeBatchMessage(message: QueueBatchMessage, index: number) {
  const lines = [
    `${toDisplayTimestamp(message) || `第${index + 1}条`} ${formatIdentity(message.senderName, message.senderId)}`
  ];

  if (message.inboundContext.ReplyToBody) {
    const prefix = message.inboundContext.ReplyToIsQuote ? '引用' : '回复给';
    lines.push(`[${prefix} ${formatReplyTarget(message.inboundContext)}：${message.inboundContext.ReplyToBody}]`);
  }

  const body = normalizeTranscriptMessageText(
    extractVisibleMessageText(message),
    message.inboundContext.MentionedUsers
  );
  lines.push(body || '(空消息)');

  return lines.join('\n');
}

export function renderRuntimeBatchInput(queueMessage: QueueMessagePayload) {
  return queueMessage.messages.map((message, index) => renderRuntimeBatchMessage(message, index)).join('\n\n');
}

export function normalizeTranscriptMessageText(
  text: string,
  mentionedUsers: FinalizedInboundContext['MentionedUsers']
) {
  let rendered = text;
  const replacements = Array.isArray(mentionedUsers) ? mentionedUsers : [];
  const placeholders: Array<{ token: string; value: string }> = [];
  let placeholderIndex = 0;

  for (const mentionedUser of replacements) {
    const canonical = formatIdentity(mentionedUser?.label || undefined, mentionedUser?.userId || undefined);

    for (const pattern of getMentionPatterns(mentionedUser)) {
      const token = `__MENTION_${placeholderIndex += 1}__`;
      const nextRendered = rendered.replace(new RegExp(escapeRegExp(pattern), 'g'), token);
      if (nextRendered !== rendered) {
        rendered = nextRendered;
        placeholders.push({ token, value: `@${canonical}` });
      }
    }
  }

  for (const { token, value } of placeholders) {
    rendered = rendered.replace(new RegExp(escapeRegExp(token), 'g'), value);
  }

  return rendered;
}
