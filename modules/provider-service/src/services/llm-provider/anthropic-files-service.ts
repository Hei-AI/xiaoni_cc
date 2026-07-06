/**
 * Anthropic Files API upload — externalize an image out of the request body.
 *
 * The 32MB single-request cap (`request_too_large`) is driven mainly by base64 images
 * inlined into the message history. Uploading the image once to /v1/files and referencing
 * it by file_id in /v1/messages shrinks each image block from megabytes to ~60 bytes.
 *
 * Contract (see docs/XIAONI_FILES_API_IMAGE_UPLOAD.md):
 *  - Called at INGEST, before the image first enters the durable stack. The returned
 *    file_id is stamped into the canonical stack item and persisted, so the wire is
 *    byte-identical across the live build, stack replay, and every fork clone → zero
 *    prompt-cache drift. Never call this at wire-build time (that would mint a fresh
 *    file_id per request and punch the run-boundary prefix cache).
 *  - Degrade is graceful: any non-200 / network error / disabled flag returns null, and
 *    the caller keeps the base64 image_url (double-store). Never throws to the caller.
 *  - Token cost is unchanged (a file_id image tokenizes the same as base64); this saves
 *    WIRE BYTES only, not context tokens.
 *
 * Reachability verified live through the subscription cloak (Max tier): GET/POST/DELETE
 * /v1/files and a file_id image in /v1/messages all 200. Requires the files-api-2025-04-14
 * beta, which is in DEFAULT_ANTHROPIC_BETA (buildClaudeHeaders).
 */

import crypto from 'crypto';
import { fetch, FormData, File } from 'undici';
import { listExpiredAnthropicFileIds } from '@qq-bot/persistence';
import type { AIConfig } from '../../types';
import { databaseConfig } from '../../config';
import { logger } from '../../utils/logger';
import {
  CLAUDE_API_BASE_URL,
  buildClaudeHeaders,
  resolveClaudeOAuthCredential
} from './anthropic-oauth';

const filesLogger = logger.createModuleLogger('llm-provider-anthropic-files');

// Master switch. Default ON; flip ANTHROPIC_FILES_API_UPLOAD_ENABLED=false to fall back to
// pure base64 everywhere without a rebuild (the documented degrade escape hatch).
function isFilesApiUploadEnabled(): boolean {
  return (process.env.ANTHROPIC_FILES_API_UPLOAD_ENABLED || 'true').trim() !== 'false';
}

// Only externalize images big enough to matter on the wire. The固化 head avatar and small
// received stickers stay inline (they are already byte-stable in the warm cached prefix, so
// externalizing them buys nothing and only adds upload round-trips). Threshold is on the raw
// (decoded) image byte size. Env-overridable.
const MIN_EXTERNALIZE_BYTES = (() => {
  const raw = Number(process.env.ANTHROPIC_FILES_API_MIN_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 200 * 1024; // 200 KiB
})();

const UPLOAD_TIMEOUT_MS = (() => {
  const raw = Number(process.env.ANTHROPIC_FILES_API_UPLOAD_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
})();

// Bounded in-memory dedup: identical image bytes (same sha256) reuse the same file_id within
// the process lifetime, so the same screenshot re-ingested in one session isn't uploaded twice.
// This is an OPTIMIZATION, not a correctness dependency — the correctness-critical persistence is
// the file_id stamped into the durable stack item by the caller. A restart just re-uploads (a new
// file_id for a not-yet-ingested image is fine; an already-ingested image keeps its stack file_id).
const MAX_DEDUP_ENTRIES = 512;
const dedupHashToFileId = new Map<string, string>();

function rememberDedup(hash: string, fileId: string): void {
  if (dedupHashToFileId.has(hash)) {
    dedupHashToFileId.delete(hash);
  }
  dedupHashToFileId.set(hash, fileId);
  while (dedupHashToFileId.size > MAX_DEDUP_ENTRIES) {
    const oldest = dedupHashToFileId.keys().next().value;
    if (oldest === undefined) break;
    dedupHashToFileId.delete(oldest);
  }
}

// Every file WE upload is named `xiaoni-<hash>.<ext>`. The TTL cleaner keys its
// delete gate off this prefix, so the sweep can NEVER touch a file some other
// integration put in the same org Files store — it only ever deletes our own.
// Keep the upload filename and the cleaner's prefix filter pinned to this one
// constant so they can't drift apart.
const XIAONI_FILENAME_PREFIX = 'xiaoni-';

const DATA_URL_RE = /^data:([^;]+);base64,(.*)$/s;

export interface ParsedImageDataUrl {
  mimeType: string;
  bytes: Buffer;
}

export function parseImageDataUrl(dataUrl: unknown): ParsedImageDataUrl | null {
  if (typeof dataUrl !== 'string') {
    return null;
  }
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match || !match[1] || typeof match[2] !== 'string') {
    return null;
  }
  const mimeType = match[1].trim();
  if (!mimeType.startsWith('image/')) {
    return null;
  }
  try {
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length === 0) {
      return null;
    }
    return { mimeType, bytes };
  } catch {
    return null;
  }
}

function fileExtensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: return 'bin';
  }
}

/**
 * Upload one base64 image data URL to the Anthropic Files API.
 * Returns the file_id on success, or null on any degrade (disabled / too small / bad data /
 * missing credential / non-200 / network error / timeout). Never throws.
 */
export async function uploadImageDataUrlToAnthropicFile(
  dataUrl: unknown,
  aiConfig: AIConfig
): Promise<{ fileId: string | null; reason?: string }> {
  if (!isFilesApiUploadEnabled()) {
    return { fileId: null, reason: 'disabled' };
  }
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    return { fileId: null, reason: 'not_a_base64_image' };
  }
  if (parsed.bytes.length < MIN_EXTERNALIZE_BYTES) {
    return { fileId: null, reason: 'below_threshold' };
  }

  const hash = crypto.createHash('sha256').update(parsed.bytes).digest('hex');
  const cached = dedupHashToFileId.get(hash);
  if (cached) {
    return { fileId: cached, reason: 'dedup_hit' };
  }

  try {
    const resolved = await resolveClaudeOAuthCredential(aiConfig);
    const accessToken = resolved.credential?.access;
    if (!accessToken) {
      return { fileId: null, reason: 'no_credential' };
    }
    // buildClaudeHeaders sets Content-Type: application/json; drop it so undici sets the
    // multipart/form-data boundary itself. Keep Authorization + anthropic-version +
    // anthropic-beta (includes files-api-2025-04-14) + the cloak client headers.
    const headers = buildClaudeHeaders(accessToken, aiConfig);
    delete (headers as Record<string, string>)['Content-Type'];
    delete (headers as Record<string, string>)['content-type'];

    const form = new FormData();
    const filename = `${XIAONI_FILENAME_PREFIX}${hash.slice(0, 16)}.${fileExtensionForMime(parsed.mimeType)}`;
    form.append('file', new File([parsed.bytes], filename, { type: parsed.mimeType }));

    const baseUrl = (aiConfig.anthropic_base_url || process.env.ANTHROPIC_BASE_URL || CLAUDE_API_BASE_URL).replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${baseUrl}/v1/files`, {
        method: 'POST',
        headers: headers as Record<string, string>,
        body: form,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      return { fileId: null, reason: `http_${response.status}` };
    }
    const payload = (await response.json()) as { id?: unknown };
    const fileId = typeof payload?.id === 'string' && payload.id.trim() ? payload.id.trim() : null;
    if (!fileId) {
      return { fileId: null, reason: 'no_id_in_response' };
    }
    rememberDedup(hash, fileId);
    return { fileId };
  } catch (error) {
    return { fileId: null, reason: error instanceof Error ? error.message : 'upload_error' };
  }
}

// ---------------------------------------------------------------------------
// TTL cleaner — reclaim old uploads from the org Files store.
//
// We upload on ingest but never deleted; files persist on Anthropic's side until
// explicitly removed (no server-side expiry), against a 100 GB per-org cap. Once a
// stack item's image scrolls past the compression read cutoff it is never sent
// again, so its file_id is dead weight. This sweeper deletes our own aged uploads.
//
// ENUMERATION SOURCE = our own ledger, NOT Anthropic's LIST. Under the subscription
// cloak `GET /v1/files` returns `{"data":[]}` (200 but empty) even when files exist,
// so a list-based sweep is a silent no-op. Instead we read the file_ids we stamped
// into agent_stack_items (listExpiredAnthropicFileIds), which is the authoritative
// record of what we uploaded — and it lets us gate on the stack item's own age.
//
// Two hard safety gates before a DELETE:
//   1. The ledger query only surfaces a file_id when EVERY stack occurrence of it is
//      older than the TTL (HAVING max(created_at) < cutoff) — so a still-referenced
//      id is never a candidate.
//   2. Belt-and-suspenders: right before DELETE we GET /v1/files/{id} and re-verify
//      the filename carries our XIAONI_FILENAME_PREFIX and created_at is older than
//      the TTL. A missing/unparseable timestamp or foreign filename is SKIPPED.
//
// The TTL (default 4 days) is far longer than the minutes-to-hours a file_id can
// live inside the live read window. Deleting a file changes ZERO request bytes (the
// wire still carries the same file_id string), so there is no prompt-cache impact —
// the only failure mode this avoids is deleting an id still on the wire, which the
// TTL margin + gate 1 rule out.
// ---------------------------------------------------------------------------

function isFilesApiCleanupEnabled(): boolean {
  return (process.env.ANTHROPIC_FILES_API_TTL_CLEANUP_ENABLED || 'true').trim() !== 'false';
}

const FILES_API_TTL_MS = (() => {
  const rawDays = Number(process.env.ANTHROPIC_FILES_API_TTL_DAYS);
  const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 4; // 4 days
  return days * 24 * 60 * 60 * 1000;
})();

const FILES_API_CLEANUP_INTERVAL_MS = (() => {
  const raw = Number(process.env.ANTHROPIC_FILES_API_CLEANUP_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 6 * 60 * 60 * 1000; // 6h
})();

const GET_TIMEOUT_MS = 20_000;
const DELETE_TIMEOUT_MS = 20_000;
const MAX_CANDIDATES_PER_SWEEP = 500;

interface AnthropicFileRecord {
  id: string;
  filename?: string;
  size_bytes?: number;
  created_at?: string;
}

export interface AnthropicFilesSweepResult {
  enabled: boolean;
  ttlDays: number;
  candidates: number; // file_ids surfaced by the ledger query (all occurrences older than TTL)
  verified: number; // candidates that passed the GET-by-id prefix+age re-check
  deleted: number; // successfully deleted (incl. already-gone 404s)
  skipped: number; // candidates withheld by the re-check (foreign / too-recent / gone-from-ledger-race)
  errors: number; // per-file GET/DELETE failures (left in place, not fatal)
  freedBytes: number; // sum of size_bytes of deleted files
  reason?: string; // set when the whole sweep short-circuited (disabled / already_running / no_credential / ledger_error)
}

async function resolveFilesApiRequestContext(
  aiConfig: AIConfig
): Promise<{ baseUrl: string; headers: Record<string, string> } | null> {
  const resolved = await resolveClaudeOAuthCredential(aiConfig);
  const accessToken = resolved.credential?.access;
  if (!accessToken) {
    return null;
  }
  const headers = buildClaudeHeaders(accessToken, aiConfig);
  const baseUrl = (aiConfig.anthropic_base_url || process.env.ANTHROPIC_BASE_URL || CLAUDE_API_BASE_URL).replace(/\/$/, '');
  return { baseUrl, headers };
}

// GET /v1/files/{id}. Returns the record, or null on 404 (already gone). Throws on other errors.
async function getAnthropicFileRecord(
  baseUrl: string,
  headers: Record<string, string>,
  fileId: string
): Promise<AnthropicFileRecord | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'GET',
      headers: headers as Record<string, string>,
      signal: controller.signal
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    return (await response.json()) as AnthropicFileRecord;
  } finally {
    clearTimeout(timer);
  }
}

async function deleteAnthropicFile(
  baseUrl: string,
  headers: Record<string, string>,
  fileId: string
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: headers as Record<string, string>,
      signal: controller.signal
    });
    // 404 = already gone; treat as success (idempotent delete).
    if (!response.ok && response.status !== 404) {
      throw new Error(`http_${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function isOurExpiredFile(file: AnthropicFileRecord, cutoffMs: number): boolean {
  // Gate 1: our prefix only.
  if (typeof file.filename !== 'string' || !file.filename.startsWith(XIAONI_FILENAME_PREFIX)) {
    return false;
  }
  // Gate 2: positively older than the TTL. Unknown/unparseable age → skip.
  if (typeof file.created_at !== 'string') {
    return false;
  }
  const createdMs = Date.parse(file.created_at);
  if (!Number.isFinite(createdMs)) {
    return false;
  }
  return createdMs < cutoffMs;
}

const persistenceDbConfig = {
  databaseUrl: databaseConfig.url,
  host: databaseConfig.host,
  port: databaseConfig.port,
  user: databaseConfig.user,
  password: databaseConfig.password,
  database: databaseConfig.database
};

let sweepInFlight = false;

/**
 * Sweep our aged uploads from the org Files store once.
 * Enumerates file_ids from the stack ledger (all occurrences older than the TTL),
 * re-verifies each via GET-by-id (prefix + age), then deletes. Never throws.
 * Single-flight: an overlapping call returns a skipped result.
 */
export async function sweepExpiredAnthropicFiles(aiConfig: AIConfig): Promise<AnthropicFilesSweepResult> {
  const ttlDays = FILES_API_TTL_MS / (24 * 60 * 60 * 1000);
  const base: AnthropicFilesSweepResult = {
    enabled: true,
    ttlDays,
    candidates: 0,
    verified: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
    freedBytes: 0
  };

  if (!isFilesApiCleanupEnabled()) {
    return { ...base, enabled: false, reason: 'disabled' };
  }
  if (sweepInFlight) {
    return { ...base, reason: 'already_running' };
  }
  sweepInFlight = true;
  try {
    const ctx = await resolveFilesApiRequestContext(aiConfig);
    if (!ctx) {
      return { ...base, reason: 'no_credential' };
    }

    let candidateIds: string[];
    try {
      candidateIds = await listExpiredAnthropicFileIds(
        { olderThanMs: FILES_API_TTL_MS, limit: MAX_CANDIDATES_PER_SWEEP },
        persistenceDbConfig
      );
    } catch (error) {
      filesLogger.warn('Anthropic files ledger enumeration failed; aborting sweep', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { ...base, reason: 'ledger_error' };
    }
    base.candidates = candidateIds.length;

    const cutoffMs = Date.now() - FILES_API_TTL_MS;
    for (const fileId of candidateIds) {
      let record: AnthropicFileRecord | null;
      try {
        record = await getAnthropicFileRecord(ctx.baseUrl, ctx.headers, fileId);
      } catch (error) {
        base.errors += 1;
        filesLogger.warn('Anthropic file GET failed; leaving in place', {
          file_id: fileId,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      if (!record) {
        // Already gone on Anthropic's side — nothing to delete.
        base.skipped += 1;
        continue;
      }
      if (!isOurExpiredFile(record, cutoffMs)) {
        // Re-check failed (foreign filename / too recent / unknown age) — never delete.
        base.skipped += 1;
        continue;
      }
      base.verified += 1;
      try {
        await deleteAnthropicFile(ctx.baseUrl, ctx.headers, fileId);
        base.deleted += 1;
        base.freedBytes += typeof record.size_bytes === 'number' ? record.size_bytes : 0;
      } catch (error) {
        base.errors += 1;
        filesLogger.warn('Anthropic file delete failed; leaving in place', {
          file_id: fileId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (base.deleted > 0 || base.errors > 0) {
      filesLogger.info('Anthropic files TTL sweep complete', {
        ttl_days: ttlDays,
        candidates: base.candidates,
        verified: base.verified,
        deleted: base.deleted,
        skipped: base.skipped,
        errors: base.errors,
        freed_mib: Number((base.freedBytes / (1024 * 1024)).toFixed(1))
      });
    }
    return base;
  } catch (error) {
    filesLogger.warn('Anthropic files TTL sweep aborted', {
      error: error instanceof Error ? error.message : String(error)
    });
    return { ...base, reason: 'sweep_error' };
  } finally {
    sweepInFlight = false;
  }
}

let cleanupSupervisorStarted = false;

/**
 * Boot the periodic TTL sweeper. Idempotent; runs one sweep shortly after start
 * then every FILES_API_CLEANUP_INTERVAL_MS. No-op when disabled by env.
 */
export function startAnthropicFilesCleanupSupervisor(aiConfig: AIConfig): void {
  if (cleanupSupervisorStarted) {
    return;
  }
  if (!isFilesApiCleanupEnabled()) {
    filesLogger.info('Anthropic files TTL cleanup disabled by env; supervisor not started');
    return;
  }
  cleanupSupervisorStarted = true;
  const runSafely = () => {
    sweepExpiredAnthropicFiles(aiConfig).catch((error) => {
      filesLogger.warn('Anthropic files TTL sweep threw unexpectedly', {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  };
  // First sweep 60s after boot (let the service settle), then on the interval.
  const kickoff = setTimeout(runSafely, 60_000);
  const interval = setInterval(runSafely, FILES_API_CLEANUP_INTERVAL_MS);
  // Don't hold the event loop open for these timers.
  if (typeof kickoff.unref === 'function') kickoff.unref();
  if (typeof interval.unref === 'function') interval.unref();
  filesLogger.info('Anthropic files TTL cleanup supervisor started', {
    ttl_days: FILES_API_TTL_MS / (24 * 60 * 60 * 1000),
    interval_ms: FILES_API_CLEANUP_INTERVAL_MS
  });
}

// test-only seam: clear the in-memory dedup map between cases.
export function __clearAnthropicFileDedupForTest(): void {
  dedupHashToFileId.clear();
}

// test-only seam: expose the gate predicate for unit coverage of the two safety rules.
export function __isOurExpiredFileForTest(file: AnthropicFileRecord, cutoffMs: number): boolean {
  return isOurExpiredFile(file, cutoffMs);
}
