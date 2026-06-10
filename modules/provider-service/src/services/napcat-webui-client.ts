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
  qrcodeurl?: string;
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

  return {
    isLogin: Boolean(data.isLogin),
    qrPayload,
    message
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
    const credential = await this.ensureCredential();
    const response = await this.httpClient.get<NapcatWebuiResponse<LoginStatusData>>('/QQLogin/CheckLoginStatus', {
      headers: {
        Authorization: `Bearer ${credential}`
      }
    });
    const data = ensureSuccessfulPayload(response.data, 'NapCat login status unavailable');
    return normalizeLoginStatus(data, response.data.message || null);
  }

  async requestLoginQrcode(): Promise<NapcatWebuiLoginStatus> {
    const credential = await this.ensureCredential();
    const response = await this.httpClient.post<NapcatWebuiResponse<LoginQrcodeData>>('/QQLogin/GetQQLoginQrcode', {}, {
      headers: {
        Authorization: `Bearer ${credential}`
      }
    });

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

  private async ensureCredential() {
    if (!this.token) {
      throw new Error('NapCat WebUI token is not configured');
    }

    if (this.credential && this.credentialExpiresAtMs > Date.now()) {
      return this.credential;
    }

    const response = await this.httpClient.post<NapcatWebuiResponse<AuthLoginData>>('/auth/login', {
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
