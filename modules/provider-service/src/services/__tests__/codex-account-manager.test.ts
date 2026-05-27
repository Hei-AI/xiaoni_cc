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

test('CodexAccountManager prefers lower priorityOrder during quota failover', async () => {
  const { manager, storeDir } = await createTempManager();
  const originalFetch = global.fetch;

  const firstSession = await manager.createLoginSession();
  const secondSession = await manager.createLoginSession();
  const thirdSession = await manager.createLoginSession();
  const tokenResponses = [
    {
      access_token: makeJwt({
        email: 'active@example.com',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_active_priority'
        }
      }),
      refresh_token: 'refresh_active_priority',
      expires_in: 3600,
      id_token: makeJwt({ email: 'active@example.com' })
    },
    {
      access_token: makeJwt({
        email: 'low@example.com',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_low_priority'
        }
      }),
      refresh_token: 'refresh_low_priority',
      expires_in: 3600,
      id_token: makeJwt({ email: 'low@example.com' })
    },
    {
      access_token: makeJwt({
        email: 'high@example.com',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct_high_priority'
        }
      }),
      refresh_token: 'refresh_high_priority',
      expires_in: 3600,
      id_token: makeJwt({ email: 'high@example.com' })
    }
  ];

  global.fetch = (async () => new Response(JSON.stringify(tokenResponses.shift()), { status: 200 })) as typeof fetch;

  try {
    const active = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_active&state=${firstSession.state}`
    });
    const lowPriority = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_low&state=${secondSession.state}`
    });
    const highPriority = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_high&state=${thirdSession.state}`
    });

    await manager.reorderAccounts([active.id, highPriority.id, lowPriority.id]);
    const switched = await manager.handleQuotaExceeded('acct_active_priority', 'usage_limit_reached');

    assert.equal(switched.switched, true);
    assert.equal(switched.nextAccountId, highPriority.id);

    const storedHighPriority = JSON.parse(await fs.readFile(
      path.join(storeDir, 'accounts', `${highPriority.id}.json`),
      'utf8'
    ));
    const storedLowPriority = JSON.parse(await fs.readFile(
      path.join(storeDir, 'accounts', `${lowPriority.id}.json`),
      'utf8'
    ));
    assert.equal(storedHighPriority.priorityOrder, 1);
    assert.equal(storedLowPriority.priorityOrder, 2);
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

test('CodexAccountManager syncs refreshed active credentials back into the managed account store', async () => {
  const { manager, storeDir } = await createTempManager();
  const session = await manager.createLoginSession();
  const originalFetch = global.fetch;
  const initialAccess = makeJwt({
    email: 'sync@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_sync'
    }
  });

  global.fetch = (async () => new Response(JSON.stringify({
    access_token: initialAccess,
    refresh_token: 'refresh_initial',
    expires_in: 3600,
    id_token: makeJwt({ email: 'sync@example.com' })
  }), { status: 200 })) as typeof fetch;

  try {
    const created = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_sync&state=${session.state}`
    });

    const refreshedAccess = makeJwt({
      email: 'sync@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_sync'
      }
    });
    const refreshedExpiry = Date.now() + 7200_000;

    await manager.syncActiveCredential({
      access: refreshedAccess,
      refresh: 'refresh_updated',
      expires: refreshedExpiry,
      accountId: 'acct_sync'
    });

    const stored = JSON.parse(await fs.readFile(
      path.join(storeDir, 'accounts', `${created.id}.json`),
      'utf8'
    ));
    assert.equal(stored.access, refreshedAccess);
    assert.equal(stored.refresh, 'refresh_updated');
    assert.equal(stored.expires, refreshedExpiry);
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager exports auth.json payload for any managed account', async () => {
  const { manager } = await createTempManager();
  const session = await manager.createLoginSession();
  const accessToken = makeJwt({
    email: 'export@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_export'
    }
  });
  const idToken = makeJwt({ email: 'export@example.com' });
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({
    access_token: accessToken,
    refresh_token: 'refresh_export',
    expires_in: 3600,
    id_token: idToken
  }), { status: 200 })) as typeof fetch;

  try {
    const created = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_export&state=${session.state}`
    });

    const exported = await manager.exportAccountAuth(created.id);
    assert.equal(exported.auth_mode, 'chatgpt');
    assert.equal(exported.OPENAI_API_KEY, null);
    assert.equal(exported.tokens.access_token, accessToken);
    assert.equal(exported.tokens.refresh_token, 'refresh_export');
    assert.equal(exported.tokens.account_id, 'acct_export');
    assert.equal(exported.tokens.id_token, idToken);
    assert.equal(typeof exported.last_refresh, 'string');
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager selects inactive enabled backup accounts for background refresh when near expiry', async () => {
  const { manager } = await createTempManager();
  const originalFetch = global.fetch;
  const now = Date.now();
  const firstSession = await manager.createLoginSession();
  const secondSession = await manager.createLoginSession();
  const firstAccess = makeJwt({
    email: 'active@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_active'
    }
  });
  const secondAccess = makeJwt({
    email: 'backup@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_backup'
    }
  });
  const tokenResponses = [
    {
      access_token: firstAccess,
      refresh_token: 'refresh_active',
      expires_in: 3600,
      id_token: makeJwt({ email: 'active@example.com' })
    },
    {
      access_token: secondAccess,
      refresh_token: 'refresh_backup',
      expires_in: 3600,
      id_token: makeJwt({ email: 'backup@example.com' })
    }
  ];

  global.fetch = (async () => new Response(JSON.stringify(tokenResponses.shift()), { status: 200 })) as typeof fetch;

  try {
    const active = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_active&state=${firstSession.state}`
    });
    const backup = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_backup&state=${secondSession.state}`
    });

    await manager.activateAccount(active.id);

    const backupFile = path.join((manager as any).accountsDir, `${backup.id}.json`);
    const storedBackup = JSON.parse(await fs.readFile(backupFile, 'utf8'));
    storedBackup.expires = now + (5 * 60 * 1000);
    await fs.writeFile(backupFile, `${JSON.stringify(storedBackup, null, 2)}\n`, 'utf8');

    const candidates = await manager.listAccountsNeedingRefresh({
      nowMs: now,
      refreshThresholdMs: 30 * 60 * 1000
    });

    assert.equal(candidates.some((item) => item.id === backup.id), true);
    assert.equal(candidates.some((item) => item.id === active.id), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager marks refresh-token auth failures as reauth required', async () => {
  const { manager, storeDir } = await createTempManager();
  const session = await manager.createLoginSession();
  const originalFetch = global.fetch;
  const accessToken = makeJwt({
    email: 'expired@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_expired'
    }
  });

  global.fetch = (async () => new Response(JSON.stringify({
    access_token: accessToken,
    refresh_token: 'refresh_expired',
    expires_in: 3600,
    id_token: makeJwt({ email: 'expired@example.com' })
  }), { status: 200 })) as typeof fetch;

  try {
    const created = await manager.completeLogin({
      callbackUrl: `http://localhost:1455/auth/callback?code=code_expired&state=${session.state}`
    });

    global.fetch = (async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'refresh_token_reused'
    }), { status: 400 })) as typeof fetch;

    await assert.rejects(() => manager.refreshAccount(created.id, {
      trigger: 'background-sweep'
    }));

    const stored = JSON.parse(await fs.readFile(
      path.join(storeDir, 'accounts', `${created.id}.json`),
      'utf8'
    ));
    assert.equal(stored.refreshFailureCode, 'reauth_required');
    assert.equal(typeof stored.refreshFailureAt, 'string');

    const accounts = await manager.listAccounts();
    assert.equal(accounts[0]?.status, 'reauth_required');
    assert.equal(accounts[0]?.refreshFailureCode, 'reauth_required');
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager imports session JSON with a manually supplied refresh token', async () => {
  const { manager, activeAuthPath } = await createTempManager();
  const accessToken = makeJwt({
    email: 'import@example.com',
    exp: Math.floor((Date.now() + 3600_000) / 1000),
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_import'
    }
  });

  const originalFetch = global.fetch;
  global.fetch = (async () => new Response([
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"status":"completed"}}',
    ''
  ].join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream'
    }
  })) as typeof fetch;

  try {
    const result = await manager.importAccount({
    rawInput: JSON.stringify({
      user: { email: 'import@example.com' },
      accessToken,
      sessionToken: 'session-token',
      account: {
        id: 'acct_import'
      }
    }),
    refreshToken: 'rt__manual_import'
    });
    const imported = result.account;

    assert.equal(imported.accountId, 'acct_import');
    assert.equal(imported.email, 'import@example.com');
    assert.equal(imported.isActive, true);
    assert.equal(imported.refreshEnabled, false);
    assert.deepEqual(result.importTest, {
      success: true,
      provider: 'codex-direct',
      model: 'gpt-5.4-mini',
      durationMs: result.importTest.durationMs,
      response: 'hi',
      error: null,
      statusCode: 200
    });

    const candidates = await manager.listAccountsNeedingRefresh({
      nowMs: Date.now(),
      refreshThresholdMs: 24 * 60 * 60 * 1000
    });
    assert.equal(candidates.some((item) => item.accountId === 'acct_import'), false);

    const projected = JSON.parse(await fs.readFile(activeAuthPath, 'utf8'));
    assert.equal(projected.tokens.access_token, accessToken);
    assert.equal(projected.tokens.refresh_token, 'rt__manual_import');
    assert.equal(projected.tokens.account_id, 'acct_import');
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager keeps same-workspace imports separate when emails differ', async () => {
  const { manager } = await createTempManager();
  const sharedWorkspaceAccountId = 'acct_workspace_shared';
  const originalFetch = global.fetch;

  global.fetch = (async () => new Response([
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"status":"completed"}}',
    ''
  ].join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream'
    }
  })) as typeof fetch;

  try {
    const first = await manager.importAccount({
      rawInput: JSON.stringify({
        user: { email: 'workspace-member-1@example.com' },
        accessToken: makeJwt({
          email: 'workspace-member-1@example.com',
          exp: Math.floor((Date.now() + 3600_000) / 1000),
          'https://api.openai.com/auth': {
            chatgpt_account_id: sharedWorkspaceAccountId
          }
        }),
        account: {
          id: sharedWorkspaceAccountId
        }
      })
    });

    const second = await manager.importAccount({
      rawInput: JSON.stringify({
        user: { email: 'workspace-member-2@example.com' },
        accessToken: makeJwt({
          email: 'workspace-member-2@example.com',
          exp: Math.floor((Date.now() + 3600_000) / 1000),
          'https://api.openai.com/auth': {
            chatgpt_account_id: sharedWorkspaceAccountId
          }
        }),
        account: {
          id: sharedWorkspaceAccountId
        }
      })
    });

    assert.notEqual(first.account.id, second.account.id);

    const accounts = await manager.listAccounts();
    const sharedWorkspaceAccounts = accounts.filter((item) => item.accountId === sharedWorkspaceAccountId);
    assert.equal(sharedWorkspaceAccounts.length, 2);
    assert.deepEqual(
      sharedWorkspaceAccounts.map((item) => item.email).sort(),
      ['workspace-member-1@example.com', 'workspace-member-2@example.com']
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager only refreshes imported accounts when explicitly enabled', async () => {
  const { manager } = await createTempManager();
  const accessToken = makeJwt({
    email: 'refreshable@example.com',
    exp: Math.floor((Date.now() + 3600_000) / 1000),
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_refreshable'
    }
  });

  const originalFetch = global.fetch;
  global.fetch = (async () => new Response([
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"status":"completed"}}',
    ''
  ].join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream'
    }
  })) as typeof fetch;

  try {
    const result = await manager.importAccount({
    rawInput: JSON.stringify({
      user: { email: 'refreshable@example.com' },
      accessToken
    }),
    refreshToken: 'rt__usable',
    refreshEnabled: true
    });
    const imported = result.account;

    assert.equal(imported.refreshEnabled, true);
    const candidates = await manager.listAccountsNeedingRefresh({
      nowMs: Date.now(),
      refreshThresholdMs: 24 * 60 * 60 * 1000
    });
    assert.equal(candidates.some((item) => item.accountId === 'acct_refreshable'), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('CodexAccountManager keeps imported account when direct probe fails', async () => {
  const { manager } = await createTempManager();
  const originalFetch = global.fetch;
  const accessToken = makeJwt({
    email: 'probe-fail@example.com',
    exp: Math.floor((Date.now() + 3600_000) / 1000),
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_probe_fail'
    }
  });

  global.fetch = (async () => new Response('{"error":"invalid"}', { status: 401, statusText: 'Unauthorized' })) as typeof fetch;

  try {
    const result = await manager.importAccount({
      rawInput: JSON.stringify({
        user: { email: 'probe-fail@example.com' },
        accessToken
      })
    });

    assert.equal(result.account.email, 'probe-fail@example.com');
    assert.equal(result.importTest.success, false);
    assert.equal(result.importTest.statusCode, 401);
    assert.match(result.importTest.error || '', /Codex API error/);
  } finally {
    global.fetch = originalFetch;
  }
});
