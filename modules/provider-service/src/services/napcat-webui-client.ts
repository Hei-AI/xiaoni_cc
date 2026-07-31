import axios, { AxiosInstance } from 'axios';
import { createHash } from 'crypto';
import { napcatConfig } from '../config';

type NapcatWebuiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type AuthLoginData = {
  Credential?: string;
};

type LoginStatusData = {
  isLogin?: boolean;
  isOffline?: boolean;
  qrcodeurl?: string;
  loginError?: string;
};

type LoginQrcodeData = {
  qrcode?: string;
};

type NapcatWebuiHttpClient = Pick<AxiosInstance, 'get' | 'post'>;

export type NapcatWebuiLoginStatus = {
  isLogin: boolean;
  qrPayload: string | null;
  message: string | null;
};

type NapcatWebuiClientOptions = {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  httpClient?: NapcatWebuiHttpClient;
};

const WEBUI_CREDENTIAL_TTL_MS = 55 * 60 * 1000;

export function generateNapcatWebuiPasswordHash(token: string) {
  return createHash('sha256')
    .update(`${token}.napcat`)
    .digest('hex');
}

export function formatNapcatWebuiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data;
    if (payload && typeof payload === 'object') {
      const message = (payload as { message?: unknown; error?: unknown }).message
        || (payload as { message?: unknown; error?: unknown }).error;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }

    if (error.code) {
      return `NapCat WebUI request failed: ${error.code}`;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

// NapCat 对失效 credential 回的是 HTTP 200 + {code:-1, message:"Unauthorized"}，
// 不是 401，所以只能按 payload 判。
function isUnauthorizedPayload(payload: NapcatWebuiResponse<unknown> | undefined) {
  if (!payload || typeof payload.message !== 'string') {
    return false;
  }

  return /unauthorized/i.test(payload.message);
}

function ensureSuccessfulPayload<T>(payload: NapcatWebuiResponse<T>, fallbackMessage: string) {
  if (typeof payload?.code === 'number' && payload.code !== 0 && payload.code !== 200) {
    throw new Error(payload.message || fallbackMessage);
  }

  if (!payload?.data) {
    throw new Error(payload?.message || fallbackMessage);
  }

  return payload.data;
}

function normalizeLoginStatus(data: LoginStatusData, message: string | null = null): NapcatWebuiLoginStatus {
  const qrPayload = typeof data.qrcodeurl === 'string' && data.qrcodeurl.trim()
    ? data.qrcodeurl.trim()
    : null;

  // NapCat 把掉线原因放在 data.loginError（例如 KickedOffLine 的「登录已失效」），
  // 而顶层 message 恒为 "success"。诊断信息优先取 loginError，否则运维面看不到踢下线原因。
  const loginError = typeof data.loginError === 'string' && data.loginError.trim()
    ? data.loginError.trim()
    : null;

  return {
    isLogin: Boolean(data.isLogin),
    qrPayload,
    message: loginError || message
  };
}

function normalizeQrcodeResult(data: LoginQrcodeData, message: string | null = null): NapcatWebuiLoginStatus {
  const qrPayload = typeof data.qrcode === 'string' && data.qrcode.trim()
    ? data.qrcode.trim()
    : null;

  return {
    isLogin: false,
    qrPayload,
    message
  };
}

export class NapcatWebuiClient {
  private readonly token: string;
  private readonly httpClient: NapcatWebuiHttpClient;
  private credential: string | null = null;
  private credentialExpiresAtMs = 0;

  constructor(options: NapcatWebuiClientOptions = {}) {
    this.token = options.token ?? napcatConfig.webUiToken;
    this.httpClient = options.httpClient ?? axios.create({
      baseURL: options.baseUrl ?? napcatConfig.webUiBaseUrl,
      timeout: options.timeoutMs ?? napcatConfig.webUiTimeoutMs,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  isConfigured() {
    return Boolean(this.token);
  }

  async checkLoginStatus(): Promise<NapcatWebuiLoginStatus> {
    const response = await this.postAuthorized<LoginStatusData>('/api/QQLogin/CheckLoginStatus');
    const data = ensureSuccessfulPayload(response.data, 'NapCat login status unavailable');
    return normalizeLoginStatus(data, response.data.message || null);
  }

  async requestLoginQrcode(): Promise<NapcatWebuiLoginStatus> {
    const response = await this.postAuthorized<LoginQrcodeData>('/api/QQLogin/GetQQLoginQrcode');

    try {
      const data = ensureSuccessfulPayload(response.data, 'NapCat login QR unavailable');
      return normalizeQrcodeResult(data, response.data.message || null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/logined/i.test(message)) {
        return {
          isLogin: true,
          qrPayload: null,
          message
        };
      }
      throw error;
    }
  }

  // NapCat 重启会作废已签发的 credential，但本地缓存还有最多 55 分钟才过期。
  // 命中 Unauthorized 时清缓存重认证一次，否则管理端在 NapCat 重启后整整一小时
  // 都拿不到登录状态 —— 而 NapCat 重启恰恰是最需要扫码的时刻。
  private async postAuthorized<T>(url: string) {
    const response = await this.httpClient.post<NapcatWebuiResponse<T>>(url, {}, {
      headers: {
        Authorization: `Bearer ${await this.ensureCredential()}`
      }
    });

    if (!isUnauthorizedPayload(response.data)) {
      return response;
    }

    this.credential = null;
    this.credentialExpiresAtMs = 0;
    return this.httpClient.post<NapcatWebuiResponse<T>>(url, {}, {
      headers: {
        Authorization: `Bearer ${await this.ensureCredential()}`
      }
    });
  }

  private async ensureCredential() {
    if (!this.token) {
      throw new Error('NapCat WebUI token is not configured');
    }

    if (this.credential && this.credentialExpiresAtMs > Date.now()) {
      return this.credential;
    }

    const response = await this.httpClient.post<NapcatWebuiResponse<AuthLoginData>>('/api/auth/login', {
      hash: generateNapcatWebuiPasswordHash(this.token)
    });
    const data = ensureSuccessfulPayload(response.data, 'NapCat WebUI authentication failed');
    if (!data.Credential) {
      throw new Error('NapCat WebUI authentication returned no credential');
    }

    this.credential = data.Credential;
    this.credentialExpiresAtMs = Date.now() + WEBUI_CREDENTIAL_TTL_MS;
    return this.credential;
  }
}
