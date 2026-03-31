import { aiConfig } from '../config';
import type { FinalizedInboundContext, InboundMentionedUser } from '../types';

export type ProviderMessageType = 'private' | 'group';

export type SimpleQueueSimulationPayload = {
  user_id?: number | string;
  group_id?: number | string;
  message?: string;
  priority?: string;
};

const DEFAULT_BOT_NAME_CUES = (process.env.GROUP_PARTICIPATION_BOT_NAME_CUES || '小腻')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function toNumericId(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferMentionLabel(message: string) {
  for (const cue of DEFAULT_BOT_NAME_CUES) {
    const pattern = new RegExp(`@${escapeRegExp(cue)}(?:\\s|$)`, 'i');
    if (pattern.test(message)) {
      return cue;
    }
  }

  return undefined;
}

function stripLeadingMention(message: string, label?: string) {
  const cqAtPattern = new RegExp(`^\\s*\\[CQ:at,qq=${escapeRegExp(String(aiConfig.bot_qq_number))}(?:,[^\\]]*)?\\]\\s*`, 'i');
  const withoutCqAt = message.replace(cqAtPattern, '');
  if (withoutCqAt !== message) {
    return withoutCqAt.trim();
  }

  if (!label) {
    return message.trim();
  }

  const atLabelPattern = new RegExp(`^\\s*@${escapeRegExp(label)}(?:\\s+|$)`, 'i');
  return message.replace(atLabelPattern, '').trim();
}

function buildMentionMetadata(messageType: ProviderMessageType, message: string) {
  if (messageType !== 'group') {
    return {
      wasMentioned: false,
      mentionedUsers: undefined,
      commandBody: message
    };
  }

  const hasCqMention = message.includes(`[CQ:at,qq=${aiConfig.bot_qq_number}`);
  const label = inferMentionLabel(message);
  const wasMentioned = hasCqMention || Boolean(label);
  const commandBody = wasMentioned ? stripLeadingMention(message, label) : message;
  const mentionedUsers: InboundMentionedUser[] | undefined = wasMentioned
    ? [{ userId: String(aiConfig.bot_qq_number), label }]
    : undefined;

  return {
    wasMentioned,
    mentionedUsers,
    commandBody
  };
}

export function buildSimpleQueueSimulationContext(
  messageType: ProviderMessageType,
  payload: SimpleQueueSimulationPayload
): Partial<FinalizedInboundContext> {
  const userId = toNumericId(payload.user_id);
  const groupId = toNumericId(payload.group_id);
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';

  if (!userId || !message) {
    throw new Error('Missing required parameters: user_id, message');
  }

  if (messageType === 'group' && !groupId) {
    throw new Error('Missing required parameter: group_id');
  }

  const accountId = String(aiConfig.bot_qq_number);
  const nativeChannelId = messageType === 'group' ? String(groupId) : String(userId);
  const mentionMetadata = buildMentionMetadata(messageType, message);

  return {
    AccountId: accountId,
    ChatType: messageType === 'group' ? 'group' : 'direct',
    SenderId: String(userId),
    SenderName: `user_${userId}`,
    NativeChannelId: nativeChannelId,
    ConversationLabel: messageType === 'group' ? `group_${groupId}` : `user_${userId}`,
    GroupSubject: messageType === 'group' ? `group_${groupId}` : undefined,
    Body: message,
    BodyForAgent: message,
    RawBody: message,
    CommandBody: mentionMetadata.commandBody,
    BodyForCommands: mentionMetadata.commandBody,
    Timestamp: Date.now(),
    Provider: 'qq',
    Surface: 'simple-queue-simulator',
    OriginatingChannel: 'qq',
    OriginatingTo: messageType === 'group' ? `group:${groupId}` : `user:${userId}`,
    To: messageType === 'group' ? `group:${groupId}` : `user:${userId}`,
    From: `qq:${userId}`,
    WasMentioned: mentionMetadata.wasMentioned,
    MentionedUsers: mentionMetadata.mentionedUsers
  };
}
