import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { NapcatWebuiClient, generateNapcatWebuiPasswordHash } from '../napcat-webui-client';

test('generateNapcatWebuiPasswordHash matches NapCat WebUI auth contract', () => {
  assert.equal(
    generateNapcatWebuiPasswordHash('secret-token'),
    createHash('sha256').update('secret-token.napcat').digest('hex')
  );
});

test('NapcatWebuiClient authenticates and requests the current QQ login QR payload', async () => {
  const calls: Array<{ method: string; url: string; body?: unknown; auth?: string }> = [];
  const client = new NapcatWebuiClient({
    token: 'secret-token',
    httpClient: {
      post: async (url: string, body?: unknown, config?: { headers?: Record<string, string> }) => {
        calls.push({ method: 'post', url, body, auth: config?.headers?.Authorization });
        if (url === '/auth/login') {
          return {
            data: {
              code: 0,
              data: {
                Credential: 'webui-credential'
              }
            }
          };
        }
        return {
          data: {
            code: 0,
            data: {
              qrcode: 'https://login.qq.example/scan'
            }
          }
        };
      },
      get: async () => {
        throw new Error('unexpected GET');
      }
    } as never
  });

  const result = await client.requestLoginQrcode();

  assert.equal(result.isLogin, false);
  assert.equal(result.qrPayload, 'https://login.qq.example/scan');
  assert.equal(calls[0].url, '/auth/login');
  assert.equal(
    (calls[0].body as { hash: string }).hash,
    generateNapcatWebuiPasswordHash('secret-token')
  );
  assert.equal(calls[1].url, '/QQLogin/GetQQLoginQrcode');
  assert.equal(calls[1].auth, 'Bearer webui-credential');
});

test('NapcatWebuiClient returns login status with existing QR payload', async () => {
  const client = new NapcatWebuiClient({
    token: 'secret-token',
    httpClient: {
      post: async () => ({
        data: {
          code: 0,
          data: {
            Credential: 'webui-credential'
          }
        }
      }),
      get: async (url: string, config?: { headers?: Record<string, string> }) => {
        assert.equal(url, '/QQLogin/CheckLoginStatus');
        assert.equal(config?.headers?.Authorization, 'Bearer webui-credential');
        return {
          data: {
            code: 0,
            data: {
              isLogin: false,
              qrcodeurl: 'https://login.qq.example/current'
            }
          }
        };
      }
    } as never
  });

  const result = await client.checkLoginStatus();

  assert.equal(result.isLogin, false);
  assert.equal(result.qrPayload, 'https://login.qq.example/current');
});
