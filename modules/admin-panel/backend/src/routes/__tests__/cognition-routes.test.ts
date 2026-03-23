import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createCognitionRoutes } from '../cognition-routes';

describe('cognition proactivity routes', () => {
  const fetchMock = jest.fn();
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  } as unknown as winston.Logger;

  beforeAll(() => {
    (global as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    (logger.error as jest.Mock).mockClear();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', createCognitionRoutes({} as any, logger));
    return app;
  }

  it('proxies GET /cognition/proactivity to qqbot-core', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: {
          followupEnabled: true,
          isPaused: false
        }
      })
    });

    const response = await request(createApp()).get('/api/cognition/proactivity');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/proactivity'),
      undefined
    );
  });

  it('normalizes PATCH /cognition/proactivity payload before proxying', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: {
          followupEnabled: true
        }
      })
    });

    const response = await request(createApp())
      .patch('/api/cognition/proactivity')
      .send({
        followup_enabled: 'true',
        is_paused: 0,
        allowed_user_ids: '85178516, 85178516,3450948895',
        max_per_run: '2',
        retry_delay_ms: '120000'
      });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/internal/proactivity');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      followup_enabled: true,
      is_paused: false,
      allowed_user_ids: [85178516, 3450948895],
      max_per_run: 2,
      retry_delay_ms: 120000
    });
  });

  it('rejects invalid PATCH /cognition/proactivity payloads before proxying', async () => {
    const response = await request(createApp())
      .patch('/api/cognition/proactivity')
      .send({
        followup_enabled: 'maybe'
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('followup_enabled must be a boolean');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
