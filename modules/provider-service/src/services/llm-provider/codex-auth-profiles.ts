import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { NormalizedOAuthCredential } from './oauth-credentials';

export const CODEX_AUTH_PROFILE_ID = 'openai:default';
const CODEX_AUTH_PROVIDER = 'openai';
const CODEX_AUTH_STORE_VERSION = 1;

type CodexAuthProfileCredential = NormalizedOAuthCredential & {
  type: 'oauth';
  provider: string;
};

type CodexAuthProfileStore = {
  version: number;
  profiles: Record<string, unknown>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
  [key: string]: unknown;
};

export function resolveCodexAuthProfilesPath(): string {
  return expandUserPath(
    process.env.CODEX_LOCAL_AUTH_PROFILES_PATH ||
      process.env.CODEX_AUTH_PROFILES_PATH ||
      path.join(os.homedir(), '.qqbot-local', 'codex-auth-profiles', 'auth-profiles.json')
  );
}

export async function loadCodexAuthProfileCredential(
  storePath = resolveCodexAuthProfilesPath(),
  profileId = CODEX_AUTH_PROFILE_ID
): Promise<NormalizedOAuthCredential | null> {
  const store = await readCodexAuthProfileStore(storePath);
  const profile = store?.profiles?.[profileId];
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const credential = profile as Record<string, unknown>;
  if (credential.type !== 'oauth' || credential.provider !== CODEX_AUTH_PROVIDER) {
    return null;
  }

  const normalized = normalizeProfileCredential(credential);
  return normalized.access || normalized.refresh ? normalized : null;
}

export async function saveCodexAuthProfileCredential(
  credential: NormalizedOAuthCredential,
  storePath = resolveCodexAuthProfilesPath(),
  profileId = CODEX_AUTH_PROFILE_ID
): Promise<void> {
  const existing = await readCodexAuthProfileStore(storePath);
  const store: CodexAuthProfileStore = existing || {
    version: CODEX_AUTH_STORE_VERSION,
    profiles: {}
  };
  store.version = CODEX_AUTH_STORE_VERSION;
  store.profiles = store.profiles && typeof store.profiles === 'object' ? store.profiles : {};
  store.profiles[profileId] = toProfileCredential(credential);
  store.order = {
    ...(store.order || {}),
    [CODEX_AUTH_PROVIDER]: [profileId]
  };
  store.lastGood = {
    ...(store.lastGood || {}),
    [CODEX_AUTH_PROVIDER]: profileId
  };

  await fs.mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempPath, storePath);
  await fs.chmod(storePath, 0o600).catch(() => undefined);
}

async function readCodexAuthProfileStore(storePath: string): Promise<CodexAuthProfileStore | null> {
  try {
    const raw = JSON.parse(await fs.readFile(storePath, 'utf8'));
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    return {
      ...raw,
      version: typeof raw.version === 'number' ? raw.version : CODEX_AUTH_STORE_VERSION,
      profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {}
    } as CodexAuthProfileStore;
  } catch {
    return null;
  }
}

function toProfileCredential(credential: NormalizedOAuthCredential): CodexAuthProfileCredential {
  return {
    type: 'oauth',
    provider: CODEX_AUTH_PROVIDER,
    ...(credential.access ? { access: credential.access } : {}),
    ...(credential.refresh ? { refresh: credential.refresh } : {}),
    ...(credential.expires ? { expires: credential.expires } : {}),
    ...(credential.accountId ? { accountId: credential.accountId } : {}),
    ...(credential.email ? { email: credential.email } : {}),
    ...(credential.idToken ? { idToken: credential.idToken } : {})
  };
}

function normalizeProfileCredential(input: Record<string, unknown>): NormalizedOAuthCredential {
  return {
    access: readString(input.access),
    refresh: readString(input.refresh),
    expires: normalizeExpiry(input.expires),
    accountId: readString(input.accountId),
    email: readString(input.email),
    idToken: readString(input.idToken)
  };
}

function expandUserPath(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeExpiry(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return numeric < 1_000_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
}
