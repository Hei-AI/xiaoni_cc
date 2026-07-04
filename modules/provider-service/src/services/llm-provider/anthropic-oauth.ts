/**
 * Claude Code subscription OAuth (OpenClaw-style), mirroring codex-oauth.ts.
 *
 * Credential store: ~/.claude/.credentials.json
 *   { "claudeAiOauth": { accessToken, refreshToken, expiresAt(ms), scopes,
 *                        subscriptionType, rateLimitTier }, "organizationUuid" }
 *
 * Refresh: POST https://platform.claude.com/v1/oauth/token (client_id below).
 * Auth header on /v1/messages: Bearer <accessToken> + the Claude Code beta /
 * client headers (anthropic-beta, anthropic-version, user-agent, x-app, ...).
 *
 * Third-party use of a Pro/Max subscription token is outside Anthropic's
 * consumer ToS and can be throttled/blocked — same risk class as the existing
 * Codex/ChatGPT subscription path.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fetch } from 'undici';
import { AIConfig } from '../../types';
import { isOAuthCredentialExpired, type NormalizedOAuthCredential } from './oauth-credentials';

export const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const CLAUDE_OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
export const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';
// The Claude Code subscription endpoint expects the ?beta=true query (the official
// CLI sends it). Without it the request can be rejected as not-Claude-Code.
export const CLAUDE_MESSAGES_PATH = '/v1/messages?beta=true';

const DEFAULT_CLIENT_VERSION = '2.1.77';
// Match the current Claude Code CLI beta set so the request looks like the official
// client (the endpoint server-side-validates this). Beta flags are opt-in enablers;
// having them in the header does not change behavior unless the body opts in.
// files-api-2025-04-14: enables uploading images to /v1/files and referencing them by
// file_id in /v1/messages (image source {type:'file'}). Required on BOTH the upload call
// and the messages call that references the file. Verified reachable through the
// subscription cloak (GET/POST/DELETE /v1/files + file_id image in /v1/messages all 200).
const DEFAULT_ANTHROPIC_BETA =
  'claude-code-20250219,oauth-2025-04-20,files-api-2025-04-14,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28';
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface ClaudeOAuthSource {
  path: string;
}

function resolveCredentialPath(aiConfig: AIConfig): string {
  const explicit = aiConfig.anthropic_oauth_path || process.env.ANTHROPIC_OAUTH_PATH;
  if (explicit && explicit.trim().length > 0) {
    const value = explicit.trim();
    if (value === '~') {
      return os.homedir();
    }
    if (value.startsWith('~/')) {
      return path.join(os.homedir(), value.slice(2));
    }
    return value;
  }
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function readRecord(input: any): NormalizedOAuthCredential | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const access = typeof input.accessToken === 'string' ? input.accessToken.trim() : undefined;
  const refresh = typeof input.refreshToken === 'string' ? input.refreshToken.trim() : undefined;
  const expiresRaw = input.expiresAt;
  const expires = typeof expiresRaw === 'number'
    ? expiresRaw
    : typeof expiresRaw === 'string' && expiresRaw.trim().length > 0
      ? Number(expiresRaw)
      : undefined;
  if (!access && !refresh) {
    return null;
  }
  return {
    access,
    refresh,
    expires: Number.isFinite(expires) ? (expires as number) : undefined
  };
}

export async function loadClaudeOAuthCredential(
  aiConfig: AIConfig
): Promise<{ credential: NormalizedOAuthCredential | null; source?: ClaudeOAuthSource }> {
  // env override first
  const envAccess = aiConfig.anthropic_access_token || process.env.ANTHROPIC_OAUTH_ACCESS_TOKEN;
  const envRefresh = aiConfig.anthropic_refresh_token || process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN;
  const envExpires = aiConfig.anthropic_expires_at || process.env.ANTHROPIC_OAUTH_EXPIRES_AT;
  if ((envAccess && envAccess.trim()) || (envRefresh && envRefresh.trim())) {
    const expiresNum = typeof envExpires === 'number' ? envExpires : envExpires ? Number(envExpires) : undefined;
    return {
      credential: {
        access: envAccess?.trim(),
        refresh: envRefresh?.trim(),
        expires: Number.isFinite(expiresNum) ? (expiresNum as number) : undefined
      }
    };
  }

  const filePath = resolveCredentialPath(aiConfig);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const record = readRecord(raw?.claudeAiOauth) || readRecord(raw);
    if (record) {
      return { credential: record, source: { path: filePath } };
    }
  } catch {
    // unreadable / missing
  }
  return { credential: null };
}

let refreshInFlight: Promise<NormalizedOAuthCredential> | null = null;

export async function resolveClaudeOAuthCredential(
  aiConfig: AIConfig,
  forceRefresh = false
): Promise<{ credential: NormalizedOAuthCredential | null; source?: ClaudeOAuthSource }> {
  const loaded = await loadClaudeOAuthCredential(aiConfig);
  const credential = loaded.credential;
  if (!credential) {
    return loaded;
  }

  const needsRefresh = forceRefresh || !credential.access || isOAuthCredentialExpired(credential);
  if (needsRefresh && credential.refresh) {
    const refreshed = await refreshClaudeOAuthCredential(credential, loaded.source);
    return { credential: refreshed, source: loaded.source };
  }
  return loaded;
}

export async function refreshClaudeOAuthCredential(
  credential: NormalizedOAuthCredential,
  source?: ClaudeOAuthSource
): Promise<NormalizedOAuthCredential> {
  if (!credential.refresh) {
    throw new Error('Claude OAuth refresh token is missing.');
  }
  // single-flight: avoid a refresh stampede across concurrent requests
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const response = await (globalThis.fetch || fetch)(CLAUDE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // NOTE: do NOT send a `scope` param on a refresh_token grant. The credential
      // is minted by the real Claude Code CLI with the platform's current scope
      // set; sending our own hardcoded scope makes the server reject the refresh
      // with `400 invalid_scope`. RFC 6749 §6: omit scope and the server reuses the
      // original grant's scope. Matches codex-oauth.ts and the official CLI.
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLAUDE_OAUTH_CLIENT_ID,
        refresh_token: credential.refresh
      })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Claude OAuth token refresh failed (${response.status}): ${errorText}`);
    }
    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token || typeof payload.expires_in !== 'number') {
      throw new Error('Claude OAuth token refresh returned an invalid payload.');
    }
    const refreshed: NormalizedOAuthCredential = {
      access: payload.access_token,
      refresh: payload.refresh_token || credential.refresh,
      // 5-minute early-expiry buffer, mirroring the Claude Code client
      expires: Date.now() + payload.expires_in * 1000 - REFRESH_SKEW_MS
    };
    await persistClaudeOAuthCredential(source, refreshed);
    return refreshed;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function persistClaudeOAuthCredential(
  source: ClaudeOAuthSource | undefined,
  credential: NormalizedOAuthCredential
): Promise<void> {
  if (!source) {
    return;
  }
  let payload: Record<string, any> = {};
  try {
    payload = JSON.parse(await fs.readFile(source.path, 'utf8'));
  } catch {
    payload = {};
  }
  const existing = payload.claudeAiOauth && typeof payload.claudeAiOauth === 'object' ? payload.claudeAiOauth : {};
  payload.claudeAiOauth = {
    ...existing,
    ...(credential.access ? { accessToken: credential.access } : {}),
    ...(credential.refresh ? { refreshToken: credential.refresh } : {}),
    ...(credential.expires ? { expiresAt: credential.expires } : {})
  };
  await fs.mkdir(path.dirname(source.path), { recursive: true });
  await fs.writeFile(source.path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function buildClaudeHeaders(accessToken: string, aiConfig: AIConfig): Record<string, string> {
  const version = (aiConfig.anthropic_client_version || process.env.ANTHROPIC_CLIENT_VERSION || DEFAULT_CLIENT_VERSION).trim();
  const beta = (aiConfig.anthropic_beta || process.env.ANTHROPIC_BETA || DEFAULT_ANTHROPIC_BETA).trim();
  // NOTE: x-anthropic-billing-header is NOT an HTTP header — real Claude Code sends it
  // as the system[0] text block (and signs its cch over the body). It's injected in
  // anthropic-translate.ts (buildBillingSystemBlock), not here.
  return {
    Authorization: `Bearer ${accessToken}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': beta,
    'user-agent': `claude-cli/${version} (external, cli)`,
    'x-app': 'cli',
    'anthropic-dangerous-direct-browser-access': 'true',
    'Content-Type': 'application/json'
  };
}
