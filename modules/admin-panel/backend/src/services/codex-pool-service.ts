const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';

async function requestProvider(pathname: string, init?: RequestInit) {
  const response = await fetch(`${PROVIDER_SERVICE_URL}${pathname}`, init);
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { success: false, error: text || 'Invalid JSON response from provider-service' };
  }

  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `provider-service request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

export async function getCodexAccountsStatus() {
  return requestProvider('/api/internal/codex-accounts/status');
}

export async function listCodexAccounts() {
  return requestProvider('/api/internal/codex-accounts');
}

export async function createCodexLoginSession(redirectUri?: string, replaceAccountId?: string) {
  return requestProvider('/api/internal/codex-accounts/login-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ redirectUri, replaceAccountId })
  });
}

export async function completeCodexLogin(body: {
  callbackUrl?: string;
  code?: string;
  state?: string;
}) {
  return requestProvider('/api/internal/codex-accounts/complete-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

export async function importCodexAccount(body: {
  rawInput: string;
  refreshToken?: string;
  replaceAccountId?: string;
  refreshEnabled?: boolean;
}) {
  return requestProvider('/api/internal/codex-accounts/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

export async function refreshCodexAccount(accountId: string) {
  return requestProvider(`/api/internal/codex-accounts/${encodeURIComponent(accountId)}/refresh`, {
    method: 'POST'
  });
}

export async function exportCodexAccountAuth(accountId: string) {
  return requestProvider(`/api/internal/codex-accounts/${encodeURIComponent(accountId)}/auth-export`);
}

export async function setCodexAccountEnabled(accountId: string, enabled: boolean) {
  return requestProvider(`/api/internal/codex-accounts/${encodeURIComponent(accountId)}/enabled`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ enabled })
  });
}

export async function removeCodexAccount(accountId: string) {
  return requestProvider(`/api/internal/codex-accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE'
  });
}
