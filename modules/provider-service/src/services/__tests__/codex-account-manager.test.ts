import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CodexAccountManager } from '../codex-account-manager';

function makeJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

async function createTempManager() {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-account-store-'));
  const activeAuthPath = path.join(storeDir, 'active-auth.json');
  return {
    storeDir,
    activeAuthPath,
    manager: new CodexAccountManager({ storeDir, activeAuthPath })
  };
}

test('CodexAccountManager creates PKCE login sessions', async () => {
  const { manager, storeDir } = await createTempManager();
  const session = await manager.createLoginSession();

  assert.equal(typeof session.authorizeUrl, 'string');
  assert.match(session.authorizeUrl, /auth\.openai\.com\/oauth\/authorize/);
  assert.match(session.authorizeUrl, new RegExp(`state=${session.state}`));
  const sessionFile = path.join(storeDir, 'login-sessions', `${session.state}.json`);
  const raw = await fs.readFile(sessionFile, 'utf8');
  assert.match(raw, /codeVerifier/);
});

test('CodexAccountManager completes OAuth login and projects the first account to auth.json', async () => {
  const { manager, activeAuthPath } = await createTempManager();
  const session = await manager.createLoginSession();
  const accessToken = makeJwt({
    email: 'first@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_first'
    }
  });
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({
    access_token: accessToken,
    refresh_token: 'refresh_first',
    expires_in: 3600,
    id_token: makeJwt({ email: 'first@example.com' })
  }), { status: 200 })) as typeof fetch;

  try {
    const account = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_first&state=${session.state}`
    });

    assert.equal(account.accountId, 'acct_first');
    assert.equal(account.isActive, true);

    const projected = JSON.parse(await fs.readFile(activeAuthPath, 'utf8'));
    assert.equal(projected.tokens.access_token, accessToken);
    assert.equal(projected.tokens.refresh_token, 'refresh_first');
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager switches to a backup account after quota exhaustion', async () => {
  const { manager, activeAuthPath } = await createTempManager();
  const originalFetch = global.fetch;

  const firstSession = await manager.createLoginSession();
  const secondSession = await manager.createLoginSession();
  const firstAccess = makeJwt({
    email: 'first@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_first'
    }
  });
  const secondAccess = makeJwt({
    email: 'second@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_second'
    }
  });

  const tokenResponses = [
    {
      access_token: firstAccess,
      refresh_token: 'refresh_first',
      expires_in: 3600,
      id_token: makeJwt({ email: 'first@example.com' })
    },
    {
      access_token: secondAccess,
      refresh_token: 'refresh_second',
      expires_in: 3600,
      id_token: makeJwt({ email: 'second@example.com' })
    }
  ];

  global.fetch = (async () => new Response(JSON.stringify(tokenResponses.shift()), { status: 200 })) as typeof fetch;

  try {
    await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_first&state=${firstSession.state}`
    });
    const secondAccount = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_second&state=${secondSession.state}`
    });

    const switched = await manager.handleQuotaExceeded('acct_first', 'usage_limit_reached');
    assert.equal(switched.switched, true);
    assert.equal(switched.nextAccountId, secondAccount.id);

    const projected = JSON.parse(await fs.readFile(activeAuthPath, 'utf8'));
    assert.equal(projected.tokens.access_token, secondAccess);
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager relogin replaces an existing account in place', async () => {
  const { manager } = await createTempManager();
  const originalFetch = global.fetch;

  const firstSession = await manager.createLoginSession();
  const firstAccess = makeJwt({
    email: 'first@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_first'
    }
  });

  global.fetch = (async () => new Response(JSON.stringify({
    access_token: firstAccess,
    refresh_token: 'refresh_first',
    expires_in: 3600,
    id_token: makeJwt({ email: 'first@example.com' })
  }), { status: 200 })) as typeof fetch;

  try {
    const created = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_first&state=${firstSession.state}`
    });

    const reloginSession = await manager.createLoginSession({ replaceAccountId: created.id });
    const refreshedAccess = makeJwt({
      email: 'first+relogin@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_first_new'
      }
    });

    global.fetch = (async () => new Response(JSON.stringify({
      access_token: refreshedAccess,
      refresh_token: 'refresh_second',
      expires_in: 3600,
      id_token: makeJwt({ email: 'first+relogin@example.com' })
    }), { status: 200 })) as typeof fetch;

    const replaced = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_second&state=${reloginSession.state}`
    });

    assert.equal(replaced.id, created.id);
    assert.equal(replaced.email, 'first+relogin@example.com');
    assert.equal(replaced.accountId, 'acct_first_new');

    const accounts = await manager.listAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]?.id, created.id);
    assert.equal(accounts[0]?.email, 'first+relogin@example.com');
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager removes active account and clears projected auth when no backup exists', async () => {
  const { manager, activeAuthPath } = await createTempManager();
  const session = await manager.createLoginSession();
  const accessToken = makeJwt({
    email: 'solo@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_solo'
    }
  });
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({
    access_token: accessToken,
    refresh_token: 'refresh_solo',
    expires_in: 3600,
    id_token: makeJwt({ email: 'solo@example.com' })
  }), { status: 200 })) as typeof fetch;

  try {
    const created = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_solo&state=${session.state}`
    });

    await manager.removeAccount(created.id);

    const accounts = await manager.listAccounts();
    assert.equal(accounts.length, 0);
    await assert.rejects(() => fs.readFile(activeAuthPath, 'utf8'));
  } finally {
    global.fetch = originalFetch;
  }
});
