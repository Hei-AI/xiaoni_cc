/**
 * 静态工具集合
 * 目前仅提供依赖运行时 WebSocket 客户端的私聊/群聊发送工具。
 */

import { StaticTool, ToolContext, ToolResult } from '../types';
import { logger } from '../utils/logger';
import { resolveAttachmentViewsFromMessage } from '../utils/message-utils';
import { extractNormalizedMessageText, parseReplyIntentContext } from '../utils/reply-intent';

const moduleLogger = logger.createModuleLogger('static-tools');

// ============================================================================
// 📨 Messaging tools
// ============================================================================

export interface MessagingToolDependencies {
  sendPrivateMessage: (userId: number, message: string) => Promise<void>;
  sendGroupMessage: (groupId: number, message: string) => Promise<void>;
  canSendPrivateMessage?: (userId: number) => Promise<boolean>;
  canSendGroupMessage?: (groupId: number) => Promise<boolean>;
  scrollChatViewUp?: (cursor: any, pageSize?: number) => Promise<any>;
  jumpChatViewToLatest?: (cursor: any, pageSize?: number) => Promise<any>;
  fetchReplyContext?: (metadata?: Record<string, any>) => Promise<ReplyContextToolPayload>;
  readMessageAttachment?: (params: {
    metadata?: Record<string, any>;
    messageId: number;
    attachmentId?: number;
    attachmentIndex?: number;
  }) => Promise<MessageAttachmentToolPayload>;
  findMemeByTags: (tags: string[]) => Promise<MemeLibraryEntry | null>;
  saveMemeImage: (imageBase64: string, tags: string[]) => Promise<MemeLibraryEntry>;
  recordMemeUsage?: (memeId: string) => Promise<void>;
  readSelfState?: () => Promise<SelfStateToolPayload>;
  readRelationshipSnapshot?: (metadata?: Record<string, any>) => Promise<RelationshipSnapshotToolPayload>;
  readActivePlans?: (params: {
    metadata?: Record<string, any>;
    limit?: number;
  }) => Promise<ActivePlansToolPayload>;
  readMemoryStream?: (params: {
    metadata?: Record<string, any>;
    stableLimit?: number;
    evidenceLimit?: number;
  }) => Promise<MemoryStreamToolPayload>;
}

export interface MemeLibraryEntry {
  id: string;
  tags: string[];
  image_base64: string;
  usage_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface UserPerspective {
  target_user_id: number;
  based_on: string;
  comment: string;
}

export interface ReplyContextToolPayload {
  status: 'ok' | 'missing_reply_context' | 'anchor_not_found';
  reply_to_message_id?: number;
  message_kind?: string;
  address_target?: {
    type?: string;
    user_id?: number;
    nickname?: string;
  };
  quoted_sender?: {
    user_id?: number;
    nickname?: string;
  };
  quoted_text?: string;
  anchor_already_visible?: boolean;
  transcript?: string;
  reply_anchor_viewport?: any;
  note?: string;
}

export interface MessageAttachmentToolPayload {
  status: 'ok' | 'message_not_found' | 'attachment_not_found' | 'not_available_yet' | 'download_failed';
  message_id: number;
  attachment_id?: number;
  attachment_type?: string;
  label?: string;
  mime_type?: string;
  note?: string;
  media_part?: {
    mimeType: string;
    data: string;
  };
}

export interface SelfStateToolPayload {
  status: 'ok' | 'empty';
  snapshot: {
    id: number;
    identity_summary: string;
    core_traits: string[];
    long_term_goals: string[];
    current_concerns: string[];
    availability: string;
    energy: string;
    updated_at: string;
  } | null;
}

export interface RelationshipSnapshotToolPayload {
  status: 'ok' | 'empty' | 'missing_scope';
  snapshot: {
    id: number;
    target_user_id: number;
    group_id: number | null;
    field_scope: 'private_chat' | 'group_chat';
    relationship_summary: string;
    interaction_style: string;
    boundary_strategy: string;
    boundary_notes: string;
    confidence: number;
    impression_profile: Record<string, any> | null;
    speech_policy: Record<string, any> | null;
    memory_bias: Record<string, any> | null;
    notes_json: Record<string, any> | null;
    last_observed_at: string | null;
    updated_at: string;
  } | null;
}

export interface ActivePlansToolPayload {
  status: 'ok';
  limit: number;
  plans: Array<{
    id: number;
    plan_type: string;
    goal: string;
    trigger_condition: string | null;
    status: string;
    target_user_id: number | null;
    target_group_id: number | null;
    target_field_scope: string | null;
    source_plan_id: number | null;
    plan_metadata_json: Record<string, any> | null;
    scheduled_start_at: string | null;
    updated_at: string;
  }>;
}

export interface MemoryStreamToolPayload {
  status: 'ok' | 'missing_scope';
  stable_limit: number;
  evidence_limit: number;
  retrieved_stable_memories: Array<{
    id: number;
    memory_scope: string;
    memory_type: string;
    title: string;
    content: string;
    confidence: number;
    salience: number;
    user_id: number | null;
    group_id: number | null;
    target_user_id: number | null;
    last_observed_at: string | null;
    updated_at: string;
  }>;
  recent_evidence: Array<{
    id: number;
    source_type: string;
    field_scope: string;
    message_type: string | null;
    user_id: number | null;
    group_id: number | null;
    subject_user_id: number | null;
    content: string;
    occurred_at: string;
  }>;
}

const validateNumericId = (value: unknown, fieldName: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  return value;
};

const validateOptionalNumericId = (value: unknown, fieldName: string): number | undefined => {
  if (value == null) {
    return undefined;
  }
  return validateNumericId(value, fieldName);
};

const validateMessage = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('message must be a non-empty string');
  }
  return value.trim();
};

