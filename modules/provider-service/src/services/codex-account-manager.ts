import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';
import {
  CODEX_AUTHORIZE_URL,
  CODEX_CLIENT_ID,
  exchangeCodexAuthorizationCode,
  extractEmailFromJwt,
  extractCodexAccountId,
  refreshCodexOAuthCredential,
} from './llm-provider/codex-oauth';
import {
  persistOAuthCredential,
  type NormalizedOAuthCredential
} from './llm-provider/oauth-credentials';
import { codexRateLimitService } from './codex-rate-limit-service';

type StoredCodexAccount = {
  id: string;
  email?: string;
  accountId?: string;
  idToken?: string;
  priorityOrder?: number;
  access: string;
  refresh: string;
  refreshEnabled?: boolean;
  expires: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  lastUsedAt?: string;
  cooldownUntil?: string;
  lastError?: string;
  lastRefreshAttemptAt?: string;
  lastRefreshSucceededAt?: string;
  refreshFailureCode?: string;
  refreshFailureAt?: string;
  stats?: {
    successCount: number;
    errorCount: number;
    quotaExceededCount: number;
  };
};

type LoginSessionRecord = {
  id: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  replaceAccountId?: string;
  createdAt: string;
  expiresAt: string;
};

type ProviderEventKind = 'success' | 'error' | 'quota_exceeded' | 'auth_error';
type RefreshTrigger = 'manual' | 'background-sweep';
type ImportCodexAccountInput = {
  rawInput: string;
  refreshToken?: string;
  replaceAccountId?: string;
  refreshEnabled?: boolean;
};

type CodexImportProbeResult = {
  success: boolean;
  provider: 'codex-direct';
  model: string;
  durationMs: number;
  response: string | null;
  error: string | null;
  statusCode: number | null;
};

const moduleLogger = logger.createModuleLogger('codex-account-manager');
const DEFAULT_STORE_DIR = process.env.CODEX_ACCOUNT_STORE_DIR || path.join(os.homedir(), '.qqbot-local', 'codex-accounts');
const DEFAULT_REDIRECT_URI = process.env.CODEX_ACCOUNT_REDIRECT_URI || 'http://localhost:1455/auth/callback';
const DEFAULT_COOLDOWN_MS = Math.max(60_000, Number.parseInt(process.env.CODEX_ACCOUNT_COOLDOWN_MS || `${30 * 60 * 1000}`, 10));
const DIRECT_CODEX_BASE_URL = (process.env.CODEX_DIRECT_BASE_URL || 'https://chatgpt.com/backend-api').replace(/\/+$/, '');
const DIRECT_CODEX_RESPONSES_PATH = (() => {
  const value = process.env.CODEX_DIRECT_RESPONSES_PATH || '/codex/responses';
  return value.startsWith('/') ? value : `/${value}`;
})();
const IMPORT_TEST_MODEL = process.env.CODEX_IMPORT_TEST_MODEL || 'gpt-5.4-mini';

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseOptionalIso(value?: string) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeAccount(record: StoredCodexAccount, activeAccountId: string | null) {
  const cooldownUntilMs = parseOptionalIso(record.cooldownUntil);
  const now = Date.now();
  const status = resolveAccountStatus(record, now);

  return {
    id: record.id,
    email: record.email || null,
    accountId: record.accountId || null,
    priorityOrder: Number.isFinite(record.priorityOrder) ? Number(record.priorityOrder) : 0,
    enabled: record.enabled,
    refreshEnabled: isRefreshEnabled(record),
    status,
    isActive: activeAccountId === record.id,
    expiresAt: new Date(record.expires).toISOString(),
    cooldownUntil: record.cooldownUntil || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActivatedAt: record.lastActivatedAt || null,
    lastUsedAt: record.lastUsedAt || null,
    lastRefreshAttemptAt: record.lastRefreshAttemptAt || null,
    lastRefreshSucceededAt: record.lastRefreshSucceededAt || null,
    refreshFailureCode: record.refreshFailureCode || null,
    refreshFailureAt: record.refreshFailureAt || null,
    lastError: record.lastError || null,
    stats: {
      successCount: record.stats?.successCount || 0,
      errorCount: record.stats?.errorCount || 0,
      quotaExceededCount: record.stats?.quotaExceededCount || 0,
    },
    rateLimits: null as null | {
      primary: {
        usedPercent: number;
        windowDurationMins: number;
        resetsAt: string | null;
      } | null;
      secondary: {
        usedPercent: number;
        windowDurationMins: number;
        resetsAt: string | null;
      } | null;
      checkedAt: string;
    }
  };
}

