import http from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TEST_SITE_KEY = '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';
const TEST_SECRET = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';
const html = readFileSync(new URL('./index.html', import.meta.url));

export function configuration(env = process.env) {
  const mode = env.RECAPTCHA_MODE || 'test';
  if (!['test', 'live'].includes(mode)) throw new Error('RECAPTCHA_MODE must be test or live');
  const siteKey = mode === 'test' ? TEST_SITE_KEY : env.RECAPTCHA_SITE_KEY;
  const secret = mode === 'test' ? TEST_SECRET : env.RECAPTCHA_SECRET_KEY;
  const hostname = env.RECAPTCHA_HOSTNAME;
  if (mode === 'live' && (!siteKey || !secret || !hostname || siteKey === TEST_SITE_KEY || secret === TEST_SECRET)) {
    throw new Error('Live mode requires real SITE_KEY, SECRET_KEY and exact HOSTNAME');
  }
  return { mode, siteKey, secret, hostname, auditFile: env.RECAPTCHA_AUDIT_FILE };
}

export function createServer(config = configuration(), fetchImpl = fetch) {
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }
    if (req.method === 'GET' && req.url === '/config') {
      return json(res, 200, { mode: config.mode, siteKey: config.siteKey });
    }
    if (req.method !== 'POST' || req.url !== '/verify') return json(res, 404, { error: 'not_found' });
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 16384) return json(res, 413, { error: 'request_too_large' });
      }
      let parsed;
      try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: 'invalid_json' }); }
      const token = parsed?.token;
      if (typeof token !== 'string' || !token.trim()) return json(res, 400, { success: false, error: 'missing_token' });
      const response = await fetchImpl('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: config.secret, response: token }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('Google verification unavailable');
      const verdict = await response.json();
      const hostnameMatches = config.mode === 'test' || verdict.hostname === config.hostname;
      const result = {
        success: verdict.success === true && hostnameMatches,
        mode: config.mode,
        liveVerification: config.mode === 'live' && verdict.success === true && hostnameMatches,
        hostname: verdict.hostname || null,
        challengeTimestamp: verdict.challenge_ts || null,
        errors: !hostnameMatches ? ['hostname_mismatch'] : (verdict['error-codes'] || []),
        verifiedAt: new Date().toISOString()
      };
      // Never record response tokens or the secret key.
      if (config.auditFile) appendFileSync(config.auditFile, `${JSON.stringify(result)}\n`, { mode: 0o600 });
      return json(res, 200, result);
    } catch {
      return json(res, 502, { success: false, error: 'verification_unavailable' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = configuration();
  const port = Number(process.env.RECAPTCHA_PORT || 18764);
  const host = process.env.RECAPTCHA_BIND || '127.0.0.1';
  createServer(config).listen(port, host, () => console.log(`reCAPTCHA lab: http://${host}:${port} (${config.mode})`));
}
