import { getPrismaClient } from '@qq-bot/persistence';
import { databaseConfig } from '../config';
import { logger } from '../utils/logger';

type MessageType = 'private' | 'group';
export type GroupNotificationMode = 'all' | 'mentions_only';

type ChatPolicyRecord = {
  is_enabled: number | bigint | null;
  notification_mode?: string | null;
};

export type PolicyState = {
  exists: boolean;
  isEnabled: boolean;
  continuousLearningEnabled: boolean;
  autoReplyEnabled: boolean;
  notificationMode: GroupNotificationMode;
};

type IncomingPolicyResult = PolicyState & {
  allowed: boolean;
  reason: 'accepted' | 'receive_disabled';
};

type AutoReplyPolicyResult = PolicyState & {
  allowed: boolean;
  reason: 'accepted' | 'auto_reply_disabled';
};

type ContinuousLearningPolicyResult = PolicyState & {
  allowed: boolean;
  reason: 'accepted' | 'continuous_learning_disabled';
};

export class ChatPolicyService {
  private readonly moduleLogger = logger.createModuleLogger('chat-policy-service');
  private readonly prisma;

  constructor() {
    this.prisma = getPrismaClient({
      databaseUrl: databaseConfig.url,
      host: databaseConfig.host,
      port: databaseConfig.port,
      user: databaseConfig.user,
      password: databaseConfig.password,
      database: databaseConfig.database
    });
  }

  async checkIncomingPolicy(params: { messageType: MessageType; userId: number; groupId?: number }): Promise<IncomingPolicyResult> {
    const state = await this.resolvePolicyState(params);
    return {
      ...state,
      allowed: state.isEnabled,
      reason: state.isEnabled ? 'accepted' : 'receive_disabled'
    };
  }

  async checkAutoReplyPolicy(params: { messageType: MessageType; userId: number; groupId?: number }): Promise<AutoReplyPolicyResult> {
    const state = await this.resolvePolicyState(params);
    return {
      ...state,
      allowed: state.autoReplyEnabled,
      reason: state.autoReplyEnabled ? 'accepted' : 'auto_reply_disabled'
    };
  }

  async checkContinuousLearningPolicy(params: { messageType: MessageType; userId: number; groupId?: number }): Promise<ContinuousLearningPolicyResult> {
    const state = await this.resolvePolicyState(params);
    return {
      ...state,
      allowed: state.continuousLearningEnabled,
      reason: state.continuousLearningEnabled ? 'accepted' : 'continuous_learning_disabled'
    };
  }

  async getPolicyState(params: { messageType: MessageType; userId: number; groupId?: number }): Promise<PolicyState> {
    return this.resolvePolicyState(params);
  }

  async markIncomingActivity(params: { messageType: MessageType; userId: number; groupId?: number }): Promise<void> {
    try {
      if (params.messageType === 'group' && params.groupId) {
        await this.prisma.$executeRawUnsafe(
          "ALTER TABLE group_chat_settings ADD COLUMN IF NOT EXISTS notification_mode TEXT NOT NULL DEFAULT 'all'"
        );
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO group_chat_settings (group_id, is_enabled, continuous_learning_enabled, auto_reply_enabled, notification_mode, last_activity)
           VALUES ($1, 1, 0, 1, 'all', NOW())
           ON CONFLICT (group_id) DO UPDATE
             SET last_activity = NOW()`,
          BigInt(params.groupId)
        );
        return;
      }

      await this.prisma.privateChatSetting.upsert({
        where: { user_id: BigInt(params.userId) },
        create: {
          user_id: BigInt(params.userId),
          is_enabled: 1,
          continuous_learning_enabled: 0,
          auto_reply_enabled: 1,
          last_activity: new Date()
        },
        update: {
          last_activity: new Date()
        }
      });
    } catch (error) {
      this.moduleLogger.warn('Failed to mark chat activity', {
        error: error instanceof Error ? error.message : String(error),
        ...params
      });
    }
  }

  private async resolvePolicyState(params: { messageType: MessageType; userId: number; groupId?: number }): Promise<PolicyState> {
    const row = params.messageType === 'group'
      ? await this.getGroupRecord(params.groupId)
      : await this.getPrivateRecord(params.userId);

    if (!row) {
      return {
        exists: false,
        isEnabled: true,
        continuousLearningEnabled: false,
        autoReplyEnabled: true,
        notificationMode: 'all'
      };
    }

    const isEnabled = Boolean(row.is_enabled);

    return {
      exists: true,
      isEnabled,
      continuousLearningEnabled: false,
      autoReplyEnabled: isEnabled,
      notificationMode: normalizeGroupNotificationMode(row.notification_mode)
    };
  }

  private async getGroupRecord(groupId?: number): Promise<ChatPolicyRecord | null> {
    if (!groupId || !Number.isFinite(groupId)) {
      return null;
    }

    try {
      const rows = await this.prisma.$queryRawUnsafe(
        'SELECT is_enabled, notification_mode FROM group_chat_settings WHERE group_id = $1 LIMIT 1',
        BigInt(groupId)
      );
      return Array.isArray(rows) ? rows[0] || null : null;
    } catch (error) {
      const row = await this.prisma.groupChatSetting.findUnique({
        where: { group_id: BigInt(groupId) },
        select: {
          is_enabled: true
        }
      });
      this.moduleLogger.warn('Fell back to legacy group policy read without notification_mode', {
        groupId,
        error: error instanceof Error ? error.message : String(error)
      });
      return row || null;
    }
  }

  private async getPrivateRecord(userId: number): Promise<ChatPolicyRecord | null> {
    const row = await this.prisma.privateChatSetting.findUnique({
      where: { user_id: BigInt(userId) },
      select: {
        is_enabled: true
      }
    });

    return row || null;
  }
}

function normalizeGroupNotificationMode(value: unknown): GroupNotificationMode {
  return value === 'mentions_only' ? 'mentions_only' : 'all';
}

export default ChatPolicyService;
