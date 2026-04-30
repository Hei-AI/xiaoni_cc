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
});
