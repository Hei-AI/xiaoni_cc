/**
 * 静态工具集合
 * 目前仅提供依赖运行时 WebSocket 客户端的私聊/群聊发送工具。
 */

import { StaticTool, ToolContext, ToolResult } from '../types';
import { logger } from '../utils/logger';

const moduleLogger = logger.createModuleLogger('static-tools');

// ============================================================================
// 📨 Messaging tools
// ============================================================================

export interface MessagingToolDependencies {
  sendPrivateMessage: (userId: number, message: string) => Promise<void>;
  sendGroupMessage: (groupId: number, message: string) => Promise<void>;
  findMemeByTags: (tags: string[]) => Promise<MemeLibraryEntry | null>;
  saveMemeImage: (imageBase64: string, tags: string[]) => Promise<MemeLibraryEntry>;
  recordMemeUsage?: (memeId: string) => Promise<void>;
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

const validateNumericId = (value: unknown, fieldName: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  return value;
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

const validateUserPerspectives = (value: unknown): UserPerspective[] => {
  if (value == null) {
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
        description: '当消息涉及评价/调侃时，提供依据以满足 persona 约束。',
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
        user_perspectives = []
      } = ctx.arguments || {};

      const normalizedGroupId = validateNumericId(ctx.group_id, 'group_id');
      const normalizedMessage = validateMessage(message);
      const mentionUserIds = validateAtUserIds(at_user_ids);
      const normalizedPerspectives = validateUserPerspectives(user_perspectives);

      const mentionPrefix = buildMentionPrefix(mentionUserIds);
      const finalPayload = mentionPrefix
        ? `${mentionPrefix} ${normalizedMessage}`.trim()
        : normalizedMessage;

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
        description: '若表情暗含评价/吐槽，请给出依据，保持 persona 约束一致。',
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
    required: ['tags']
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
      const { tags, at_user_ids = [], user_perspectives = [] } = ctx.arguments || {};

      const normalizedTags = validateTags(tags);
      const mentionUserIds = validateAtUserIds(at_user_ids);
      const normalizedPerspectives = validateUserPerspectives(user_perspectives);

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
        await deps.sendGroupMessage(normalizedGroupId, finalPayload);
      } else if (ctx.user_id) {
        const normalizedUserId = validateNumericId(ctx.user_id, 'user_id');
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
  description: '将新的表情图片入库以便后续按标签检索使用。',
  mode: 'fire-and-forget',
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
  handler: async (): Promise<ToolResult> => ({
    success: true
  })
});

export const createMessagingTools = (
  deps: MessagingToolDependencies
): StaticTool[] => [
  createPrivateMessageTool(deps),
  createGroupMessageTool(deps),
  createSendMemeImageTool(deps),
  createSaveMemeImageTool(deps),
  createEndTool()
];
