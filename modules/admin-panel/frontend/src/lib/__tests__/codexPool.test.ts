import {
  createCodexLoginSession,
  exportCodexAccountAuth,
  fetchCodexAccounts,
  fetchCodexPoolStatus,
  importCodexAccount,
  removeCodexAccount
} from '../codexPool';

describe('codexPool helpers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('loads status from the backend', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          available: true,
          storeDir: '/root/.qqbot-local/codex-accounts',
          activeAccountId: null,
          totalAccounts: 1,
          enabledAccounts: 1,
          readyAccounts: 1,
          accounts: []
        }
      })
    } as Response) as typeof fetch;

    await expect(fetchCodexPoolStatus()).resolves.toMatchObject({
      success: true,
      data: {
        totalAccounts: 1
      }
    });
  });

  it('loads accounts from the backend', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'acct-1',
            email: 'user@example.com',
            accountId: 'acct_provider_1',
            priorityOrder: 0,
            enabled: true,
            refreshEnabled: true,
            status: 'ready',
            isActive: true,
            expiresAt: new Date().toISOString(),
            cooldownUntil: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastActivatedAt: null,
            lastUsedAt: null,
            lastRefreshAttemptAt: null,
            lastRefreshSucceededAt: null,
            refreshFailureCode: null,
            refreshFailureAt: null,
            lastError: null,
            stats: {
              successCount: 0,
              errorCount: 0,
              quotaExceededCount: 0
            },
            rateLimits: {
              primary: {
                usedPercent: 25,
                windowDurationMins: 300,
                resetsAt: new Date().toISOString()
              },
              secondary: {
                usedPercent: 10,
                windowDurationMins: 10080,
                resetsAt: new Date().toISOString()
              },
              checkedAt: new Date().toISOString()
            }
          }
        ]
      })
    } as Response) as typeof fetch;

    await expect(fetchCodexAccounts()).resolves.toMatchObject({
      success: true,
      data: [
        expect.objectContaining({
          id: 'acct-1'
        })
      ]
    });
  });

  it('creates a login session via POST', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: 'session-1',
          state: 'state-1',
          redirectUri: 'http://localhost:1455/auth/callback',
          authorizeUrl: 'https://auth.openai.com/oauth/authorize?...',
          expiresAt: new Date().toISOString()
        }
      })
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    const result = await createCodexLoginSession();

    expect(fetchMock).toHaveBeenCalledWith('/api/codex-pool/login-session', expect.objectContaining({
      method: 'POST'
    }));
    expect(result.success).toBe(true);
  });

  it('forwards replaceAccountId when creating a relogin session', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: 'session-2',
          state: 'state-2',
          redirectUri: 'http://localhost:1455/auth/callback',
          authorizeUrl: 'https://auth.openai.com/oauth/authorize?...',
          expiresAt: new Date().toISOString()
        }
      })
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    await createCodexLoginSession({ replaceAccountId: 'acct-1' });

    expect(fetchMock).toHaveBeenCalledWith('/api/codex-pool/login-session', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ redirectUri: undefined, replaceAccountId: 'acct-1' })
    }));
  });

  it('removes an account via DELETE', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          removedAccountId: 'acct-1'
        }
      })
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    await removeCodexAccount('acct-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/codex-pool/accounts/acct-1', expect.objectContaining({
      method: 'DELETE'
    }));
  });

  it('imports a session payload via POST', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          account: {
            id: 'acct-1'
          },
          importTest: {
            success: true,
            provider: 'codex-direct',
            model: 'gpt-5.4-mini',
            durationMs: 123,
            response: 'hi',
            error: null,
            statusCode: 200
          }
        }
      })
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    await importCodexAccount({
      rawInput: '{"accessToken":"abc"}',
      refreshToken: 'rt__manual',
      refreshEnabled: false
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/codex-pool/import', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        rawInput: '{"accessToken":"abc"}',
        refreshToken: 'rt__manual',
        refreshEnabled: false
      })
    }));
    await expect(importCodexAccount({
      rawInput: '{"accessToken":"abc"}',
      refreshToken: 'rt__manual',
      refreshEnabled: false
    })).resolves.toMatchObject({
      success: true,
      data: {
        account: {
          id: 'acct-1'
        },
        importTest: {
          success: true
        }
      }
    });
  });

  it('loads auth export payload for a specific account', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          last_refresh: new Date().toISOString(),
          tokens: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_at: Date.now()
          }
        }
      })
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    await expect(exportCodexAccountAuth('acct-1')).resolves.toMatchObject({
      success: true,
      data: {
        auth_mode: 'chatgpt'
      }
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/codex-pool/accounts/acct-1/auth-export', undefined);
  });
});
