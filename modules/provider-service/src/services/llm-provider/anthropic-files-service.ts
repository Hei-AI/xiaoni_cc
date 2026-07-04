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
import type { AIConfig } from '../../types';
import {
  CLAUDE_API_BASE_URL,
  buildClaudeHeaders,
  resolveClaudeOAuthCredential
} from './anthropic-oauth';

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
    const filename = `xiaoni-${hash.slice(0, 16)}.${fileExtensionForMime(parsed.mimeType)}`;
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

// test-only seam: clear the in-memory dedup map between cases.
export function __clearAnthropicFileDedupForTest(): void {
  dedupHashToFileId.clear();
}
