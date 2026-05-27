import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createCodexPoolRoutes } from '../routes/codex-pool-routes';

function createLogger(): winston.Logger {
  return winston.createLogger({ silent: true });
}

describe('codex pool routes', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', createCodexPoolRoutes({} as never, createLogger()));
    return app;
  }

  it('proxies status from provider-service', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          available: true,
          totalAccounts: 1
        }
      })
    } as Response) as typeof fetch;

    const response = await request(createApp()).get('/api/codex-pool/status');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      available: true,
      totalAccounts: 1
    });
  });

  it('creates a login session through provider-service', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          authorizeUrl: 'https://auth.openai.com/oauth/authorize?...'
        }
      })
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    const response = await request(createApp())
      .post('/api/codex-pool/login-session')
      .send({});

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/codex-accounts/login-session'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('forwards replaceAccountId when creating relogin session', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          authorizeUrl: 'https://auth.openai.com/oauth/authorize?...'
        }
      })
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    const response = await request(createApp())
      .post('/api/codex-pool/login-session')
      .send({ replaceAccountId: 'acct-1' });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/codex-accounts/login-session'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ redirectUri: undefined, replaceAccountId: 'acct-1' })
      })
    );
  });

  it('removes an account through provider-service', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          removedAccountId: 'acct-1'
        }
      })
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    const response = await request(createApp()).delete('/api/codex-pool/accounts/acct-1');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/codex-accounts/acct-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('imports a session payload through provider-service', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          account: {
            id: 'acct-1',
            email: 'import@example.com'
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

    const response = await request(createApp())
      .post('/api/codex-pool/import')
      .send({
        rawInput: '{"accessToken":"abc"}',
        refreshToken: 'rt__manual'
      });

    expect(response.status).toBe(200);
    expect(response.body.data.account.email).toBe('import@example.com');
    expect(response.body.data.importTest.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/codex-accounts/import'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          rawInput: '{"accessToken":"abc"}',
          refreshToken: 'rt__manual',
          replaceAccountId: undefined,
          refreshEnabled: false
        })
      })
    );
  });

  it('exports auth payload for an account through provider-service', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          last_refresh: '2026-05-09T03:00:00.000Z',
          tokens: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_at: 1
          }
        }
      })
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    const response = await request(createApp()).get('/api/codex-pool/accounts/acct-1/auth-export');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/codex-accounts/acct-1/auth-export'),
      undefined
    );
    expect(response.body.data.tokens.access_token).toBe('access-token');
  });

});
