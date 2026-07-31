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
        if (url === '/api/auth/login') {
          return {
            data: {
              code: 0,
              data: {
                Credential: 'webui-credential'
              }
            }
          };
        }
        assert.equal(url, '/api/QQLogin/GetQQLoginQrcode');
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
  assert.equal(calls[0].url, '/api/auth/login');
  assert.equal(
    (calls[0].body as { hash: string }).hash,
    generateNapcatWebuiPasswordHash('secret-token')
  );
  assert.equal(calls[1].url, '/api/QQLogin/GetQQLoginQrcode');
  assert.equal(calls[1].auth, 'Bearer webui-credential');
});

test('NapcatWebuiClient returns login status with existing QR payload', async () => {
  const calls: Array<{ method: string; url: string; body?: unknown; auth?: string }> = [];
  const client = new NapcatWebuiClient({
    token: 'secret-token',
    httpClient: {
      post: async (url: string, body?: unknown, config?: { headers?: Record<string, string> }) => {
        calls.push({ method: 'post', url, body, auth: config?.headers?.Authorization });
        if (url === '/api/auth/login') {
          return {
            data: {
              code: 0,
              data: {
                Credential: 'webui-credential'
              }
            }
          };
        }
        assert.equal(url, '/api/QQLogin/CheckLoginStatus');
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
      },
      get: async (url: string, config?: { headers?: Record<string, string> }) => {
        throw new Error(`unexpected GET ${url} ${config?.headers?.Authorization || ''}`);
      }
    } as never
  });

  const result = await client.checkLoginStatus();

  assert.equal(result.isLogin, false);
  assert.equal(result.qrPayload, 'https://login.qq.example/current');
  assert.equal(calls[0].url, '/api/auth/login');
  assert.equal(calls[1].url, '/api/QQLogin/CheckLoginStatus');
});

// NapCat 把掉线原因放进 data.loginError，顶层 message 恒为 "success"。
// 只读顶层 message 的话，运维面板永远看不到「为什么掉线」。
test('NapcatWebuiClient surfaces data.loginError instead of the useless top-level message', async () => {
  const client = new NapcatWebuiClient({
    token: 'secret-token',
    httpClient: {
      post: async (url: string) => {
        if (url === '/api/auth/login') {
          return { data: { code: 0, data: { Credential: 'webui-credential' } } };
        }
        return {
          data: {
            code: 0,
            message: 'success',
            data: {
              isLogin: false,
              isOffline: false,
              qrcodeurl: '',
              loginError: '[KickedOffLine] [下线通知] 你的账号当前登录已失效，请重新登录。'
            }
          }
        };
      },
      get: async () => {
        throw new Error('unexpected GET');
      }
    } as never
  });

  const result = await client.checkLoginStatus();

  assert.equal(result.isLogin, false);
  assert.equal(result.qrPayload, null);
  assert.equal(result.message, '[KickedOffLine] [下线通知] 你的账号当前登录已失效，请重新登录。');
});

// NapCat 重启会作废已签发的 credential，但本地缓存还有最多 55 分钟才过期。
// 失效响应是 HTTP 200 + {code:-1, message:"Unauthorized"}，必须按 payload 认出来并重认证。
test('NapcatWebuiClient re-authenticates once when NapCat rejects a stale credential', async () => {
  const calls: string[] = [];
  let issuedCredentials = 0;
  const client = new NapcatWebuiClient({
    token: 'secret-token',
    httpClient: {
      post: async (url: string, _body?: unknown, config?: { headers?: Record<string, string> }) => {
        calls.push(`${url} ${config?.headers?.Authorization || ''}`.trim());
        if (url === '/api/auth/login') {
          issuedCredentials += 1;
          return { data: { code: 0, data: { Credential: `credential-${issuedCredentials}` } } };
        }
        if (config?.headers?.Authorization === 'Bearer credential-1') {
          return { data: { code: -1, message: 'Unauthorized' } };
        }
        return { data: { code: 0, data: { isLogin: true } } };
      },
      get: async () => {
        throw new Error('unexpected GET');
      }
    } as never
  });

  const result = await client.checkLoginStatus();

  assert.equal(result.isLogin, true);
  assert.equal(issuedCredentials, 2, '过期 credential 必须换新的重试一次');
  assert.deepEqual(calls, [
    '/api/auth/login',
    '/api/QQLogin/CheckLoginStatus Bearer credential-1',
    '/api/auth/login',
    '/api/QQLogin/CheckLoginStatus Bearer credential-2'
  ]);
});
