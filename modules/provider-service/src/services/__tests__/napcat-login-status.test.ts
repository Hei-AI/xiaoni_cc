import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNapcatLoginStatus, NapcatLoginStatusDeps } from '../napcat-login-status';

const KICKED_OFF_LINE = '[KickedOffLine] [下线通知] 你的账号当前登录已失效，请重新登录。';

function buildDeps(overrides: {
  probe?: NapcatLoginStatusDeps['probe'];
  isConfigured?: boolean;
  checkLoginStatus?: NapcatLoginStatusDeps['webui']['checkLoginStatus'];
  requestLoginQrcode?: NapcatLoginStatusDeps['webui']['requestLoginQrcode'];
}): NapcatLoginStatusDeps {
  return {
    probe: overrides.probe
      ?? (async () => ({ reachable: true, selfId: 1129974489 })),
    webui: {
      isConfigured: () => overrides.isConfigured ?? true,
      checkLoginStatus: overrides.checkLoginStatus
        ?? (async () => { throw new Error('checkLoginStatus not stubbed'); }),
      requestLoginQrcode: overrides.requestLoginQrcode
        ?? (async () => { throw new Error('requestLoginQrcode not stubbed'); })
    }
  };
}

// 回归用例：账号被踢下线后 NapCat 进程仍在跑，OneBot get_login_info 照常返回 user_id，
// 于是 probe.reachable=true。旧实现拿 reachable 当已登录并直接早退，管理端因此在
// 唯一需要扫码的时刻报「已登录」并拒绝出码。
test('掉线但端口仍可达时不得判为已登录', async () => {
  let webuiAsked = false;
  const payload = await resolveNapcatLoginStatus(buildDeps({
    probe: async () => ({ reachable: true, selfId: 1129974489 }),
    checkLoginStatus: async () => {
      webuiAsked = true;
      return { isLogin: false, qrPayload: 'https://txz.qq.com/p?k=scan-me', message: KICKED_OFF_LINE };
    }
  }), false);

  assert.equal(webuiAsked, true, 'reachable 时也必须问 WebUI，不能早退');
  assert.equal(payload.napcatReachable, true);
  assert.equal(payload.qqLoggedIn, false);
  assert.equal(payload.qrAvailable, true);
  assert.equal(payload.qrPayload, 'https://txz.qq.com/p?k=scan-me');
  assert.equal(payload.message, KICKED_OFF_LINE);
});

test('WebUI 报已登录时不出二维码', async () => {
  const payload = await resolveNapcatLoginStatus(buildDeps({
    checkLoginStatus: async () => ({ isLogin: true, qrPayload: null, message: null })
  }), true);

  assert.equal(payload.qqLoggedIn, true);
  assert.equal(payload.qrAvailable, false);
  assert.equal(payload.qrPayload, null);
  assert.equal(payload.qqAccountId, '1129974489');
  assert.equal(payload.message, null);
});

test('刷新二维码时向 WebUI 要一张新的', async () => {
  let qrRequested = 0;
  const payload = await resolveNapcatLoginStatus(buildDeps({
    checkLoginStatus: async () => ({ isLogin: false, qrPayload: null, message: KICKED_OFF_LINE }),
    requestLoginQrcode: async () => {
      qrRequested += 1;
      return { isLogin: false, qrPayload: 'https://txz.qq.com/p?k=fresh', message: null };
    }
  }), true);

  assert.equal(qrRequested, 1);
  assert.equal(payload.qrPayload, 'https://txz.qq.com/p?k=fresh');
  assert.equal(payload.qrAvailable, true);
});

// 被踢下线后 NapCat 停在终态，GetQQLoginQrcode 回 "QRCode Get Error"。
// 面板必须同时拿到掉线原因和「重启才能恢复」这个可执行结论，而不是空白的「二维码暂不可用」。
test('NapCat 吐不出二维码时给出掉线原因和重启提示', async () => {
  const payload = await resolveNapcatLoginStatus(buildDeps({
    checkLoginStatus: async () => ({ isLogin: false, qrPayload: null, message: KICKED_OFF_LINE }),
    requestLoginQrcode: async () => { throw new Error('QRCode Get Error'); }
  }), true);

  assert.equal(payload.qqLoggedIn, false);
  assert.equal(payload.qrAvailable, false);
  assert.ok(payload.message?.includes(KICKED_OFF_LINE), '要保留掉线原因');
  assert.ok(payload.message?.includes('重启 napcat 容器'), '要给出可执行的下一步');
});

test('WebUI 未配置时退回端口探针并说明原因', async () => {
  const payload = await resolveNapcatLoginStatus(buildDeps({
    isConfigured: false,
    probe: async () => ({ reachable: false, error: 'connect ECONNREFUSED' })
  }), false);

  assert.equal(payload.webuiConfigured, false);
  assert.equal(payload.qqLoggedIn, false);
  assert.equal(payload.message, 'NapCat WebUI token is not configured');
});

test('WebUI 认证失败时报错而不是谎称已登录', async () => {
  const payload = await resolveNapcatLoginStatus(buildDeps({
    probe: async () => ({ reachable: true, selfId: 1129974489 }),
    checkLoginStatus: async () => { throw new Error('token is invalid'); }
  }), false);

  assert.equal(payload.qqLoggedIn, false);
  assert.equal(payload.message, 'token is invalid');
});