const validateAtUserIds = (value: unknown): number[] => {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('at_user_ids must be an array of QQ numbers');
  }

  const normalized = value.map((item, index) => {
    try {
      return validateNumericId(item, `at_user_ids[${index}]`);
    } catch (error) {
      throw new Error(`at_user_ids[${index}] must be a valid number`);
    }
  });

  const unique = Array.from(new Set(normalized));
  return unique;
};

const validateTags = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('tags must be a non-empty array of strings');
  }

  const normalized = value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`tags[${index}] must be a string`);
    }

    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new Error(`tags[${index}] cannot be empty`);
    }

    if (trimmed.length < 2 || trimmed.length > 8) {
      throw new Error(`tags[${index}] length must be between 2 and 8 characters`);
    }

    return trimmed;
  });

  return Array.from(new Set(normalized));
};

const validateUserPerspectives = (
  value: unknown,
  options: { required?: boolean } = {}
): UserPerspective[] => {
  if (value == null) {
    if (options.required) {
      throw new Error('user_perspectives is required; provide an empty array if no perspectives apply');
    }
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('user_perspectives must be an array');
  }

  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`user_perspectives[${index}] must be an object`);
    }

    const {
      target_user_id: targetUserId,
      based_on: basedOn,
      comment
    } = item as Record<string, unknown>;

    const normalizedTargetId = validateNumericId(targetUserId, `user_perspectives[${index}].target_user_id`);

    if (typeof basedOn !== 'string' || basedOn.trim().length === 0) {
      throw new Error(`user_perspectives[${index}].based_on must be a non-empty string`);
    }

    if (typeof comment !== 'string' || comment.trim().length === 0) {
      throw new Error(`user_perspectives[${index}].comment must be a non-empty string`);
    }

    return {
      target_user_id: normalizedTargetId,
      based_on: basedOn.trim(),
      comment: comment.trim()
    };
  });
};

const validateBase64 = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('image_base64 must be a non-empty string');
  }

  const sanitized = value.replace(/\s+/g, '');

  // 简单校验 Base64 格式
  if (!/^[A-Za-z0-9+/=]+$/.test(sanitized)) {
    throw new Error('image_base64 contains invalid characters');
  }

  if (sanitized.length < 12) {
    throw new Error('image_base64 is too short to represent valid image data');
  }

  return sanitized;
};

const validateOptionalPositiveInteger = (
  value: unknown,
  fallback: number
): number => {
  if (value == null) {
    return fallback;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error('page_size must be a positive integer');
  }

  return Math.min(20, Math.floor(normalized));
};

const validateOptionalLimit = (
  value: unknown,
  fallback: number,
  max: number,
  fieldName: string
): number => {
  if (value == null) {
    return fallback;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return Math.min(max, Math.floor(normalized));
};

const validateReason = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('reason must be a non-empty string');
  }

  return value.trim();
};

const validateViewportTarget = (value: unknown): 'current' | 'reply_anchor' => {
  if (value == null) {
    return 'current';
  }

  if (value === 'current' || value === 'reply_anchor') {
    return value;
  }

  throw new Error('target must be either "current" or "reply_anchor"');
};

const buildViewportTranscript = (viewport: any): string => {
  const lines: string[] = [];
  const headerLines = Array.isArray(viewport?.header_lines) ? viewport.header_lines : [];
  headerLines.forEach((line: unknown) => {
    if (typeof line === 'string' && line.trim().length > 0) {
      lines.push(line.trim());
    }
  });

  const dividerId = viewport?.divider_before_history_id;
  const messages = Array.isArray(viewport?.visible_messages) ? viewport.visible_messages : [];

  messages.forEach((message: any) => {
    if (dividerId != null && Number(message?.history_id) === Number(dividerId)) {
      lines.push('--- 以下是未读消息 ---');
    }

    lines.push(buildViewportMessageRecord(message));
  });

  return lines.join('\n').trim();
};

