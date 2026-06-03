import fs from 'fs/promises';
import path from 'path';

const CODEX_AUTH_FALLBACK_EXPIRY_MS = 60 * 60 * 1000;

export type OAuthCredentialSource =
  | {
      path: string;
      format: 'provider-map';
      providerKey: string;
    }
  | {
      path: string;
      format: 'codex-auth';
    }
  | {
      path: string;
      format: 'direct-record';
    }
  | {
      path: string;
      format: 'gemini-cli-native';
    };

export interface NormalizedOAuthCredential {
  access?: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
  projectId?: string;
  email?: string;
  idToken?: string;
}

type LoadOAuthCredentialOptions = {
  envAccessToken?: string;
  envRefreshToken?: string;
  envExpiresAt?: string | number;
  envAccountId?: string;
  envProjectId?: string;
  envEmail?: string;
  explicitPath?: string;
  fallbackPaths?: string[];
  providerKey?: string;
};

export async function loadOAuthCredential(
  options: LoadOAuthCredentialOptions
): Promise<{
  credential: NormalizedOAuthCredential | null;
  source?: OAuthCredentialSource;
}> {
  const fromEnv = normalizeCredentialRecord({
    access: options.envAccessToken,
    refresh: options.envRefreshToken,
    expires: options.envExpiresAt,
    accountId: options.envAccountId,
    projectId: options.envProjectId,
    email: options.envEmail
  });

  if (fromEnv.access || fromEnv.refresh) {
    return { credential: fromEnv };
  }

  const candidates = [
    options.explicitPath,
    ...(options.fallbackPaths || [])
  ].filter((value, index, array): value is string => {
    return typeof value === 'string' && value.trim().length > 0 && array.indexOf(value) === index;
  });

  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(await fs.readFile(candidate, 'utf8'));

      if (options.providerKey && raw?.[options.providerKey] && typeof raw[options.providerKey] === 'object') {
        const credential = normalizeCredentialRecord(raw[options.providerKey]);
        if (credential.access || credential.refresh) {
          return {
            credential,
            source: {
              path: candidate,
              format: 'provider-map',
              providerKey: options.providerKey
            }
          };
        }
      }

      if (raw?.tokens && typeof raw.tokens === 'object') {
        const credential = normalizeCredentialRecord(raw.tokens);
        if (!credential.expires && credential.access) {
          credential.expires = decodeJwtExpiryMs(credential.access)
            || await resolveCodexAuthFallbackExpiryMs(candidate);
        }
        if (credential.access || credential.refresh) {
          return {
            credential,
            source: {
              path: candidate,
              format: 'codex-auth'
            }
          };
        }
      }

      const directCredential = normalizeCredentialRecord(raw);
      if (directCredential.access || directCredential.refresh) {
        return {
          credential: directCredential,
          source: {
            path: candidate,
            format: isGeminiCliNativeCredentialRecord(candidate, raw) ? 'gemini-cli-native' : 'direct-record'
          }
        };
      }
    } catch {
      // ignore unreadable candidates
    }
  }

  return { credential: null };
}

export function isOAuthCredentialExpired(
  credential: Pick<NormalizedOAuthCredential, 'expires'> | null | undefined,
  skewMs = 60_000
): boolean {
  if (!credential?.expires || !Number.isFinite(credential.expires)) {
    return false;
  }

  return credential.expires <= (Date.now() + skewMs);
}

export async function persistOAuthCredential(
  source: OAuthCredentialSource | undefined,
  credential: NormalizedOAuthCredential
): Promise<void> {
  if (!source) {
    return;
  }
  if (source.format === 'codex-auth') {
    return;
  }

  await fs.mkdir(path.dirname(source.path), { recursive: true });

  let payload: Record<string, any> = {};
  try {
    payload = JSON.parse(await fs.readFile(source.path, 'utf8'));
  } catch {
    payload = {};
  }

  if (source.format === 'provider-map') {
    payload[source.providerKey] = {
      ...(payload[source.providerKey] && typeof payload[source.providerKey] === 'object'
        ? payload[source.providerKey]
        : {}),
      ...(credential.access ? { access: credential.access } : {}),
      ...(credential.refresh ? { refresh: credential.refresh } : {}),
      ...(credential.expires ? { expires: credential.expires } : {}),
      ...(credential.accountId ? { accountId: credential.accountId } : {}),
      ...(credential.projectId ? { projectId: credential.projectId } : {}),
      ...(credential.email ? { email: credential.email } : {}),
      ...(credential.idToken ? { idToken: credential.idToken } : {})
    };
  } else if (source.format === 'gemini-cli-native') {
    payload = {
      ...(payload && typeof payload === 'object' ? payload : {}),
      ...(credential.access ? { access_token: credential.access } : {}),
      ...(credential.refresh ? { refresh_token: credential.refresh } : {}),
      ...(credential.expires ? { expiry_date: credential.expires } : {}),
      ...(credential.projectId ? { projectId: credential.projectId } : {})
    };
  } else {
    payload = {
      ...(payload && typeof payload === 'object' ? payload : {}),
      ...(credential.access ? { access: credential.access } : {}),
      ...(credential.refresh ? { refresh: credential.refresh } : {}),
      ...(credential.expires ? { expires: credential.expires } : {}),
      ...(credential.accountId ? { accountId: credential.accountId } : {}),
      ...(credential.projectId ? { projectId: credential.projectId } : {}),
      ...(credential.email ? { email: credential.email } : {}),
      ...(credential.idToken ? { idToken: credential.idToken } : {})
    };
  }

  await fs.writeFile(source.path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function normalizeCredentialRecord(input: any): NormalizedOAuthCredential {
  if (!input || typeof input !== 'object') {
    return {};
  }

  return {
    access: readString(input.access, input.access_token, input.token),
    refresh: readString(input.refresh, input.refresh_token),
    expires: normalizeExpiry(input.expires, input.expires_at, input.expiry, input.expiresAt, input.expiry_date),
    accountId: readString(input.accountId, input.account_id),
    projectId: readString(input.projectId, input.project_id),
    email: readString(input.email),
    idToken: readString(input.idToken, input.id_token)
  };
}

function isGeminiCliNativeCredentialRecord(candidate: string, raw: any): boolean {
  return (
    path.basename(candidate) === 'oauth_creds.json' &&
    raw &&
    typeof raw === 'object' &&
    (typeof raw.access_token === 'string' || typeof raw.refresh_token === 'string')
  );
}

function readString(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeExpiry(...values: any[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }

    return numeric < 1_000_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
  }

  return undefined;
}

function decodeJwtExpiryMs(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return undefined;
  }

  try {
    const payloadRaw = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadRaw) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= 0) {
      return undefined;
    }
    const expires = Math.trunc(payload.exp * 1000);
    return Number.isSafeInteger(expires) && expires > 0 ? expires : undefined;
  } catch {
    return undefined;
  }
}

async function resolveCodexAuthFallbackExpiryMs(candidate: string): Promise<number | undefined> {
  let baseMs: number;
  try {
    const stat = await fs.stat(candidate);
    baseMs = stat.mtimeMs;
  } catch {
    baseMs = Date.now();
  }

  const normalizedBaseMs = Math.floor(baseMs);
  if (!Number.isFinite(normalizedBaseMs) || normalizedBaseMs <= 0) {
    return undefined;
  }
  return normalizedBaseMs + CODEX_AUTH_FALLBACK_EXPIRY_MS;
}
