import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QqProfileService, QqProfileSkillRuntime, QQ_PROFILE_ACTIONS } from '../services/qq-profile-service';

type Captured = { url: string; body: any };

function fakeFetch(captured: Captured[]) {
  return (async (url: string, init: { body: string }) => {
    captured.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: { result: 0 } }) };
  }) as any;
}

test('set_signature posts long_nick to provider (empty string clears, is not dropped)', async () => {
  const captured: Captured[] = [];
  const service = new QqProfileService({ providerServiceUrl: 'http://provider', fetchImpl: fakeFetch(captured) });

  const ok = await service.setSignature({ text: '今天也在好好生活' });
  assert.notEqual(ok.failed, true);
  assert.equal(captured[0].url, 'http://provider/api/internal/set_self_longnick');
  assert.equal(captured[0].body.long_nick, '今天也在好好生活');

  const cleared = await service.setSignature({ text: '' });
  assert.notEqual(cleared.failed, true);
  assert.equal(captured[1].body.long_nick, '', 'empty string reaches provider (clear), not stripped');
});

test('set_status maps names to NapCat enum codes and posts', async () => {
  const captured: Captured[] = [];
  const service = new QqProfileService({ providerServiceUrl: 'http://provider', fetchImpl: fakeFetch(captured) });

  const cases: Array<[string, number]> = [
    ['online', 10], ['away', 30], ['invisible', 40], ['busy', 50], ['qme', 60], ['dnd', 70]
  ];
  for (const [name, code] of cases) {
    captured.length = 0;
    const res = await service.setStatus({ status: name });
    assert.notEqual(res.failed, true, `${name} ok`);
    assert.equal(captured[0].url, 'http://provider/api/internal/set_online_status');
    assert.equal(captured[0].body.status, code, `${name} -> ${code}`);
    assert.equal(captured[0].body.ext_status, 0);
  }
});

test('set_status accepts a raw numeric enum + ext_status', async () => {
  const captured: Captured[] = [];
  const service = new QqProfileService({ providerServiceUrl: 'http://provider', fetchImpl: fakeFetch(captured) });
  const res = await service.setStatus({ status: '10', ext_status: '1027' });
  assert.notEqual(res.failed, true);
  assert.equal(captured[0].body.status, 10);
  assert.equal(captured[0].body.ext_status, 1027);
});

test('set_status rejects an unknown status name', async () => {
  const service = new QqProfileService({ providerServiceUrl: 'http://provider', fetchImpl: fakeFetch([]) });
  const runtime = new QqProfileSkillRuntime(service);
  const res = await runtime.execute('set_status', { status: 'nonsense' });
  assert.equal(res.failed, true);
  assert.match(res.content, /unsupported status/);
});

test('set_avatar reads a file under runtime root, base64s it, posts data_url', async () => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qqprofile-'));
  try {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 9)
    ]);
    const avatarPath = path.join(runtimeRoot, 'avatar.png');
    await fs.writeFile(avatarPath, png);

    const captured: Captured[] = [];
    const service = new QqProfileService({
      providerServiceUrl: 'http://provider',
      runtimeRoot,
      allowedRoots: [runtimeRoot],
      fetchImpl: fakeFetch(captured)
    });

    const res = await service.setAvatar({ file: avatarPath });
    assert.notEqual(res.failed, true);
    assert.equal(captured[0].url, 'http://provider/api/internal/set_qq_avatar');
    assert.match(captured[0].body.data_url, /^data:image\/png;base64,/);
    assert.equal(captured[0].body.data_url, `data:image/png;base64,${png.toString('base64')}`);
  } finally {
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('set_avatar refuses a path outside the allowed roots (no traversal)', async () => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qqprofile-'));
  try {
    const service = new QqProfileService({
      providerServiceUrl: 'http://provider',
      runtimeRoot,
      allowedRoots: [runtimeRoot],
      fetchImpl: fakeFetch([])
    });
    const runtime = new QqProfileSkillRuntime(service);
    const res = await runtime.execute('set_avatar', { file: '/etc/hostname' });
    assert.equal(res.failed, true);
  } finally {
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
});

function fakeFetchReturning(captured: Captured[], data: any) {
  return (async (url: string, init: { body: string }) => {
    captured.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) };
  }) as any;
}

test('view_profile with no qq defaults to the bot self and renders a card', async () => {
  const captured: Captured[] = [];
  const service = new QqProfileService({
    providerServiceUrl: 'http://provider',
    botAccountId: '1129974489',
    fetchImpl: fakeFetchReturning(captured, {
      user_id: 1129974489, nickname: '小腻', long_nick: '在好好生活', status: 50, avatar_url: 'https://q1.qlogo.cn/g?b=qq&nk=1129974489&s=640'
    })
  });
  const res = await service.getProfile({});
  assert.notEqual(res.failed, true);
  assert.equal(captured[0].url, 'http://provider/api/internal/get_profile');
  assert.equal(captured[0].body.user_id, 1129974489, 'no qq -> self bot id');
  assert.match(res.content, /who="self"/);
  assert.match(res.content, /signature="在好好生活"/);
  assert.match(res.content, /busy 忙碌/, 'status code 50 -> human word');
});

test('view_profile shows 在线 for the default resting status (nc returns 0 or null, not a set enum)', async () => {
  for (const restStatus of [0, null]) {
    const captured: Captured[] = [];
    const service = new QqProfileService({
      providerServiceUrl: 'http://provider',
      botAccountId: '1129974489',
      fetchImpl: fakeFetchReturning(captured, { user_id: 1129974489, nickname: '小腻', long_nick: 'x', status: restStatus })
    });
    const res = await service.getProfile({});
    assert.notEqual(res.failed, true, `restStatus=${restStatus}`);
    assert.match(res.content, /online_status="online 在线"/, `restStatus=${restStatus} -> 在线`);
    assert.doesNotMatch(res.content, /status=0/, `restStatus=${restStatus} must not leak raw status=0`);
  }
});

test('view_profile <qq> targets another user and marks it read-only', async () => {
  const captured: Captured[] = [];
  const service = new QqProfileService({
    providerServiceUrl: 'http://provider',
    botAccountId: '1129974489',
    fetchImpl: fakeFetchReturning(captured, { user_id: 85178516, nickname: '阿花', long_nick: '', status: 10 })
  });
  const res = await service.getProfile({ qq: '85178516' });
  assert.notEqual(res.failed, true);
  assert.equal(captured[0].body.user_id, 85178516);
  assert.match(res.content, /who="other"/);
  assert.match(res.content, /online 在线/);
});

test('QQ_PROFILE_ACTIONS is exactly the four profile actions', () => {
  assert.deepEqual([...QQ_PROFILE_ACTIONS].sort(), ['set_avatar', 'set_signature', 'set_status', 'view_profile']);
});