const buildViewportMessageRecord = (message: any): string => {
  const rawMessage = message?.raw_payload && typeof message.raw_payload === 'object'
    ? message.raw_payload
    : undefined;
  const rawSender = rawMessage?.sender;
  const senderId = typeof message?.sender_id === 'number' ? message.sender_id : rawSender?.user_id;
  const senderName =
    message?.sender_role === 'bot'
      ? '我'
      : rawSender?.nickname
        || rawSender?.card
        || (senderId != null ? `用户${senderId}` : '未知用户');
  const normalizedText = rawMessage ? extractNormalizedMessageText(rawMessage) : '';
  const attachmentViews = rawMessage ? resolveAttachmentViewsFromMessage(rawMessage) : [];
  const mentions = Array.isArray(rawMessage?.message)
    ? rawMessage.message
        .filter((segment: any) => segment?.type === 'at')
        .map((segment: any) => String(segment?.data?.qq))
        .filter((value: string) => value && value !== 'all' && value !== 'here')
    : [];
  const replyIntent = rawMessage ? (rawMessage.reply_intent_context || parseReplyIntentContext(rawMessage)) : undefined;
  const lines = ['- message:'];
  lines.push(`  time=${message?.sent_at ? new Date(message.sent_at).toISOString() : ''}`);
  if (message?.message_id != null) {
    lines.push(`  message_id=${message.message_id}`);
  }
  if (senderId != null) {
    lines.push(`  sender_id=${senderId}`);
  }
  lines.push(`  sender_name=${senderName}`);
  lines.push(`  mentions=${JSON.stringify(Array.from(new Set(mentions)))}`);
  if (replyIntent?.semantic_anchor?.message_id != null) {
    lines.push(`  reply_ref.message_id=${replyIntent.semantic_anchor.message_id}`);
    if (replyIntent.semantic_anchor.sender_id != null) {
      lines.push(`  reply_ref.sender_id=${replyIntent.semantic_anchor.sender_id}`);
    }
    if (replyIntent.semantic_anchor.sender_nickname) {
      lines.push(`  reply_ref.sender_name=${replyIntent.semantic_anchor.sender_nickname}`);
    }
    if (replyIntent.semantic_anchor.text) {
      lines.push(`  reply_ref.text=${replyIntent.semantic_anchor.text}`);
    }
  }
  lines.push(`  content_type=${resolveTranscriptContentType(normalizedText, attachmentViews)}`);
  if (normalizedText) {
    lines.push(`  text=${normalizedText}`);
  }
  if (attachmentViews.length > 0) {
    lines.push(`  attachments=${JSON.stringify(attachmentViews.map(({ attachment_id, type, label, mime_type }) => ({
      attachment_id,
      type,
      label,
      mime_type
    })))}`);
  }

  return lines.join('\n');
};

const resolveTranscriptContentType = (
  text: string | undefined,
  attachments: Array<{ type: string }>
): string => {
  const hasText = typeof text === 'string' && text.trim().length > 0;
  const hasImage = attachments.some(item => item.type === 'image');
  const hasOnlyFace = attachments.length > 0 && attachments.every(item => item.type === 'face');

  if (hasText && attachments.length > 0) {
    return 'mixed';
  }
  if (hasImage) {
    return 'image';
  }
  if (!hasText && hasOnlyFace) {
    return 'face_only';
  }
  return 'text';
};

const buildMentionPrefix = (atUserIds: number[]): string => {
  if (!Array.isArray(atUserIds) || atUserIds.length === 0) {
    return '';
  }

  return atUserIds.map(userId => `[CQ:at,qq=${userId}]`).join(' ');
};

const createPrivateMessageTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'send_private_chat_message',
  description: '向指定QQ用户发送一条私聊消息。',
  mode: 'fire-and-forget',
  loopBehavior: {
    completion: 'terminal',
    outcomeKind: 'message_sent'
  },
  parameters: {
    type: 'object',
    properties: {
      user_id: {
        type: 'integer',
        description: '接收消息的QQ用户ID。'
      },
      message: {
        type: 'string',
        description: '要发送的消息内容。'
      }
    },
    required: ['user_id', 'message']
  },
  registryMetadata: {
    displayName: 'Send Private Chat Message',
    category: 'messaging',
    tags: ['qq', 'private'],
    sideEffect: true,
    expectResponse: false,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();

    try {
      const { user_id, message } = ctx.arguments || {};
      const normalizedUserId = validateNumericId(user_id, 'user_id');
      const normalizedMessage = validateMessage(message);

      if (typeof deps.canSendPrivateMessage === 'function') {
        const canSend = await deps.canSendPrivateMessage(normalizedUserId);
        if (!canSend) {
          return {
            success: true,
            data: {
              status: 'suppressed',
              reason: 'auto_reply_disabled',
              user_id: normalizedUserId,
              message: normalizedMessage,
              duration_ms: Date.now() - start
            }
          };
        }
      }

      await deps.sendPrivateMessage(normalizedUserId, normalizedMessage);

      return {
        success: true,
        data: {
          status: 'sent',
          user_id: normalizedUserId,
          message: normalizedMessage,
          duration_ms: Date.now() - start
        }
      };
    } catch (error: any) {
      moduleLogger.error('[send_private_chat_message] Error:', {
        error: error?.message || error,
        trace_id: ctx.trace_id,
        arguments: ctx.arguments
      });

      return {
        success: false,
        error: error?.message || 'Failed to send private message',
        duration_ms: Date.now() - start
      };
    }
  }
});

const createGroupMessageTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'send_qq_group_message',
  description: '向当前会话所属的QQ群发送文本消息，可选精准@指定成员。',
  mode: 'fire-and-forget',
  loopBehavior: {
    completion: 'terminal',
    outcomeKind: 'message_sent'
  },
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: '要发送的群聊文本内容。'
      },
      at_user_ids: {
        type: 'array',
        description: '需要被@的QQ号列表；缺省或空数组时不@任何人。',
        items: {
          type: 'integer'
        }
      },
      user_perspectives: {
        type: 'array',
        description: '可选。当消息涉及评价/调侃时，提供依据以满足 persona 约束；普通发送可省略。',
        items: {
          type: 'object',
          properties: {
            target_user_id: { type: 'integer', description: '被评价的用户QQ号。' },
            based_on: { type: 'string', description: '触发该评价的原始输入片段。' },
            comment: { type: 'string', description: '面向目标用户的评价或结论。' }
          },
          required: ['target_user_id', 'based_on', 'comment']
        }
      }
    },
    required: ['message']
  },
  registryMetadata: {
    displayName: 'Send QQ Group Message',
    category: 'messaging',
    tags: ['qq', 'group'],
    sideEffect: true,
    expectResponse: false,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();

    try {
      const {
        message,
        at_user_ids = [],
        user_perspectives
      } = ctx.arguments || {};

      const normalizedGroupId = validateNumericId(ctx.group_id, 'group_id');
      const normalizedMessage = validateMessage(message);
      const mentionUserIds = validateAtUserIds(at_user_ids);
      const normalizedPerspectives = validateUserPerspectives(user_perspectives, { required: false });

      const mentionPrefix = buildMentionPrefix(mentionUserIds);
      const finalPayload = mentionPrefix
        ? `${mentionPrefix} ${normalizedMessage}`.trim()
        : normalizedMessage;

      if (typeof deps.canSendGroupMessage === 'function') {
        const canSend = await deps.canSendGroupMessage(normalizedGroupId);
        if (!canSend) {
          return {
            success: true,
            data: {
              status: 'suppressed',
              reason: 'auto_reply_disabled',
              group_id: normalizedGroupId,
              message: normalizedMessage,
              mention: {
                enabled: mentionUserIds.length > 0,
                user_ids: mentionUserIds
              },
              user_perspectives: normalizedPerspectives,
              duration_ms: Date.now() - start
            }
          };
        }
      }

      await deps.sendGroupMessage(normalizedGroupId, finalPayload);

      return {
        success: true,
        data: {
          status: 'sent',
          group_id: normalizedGroupId,
          message: normalizedMessage,
          mention: {
            enabled: mentionUserIds.length > 0,
            user_ids: mentionUserIds
          },
          user_perspectives: normalizedPerspectives,
          duration_ms: Date.now() - start
        }
      };
    } catch (error: any) {
      moduleLogger.error('[send_qq_group_message] Error:', {
        error: error?.message || error,
        trace_id: ctx.trace_id,
        arguments: ctx.arguments
      });

      return {
        success: false,
        error: error?.message || 'Failed to send group message',
        duration_ms: Date.now() - start
      };
    }
  }
});

const createSendMemeImageTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'send_meme_image',
  description: '按标签检索并发送匹配的表情包，支持必要的@与观点说明。',
  mode: 'fire-and-forget',
  loopBehavior: {
    completion: 'terminal',
    outcomeKind: 'message_sent'
  },
  parameters: {
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        description: '用于检索表情包的语义标签（情绪/场景等，每个尽量2-4字）。',
        items: {
          type: 'string'
        }
      },
      at_user_ids: {
        type: 'array',
        description: '需要被@的成员QQ号列表；缺省表示不@任何人。',
        items: {
          type: 'integer'
        }
      },
      user_perspectives: {
        type: 'array',
        description: '若表情暗含评价/吐槽，请给出依据，保持 persona 约束一致；无观点请显式传空数组。',
        items: {
          type: 'object',
          properties: {
            target_user_id: { type: 'integer', description: '被评价的用户QQ号。' },
            based_on: { type: 'string', description: '触发该评价的原始输入片段。' },
            comment: { type: 'string', description: '对目标用户的评价或结论。' }
          },
          required: ['target_user_id', 'based_on', 'comment']
        }
      }
    },
    required: ['tags', 'user_perspectives']
  },
  registryMetadata: {
    displayName: 'Send Meme Image',
    category: 'messaging',
    tags: ['qq', 'meme', 'image'],
    sideEffect: true,
    expectResponse: false,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();

    try {
      const { tags, at_user_ids = [], user_perspectives } = ctx.arguments || {};

      const normalizedTags = validateTags(tags);
      const mentionUserIds = validateAtUserIds(at_user_ids);
      const normalizedPerspectives = validateUserPerspectives(user_perspectives, { required: true });

      const memeCandidate = await deps.findMemeByTags(normalizedTags);
      if (!memeCandidate) {
        throw new Error('No meme image found for the provided tags');
      }

      const mentionPrefix = buildMentionPrefix(mentionUserIds);
      const imageSegment = `[CQ:image,file=base64://${memeCandidate.image_base64}]`;
      const finalPayload = mentionPrefix
        ? `${mentionPrefix} ${imageSegment}`.trim()
        : imageSegment;

      if (ctx.group_id) {
        const normalizedGroupId = validateNumericId(ctx.group_id, 'group_id');
        if (typeof deps.canSendGroupMessage === 'function') {
          const canSend = await deps.canSendGroupMessage(normalizedGroupId);
          if (!canSend) {
            return {
              success: true,
              data: {
                status: 'suppressed',
                reason: 'auto_reply_disabled',
                group_id: normalizedGroupId,
                meme_id: memeCandidate.id,
                tags: normalizedTags,
                at_user_ids: mentionUserIds,
                user_perspectives: normalizedPerspectives,
                duration_ms: Date.now() - start
              }
            };
          }
        }
        await deps.sendGroupMessage(normalizedGroupId, finalPayload);
      } else if (ctx.user_id) {
        const normalizedUserId = validateNumericId(ctx.user_id, 'user_id');
        if (typeof deps.canSendPrivateMessage === 'function') {
          const canSend = await deps.canSendPrivateMessage(normalizedUserId);
          if (!canSend) {
            return {
              success: true,
              data: {
                status: 'suppressed',
                reason: 'auto_reply_disabled',
                user_id: normalizedUserId,
                meme_id: memeCandidate.id,
                tags: normalizedTags,
                at_user_ids: mentionUserIds,
                user_perspectives: normalizedPerspectives,
                duration_ms: Date.now() - start
              }
            };
          }
        }
        await deps.sendPrivateMessage(normalizedUserId, finalPayload);
      } else {
        throw new Error('send_meme_image requires group or user context');
      }

      if (typeof deps.recordMemeUsage === 'function') {
        await deps.recordMemeUsage(memeCandidate.id).catch(error => {
          moduleLogger.warn('Failed to record meme usage', {
            meme_id: memeCandidate.id,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }

      return {
        success: true,
        data: {
          status: 'sent',
          meme_id: memeCandidate.id,
          tags: normalizedTags,
          at_user_ids: mentionUserIds,
          user_perspectives: normalizedPerspectives,
          duration_ms: Date.now() - start
        }
      };
    } catch (error: any) {
      moduleLogger.error('[send_meme_image] Error:', {
        error: error?.message || error,
        trace_id: ctx.trace_id,
        arguments: ctx.arguments
      });

      return {
        success: false,
        error: error?.message || 'Failed to send meme image',
        duration_ms: Date.now() - start
      };
    }
  }
});

const createSaveMemeImageTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'save_meme_image',
  description: '这表情挺有意思的,保存一下,我以后可能要用到',
  mode: 'fire-and-forget',
  loopBehavior: {
    completion: 'continue',
    outcomeKind: 'side_effect_only'
  },
  parameters: {
    type: 'object',
    properties: {
      image_base64: {
        type: 'string',
        description: '表情图片的 Base64 编码内容；后端需解码保存。'
      },
      tags: {
        type: 'array',
        description: '为表情打上的检索标签（每个尽量2-4字，覆盖情绪/场景）。',
        items: {
          type: 'string'
        }
      }
    },
    required: ['image_base64', 'tags']
  },
  registryMetadata: {
    displayName: 'Save Meme Image',
    category: 'messaging',
    tags: ['qq', 'meme', 'storage'],
    sideEffect: true,
    expectResponse: false,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();

    try {
      const { image_base64, tags } = ctx.arguments || {};

      const normalizedBase64 = validateBase64(image_base64);
      const normalizedTags = validateTags(tags);

      const record = await deps.saveMemeImage(normalizedBase64, normalizedTags);

      return {
        success: true,
        data: {
          status: 'stored',
          meme_id: record.id,
          tags: record.tags,
          duration_ms: Date.now() - start
        }
      };
    } catch (error: any) {
      moduleLogger.error('[save_meme_image] Error:', {
        error: error?.message || error,
        trace_id: ctx.trace_id,
        arguments: ctx.arguments
      });

      return {
        success: false,
        error: error?.message || 'Failed to save meme image',
        duration_ms: Date.now() - start
      };
    }
  }
});

