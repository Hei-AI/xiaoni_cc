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

function renderMentionList(mentionedUsers: FinalizedInboundContext['MentionedUsers']) {
  const rendered = (Array.isArray(mentionedUsers) ? mentionedUsers : [])
    .map((mentionedUser) => formatIdentity(mentionedUser?.label, mentionedUser?.userId));
  return rendered.length > 0 ? `[${rendered.join(', ')}]` : '[]';
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

function extractSemanticText(
  text: string,
  mentionedUsers: FinalizedInboundContext['MentionedUsers']
) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) {
    return '';
  }

  let remaining = source;
  let didStripLeadingMention = false;

  while (true) {
    const next = stripLeadingMentionToken(remaining, mentionedUsers).trim();
    if (next === remaining) {
      break;
    }
    remaining = next;
    didStripLeadingMention = true;
  }

  return didStripLeadingMention ? remaining : source;
}

function buildConversationInfo(message: QueueBatchMessage, index: number) {
  return JSON.stringify({
    sequence: index + 1,
    chat_type: message.chatType
  }, null, 2);
}

function buildMessageSemantics(message: QueueBatchMessage) {
  return JSON.stringify({
    text: extractSemanticText(message.bodyForAgent, message.inboundContext.MentionedUsers)
  }, null, 2);
}

function buildReplyInfo(inboundContext: FinalizedInboundContext) {
  return JSON.stringify({
    sender: formatReplyTarget(inboundContext),
    text: inboundContext.ReplyToBody
  }, null, 2);
}

function wrapBlock(label: string, fenceType: 'json' | 'text', content: string) {
  return `${label}:\n\`\`\`${fenceType}\n${content}\n\`\`\``;
}

export function renderRuntimeBatchMessage(message: QueueBatchMessage, index: number) {
  const blocks = [
    wrapBlock('Conversation info', 'json', buildConversationInfo(message, index)),
    wrapBlock('Sender', 'text', formatIdentity(message.senderName, message.senderId)),
    wrapBlock('Mentions in current message', 'text', renderMentionList(message.inboundContext.MentionedUsers)),
    wrapBlock('Visible message text', 'text', extractVisibleMessageText(message)),
    wrapBlock('Message semantics', 'json', buildMessageSemantics(message))
  ];

  if (message.inboundContext.ReplyToBody) {
    blocks.push(wrapBlock('Reply to', 'json', buildReplyInfo(message.inboundContext)));
  }

  return blocks.join('\n\n');
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
        placeholders.push({ token, value: canonical });
      }
    }
  }

  for (const { token, value } of placeholders) {
    rendered = rendered.replace(new RegExp(escapeRegExp(token), 'g'), value);
  }

  return rendered;
}
