import os from 'os';
import path from 'path';
import { fetch } from 'undici';
import { AIConfig } from '../../types';
import {
  isOAuthCredentialExpired,
  loadOAuthCredential,
  persistOAuthCredential,
  type NormalizedOAuthCredential,
  type OAuthCredentialSource
} from './oauth-credentials';

export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
export const CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth';

function resolveCodexCliAuthPath(): string {
  const codexHome = process.env.CODEX_HOME && process.env.CODEX_HOME.trim().length > 0
    ? process.env.CODEX_HOME.trim()
    : path.join(os.homedir(), '.codex');
  const resolvedHome = codexHome === '~'
    ? os.homedir()
    : codexHome.startsWith('~/')
      ? path.join(os.homedir(), codexHome.slice(2))
      : codexHome;
  return path.join(resolvedHome, 'auth.json');
}

export async function resolveCodexOAuthCredential(
  aiConfig: AIConfig,
  forceRefresh = false
): Promise<{
  credential: NormalizedOAuthCredential | null;
  source?: OAuthCredentialSource;
}> {
  const resolved = await loadOAuthCredential({
    envAccessToken: aiConfig.codex_access_token || process.env.CODEX_OAUTH_ACCESS_TOKEN,
    envRefreshToken: aiConfig.codex_refresh_token || process.env.CODEX_OAUTH_REFRESH_TOKEN,
    envExpiresAt: aiConfig.codex_expires_at || process.env.CODEX_OAUTH_EXPIRES_AT,
    envAccountId: aiConfig.codex_account_id || process.env.CODEX_ACCOUNT_ID,
    explicitPath: aiConfig.codex_oauth_path || process.env.CODEX_OAUTH_PATH,
    fallbackPaths: [
      resolveCodexCliAuthPath(),
      path.join(os.homedir(), '.openclaw', 'credentials', 'oauth.json')
    ],
    providerKey: 'openai-codex'
  });

  const credential = resolved.credential;
  if (!credential) {
    return resolved;
  }

  const needsRefresh = forceRefresh || !credential.access || isOAuthCredentialExpired(credential);
  if (needsRefresh && credential.refresh) {
    return {
      credential: await refreshCodexOAuthCredential(credential, resolved.source),
      source: resolved.source
    };
  }

  if (!credential.accountId && credential.access) {
    credential.accountId = extractCodexAccountId(credential.access) || undefined;
  }

  return resolved;
}

export async function refreshCodexOAuthCredential(
  credential: NormalizedOAuthCredential,
  source?: OAuthCredentialSource
): Promise<NormalizedOAuthCredential> {
  if (!credential.refresh) {
    throw new Error('Codex OAuth refresh token is missing.');
  }

  const response = await (globalThis.fetch || fetch)(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refresh,
      client_id: CODEX_CLIENT_ID
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Codex OAuth token refresh failed: ${errorText}`);
  }

  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token || typeof payload.expires_in !== 'number') {
    throw new Error('Codex OAuth token refresh returned an invalid payload.');
  }

  const refreshed: NormalizedOAuthCredential = {
    access: payload.access_token,
    refresh: payload.refresh_token || credential.refresh,
    expires: Date.now() + (payload.expires_in * 1000),
    accountId: extractCodexAccountId(payload.access_token) || credential.accountId,
    email: credential.email,
    idToken: credential.idToken
  };

  await persistOAuthCredential(source, refreshed);
  return refreshed;
}

export async function exchangeCodexAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<NormalizedOAuthCredential> {
  const response = await (globalThis.fetch || fetch)(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: CODEX_CLIENT_ID,
      code_verifier: params.codeVerifier
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Codex OAuth code exchange failed: ${errorText}`);
  }

  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };

  if (!payload.access_token || !payload.refresh_token || typeof payload.expires_in !== 'number') {
    throw new Error('Codex OAuth code exchange returned an invalid payload.');
  }

  return {
    access: payload.access_token,
    refresh: payload.refresh_token,
    expires: Date.now() + (payload.expires_in * 1000),
    accountId: extractCodexAccountId(payload.access_token) || undefined,
    email: extractEmailFromJwt(payload.id_token || payload.access_token) || undefined,
    idToken: payload.id_token
  };
}

export function extractCodexAccountId(accessToken: string): string | null {
  try {
    const payload = decodeJwtPayload(accessToken);
    const auth = payload?.[CODEX_JWT_CLAIM_PATH];
    const accountId = auth?.chatgpt_account_id;
    return typeof accountId === 'string' && accountId.trim().length > 0 ? accountId : null;
  } catch {
    return null;
  }
}

export function buildCodexUserAgent(): string {
  return `openclaw (${os.platform()} ${os.release()}; ${os.arch()})`;
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }

  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const decoded = Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');

  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function extractEmailFromJwt(token: string): string | null {
  try {
    const payload = decodeJwtPayload(token);
    const email = payload?.email;
    return typeof email === 'string' && email.trim().length > 0 ? email.trim() : null;
  } catch {
    return null;
  }
}
