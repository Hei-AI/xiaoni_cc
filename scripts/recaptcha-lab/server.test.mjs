import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, configuration, TEST_SITE_KEY } from './server.mjs';

async function probe(t, config, upstream) {
  const server = createServer(config, upstream);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, verify: token => fetch(`${base}/verify`, {
    method: 'POST', body: JSON.stringify({ token })
  }).then(async r => ({ status: r.status, body: await r.json() })) };
}
test('live mode cannot silently use test credentials', () => {
  assert.throws(() => configuration({ RECAPTCHA_MODE: 'live' }));
  assert.throws(() => configuration({ RECAPTCHA_MODE: 'live', RECAPTCHA_SITE_KEY: TEST_SITE_KEY, RECAPTCHA_SECRET_KEY: 'secret', RECAPTCHA_HOSTNAME: 'localhost' }));
});
test('missing tokens never contact Google; client config never exposes secret', async t => {
  const { base, verify } = await probe(t, configuration({}), () => { throw new Error('must not call'); });
  assert.equal((await verify('')).status, 400);
  assert.deepEqual(await fetch(`${base}/config`).then(r => r.json()), { mode: 'test', siteKey: TEST_SITE_KEY });
});
test('Google success in official test mode is labeled test only', async t => {
  const { verify } = await probe(t, configuration({}), async (url, options) => {
    assert.equal(url, 'https://www.google.com/recaptcha/api/siteverify');
    assert.equal(options.body.get('response'), 'browser-response');
    return Response.json({ success: true, hostname: 'testkey.google.com' });
  });
  const { body } = await verify('browser-response');
  assert.equal(body.success, true);
  assert.equal(body.liveVerification, false);
});
test('live verification rejects mismatched hostname and Google rejection', async t => {
  const config = configuration({ RECAPTCHA_MODE: 'live', RECAPTCHA_SITE_KEY: 'site', RECAPTCHA_SECRET_KEY: 'secret', RECAPTCHA_HOSTNAME: 'localhost' });
  for (const verdict of [{ success: true, hostname: 'elsewhere' }, { success: false, hostname: 'localhost', 'error-codes': ['timeout-or-duplicate'] }]) {
    const { verify } = await probe(t, config, async () => Response.json(verdict));
    assert.equal((await verify('response')).body.success, false);
  }
  const { verify } = await probe(t, config, async () => Response.json({ success: true, hostname: 'localhost' }));
  assert.equal((await verify('response')).body.liveVerification, true);
});
test('upstream outage cannot report success', async t => {
  const { verify } = await probe(t, configuration({}), async () => { throw new Error('offline'); });
  const result = await verify('response');
  assert.equal(result.status, 502);
  assert.equal(result.body.success, false);
});
