import axios, { AxiosInstance } from 'axios';
import { napcatConfig } from '../config';
import { logger } from '../utils/logger';

type NapcatActionResponse<T> = {
  status?: string;
  retcode?: number;
  data?: T;
  message?: string;
  wording?: string;
};

export type ForwardMessageSegment = {
  type?: string;
  data?: Record<string, unknown>;
};

export type ForwardMessageItem = {
  sender?: { nickname?: string; user_id?: number | string };
  time?: number;
  content?: ForwardMessageSegment[];
  message?: ForwardMessageSegment[];
};

function normalizeMentionUserId(value: string | number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid mention user id: ${value}`);
  }
  return String(Math.trunc(numeric));
}

export function buildGroupMessageText(message: string, mentionUserIds: Array<string | number> = []) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new Error('Group message text cannot be empty');
  }

  const normalizedMentionIds = Array.from(new Set(
    mentionUserIds.map((value) => normalizeMentionUserId(value))
  ));

  if (normalizedMentionIds.length === 0) {
    return trimmedMessage;
  }

  const mentionPrefix = normalizedMentionIds
    .map((userId) => `[CQ:at,qq=${userId}]`)
    .join(' ');

  return `${mentionPrefix} ${trimmedMessage}`;
}

export function normalizeImageFileReference(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Group image file cannot be empty');
  }

  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (dataUrlMatch) {
    return `base64://${dataUrlMatch[2]}`;
  }

  return trimmed;
}

export class NapcatClient {
  private readonly moduleLogger = logger.createModuleLogger('napcat-client');
  private readonly httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: napcatConfig.baseUrl,
      timeout: napcatConfig.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(napcatConfig.accessToken
          ? { Authorization: `Bearer ${napcatConfig.accessToken}` }
          : {})
      }
    });
  }

  getAccessToken() {
    return napcatConfig.accessToken;
  }

  async probe(): Promise<{ reachable: boolean; selfId?: number | null; error?: string }> {
    try {
      const response = await this.callAction<{ user_id?: number }>('get_login_info', {});
      return {
        reachable: true,
        selfId: response?.user_id ?? null
      };
    } catch (error) {
      return {
        reachable: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async sendPrivateMessage(userId: number, message: string): Promise<any> {
    return this.callAction('send_private_msg', {
      user_id: userId,
      message
    });
  }

  async sendGroupMessage(groupId: number, message: string, mentionUserIds: Array<string | number> = []): Promise<any> {
    return this.callAction('send_group_msg', {
      group_id: groupId,
      message: buildGroupMessageText(message, mentionUserIds)
    });
  }

  async sendGroupImage(groupId: number, imageFile: string, caption?: string): Promise<any> {
    const message: Array<Record<string, unknown>> = [
      {
        type: 'image',
        data: {
          file: normalizeImageFileReference(imageFile)
        }
      }
    ];
    if (typeof caption === 'string' && caption.trim()) {
      message.push({
        type: 'text',
        data: {
          text: caption.trim()
        }
      });
    }
    return this.callAction('send_group_msg', {
      group_id: groupId,
      message
    });
  }

  async getFile(fileId: string): Promise<any> {
    return this.callAction('get_file', {
      file_id: fileId
    });
  }

  async getForwardMessage(id: string): Promise<ForwardMessageItem[]> {
    const result = await this.callAction<{ messages?: ForwardMessageItem[] }>('get_forward_msg', { id });
    return result?.messages ?? [];
  }

  private async callAction<T>(action: string, params: Record<string, unknown>): Promise<T> {
    const response = await this.httpClient.post<NapcatActionResponse<T>>(`/${action}`, params);
    const payload = response.data;

    if (payload?.status === 'failed' || (typeof payload?.retcode === 'number' && payload.retcode !== 0)) {
      const message = payload?.wording || payload?.message || `NapCat action failed: ${action}`;
      this.moduleLogger.error('NapCat action failed', { action, params, message, retcode: payload?.retcode });
      throw new Error(message);
    }

    return payload?.data as T;
  }
}
