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

  async sendGroupMessage(groupId: number, message: string): Promise<any> {
    return this.callAction('send_group_msg', {
      group_id: groupId,
      message
    });
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