const createEndTool = (): StaticTool => ({
  name: 'end',
  description: '当无需回复或执行任何操作时使用，表示当前会话结束。',
  mode: 'fire-and-forget',
  loopBehavior: {
    completion: 'terminal',
    outcomeKind: 'ended_no_reply'
  },
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: '说明本轮为什么选择不回复，供审计与后续分析使用。'
      }
    },
    required: ['reason']
  },
  registryMetadata: {
    displayName: 'End Conversation',
    category: 'system',
    tags: ['system', 'control'],
    sideEffect: false,
    expectResponse: false,
    timeoutMs: 5000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    try {
      const reason = validateReason(ctx.arguments?.reason);

      return {
        success: true,
        data: {
          status: 'ended',
          reason
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to end conversation'
      };
    }
  }
});

const createReadSelfStateTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'read_self_state',
  description: '读取当前稳定自我状态快照，包括身份摘要、长期目标与当前内部状态。',
  mode: 'returnable',
  loopBehavior: {
    completion: 'continue'
  },
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  registryMetadata: {
    displayName: 'Read Self State',
    category: 'cognition',
    tags: ['cognition', 'self', 'state'],
    sideEffect: false,
    expectResponse: true,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (): Promise<ToolResult> => {
    try {
      if (typeof deps.readSelfState !== 'function') {
        throw new Error('self state reading is not available');
      }

      const payload = await deps.readSelfState();
      return {
        success: true,
        data: payload
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to read self state'
      };
    }
  }
});

const createReadRelationshipSnapshotTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'read_relationship_snapshot',
  description: '读取当前消息作用域下的关系快照，不附带回复建议。',
  mode: 'returnable',
  loopBehavior: {
    completion: 'continue'
  },
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  registryMetadata: {
    displayName: 'Read Relationship Snapshot',
    category: 'cognition',
    tags: ['cognition', 'relationship', 'snapshot'],
    sideEffect: false,
    expectResponse: true,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    try {
      if (typeof deps.readRelationshipSnapshot !== 'function') {
        throw new Error('relationship snapshot reading is not available');
      }

      const payload = await deps.readRelationshipSnapshot(ctx.metadata);
      return {
        success: true,
        data: payload
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to read relationship snapshot'
      };
    }
  }
});

const createReadActivePlansTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'read_active_plans',
  description: '读取当前消息作用域相关的活动计划与排队计划，不附带动作建议。',
  mode: 'returnable',
  loopBehavior: {
    completion: 'continue'
  },
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        description: '返回的计划数量上限，默认 3。'
      }
    },
    required: []
  },
  registryMetadata: {
    displayName: 'Read Active Plans',
    category: 'cognition',
    tags: ['cognition', 'plans'],
    sideEffect: false,
    expectResponse: true,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    try {
      if (typeof deps.readActivePlans !== 'function') {
        throw new Error('active plans reading is not available');
      }

      const limit = validateOptionalLimit(ctx.arguments?.limit, 3, 6, 'limit');
      const payload = await deps.readActivePlans({
        metadata: ctx.metadata,
        limit
      });

      return {
        success: true,
        data: payload
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to read active plans'
      };
    }
  }
});

const createReadMemoryStreamTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'read_memory_stream',
  description: '读取当前消息作用域相关的稳定记忆与近期证据流，不附带动作建议。',
  mode: 'returnable',
  loopBehavior: {
    completion: 'continue'
  },
  parameters: {
    type: 'object',
    properties: {
      stable_limit: {
        type: 'integer',
        description: '返回稳定记忆的上限，默认 6。'
      },
      evidence_limit: {
        type: 'integer',
        description: '返回近期证据的上限，默认 4。'
      }
    },
    required: []
  },
  registryMetadata: {
    displayName: 'Read Memory Stream',
    category: 'cognition',
    tags: ['cognition', 'memory', 'evidence'],
    sideEffect: false,
    expectResponse: true,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    try {
      if (typeof deps.readMemoryStream !== 'function') {
        throw new Error('memory stream reading is not available');
      }

      const stableLimit = validateOptionalLimit(ctx.arguments?.stable_limit, 6, 8, 'stable_limit');
      const evidenceLimit = validateOptionalLimit(ctx.arguments?.evidence_limit, 4, 4, 'evidence_limit');
      const payload = await deps.readMemoryStream({
        metadata: ctx.metadata,
        stableLimit,
        evidenceLimit
      });

      return {
        success: true,
        data: payload
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to read memory stream'
      };
    }
  }
});

const createChatViewScrollUpTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'chat_view_scroll_up',
  description: '向前翻页查看当前聊天窗口或引用锚点窗口中更早的消息。',
  mode: 'returnable',
  loopBehavior: {
    completion: 'continue'
  },
  parameters: {
    type: 'object',
    properties: {
      page_size: {
        type: 'integer',
        description: '本次向前翻页加载的消息条数，默认 8。'
      },
      target: {
        type: 'string',
        description: '要翻页的窗口。current 表示当前聊天窗口，reply_anchor 表示引用锚点窗口。'
      }
    },
    required: []
  },
  registryMetadata: {
    displayName: 'Chat View Scroll Up',
    category: 'chat_view',
    tags: ['qq', 'chat', 'viewport'],
    sideEffect: false,
    expectResponse: true,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();

    try {
      if (typeof deps.scrollChatViewUp !== 'function') {
        throw new Error('chat view scrolling is not available');
      }

      const target = validateViewportTarget(ctx.arguments?.target);
      const cursor = target === 'reply_anchor'
        ? ctx.metadata?.replyAnchorViewport
        : ctx.metadata?.chatViewport;
      if (!cursor) {
        throw new Error(target === 'reply_anchor'
          ? 'missing replyAnchorViewport metadata'
          : 'missing chatViewport metadata');
      }

      const pageSize = validateOptionalPositiveInteger(ctx.arguments?.page_size, 8);
      const viewport = await deps.scrollChatViewUp(cursor, pageSize);

      return {
        success: true,
        data: {
          status: 'ok',
          transcript: buildViewportTranscript(viewport),
          page_size: pageSize,
          target,
          __job_metadata_patch: {
            [target === 'reply_anchor' ? 'replyAnchorViewport' : 'chatViewport']: viewport.cursor
          }
        },
        duration_ms: Date.now() - start
      };
    } catch (error: any) {
      moduleLogger.error('[chat_view_scroll_up] Error:', {
        error: error?.message || error,
        trace_id: ctx.trace_id,
        arguments: ctx.arguments
      });

      return {
        success: false,
        error: error?.message || 'Failed to scroll chat view upward',
        duration_ms: Date.now() - start
      };
    }
  }
});

const createChatViewJumpToLatestTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'chat_view_jump_to_latest',
  description: '跳回当前聊天窗口的最新消息位置，或回到引用锚点窗口的初始视图。',
  mode: 'returnable',
  loopBehavior: {
    completion: 'continue'
  },
  parameters: {
    type: 'object',
    properties: {
      page_size: {
        type: 'integer',
        description: '最新视图显示的消息条数，默认 8。'
      },
      target: {
        type: 'string',
        description: '要重置的窗口。current 表示当前聊天窗口，reply_anchor 表示引用锚点窗口。'
      }
    },
    required: []
  },
  registryMetadata: {
    displayName: 'Chat View Jump To Latest',
    category: 'chat_view',
    tags: ['qq', 'chat', 'viewport'],
    sideEffect: false,
    expectResponse: true,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();

    try {
      if (typeof deps.jumpChatViewToLatest !== 'function') {
        throw new Error('chat view jump is not available');
      }

      const target = validateViewportTarget(ctx.arguments?.target);
      const cursor = target === 'reply_anchor'
        ? ctx.metadata?.replyAnchorViewport
        : ctx.metadata?.chatViewport;
      if (!cursor) {
        throw new Error(target === 'reply_anchor'
          ? 'missing replyAnchorViewport metadata'
          : 'missing chatViewport metadata');
      }

      const pageSize = validateOptionalPositiveInteger(ctx.arguments?.page_size, 8);
      const viewport = await deps.jumpChatViewToLatest(cursor, pageSize);

      return {
        success: true,
        data: {
          status: 'ok',
          transcript: buildViewportTranscript(viewport),
          page_size: pageSize,
          target,
          __job_metadata_patch: {
            [target === 'reply_anchor' ? 'replyAnchorViewport' : 'chatViewport']: viewport.cursor
          }
        },
        duration_ms: Date.now() - start
      };
    } catch (error: any) {
      moduleLogger.error('[chat_view_jump_to_latest] Error:', {
        error: error?.message || error,
        trace_id: ctx.trace_id,
        arguments: ctx.arguments
      });

      return {
        success: false,
        error: error?.message || 'Failed to jump chat view to latest',
        duration_ms: Date.now() - start
      };
    }
  }
});

const createReplyContextFetchTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'reply_context_fetch',
  description: '读取当前消息的引用回复上下文，包括直接回应对象、被引用消息摘要，以及按需返回引用锚点窗口。',
  mode: 'returnable',
  loopBehavior: {
    completion: 'continue'
  },
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  registryMetadata: {
    displayName: 'Reply Context Fetch',
    category: 'chat_view',
    tags: ['qq', 'reply', 'context'],
    sideEffect: false,
    expectResponse: true,
    timeoutMs: 10000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();

    try {
      if (typeof deps.fetchReplyContext !== 'function') {
        throw new Error('reply context fetching is not available');
      }

      const payload = await deps.fetchReplyContext(ctx.metadata);
      const metadataPatch = payload.reply_anchor_viewport
        ? { replyAnchorViewport: payload.reply_anchor_viewport }
        : undefined;

      return {
        success: true,
        data: {
          ...payload,
          __job_metadata_patch: metadataPatch
        },
        duration_ms: Date.now() - start
      };
    } catch (error: any) {
      moduleLogger.error('[reply_context_fetch] Error:', {
        error: error?.message || error,
        trace_id: ctx.trace_id
      });

      return {
        success: false,
        error: error?.message || 'Failed to fetch reply context',
        duration_ms: Date.now() - start
      };
    }
  }
});