function isRefreshEnabled(record: Pick<StoredCodexAccount, 'refresh' | 'refreshEnabled'>) {
  return Boolean(record.refresh) && record.refreshEnabled !== false;
}

function resolveAccountStatus(record: StoredCodexAccount, now = Date.now()) {
  const cooldownUntilMs = parseOptionalIso(record.cooldownUntil);
  if (!record.enabled) {
    return 'disabled';
  }
  if (record.refreshFailureCode) {
    return 'reauth_required';
  }
  if (cooldownUntilMs && cooldownUntilMs > now) {
    return 'cooldown';
  }
  if (record.expires <= now) {
    return 'expired';
  }
  return 'ready';
}

function classifyRefreshFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes('invalid_grant') ||
    normalized.includes('invalid grant') ||
    normalized.includes('refresh_token_reused') ||
    normalized.includes('token is invalid') ||
    normalized.includes('token has expired') ||
    normalized.includes('revoked') ||
    normalized.includes('reuse detected')
  ) {
    return {
      code: 'reauth_required',
      terminal: true,
      message
    };
  }

  return {
    code: 'refresh_failed',
    terminal: false,
    message
  };
}

function buildCodexAuthPayload(record: Pick<StoredCodexAccount, 'access' | 'refresh' | 'expires' | 'accountId' | 'idToken'>) {
  return {
    OPENAI_API_KEY: null,
    auth_mode: 'chatgpt',
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: record.access,
      refresh_token: record.refresh,
      expires_at: record.expires,
      ...(record.accountId ? { account_id: record.accountId } : {}),
      ...(record.idToken ? { id_token: record.idToken } : {})
    }
  };
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) {
      return null;
    }
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const decoded = Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? (parsed > 1_000_000_000_000 ? parsed : parsed * 1000) : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeImportPayload(rawInput: string, refreshTokenOverride?: string) {
  let parsed: any;
  try {
    parsed = JSON.parse(rawInput);
  } catch (error) {
    throw new Error(`Invalid import JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!record || typeof record !== 'object') {
    throw new Error('Import payload must be a JSON object.');
  }

  const accessToken = readFirstString(
    record.accessToken,
    record.access_token,
    record.tokens?.accessToken,
    record.tokens?.access_token,
    record.token?.accessToken,
    record.token?.access_token,
    record.credentials?.accessToken,
    record.credentials?.access_token
  );
  if (!accessToken) {
    throw new Error('Import payload is missing access token.');
  }

  const idToken = readFirstString(
    record.idToken,
    record.id_token,
    record.tokens?.idToken,
    record.tokens?.id_token,
    record.token?.idToken,
    record.token?.id_token,
    record.credentials?.id_token
  );
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.['https://api.openai.com/auth'];
  const email = readFirstString(
    record.user?.email,
    record.email,
    record.meta?.label,
    record.label,
    record.credentials?.email,
    extractEmailFromJwt(idToken || accessToken),
    payload?.email
  );
  const accountId = readFirstString(
    record.account?.id,
    record.accountId,
    record.account_id,
    record.tokens?.accountId,
    record.tokens?.account_id,
    record.chatgptAccountId,
    record.chatgpt_account_id,
    record.providerSpecificData?.chatgptAccountId,
    record.providerSpecificData?.chatgpt_account_id,
    record.credentials?.chatgpt_account_id,
    auth?.chatgpt_account_id,
    extractCodexAccountId(accessToken)
  );
  const refreshToken = readFirstString(
    refreshTokenOverride,
    record.refreshToken,
    record.refresh_token,
    record.tokens?.refreshToken,
    record.tokens?.refresh_token,
    record.token?.refreshToken,
    record.token?.refresh_token,
    record.credentials?.refresh_token
  ) || '';
  const expires = normalizeTimestamp(
    record.expiresAt ?? record.expires_at ?? record.expires ?? record.expiry ?? record.expiry_date ?? record.expired
  ) || (
    typeof payload?.exp === 'number'
      ? payload.exp * 1000
      : Date.now() + 3600_000
  );

  return {
    access: accessToken,
    refresh: refreshToken,
    expires,
    accountId,
    email,
    idToken
  };
}

function parseCodexProbeText(payload: string) {
  const events = payload
    .split(/\r?\n\r?\n/)
    .flatMap((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter((line) => line.length > 0 && line !== '[DONE]')
    )
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as any[];

  let outputText = '';
  let messageText = '';

  for (const event of events) {
    const type = typeof event?.type === 'string' ? event.type : '';
    if (!type) {
      continue;
    }
    if (type === 'error') {
      throw new Error(event?.message || event?.code || 'Codex SSE error');
    }
    if (type === 'response.failed') {
      throw new Error(event?.response?.error?.message || 'Codex response failed');
    }
    if (type === 'response.output_text.delta' && typeof event?.delta === 'string') {
      outputText += event.delta;
      continue;
    }
    if (type === 'response.output_item.done' && event?.item?.type === 'message' && Array.isArray(event.item.content)) {
      messageText += event.item.content
        .filter((part: any) => part?.type === 'output_text' && typeof part?.text === 'string')
        .map((part: any) => part.text)
        .join('');
    }
  }

  return (messageText || outputText || '').trim();
}

export class CodexAccountManager {
  private readonly storeDir: string;
  private readonly accountsDir: string;
  private readonly sessionsDir: string;
  private readonly activeStatePath: string;
  private readonly activeAuthPath: string;

  constructor(options?: { storeDir?: string; activeAuthPath?: string }) {
    this.storeDir = options?.storeDir || DEFAULT_STORE_DIR;
    this.accountsDir = path.join(this.storeDir, 'accounts');
    this.sessionsDir = path.join(this.storeDir, 'login-sessions');
    this.activeStatePath = path.join(this.storeDir, 'active-account.json');
    this.activeAuthPath = options?.activeAuthPath || path.join(os.homedir(), '.codex', 'auth.json');
  }

  async getStatus() {
    const [accounts, active] = await Promise.all([
      this.listAccounts(),
      this.readActiveAccountId()
    ]);
    return {
      available: true,
      storeDir: this.storeDir,
      activeAccountId: active,
      totalAccounts: accounts.length,
      enabledAccounts: accounts.filter((item) => item.enabled).length,
      readyAccounts: accounts.filter((item) => item.status === 'ready').length,
      accounts
    };
  }

  async listAccounts() {
    await this.ensureConsistentPriorities();
    const activeAccountId = await this.readActiveAccountId();
    const activeCredential = await this.readActiveAuthCredential();
    const files = await fs.readdir(this.accountsDir).catch(() => []);
    const records: Array<ReturnType<typeof sanitizeAccount> & { __authPayload?: Record<string, unknown> }> = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(this.accountsDir, file), 'utf8').catch(() => null);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as StoredCodexAccount;
        if (!parsed.idToken && activeCredential?.accountId && activeCredential.accountId === parsed.accountId && activeCredential.idToken) {
          parsed.idToken = activeCredential.idToken;
          await this.writeAccount(parsed);
        }
        const sanitized = sanitizeAccount(parsed, activeAccountId) as ReturnType<typeof sanitizeAccount> & {
          __authPayload?: Record<string, unknown>;
        };
        sanitized.__authPayload = buildCodexAuthPayload(parsed);
        records.push(sanitized);
      } catch {
        continue;
      }
    }
    const sorted = records.sort((left, right) => {
      if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
      if (left.priorityOrder !== right.priorityOrder) return left.priorityOrder - right.priorityOrder;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    await Promise.all(sorted.map(async (record) => {
      if (!record.accountId || !record.__authPayload) {
        delete record.__authPayload;
        return;
      }
      const authTokens = record.__authPayload.tokens as Record<string, unknown>;
      if (!authTokens.id_token && activeCredential?.accountId && activeCredential.accountId === record.accountId && activeCredential.idToken) {
        authTokens.id_token = activeCredential.idToken;
      }
      record.rateLimits = await codexRateLimitService.getAccountRateLimits({
        accountId: record.id,
        authPayload: record.__authPayload
      });
      delete record.__authPayload;
    }));
    return sorted;
  }

  async createLoginSession(options?: { redirectUri?: string; replaceAccountId?: string }) {
    await this.ensureStore();
    const redirectUri = options?.redirectUri || DEFAULT_REDIRECT_URI;
    if (options?.replaceAccountId) {
      await this.requireAccount(options.replaceAccountId);
    }
    const id = crypto.randomUUID();
    const state = toBase64Url(crypto.randomBytes(18));
    const codeVerifier = toBase64Url(crypto.randomBytes(32));
    const codeChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const session: LoginSessionRecord = {
      id,
      state,
      codeVerifier,
      redirectUri,
      replaceAccountId: options?.replaceAccountId,
      createdAt,
      expiresAt
    };
    await fs.writeFile(path.join(this.sessionsDir, `${state}.json`), `${JSON.stringify(session, null, 2)}\n`, 'utf8');

    const authorizeUrl = new URL(CODEX_AUTHORIZE_URL);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', CODEX_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'openid profile email offline_access');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    return {
      id,
      state,
      redirectUri,
      authorizeUrl: authorizeUrl.toString(),
      expiresAt
    };
  }

  async completeLogin(input: { callbackUrl?: string; code?: string; state?: string }) {
    const { code, state } = this.parseCallbackInput(input);
    const sessionPath = path.join(this.sessionsDir, `${state}.json`);
    const raw = await fs.readFile(sessionPath, 'utf8').catch(() => null);
    if (!raw) {
      throw new Error('Unknown or expired Codex login session.');
    }

    const session = JSON.parse(raw) as LoginSessionRecord;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await fs.rm(sessionPath, { force: true });
      throw new Error('Codex login session has expired.');
    }

    const credential = await exchangeCodexAuthorizationCode({
      code,
      codeVerifier: session.codeVerifier,
      redirectUri: session.redirectUri
    });

    const access = credential.access || '';
    const nowIso = new Date().toISOString();
    const replacing = session.replaceAccountId ? await this.readAccount(session.replaceAccountId) : null;
    const account: StoredCodexAccount = replacing
      ? {
          ...replacing,
          email: credential.email,
          accountId: credential.accountId || extractCodexAccountId(access) || replacing.accountId,
          idToken: credential.idToken,
          access,
          refresh: credential.refresh || '',
          refreshEnabled: Boolean(credential.refresh),
          expires: credential.expires || (Date.now() + 3600_000),
          updatedAt: nowIso,
          cooldownUntil: undefined,
          lastError: undefined,
          refreshFailureCode: undefined,
          refreshFailureAt: undefined,
          lastRefreshAttemptAt: undefined,
          lastRefreshSucceededAt: undefined
        }
      : {
          id: crypto.randomUUID(),
          email: credential.email,
          accountId: credential.accountId || extractCodexAccountId(access) || undefined,
          idToken: credential.idToken,
          access,
          refresh: credential.refresh || '',
          refreshEnabled: Boolean(credential.refresh),
          expires: credential.expires || (Date.now() + 3600_000),
          enabled: true,
          createdAt: nowIso,
          updatedAt: nowIso,
          stats: {
            successCount: 0,
            errorCount: 0,
            quotaExceededCount: 0
          }
        };

    await this.writeAccount(account);
    await fs.rm(sessionPath, { force: true });

    const active = await this.readActiveAccountId();
    if (!active || active === account.id) {
      await this.activateAccount(account.id);
    }

    return sanitizeAccount(account, await this.readActiveAccountId());
  }

  async importAccount(input: ImportCodexAccountInput) {
    await this.ensureStore();
    const normalized = normalizeImportPayload(input.rawInput, input.refreshToken);
    const nowIso = new Date().toISOString();
    const replacing = input.replaceAccountId ? await this.readAccount(input.replaceAccountId) : null;
    const existing = !replacing
      ? await this.findExistingImportedAccount(normalized.accountId, normalized.email)
      : null;
    const target = replacing || existing;

    const account: StoredCodexAccount = target
      ? {
          ...target,
          email: normalized.email || target.email,
          accountId: normalized.accountId || target.accountId,
          idToken: normalized.idToken || target.idToken,
          access: normalized.access,
          refresh: normalized.refresh,
          refreshEnabled: input.refreshEnabled === true && Boolean(normalized.refresh),
          expires: normalized.expires,
          enabled: true,
          updatedAt: nowIso,
          cooldownUntil: undefined,
          lastError: undefined,
          refreshFailureCode: undefined,
          refreshFailureAt: undefined,
          lastRefreshAttemptAt: undefined,
          lastRefreshSucceededAt: undefined
        }
      : {
          id: crypto.randomUUID(),
          email: normalized.email,
          accountId: normalized.accountId,
          idToken: normalized.idToken,
          access: normalized.access,
          refresh: normalized.refresh,
          refreshEnabled: input.refreshEnabled === true && Boolean(normalized.refresh),
          expires: normalized.expires,
          enabled: true,
          createdAt: nowIso,
          updatedAt: nowIso,
          stats: {
            successCount: 0,
            errorCount: 0,
            quotaExceededCount: 0
          }
        };

    await this.writeAccount(account);

    const active = await this.readActiveAccountId();
    if (!active || active === account.id) {
      await this.activateAccount(account.id);
    }

    const importTest = await this.probeImportedAccount(account);

    return {
      account: sanitizeAccount(account, await this.readActiveAccountId()),
      importTest
    };
  }

  async setAccountEnabled(id: string, enabled: boolean) {
    const account = await this.requireAccount(id);
    account.enabled = enabled;
    account.updatedAt = new Date().toISOString();
    if (!enabled) {
      account.cooldownUntil = undefined;
    }
    if (!enabled && (await this.readActiveAccountId()) === id) {
      await this.clearActiveAccount();
    }
    await this.writeAccount(account);
    return sanitizeAccount(account, await this.readActiveAccountId());
  }

  async activateAccount(id: string) {
    const account = await this.requireAccount(id);
    if (!account.enabled) {
      throw new Error('Cannot activate a disabled Codex account.');
    }

    await this.withLock('projection', async () => {
      await persistOAuthCredential({
        path: this.activeAuthPath,
        format: 'codex-auth'
      }, {
        access: account.access,
        refresh: account.refresh,
        expires: account.expires,
        accountId: account.accountId,
        email: account.email,
        idToken: account.idToken
      });

      await fs.writeFile(this.activeStatePath, `${JSON.stringify({
        activeAccountId: account.id,
        updatedAt: new Date().toISOString()
      }, null, 2)}\n`, 'utf8');
    });

    account.lastActivatedAt = new Date().toISOString();
    account.updatedAt = account.lastActivatedAt;
    await this.writeAccount(account);
    return sanitizeAccount(account, account.id);
  }

  async refreshAccount(id: string, options?: { trigger?: RefreshTrigger }) {
    const account = await this.requireAccount(id);
    if (!isRefreshEnabled(account)) {
      throw new Error('Refresh is disabled for this account. Re-import and explicitly enable refresh if this token is known-good.');
    }
    const nowIso = new Date().toISOString();
    account.lastRefreshAttemptAt = nowIso;

    try {
      const refreshed = await refreshCodexOAuthCredential({
        access: account.access,
        refresh: account.refresh,
        expires: account.expires,
        accountId: account.accountId,
        email: account.email,
        idToken: account.idToken
      });
      account.access = refreshed.access || account.access;
      account.refresh = refreshed.refresh || account.refresh;
      account.expires = refreshed.expires || account.expires;
      account.accountId = refreshed.accountId || account.accountId;
      account.email = refreshed.email || account.email;
      account.idToken = refreshed.idToken || account.idToken;
      account.lastRefreshSucceededAt = nowIso;
      account.refreshFailureCode = undefined;
      account.refreshFailureAt = undefined;
      account.lastError = undefined;
      account.updatedAt = nowIso;
      await this.writeAccount(account);

      if ((await this.readActiveAccountId()) === id) {
        await this.activateAccount(id);
      }
      return sanitizeAccount(account, await this.readActiveAccountId());
    } catch (error) {
      const failure = classifyRefreshFailure(error);
      account.refreshFailureCode = failure.code;
      account.refreshFailureAt = nowIso;
      account.lastError = failure.message;
      account.updatedAt = nowIso;
      await this.writeAccount(account);
      moduleLogger.warn('Failed to refresh Codex account', {
        accountId: account.id,
        providerAccountId: account.accountId || null,
        trigger: options?.trigger || 'manual',
        refreshFailureCode: failure.code,
        terminal: failure.terminal,
        error: failure.message
      });
      throw error;
    }
  }

  async syncActiveCredential(credential: NormalizedOAuthCredential) {
    const activeAccountId = await this.readActiveAccountId();
    if (!activeAccountId) {
      return null;
    }

    const account = await this.readAccount(activeAccountId);
    if (!account) {
      return null;
    }

    let changed = false;

    if (credential.access && credential.access !== account.access) {
      account.access = credential.access;
      changed = true;
    }
    if (credential.refresh && credential.refresh !== account.refresh) {
      account.refresh = credential.refresh;
      changed = true;
    }
    if (credential.expires && credential.expires !== account.expires) {
      account.expires = credential.expires;
      changed = true;
    }
    if (credential.accountId && credential.accountId !== account.accountId) {
      account.accountId = credential.accountId;
      changed = true;
    }
    if (credential.email && credential.email !== account.email) {
      account.email = credential.email;
      changed = true;
    }
    if (credential.idToken && credential.idToken !== account.idToken) {
      account.idToken = credential.idToken;
      changed = true;
    }

    if (!changed) {
      return sanitizeAccount(account, activeAccountId);
    }

    account.updatedAt = new Date().toISOString();
    await this.writeAccount(account);
    return sanitizeAccount(account, activeAccountId);
  }

  async exportAccountAuth(id: string) {
    const account = await this.requireAccount(id);
    return buildCodexAuthPayload(account);
  }

  async reorderAccounts(orderedIds: string[]) {
    const accounts = await this.listStoredAccounts();
    const requestedIds = orderedIds.map((value) => value.trim()).filter((value) => value.length > 0);
    const knownIds = new Set(accounts.map((account) => account.id));

    if (requestedIds.length !== accounts.length || new Set(requestedIds).size !== requestedIds.length) {
      throw new Error('Account reorder payload must include every managed account exactly once.');
    }

    for (const id of requestedIds) {
      if (!knownIds.has(id)) {
        throw new Error(`Unknown Codex account in reorder payload: ${id}`);
      }
    }

    const orderIndex = new Map(requestedIds.map((id, index) => [id, index]));
    await Promise.all(accounts.map(async (account) => {
      const nextOrder = orderIndex.get(account.id);
      if (!Number.isFinite(nextOrder)) {
        return;
      }
      account.priorityOrder = Number(nextOrder);
      account.updatedAt = new Date().toISOString();
      await this.writeAccount(account);
    }));

    return this.listAccounts();
  }

  private async probeImportedAccount(account: Pick<StoredCodexAccount, 'access' | 'accountId'>): Promise<CodexImportProbeResult> {
    const startedAt = Date.now();
    const payload = {
      model: IMPORT_TEST_MODEL,
      store: false,
      stream: true,
      instructions: 'You are a helpful assistant.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'hi'
            }
          ]
        }
      ],
      text: {
        verbosity: 'low'
      },
      include: ['reasoning.encrypted_content'],
      parallel_tool_calls: false
    };

    try {
      const response = await fetch(`${DIRECT_CODEX_BASE_URL}${DIRECT_CODEX_RESPONSES_PATH}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          Authorization: `Bearer ${account.access}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'User-Agent': 'codex_cli_rs/0.117.0 (linux x64) xterm-256color (codex-tui; 0.117.0)',
          Origin: 'https://chatgpt.com',
          Referer: 'https://chatgpt.com/',
          originator: 'codex_cli_rs',
          'OpenAI-Beta': 'responses=experimental',
          ...(account.accountId ? { 'chatgpt-account-id': account.accountId } : {})
        }
      });

      const bodyText = await response.text().catch(() => '');
      if (!response.ok) {
        return {
          success: false,
          provider: 'codex-direct',
          model: IMPORT_TEST_MODEL,
          durationMs: Date.now() - startedAt,
          response: null,
          error: `Codex API error (${response.status} ${response.statusText}): ${bodyText}`,
          statusCode: response.status
        };
      }

      return {
        success: true,
        provider: 'codex-direct',
        model: IMPORT_TEST_MODEL,
        durationMs: Date.now() - startedAt,
        response: parseCodexProbeText(bodyText) || null,
        error: null,
        statusCode: response.status
      };
    } catch (error) {
      return {
        success: false,
        provider: 'codex-direct',
        model: IMPORT_TEST_MODEL,
        durationMs: Date.now() - startedAt,
        response: null,
        error: error instanceof Error ? error.message : String(error),
        statusCode: null
      };
    }
  }

  async removeAccount(id: string) {
    const account = await this.requireAccount(id);
    const activeId = await this.readActiveAccountId();
    const nextReady = activeId === id ? await this.pickNextReadyAccount(id) : null;

    await fs.rm(path.join(this.accountsDir, `${account.id}.json`), { force: true });

    if (activeId === id) {
      if (nextReady) {
        await this.activateAccount(nextReady.id);
      } else {
        await this.clearActiveAccount();
        await fs.rm(this.activeAuthPath, { force: true }).catch(() => undefined);
      }
    }

    return {
      removedAccountId: id,
      nextActiveAccountId: nextReady?.id || null
    };
  }

  async recordProviderEvent(accountId: string | null | undefined, kind: ProviderEventKind, error?: string) {
    if (!accountId) {
      return null;
    }
    const account = await this.findAccountByProviderAccountId(accountId);
    if (!account) {
      return null;
    }

    const nowIso = new Date().toISOString();
    account.lastUsedAt = nowIso;
    account.updatedAt = nowIso;
    account.stats = account.stats || { successCount: 0, errorCount: 0, quotaExceededCount: 0 };

    if (kind === 'success') {
      account.stats.successCount += 1;
      account.lastError = undefined;
      if (account.refreshFailureCode === 'refresh_failed') {
        account.refreshFailureCode = undefined;
        account.refreshFailureAt = undefined;
      }
    } else if (kind === 'quota_exceeded') {
      account.stats.errorCount += 1;
      account.stats.quotaExceededCount += 1;
      account.cooldownUntil = new Date(Date.now() + DEFAULT_COOLDOWN_MS).toISOString();
      account.lastError = error || 'usage_limit_reached';
    } else {
      account.stats.errorCount += 1;
      account.lastError = error || kind;
    }

    await this.writeAccount(account);
    return sanitizeAccount(account, await this.readActiveAccountId());
  }

  async handleQuotaExceeded(accountId: string | null | undefined, error?: string) {
    if (!accountId) {
      return { switched: false, reason: 'missing-account-id' };
    }

    const current = await this.findAccountByProviderAccountId(accountId);
    if (!current) {
      return { switched: false, reason: 'account-not-managed' };
    }

    await this.recordProviderEvent(accountId, 'quota_exceeded', error);
    const next = await this.pickNextReadyAccount(current.id);
    if (!next) {
      return { switched: false, reason: 'no-backup-account' };
    }

    await this.activateAccount(next.id);
    moduleLogger.warn('Switched active Codex account after quota exhaustion', {
      previousAccountId: current.id,
      nextAccountId: next.id,
      providerAccountId: accountId
    });
    return {
      switched: true,
      previousAccountId: current.id,
      nextAccountId: next.id
    };
  }

  async listAccountsNeedingRefresh(options?: { refreshThresholdMs?: number; nowMs?: number }) {
    const accounts = await this.listStoredAccounts();
    const nowMs = options?.nowMs || Date.now();
    const refreshThresholdMs = Math.max(0, options?.refreshThresholdMs || 0);
    return accounts.filter((item) => {
      if (!item.enabled || !item.refresh) {
        return false;
      }
      if (!isRefreshEnabled(item)) {
        return false;
      }
      if (resolveAccountStatus(item, nowMs) === 'reauth_required') {
        return false;
      }
      return item.expires <= nowMs + refreshThresholdMs;
    });
  }

  private parseCallbackInput(input: { callbackUrl?: string; code?: string; state?: string }) {
    if (input.callbackUrl && input.callbackUrl.trim()) {
      const url = new URL(input.callbackUrl.trim());
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) {
        throw new Error('Callback URL must include both code and state.');
      }
      return { code, state };
    }
    if (input.code && input.state) {
      return { code: input.code.trim(), state: input.state.trim() };
    }
    throw new Error('Provide a full callback URL or both code and state.');
  }

  private async ensureStore() {
    await fs.mkdir(this.accountsDir, { recursive: true });
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.mkdir(path.dirname(this.activeAuthPath), { recursive: true });
  }

  private async readActiveAccountId() {
    try {
      const raw = await fs.readFile(this.activeStatePath, 'utf8');
      const parsed = JSON.parse(raw) as { activeAccountId?: string };
      return typeof parsed.activeAccountId === 'string' ? parsed.activeAccountId : null;
    } catch {
      return null;
    }
  }

  private async clearActiveAccount() {
    await fs.rm(this.activeStatePath, { force: true });
  }

  private async readActiveAuthCredential() {
    try {
      const raw = JSON.parse(await fs.readFile(this.activeAuthPath, 'utf8')) as {
        tokens?: {
          account_id?: string;
          id_token?: string;
        };
      };
      return {
        accountId: typeof raw?.tokens?.account_id === 'string' ? raw.tokens.account_id : null,
        idToken: typeof raw?.tokens?.id_token === 'string' ? raw.tokens.id_token : null
      };
    } catch {
      return null;
    }
  }

  private async requireAccount(id: string) {
    const account = await this.readAccount(id);
    if (!account) {
      throw new Error(`Unknown Codex account: ${id}`);
    }
    return account;
  }

  private async readAccount(id: string) {
    try {
      const raw = await fs.readFile(path.join(this.accountsDir, `${id}.json`), 'utf8');
      return JSON.parse(raw) as StoredCodexAccount;
    } catch {
      return null;
    }
  }

  private async writeAccount(account: StoredCodexAccount) {
    await this.ensureStore();
    account.updatedAt = account.updatedAt || new Date().toISOString();
    await fs.writeFile(path.join(this.accountsDir, `${account.id}.json`), `${JSON.stringify(account, null, 2)}\n`, 'utf8');
  }

  private async findAccountByProviderAccountId(accountId: string) {
    const accounts = await this.listStoredAccounts();
    return accounts.find((item) => item.accountId === accountId) || null;
  }

  private async findExistingImportedAccount(accountId?: string, email?: string) {
    const accounts = await this.listStoredAccounts();
    if (email) {
      const byEmail = accounts.find((item) => item.email === email);
      if (byEmail) {
        return byEmail;
      }
    }
    if (accountId) {
      const byAccountId = accounts.find((item) =>
        item.accountId === accountId && (!email || !item.email || item.email === email)
      );
      if (byAccountId) {
        return byAccountId;
      }
    }
    return null;
  }

  private async pickNextReadyAccount(excludingId: string) {
    const accounts = await this.listStoredAccounts();
    const now = Date.now();
    const ready = accounts.filter((item) => {
      if (item.id === excludingId || !item.enabled) return false;
      if (item.expires <= now) return false;
      const cooldownUntilMs = parseOptionalIso(item.cooldownUntil);
      return !cooldownUntilMs || cooldownUntilMs <= now;
    });
    ready.sort((left, right) => {
      const leftPriority = Number.isFinite(left.priorityOrder) ? Number(left.priorityOrder) : Number.MAX_SAFE_INTEGER;
      const rightPriority = Number.isFinite(right.priorityOrder) ? Number(right.priorityOrder) : Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      const leftScore = Date.parse(left.lastActivatedAt || left.createdAt);
      const rightScore = Date.parse(right.lastActivatedAt || right.createdAt);
      return leftScore - rightScore;
    });
    return ready[0] || null;
  }

  private async listStoredAccounts() {
    await this.ensureConsistentPriorities();
    const files = await fs.readdir(this.accountsDir).catch(() => []);
    const accounts: StoredCodexAccount[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(this.accountsDir, file), 'utf8').catch(() => null);
      if (!raw) continue;
      try {
        accounts.push(JSON.parse(raw) as StoredCodexAccount);
      } catch {
        continue;
      }
    }
    return accounts;
  }

  private async ensureConsistentPriorities() {
    await this.ensureStore();
    await this.withLock('priority-order', async () => {
      const files = await fs.readdir(this.accountsDir).catch(() => []);
      const accounts: StoredCodexAccount[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const raw = await fs.readFile(path.join(this.accountsDir, file), 'utf8').catch(() => null);
        if (!raw) continue;
        try {
          accounts.push(JSON.parse(raw) as StoredCodexAccount);
        } catch {
          continue;
        }
      }

      const withPriority = accounts.filter((account) => Number.isFinite(account.priorityOrder));
      if (withPriority.length === accounts.length) {
        return;
      }

      accounts
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
        .forEach((account, index) => {
          account.priorityOrder = index;
        });

      await Promise.all(accounts.map((account) => this.writeAccount(account)));
    });
  }

  private async withLock<T>(name: string, fn: () => Promise<T>) {
    const lockPath = path.join(this.storeDir, `${name}.lock`);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const handle = await fs.open(lockPath, 'wx');
        try {
          return await fn();
        } finally {
          await handle.close().catch(() => undefined);
          await fs.rm(lockPath, { force: true }).catch(() => undefined);
        }
      } catch (error: any) {
        if (error?.code !== 'EEXIST') {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`Timed out waiting for Codex account lock: ${name}`);
  }
}

export const codexAccountManager = new CodexAccountManager();
