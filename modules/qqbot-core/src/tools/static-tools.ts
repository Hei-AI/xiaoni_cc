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
  sendAtMessage: (groupId: number, userId: number, message: string) => Promise<void>;
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
  name: 'send_group_chat_message',
  description: '向指定QQ群发送消息，可选@指定成员。',
  mode: 'fire-and-forget',
  parameters: {
    type: 'object',
    properties: {
      group_id: {
        type: 'integer',
        description: '目标QQ群ID。'
      },
      message: {
        type: 'string',
        description: '要发送的消息内容。'
      },
      should_at: {
        type: 'boolean',
        description: '是否需要@某个群成员。',
        default: false
      },
      at_user_id: {
        type: 'integer',
        description: '当should_at为true时，需要@的QQ号。'
      }
    },
    required: ['group_id', 'message']
  },
  registryMetadata: {
    displayName: 'Send Group Chat Message',
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
        group_id,
        message,
        should_at = false,
        at_user_id = null
      } = ctx.arguments || {};

      const normalizedGroupId = validateNumericId(group_id, 'group_id');
      const normalizedMessage = validateMessage(message);
      const normalizedShouldAt = Boolean(should_at);

      if (normalizedShouldAt) {
        const normalizedAtUserId = validateNumericId(at_user_id, 'at_user_id');
        await deps.sendAtMessage(normalizedGroupId, normalizedAtUserId, normalizedMessage);

        return {
          success: true,
          data: {
            status: 'sent',
            group_id: normalizedGroupId,
            message: normalizedMessage,
            mention: {
              enabled: true,
              user_id: normalizedAtUserId
            },
            duration_ms: Date.now() - start
          }
        };
      }

      await deps.sendGroupMessage(normalizedGroupId, normalizedMessage);

      return {
        success: true,
        data: {
          status: 'sent',
          group_id: normalizedGroupId,
          message: normalizedMessage,
          mention: {
            enabled: false
          },
          duration_ms: Date.now() - start
        }
      };
    } catch (error: any) {
      moduleLogger.error('[send_group_chat_message] Error:', {
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

const createEndTool = (): StaticTool => ({
  name: 'end',
  description: '当无需回复或执行任何操作时使用，表示当前会话结束。',
  mode: 'fire-and-forget',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false
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
  handler: async (_ctx: ToolContext): Promise<ToolResult> => ({
    success: true
  })
});

export const createMessagingTools = (
  deps: MessagingToolDependencies
): StaticTool[] => [
  createPrivateMessageTool(deps),
  createGroupMessageTool(deps),
  createEndTool()
];
