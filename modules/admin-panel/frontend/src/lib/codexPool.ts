export type CodexAccountRow = {
  id: string;
  email: string | null;
  accountId: string | null;
  enabled: boolean;
  status: 'ready' | 'cooldown' | 'expired' | 'disabled';
  isActive: boolean;
  expiresAt: string;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  stats: {
    successCount: number;
    errorCount: number;
    quotaExceededCount: number;
  };
  rateLimits: {
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
  } | null;
};

export interface CodexPoolStatusResponse {
  success: boolean;
  data?: {
    available: boolean;
    storeDir: string;
    activeAccountId: string | null;
    totalAccounts: number;
    enabledAccounts: number;
    readyAccounts: number;
    accounts: CodexAccountRow[];
  };
  error?: string;
}

export interface CodexPoolAccountsResponse {
  success: boolean;
  data?: CodexAccountRow[];
  error?: string;
}

export interface CodexLoginSessionResponse {
  success: boolean;
  data?: {
    id: string;
    state: string;
    redirectUri: string;
    authorizeUrl: string;
    expiresAt: string;
  };
  error?: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({ success: false, error: `Invalid response from ${url}` }));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`);
  }
  return payload as T;
}

export async function fetchCodexPoolStatus(): Promise<CodexPoolStatusResponse> {
  return requestJson<CodexPoolStatusResponse>('/api/codex-pool/status');
}

export async function fetchCodexAccounts(): Promise<CodexPoolAccountsResponse> {
  return requestJson<CodexPoolAccountsResponse>('/api/codex-pool/accounts');
}

export async function createCodexLoginSession(options?: {
  redirectUri?: string;
  replaceAccountId?: string;
}): Promise<CodexLoginSessionResponse> {
  return requestJson<CodexLoginSessionResponse>('/api/codex-pool/login-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      redirectUri: options?.redirectUri,
      replaceAccountId: options?.replaceAccountId
    })
  });
}

export async function completeCodexLogin(callbackUrl: string) {
  return requestJson('/api/codex-pool/complete-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ callbackUrl })
  });
}

export async function activateCodexAccount(accountId: string) {
  return requestJson(`/api/codex-pool/accounts/${encodeURIComponent(accountId)}/activate`, {
    method: 'POST'
  });
}

export async function refreshCodexAccount(accountId: string) {
  return requestJson(`/api/codex-pool/accounts/${encodeURIComponent(accountId)}/refresh`, {
    method: 'POST'
  });
}

export async function setCodexAccountEnabled(accountId: string, enabled: boolean) {
  return requestJson(`/api/codex-pool/accounts/${encodeURIComponent(accountId)}/enabled`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ enabled })
  });
}

export async function removeCodexAccount(accountId: string) {
  return requestJson(`/api/codex-pool/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE'
  });
}