const createReadMessageAttachmentTool = (
  deps: MessagingToolDependencies
): StaticTool => ({
  name: 'read_message_attachment',
  description: '点开并读取某条消息上的图片或表情包附件；仅在附件内容影响理解时使用。',
  mode: 'returnable',
  loopBehavior: {
    completion: 'continue'
  },
  parameters: {
    type: 'object',
    properties: {
      message_id: {
        type: 'integer',
        description: '要读取附件的消息 ID。'
      },
      attachment_id: {
        type: 'integer',
        description: '附件在该消息 attachments 列表中的 ID。'
      },
      attachment_index: {
        type: 'integer',
        description: '附件索引。若 attachment_id 缺失，则使用该值作为兼容输入。'
      }
    },
    required: ['message_id']
  },
  registryMetadata: {
    displayName: 'Read Message Attachment',
    category: 'chat_view',
    tags: ['qq', 'attachment', 'image'],
    sideEffect: false,
    expectResponse: true,
    timeoutMs: 15000,
    version: '1.0.0',
    createdBy: 'system',
    updatedBy: 'system'
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    const start = Date.now();

    try {
      if (typeof deps.readMessageAttachment !== 'function') {
        throw new Error('message attachment reading is not available');
      }

      const messageId = validateNumericId(ctx.arguments?.message_id, 'message_id');
      const attachmentId = validateOptionalNumericId(ctx.arguments?.attachment_id, 'attachment_id');
      const attachmentIndex = validateOptionalNumericId(ctx.arguments?.attachment_index, 'attachment_index');
      if (attachmentId == null && attachmentIndex == null) {
        throw new Error('attachment_id or attachment_index is required');
      }

      const payload = await deps.readMessageAttachment({
        metadata: ctx.metadata,
        messageId,
        attachmentId,
        attachmentIndex
      });

      const data: Record<string, any> = {
        status: payload.status,
        message_id: payload.message_id,
        attachment_id: payload.attachment_id,
        attachment_type: payload.attachment_type,
        label: payload.label,
        mime_type: payload.mime_type,
        note: payload.note
      };

      if (payload.media_part) {
        data.media_loaded = true;
        data.__tool_followup_contents = [
          {
            role: 'user',
            parts: [
              {
                text: `Attachment content loaded for message_id=${payload.message_id}, attachment_id=${payload.attachment_id}.`
              },
              {
                inlineData: payload.media_part
              }
            ]
          }
        ];
      } else {
        data.media_loaded = false;
      }

      return {
        success: true,
        data,
        duration_ms: Date.now() - start
      };
    } catch (error: any) {
      moduleLogger.error('[read_message_attachment] Error:', {
        error: error?.message || error,
        trace_id: ctx.trace_id,
        arguments: ctx.arguments
      });

      return {
        success: false,
        error: error?.message || 'Failed to read message attachment',
        duration_ms: Date.now() - start
      };
    }
  }
});

export const createMessagingTools = (
  deps: MessagingToolDependencies
): StaticTool[] => {
  const tools: StaticTool[] = [
    createPrivateMessageTool(deps),
    createGroupMessageTool(deps),
    createSendMemeImageTool(deps),
    createSaveMemeImageTool(deps)
  ];

  if (typeof deps.scrollChatViewUp === 'function') {
    tools.push(createChatViewScrollUpTool(deps));
  }

  if (typeof deps.jumpChatViewToLatest === 'function') {
    tools.push(createChatViewJumpToLatestTool(deps));
  }

  if (typeof deps.fetchReplyContext === 'function') {
    tools.push(createReplyContextFetchTool(deps));
  }

  if (typeof deps.readMessageAttachment === 'function') {
    tools.push(createReadMessageAttachmentTool(deps));
  }

  if (typeof deps.readSelfState === 'function') {
    tools.push(createReadSelfStateTool(deps));
  }

  if (typeof deps.readRelationshipSnapshot === 'function') {
    tools.push(createReadRelationshipSnapshotTool(deps));
  }

  if (typeof deps.readActivePlans === 'function') {
    tools.push(createReadActivePlansTool(deps));
  }

  if (typeof deps.readMemoryStream === 'function') {
    tools.push(createReadMemoryStreamTool(deps));
  }

  tools.push(createEndTool());
  return tools;
};
