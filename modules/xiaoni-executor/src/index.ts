import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

type ExecCommandRequest = {
  cmd?: unknown;
  workdir?: unknown;
  shell?: unknown;
  login?: unknown;
  tty?: unknown;
  max_output_tokens?: unknown;
  yield_time_ms?: unknown;
  sandbox_permissions?: unknown;
  env?: unknown;
};

type StorePictureRequest = {
  picture_id?: unknown;
  data_url?: unknown;
  mime_type?: unknown;
  format?: unknown;
};

type StoredPicture = {
  picture_id: string;
  filename: string;
  path: string;
  mime_type: string;
  bytes: number;
};

type ExecCommandResult = {
  cmd: string;
  workdir: string;
  shell: string;
  login: boolean;
  tty: boolean;
  sandbox_permissions: string;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  timed_out: boolean;
  duration_ms: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  executor: 'xiaoni-executor';
  session_id?: string;
  chunk_id: string;
  running?: boolean;
  blocked?: boolean;
  blocked_reason?: string;
  error_message?: string;
  translated_cmd?: string;
  codex_output: string;
};

type ReadFileRequest = {
  path?: unknown;
  offset?: unknown;
  limit?: unknown;
  max_output_tokens?: unknown;
};

type ReadFileResult = {
  path: string;
  offset: number;
  limit: number;
  total_lines: number;
  returned_lines: number;
  truncated: boolean;
  executor: 'xiaoni-executor';
  error_message?: string;
  codex_output: string;
};

type RuntimeSession = {
  id: string;
  chunkId: string;
  cmd: string;
  translatedCmd: string;
  workdir: string;
  shell: string;
  login: boolean;
  tty: boolean;
  sandboxPermissions: string;
  startedAt: number;
  stdout: string;
  stderr: string;
  stdoutCap: StreamCapture;
  stderrCap: StreamCapture;
  truncated: boolean;
  maxOutputChars: number;
  timedOut: boolean;
  child: ChildProcess;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  closed: boolean;
  // Wall-clock of the close/error transition. Freezes duration_ms (so a closed
  // session stops accruing wall time) and drives TTL eviction from the map.
  closedAt: number | null;
  // Single-flight snapshot writer state (see persistSession). Kept on the
  // session object itself so it is reclaimed with the session on eviction —
  // no side Map that would need its own cleanup.
  persistWriting: boolean;
  persistDirty: boolean;
};

type CommandPolicyVerdict = {
  allowed: boolean;
  reason?: string;
};

const port = Number.parseInt(process.env.HTTP_PORT || '8093', 10);
const runtimeRoot = process.env.XIAONI_RUNTIME_ROOT || '/xiaoni-runtime';
const workspaceRoot = process.env.WORKSPACE_ROOT || '/workspace/qq_bot';
const sessions = new Map<string, RuntimeSession>();
const execFileAsync = promisify(execFile);

function safePictureId(value: unknown) {
  const raw = typeof value === 'string' && value.trim()
    ? value.trim()
    : `picture_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '');
  return normalized || `picture_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function extensionForPicture(mimeType: string, format: unknown) {
  const normalizedFormat = typeof format === 'string' ? format.trim().toLowerCase() : '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(normalizedFormat)) {
    return normalizedFormat === 'jpeg' ? 'jpg' : normalizedFormat;
  }
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.includes('jpeg') || normalizedMime.includes('jpg')) {
    return 'jpg';
  }
  if (normalizedMime.includes('webp')) {
    return 'webp';
  }
  if (normalizedMime.includes('gif')) {
    return 'gif';
  }
  return 'png';
}

export async function storePicture(input: StorePictureRequest, root = runtimeRoot): Promise<StoredPicture> {
  const dataUrl = typeof input.data_url === 'string' ? input.data_url.trim() : '';
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) {
    throw new Error('store picture requires a base64 data_url');
  }
  const mimeType = typeof input.mime_type === 'string' && input.mime_type.trim()
    ? input.mime_type.trim()
    : match[1];
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) {
    throw new Error('store picture received empty image bytes');
  }
  const pictureId = safePictureId(input.picture_id);
  const extension = extensionForPicture(mimeType, input.format);
  const filename = pictureId.match(/\.[a-z0-9]{2,5}$/i) ? pictureId : `${pictureId}.${extension}`;
  const pictureDir = path.join(root, 'picture');
  await mkdir(pictureDir, { recursive: true });
  const filePath = path.join(pictureDir, filename);
  await writeFile(filePath, bytes);
  await appendAudit('picture_store', {
    picture_id: pictureId,
    filename,
    path: filePath,
    mime_type: mimeType,
    bytes: bytes.length
  }, root);
  return {
    picture_id: pictureId,
    filename,
    path: filePath,
    mime_type: mimeType,
    bytes: bytes.length
  };
}

export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function translateCommandPaths(input: string, root = workspaceRoot): string {
  const normalizedRoot = root.replace(/\/$/, '');
  return input
    .split('/app/')
    .join(`${normalizedRoot}/`)
    .replace(/(^|\s)\/app(?=\s|$)/g, `$1${normalizedRoot}`);
}

function translateWorkdir(input: string, root = workspaceRoot): string {
  const normalizedRoot = root.replace(/\/$/, '');
  if (input === '/app') {
    return normalizedRoot;
  }
  if (input.startsWith('/app/')) {
    return `${normalizedRoot}${input.slice('/app'.length)}`;
  }
  return input;
}

export function evaluateCommandPolicy(
  cmd: string
): CommandPolicyVerdict {
  const normalized = cmd.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return { allowed: false, reason: 'empty command' };
  }
  return { allowed: true };
}

export function resolveExecShellArgs(shell: string, cmd: string, login: boolean): string[] {
  const shellName = path.basename(shell);
  if (login && (shellName === 'bash' || shellName === 'zsh')) {
    return ['-lc', cmd];
  }
  return ['-c', cmd];
}

export function formatCodexOutput(input: {
  chunkId: string;
  durationMs: number;
  exitCode: number | null;
  signal?: NodeJS.Signals | null;
  running?: boolean;
  sessionId?: string;
  blocked?: boolean;
  output: string;
  truncated?: boolean;
  originalTokenCount?: number;
  spillNote?: string;
}): string {
  // Minimal envelope, modelled on Claude Code's Bash tool: on the plain happy
  // path (clean exit, output present, nothing truncated/running/blocked) return
  // the raw bytes with ZERO header. Metadata is a single compact status line and
  // only when it's actionable. chunkId / wall-time / token-count are debug fields
  // — they live in the structured ExecCommandResult + admin trace, never in her
  // context. On truncation the spill path rides inline in the elision marker
  // (see StreamCapture.render), so there is no separate header note; `spillNote`
  // now carries ONLY an out-of-band caveat (e.g. executor restart) appended as a
  // single trailing line when present.
  let status: string | null = null;
  if (input.blocked) {
    status = '[已被执行器策略拦截]';
  } else if (input.running) {
    // Factual only, like the old "Process running with session ID X": the model
    // does not poll via exec_command (agent-service drives /sessions/<id>/poll).
    status = `[会话 ${input.sessionId || ''} 运行中]`;
  } else if (typeof input.exitCode === 'number') {
    status = input.exitCode === 0 ? null : `[exit ${input.exitCode}]`;
  } else if (input.signal) {
    status = `[signal ${input.signal}]`;
  } else {
    status = '[无退出码]';
  }
  const body = input.output.length > 0
    ? input.output
    : (status ? '' : '(exec_command 无输出)');
  const trailer = input.truncated && input.spillNote ? input.spillNote : null;
  return [status, body, trailer]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join('\n');
}

function clampNumber(value: unknown, defaultValue: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, parsed));
}

// First-class file read, modelled on Claude Code's Read tool: line-based range,
// cat -n numbering, minimal envelope. Same filesystem view + /app path translation
// as exec_command, so read_file(path) reads exactly what `exec_command cat path`
// would — including a truncated exec output spilled under /xiaoni-runtime/exec-output.
// Its own output is capped and, when it overflows, points at the next offset rather
// than spilling again (she's already reading a bounded range).
export async function readFileRange(args: ReadFileRequest): Promise<ReadFileResult> {
  const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
  const offset = clampNumber(args.offset, 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = clampNumber(args.limit, 2000, 1, 100_000);
  const maxOutputTokens = clampNumber(args.max_output_tokens, 10_000, 2000, 200_000);
  const maxChars = Math.max(1, maxOutputTokens * 4);
  const build = (target: string, extra: Partial<ReadFileResult> & { codex_output: string }): ReadFileResult => ({
    path: target,
    offset,
    limit,
    total_lines: 0,
    returned_lines: 0,
    truncated: false,
    executor: 'xiaoni-executor',
    ...extra
  });
  if (!rawPath) {
    return build('', { error_message: 'read_file requires path', codex_output: '[read_file 需要 path]' });
  }
  const target = translateWorkdir(rawPath);
  let content: string;
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      return build(target, { error_message: 'path is a directory', codex_output: `[不是文件,是目录: ${target}]` });
    }
    content = await readFile(target, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    const msg = code === 'ENOENT' ? `文件不存在: ${target}` : (error instanceof Error ? error.message : String(error));
    return build(target, { error_message: msg, codex_output: `[${msg}]` });
  }
  const lines = content.split('\n');
  // A trailing newline yields a final '' element — drop it so line count is natural.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const totalLines = lines.length;
  if (totalLines === 0) {
    return build(target, { total_lines: 0, codex_output: '(空文件)' });
  }
  const start = offset - 1;
  if (start >= totalLines) {
    return build(target, { total_lines: totalLines, codex_output: `(offset ${offset} 超过文件末尾，共 ${totalLines} 行)` });
  }
  const slice = lines.slice(start, start + limit);
  const width = String(start + slice.length).length;
  const numbered: string[] = [];
  let charCount = 0;
  let truncated = false;
  let stoppedLineNo = start + slice.length; // last fully-returned line
  for (let i = 0; i < slice.length; i += 1) {
    const lineNo = start + i + 1;
    const rendered = `${String(lineNo).padStart(width)}\t${slice[i]}`;
    if (numbered.length === 0 && rendered.length > maxChars) {
      // Single line larger than the whole budget: hard-cut it (surrogate-safe) so
      // read_file always makes progress instead of returning nothing.
      numbered.push(`${sliceHead(rendered, maxChars)} …[该行过长已截断]`);
      truncated = true;
      stoppedLineNo = lineNo; // this line is partially returned; resume at it
      break;
    }
    if (numbered.length > 0 && charCount + rendered.length + 1 > maxChars) {
      truncated = true;
      stoppedLineNo = lineNo - 1;
      break;
    }
    numbered.push(rendered);
    charCount += rendered.length + 1;
  }
  let body = numbered.join('\n');
  if (truncated) {
    const kb = Math.round(maxChars / 1024);
    body += `\n…[超 ${kb}KB，读到第 ${stoppedLineNo} 行止；继续 read_file(offset=${stoppedLineNo + 1})]…`;
  }
  return build(target, {
    total_lines: totalLines,
    returned_lines: numbered.length,
    truncated,
    codex_output: body
  });
}

function normalizeExecEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || entry === null || typeof entry === 'undefined') {
      continue;
    }
    env[key] = String(entry);
  }
  return env;
}

// Full command output is never discarded on truncation. When a stream crosses
// max_output_tokens we keep a HEAD + TAIL preview inline (so the newest bytes —
// e.g. the latest qq-usage messages, which render at the tail — stay visible)
// and stream the FULL raw bytes to a spill file under /xiaoni-runtime/exec-output,
// which she can `tail`/`cat`/`sed` via another exec_command (same RW mount). The
// middle is elided with a marker that carries the spill path. Nothing is lost.
const EXEC_OUTPUT_SUBDIR = 'exec-output';
const SPILL_CEILING_BYTES = 50 * 1024 * 1024;
const EXEC_OUTPUT_TTL_DAYS = 7;
// Grace period a CLOSED session lingers in the in-memory map before eviction.
// A late poll after eviction falls through to the on-disk snapshot branch,
// which already reports running:false. Only closed sessions are evicted, so the
// pollSession "not in map + running:true => restart orphan" inference is
// preserved. Large enough that the close-time snapshot write has long settled.
const SESSION_EVICT_TTL_MS = 10 * 60 * 1000;
const SESSION_EVICT_INTERVAL_MS = 60 * 1000;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Slice the first `n` UTF-16 units without splitting a surrogate pair (emoji).
function sliceHead(str: string, n: number): string {
  if (n >= str.length) {
    return str;
  }
  let end = n;
  if (end > 0 && isHighSurrogate(str.charCodeAt(end - 1))) {
    end -= 1;
  }
  return str.slice(0, end);
}

// Keep the last `n` UTF-16 units without splitting a surrogate pair (emoji).
function sliceTail(str: string, n: number): string {
  if (n >= str.length) {
    return str;
  }
  let start = str.length - n;
  if (start > 0 && isLowSurrogate(str.charCodeAt(start))) {
    start += 1;
  }
  return str.slice(start);
}

function execOutputPath(sessionId: string, stream: 'stdout' | 'stderr', root = runtimeRoot): string {
  return path.join(root, EXEC_OUTPUT_SUBDIR, `${sessionId}.${stream}.txt`);
}

// Per-stream streaming capture. Bytes go through a single StringDecoder so a
// multibyte char (CJK / emoji) split across two `data` events survives — the
// previous `chunk.toString('utf8')` per-chunk decode mojibake'd those. The spill
// file is written as RAW bytes (exact), the preview from decoded chars.
export class StreamCapture {
  private readonly decoder = new StringDecoder('utf8');
  private readonly headBudget: number;
  private readonly tailBudget: number;
  private head = '';
  private tail = '';
  private full: string | null = ''; // holds everything until we cross the cap
  private rawBuffer: Buffer[] | null = []; // raw chunks buffered until first cross
  private spillStream: WriteStream | null = null;
  private spilledBytes = 0;
  private spillFinished: Promise<void> | null = null;
  totalChars = 0;
  truncated = false;
  spillPath: string | null = null;
  spillError = false;
  spillCeilingHit = false;

  constructor(
    private readonly maxChars: number,
    private readonly makeSpillPath: () => string,
    private readonly spillCeilingBytes = SPILL_CEILING_BYTES
  ) {
    this.headBudget = Math.max(1, Math.floor(maxChars / 2));
    this.tailBudget = Math.max(1, maxChars - this.headBudget);
  }

  // Await the spill write-stream flushing to disk (the stream closes async after
  // end()). Tests read the spill file only after this resolves.
  async settled(): Promise<void> {
    if (this.spillFinished) {
      await this.spillFinished;
    }
  }

  push(chunk: Buffer): void {
    // Handle raw bytes first (buffer pre-cross, stream post-cross) so the spill
    // file is exact bytes regardless of where multibyte chars land.
    if (!this.spillError) {
      if (this.spillStream) {
        this.writeSpill(chunk);
      } else if (this.rawBuffer) {
        this.rawBuffer.push(chunk);
      }
    }
    this.ingest(this.decoder.write(chunk));
  }

  end(): void {
    this.ingest(this.decoder.end());
    if (this.spillStream) {
      try {
        this.spillStream.end();
      } catch {
        // best-effort flush
      }
      this.spillStream = null;
    }
  }

  private ingest(text: string): void {
    if (!text) {
      return;
    }
    this.totalChars += text.length;
    if (this.head.length < this.headBudget) {
      this.head = sliceHead(this.head + text, this.headBudget);
    }
    this.tail = sliceTail(this.tail + text, this.tailBudget);
    if (this.full !== null) {
      this.full += text;
    }
    if (!this.truncated && this.totalChars > this.maxChars) {
      this.truncated = true;
      this.full = null; // release; render() switches to head + marker + tail
      this.openSpillAndFlush();
    }
  }

  private openSpillAndFlush(): void {
    if (this.spillError || this.spillStream) {
      return;
    }
    try {
      const target = this.makeSpillPath();
      mkdirSync(path.dirname(target), { recursive: true });
      const stream = createWriteStream(target, { flags: 'w' });
      // Degrade-don't-fail: a spill IO error must never turn her command into a
      // hard error — fall back to inline-preview-only.
      stream.on('error', () => {
        this.spillError = true;
        this.spillPath = null;
      });
      this.spillFinished = new Promise<void>((resolve) => {
        stream.on('close', () => resolve());
        stream.on('error', () => resolve());
      });
      this.spillStream = stream;
      this.spillPath = target;
      const buffered = this.rawBuffer || [];
      this.rawBuffer = null;
      for (const buf of buffered) {
        this.writeSpill(buf);
      }
    } catch {
      this.spillError = true;
      this.spillPath = null;
      this.rawBuffer = null;
    }
  }

  private writeSpill(chunk: Buffer): void {
    if (this.spillError || !this.spillStream) {
      return;
    }
    if (this.spilledBytes >= this.spillCeilingBytes) {
      this.spillCeilingHit = true;
      return;
    }
    try {
      const room = this.spillCeilingBytes - this.spilledBytes;
      const toWrite = chunk.length <= room ? chunk : chunk.subarray(0, room);
      this.spillStream.write(toWrite);
      this.spilledBytes += toWrite.length;
      if (toWrite.length < chunk.length) {
        this.spillCeilingHit = true;
      }
    } catch {
      this.spillError = true;
      this.spillPath = null;
    }
  }

  render(): string {
    if (!this.truncated) {
      return this.full ?? this.head;
    }
    const elided = Math.max(0, this.totalChars - this.head.length - this.tail.length);
    // Self-contained elision marker, factual and minimal like Claude Code's spill
    // notice ("Output too large. Full output saved to: <path>"): it marks WHERE the
    // cut is and names the spill file, nothing more. No re-read coaching — she
    // ignores it, and head+tail already keeps both ends inline (which serves her
    // better than a re-read she never does). One reference, at the cut.
    const ceilTag = this.spillCeilingHit
      ? `（文件在 ${Math.round(this.spillCeilingBytes / 1024 / 1024)}MB 处截断）`
      : '';
    const note = (this.spillError || !this.spillPath)
      ? `…[省略约 ${elided} 字符 · 写盘失败]…`
      : `…[省略约 ${elided} 字符 · 完整 ${this.spillPath}${ceilTag}]…`;
    return `${this.head}\n${note}\n${this.tail}`;
  }
}

// Age-prune spilled exec-output files so /xiaoni-runtime/exec-output doesn't grow
// forever (mirrors the web_search spill prune). Only the path enters her context;
// deleting a file is a runtime miss (file-not-found on a stale re-read), never a
// cache break — the path string was already frozen verbatim in the stack.
export async function pruneExecOutput(root = runtimeRoot, ttlDays = EXEC_OUTPUT_TTL_DAYS, now = Date.now()): Promise<number> {
  const dir = path.join(root, EXEC_OUTPUT_SUBDIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  const cutoff = now - ttlDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.txt')) {
      continue;
    }
    const full = path.join(dir, entry);
    try {
      const info = await stat(full);
      if (info.mtimeMs < cutoff) {
        await rm(full, { force: true });
        removed += 1;
      }
    } catch {
      // ignore individual file errors
    }
  }
  return removed;
}

// Evict CLOSED sessions from the in-memory map once their close is older than
// the TTL, bounding memory on a long-running executor (the map otherwise keeps
// one RuntimeSession — a ChildProcess ref + two StreamCaptures — per command
// for the container's lifetime). Running sessions are NEVER evicted: a live
// poll must resolve from memory, and dropping a running session would also
// make killSession lose its only handle to the child (an unkillable process)
// and make pollSession falsely report it as a restart orphan. Late polls after
// eviction fall through to the on-disk snapshot (running:false). Exported +
// store-injectable for unit testing, mirroring pruneExecOutput.
export function pruneClosedSessions(
  now = Date.now(),
  ttlMs = SESSION_EVICT_TTL_MS,
  store = sessions
): number {
  let removed = 0;
  for (const [id, session] of store) {
    if (session.closed && session.closedAt !== null && now - session.closedAt > ttlMs) {
      store.delete(id);
      removed += 1;
    }
  }
  return removed;
}

async function ensureRuntimeDirectories() {
  await Promise.all([
    'sessions',
    'logs',
    'skills',
    'services',
    'artifacts',
    'registry',
    EXEC_OUTPUT_SUBDIR
  ].map((dir) => mkdir(path.join(runtimeRoot, dir), { recursive: true })));
}

function buildSessionFilePath(sessionId: string, root = runtimeRoot): string {
  return path.join(root, 'sessions', `${sessionId}.json`);
}

// Serialize the current session state to disk atomically (write-temp + rename)
// so a reader — pollSession after a restart, or any external reader of the
// sessions dir — never observes a torn file, and a crash mid-write can only
// orphan a .tmp-* file rather than truncate the live snapshot.
async function writeSnapshotAtomic(session: RuntimeSession, root: string): Promise<void> {
  const finalPath = buildSessionFilePath(session.id, root);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  await writeFile(tmpPath, JSON.stringify(sessionToSnapshot(session), null, 2));
  await rename(tmpPath, finalPath);
}

// Single-flight, coalescing snapshot writer. persistSession is called
// fire-and-forget on every stdout/stderr chunk AND on close; without
// serialization those unordered writeFile('w') calls interleave (torn reads →
// false 404) and can land out of order (a laggard chunk write clobbers the
// final close snapshot back to running:true — the source of stale snapshots).
//
// Contract: at most one write is ever in flight for a given session's file. A
// call arriving while a write is in flight only sets `persistDirty`; the active
// writer then re-serializes the CURRENT session object once more. Because the
// serialization always reflects the live session at write time — and Node
// delivers every 'data' event before 'close' for the same child — any write
// dispatched at or after the close handler observes closed===true, so the final
// on-disk snapshot always converges to running:false + the real exit_code.
export async function persistSession(session: RuntimeSession, root = runtimeRoot): Promise<void> {
  if (session.persistWriting) {
    session.persistDirty = true;
    return;
  }
  session.persistWriting = true;
  try {
    do {
      session.persistDirty = false;
      await writeSnapshotAtomic(session, root);
    } while (session.persistDirty);
  } finally {
    session.persistWriting = false;
  }
}

async function appendAudit(event: string, payload: Record<string, unknown>, root = runtimeRoot) {
  const line = JSON.stringify({ event, at: new Date().toISOString(), ...payload });
  const logsDir = path.join(root, 'logs');
  await mkdir(logsDir, { recursive: true });
  await appendFile(path.join(logsDir, 'exec-command.jsonl'), `${line}\n`);
}

// Elapsed wall time for the command. A closed session freezes at closedAt so
// the value stops growing across repeated polls and matches the on-disk
// snapshot (the live in-memory path and the post-eviction snapshot path must
// report the same duration for the same closed session).
function sessionDurationMs(session: RuntimeSession): number {
  return (session.closedAt ?? Date.now()) - session.startedAt;
}

function sessionToSnapshot(session: RuntimeSession) {
  return {
    id: session.id,
    chunk_id: session.chunkId,
    cmd: session.cmd,
    translated_cmd: session.translatedCmd,
    workdir: session.workdir,
    shell: session.shell,
    login: session.login,
    tty: session.tty,
    sandbox_permissions: session.sandboxPermissions,
    started_at: new Date(session.startedAt).toISOString(),
    duration_ms: sessionDurationMs(session),
    stdout: session.stdout,
    stderr: session.stderr,
    truncated: session.truncated,
    original_chars: session.stdoutCap.totalChars + session.stderrCap.totalChars,
    timed_out: session.timedOut,
    exit_code: session.exitCode,
    signal: session.signal,
    running: !session.closed
  };
}

function buildResultFromSession(session: RuntimeSession): ExecCommandResult {
  const output = session.stdout + session.stderr;
  const originalChars = session.stdoutCap.totalChars + session.stderrCap.totalChars;
  const durationMs = sessionDurationMs(session);
  return {
    cmd: session.cmd,
    translated_cmd: session.translatedCmd === session.cmd ? undefined : session.translatedCmd,
    workdir: session.workdir,
    shell: session.shell,
    login: session.login,
    tty: session.tty,
    sandbox_permissions: session.sandboxPermissions,
    exit_code: session.exitCode,
    signal: session.signal,
    timed_out: session.timedOut,
    duration_ms: durationMs,
    stdout: session.stdout,
    stderr: session.stderr,
    truncated: session.truncated,
    executor: 'xiaoni-executor',
    session_id: session.id,
    chunk_id: session.chunkId,
    running: !session.closed,
    codex_output: formatCodexOutput({
      chunkId: session.chunkId,
      durationMs,
      exitCode: session.exitCode,
      signal: session.signal,
      running: !session.closed,
      sessionId: session.id,
      output,
      truncated: session.truncated,
      originalTokenCount: Math.max(0, Math.ceil(originalChars / 4))
    })
  };
}

function buildBlockedResult(cmd: string, workdir: string, shell: string, login: boolean, sandboxPermissions: string, reason: string): ExecCommandResult {
  const chunkId = randomUUID().slice(0, 8);
  const stderr = reason;
  return {
    cmd,
    workdir,
    shell,
    login,
    tty: false,
    sandbox_permissions: sandboxPermissions,
    exit_code: null,
    signal: null,
    timed_out: false,
    duration_ms: 0,
    stdout: '',
    stderr,
    truncated: false,
    executor: 'xiaoni-executor',
    chunk_id: chunkId,
    blocked: true,
    blocked_reason: reason,
    error_message: reason,
    codex_output: formatCodexOutput({
      chunkId,
      durationMs: 0,
      exitCode: null,
      blocked: true,
      output: stderr
    })
  };
}

async function executeCommand(args: ExecCommandRequest): Promise<ExecCommandResult> {
  const originalCmd = typeof args.cmd === 'string' && args.cmd.trim() ? args.cmd : '';
  if (!originalCmd) {
    return buildBlockedResult('', workspaceRoot, '/bin/bash', true, 'use_default', 'exec_command requires cmd');
  }
  const translatedCmd = translateCommandPaths(originalCmd);
  const shell = typeof args.shell === 'string' && args.shell.trim() ? args.shell.trim() : '/bin/bash';
  const workdir = translateWorkdir(
    typeof args.workdir === 'string' && args.workdir.trim() ? args.workdir.trim() : workspaceRoot
  );
  const login = args.login !== false;
  const tty = Boolean(args.tty);
  const sandboxPermissions = typeof args.sandbox_permissions === 'string' ? args.sandbox_permissions : 'use_default';
  // Floor at 2000 tokens (~8000 chars): a stray tiny value like max_output_tokens:5
  // must not cap a 20-token answer down to nothing and detonate the spill machinery.
  // Small caps are never useful — head+tail truncation already bounds huge output.
  const maxOutputTokens = clampNumber(args.max_output_tokens, 10_000, 2000, 200_000);
  const maxOutputChars = Math.max(1, maxOutputTokens * 4);
  const yieldMs = clampNumber(args.yield_time_ms, 10_000, 250, 30_000);
  const policy = evaluateCommandPolicy(translatedCmd);
  if (!policy.allowed) {
    return buildBlockedResult(originalCmd, workdir, shell, login, sandboxPermissions, policy.reason || 'command blocked');
  }

  const sessionId = `exec_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const chunkId = randomUUID().slice(0, 8);
  const session: RuntimeSession = {
    id: sessionId,
    chunkId,
    cmd: originalCmd,
    translatedCmd,
    workdir,
    shell,
    login,
    tty,
    sandboxPermissions,
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    stdoutCap: new StreamCapture(maxOutputChars, () => execOutputPath(sessionId, 'stdout')),
    stderrCap: new StreamCapture(maxOutputChars, () => execOutputPath(sessionId, 'stderr')),
    truncated: false,
    maxOutputChars,
    timedOut: false,
    child: spawn(shell, resolveExecShellArgs(shell, translatedCmd, login), {
      cwd: workdir,
      env: {
        ...process.env,
        ...normalizeExecEnv(args.env)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }),
    exitCode: null,
    signal: null,
    closed: false,
    closedAt: null,
    persistWriting: false,
    persistDirty: false
  };
  sessions.set(session.id, session);
  await persistSession(session);
  await appendAudit('exec_start', { session_id: session.id, cmd: originalCmd, translated_cmd: translatedCmd, workdir, shell });

  const refreshRendered = () => {
    session.stdout = session.stdoutCap.render();
    session.stderr = session.stderrCap.render();
    session.truncated = session.stdoutCap.truncated || session.stderrCap.truncated;
  };
  session.child.stdout?.on('data', (chunk: Buffer) => {
    session.stdoutCap.push(chunk);
    refreshRendered();
    void persistSession(session);
  });
  session.child.stderr?.on('data', (chunk: Buffer) => {
    session.stderrCap.push(chunk);
    refreshRendered();
    void persistSession(session);
  });
  session.child.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    session.stderrCap.push(Buffer.from(message, 'utf8'));
    session.stderrCap.end();
    session.stdoutCap.end();
    refreshRendered();
    session.exitCode = null;
    session.signal = null;
    session.closed = true;
    session.closedAt = Date.now();
    void persistSession(session);
    void appendAudit('exec_error', { session_id: session.id, error_message: message });
  });
  session.child.on('close', (code, signal) => {
    // Flush the decoders (drop any trailing partial multibyte bytes) and close
    // the spill streams before the final snapshot.
    session.stdoutCap.end();
    session.stderrCap.end();
    refreshRendered();
    session.exitCode = typeof code === 'number' ? code : null;
    session.signal = signal || null;
    session.closed = true;
    session.closedAt = Date.now();
    void persistSession(session);
    void appendAudit('exec_close', { session_id: session.id, exit_code: session.exitCode, signal: session.signal });
  });

  return await new Promise<ExecCommandResult>((resolve) => {
    // When the process has CLOSED, wait for the spill streams to finish flushing
    // before resolving — otherwise the elision marker names a spill file that is
    // still mid-flush (the read comes a round-trip later, but make it
    // true-by-construction). Not awaited on the yield path: a still-running command
    // keeps its stream open and is polled later.
    const resolveClosed = async () => {
      await Promise.all([session.stdoutCap.settled(), session.stderrCap.settled()]);
      resolve(buildResultFromSession(session));
    };
    if (session.closed) {
      void resolveClosed();
      return;
    }
    const timeout = setTimeout(() => resolve(buildResultFromSession(session)), yieldMs);
    timeout.unref();
    session.child.once('close', () => {
      clearTimeout(timeout);
      void resolveClosed();
    });
    session.child.once('error', () => {
      clearTimeout(timeout);
      void resolveClosed();
    });
  });
}

async function pollSession(sessionId: string): Promise<ExecCommandResult | null> {
  const session = sessions.get(sessionId);
  if (session) {
    return buildResultFromSession(session);
  }
  try {
    const raw = await readFile(buildSessionFilePath(sessionId), 'utf8');
    const snapshot = JSON.parse(raw) as Record<string, unknown>;
    const output = `${typeof snapshot.stdout === 'string' ? snapshot.stdout : ''}${typeof snapshot.stderr === 'string' ? snapshot.stderr : ''}`;
    const chunkId = typeof snapshot.chunk_id === 'string' ? snapshot.chunk_id : randomUUID().slice(0, 8);
    const durationMs = typeof snapshot.duration_ms === 'number' ? snapshot.duration_ms : 0;
    const originalChars = typeof snapshot.original_chars === 'number' ? snapshot.original_chars : output.length;
    // Sessions are never evicted from the in-memory map within a process lifetime,
    // so reaching the snapshot branch means a DIFFERENT process wrote it — i.e. the
    // executor restarted. A snapshot still marked running:true is therefore an
    // orphaned dead process; its spill file only flushed up to the crash point.
    // Report it as not-running (so the caller stops polling forever). The inline
    // elision marker in `output` already carries the spill path; here we only add
    // a trailing caveat so a partial file is never presented as complete.
    const wasRunning = Boolean(snapshot.running);
    const spillNote = wasRunning && Boolean(snapshot.truncated)
      ? '⚠ 执行器已重启，此命令进程已丢失，落盘文件可能不完整'
      : undefined;
    return {
      cmd: typeof snapshot.cmd === 'string' ? snapshot.cmd : '',
      translated_cmd: typeof snapshot.translated_cmd === 'string' ? snapshot.translated_cmd : undefined,
      workdir: typeof snapshot.workdir === 'string' ? snapshot.workdir : workspaceRoot,
      shell: typeof snapshot.shell === 'string' ? snapshot.shell : '/bin/bash',
      login: snapshot.login !== false,
      tty: Boolean(snapshot.tty),
      sandbox_permissions: typeof snapshot.sandbox_permissions === 'string' ? snapshot.sandbox_permissions : 'use_default',
      exit_code: typeof snapshot.exit_code === 'number' ? snapshot.exit_code : null,
      signal: typeof snapshot.signal === 'string' ? snapshot.signal as NodeJS.Signals : null,
      timed_out: Boolean(snapshot.timed_out),
      duration_ms: durationMs,
      stdout: typeof snapshot.stdout === 'string' ? snapshot.stdout : '',
      stderr: typeof snapshot.stderr === 'string' ? snapshot.stderr : '',
      truncated: Boolean(snapshot.truncated),
      executor: 'xiaoni-executor',
      session_id: sessionId,
      chunk_id: chunkId,
      running: false,
      codex_output: formatCodexOutput({
        chunkId,
        durationMs,
        exitCode: typeof snapshot.exit_code === 'number' ? snapshot.exit_code : null,
        signal: typeof snapshot.signal === 'string' ? snapshot.signal as NodeJS.Signals : null,
        running: false,
        sessionId,
        output,
        truncated: Boolean(snapshot.truncated),
        originalTokenCount: Math.max(0, Math.ceil(originalChars / 4)),
        spillNote
      })
    };
  } catch {
    return null;
  }
}

async function killSession(sessionId: string): Promise<ExecCommandResult | null> {
  const session = sessions.get(sessionId);
  if (!session) {
    return pollSession(sessionId);
  }
  if (!session.closed) {
    session.timedOut = true;
    session.child.kill('SIGTERM');
    setTimeout(() => {
      if (!session.closed) {
        session.child.kill('SIGKILL');
      }
    }, 1_000).unref();
  }
  await persistSession(session);
  await appendAudit('exec_kill', { session_id: sessionId });
  return buildResultFromSession(session);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://xiaoni-executor.local');
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      status: 'healthy',
      service: 'xiaoni-executor',
      runtime_root: runtimeRoot,
      workspace_root: workspaceRoot,
      active_sessions: Array.from(sessions.values()).filter((session) => !session.closed).length,
      timestamp: new Date().toISOString()
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/internal/exec-command') {
    const body = await readJson(req);
    const result = await executeCommand((body && typeof body === 'object') ? body as ExecCommandRequest : {});
    sendJson(res, 200, { success: true, result });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/internal/read-file') {
    const body = await readJson(req);
    const result = await readFileRange((body && typeof body === 'object') ? body as ReadFileRequest : {});
    sendJson(res, 200, { success: true, result });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/internal/pictures') {
    try {
      const body = await readJson(req);
      const result = await storePicture((body && typeof body === 'object') ? body as StorePictureRequest : {});
      sendJson(res, 200, { success: true, result });
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }
  const pollMatch = url.pathname.match(/^\/api\/internal\/sessions\/([^/]+)\/poll$/);
  if (req.method === 'POST' && pollMatch) {
    const result = await pollSession(decodeURIComponent(pollMatch[1]));
    if (!result) {
      sendJson(res, 404, { success: false, error: 'session not found' });
      return;
    }
    sendJson(res, 200, { success: true, result });
    return;
  }
  const killMatch = url.pathname.match(/^\/api\/internal\/sessions\/([^/]+)\/kill$/);
  if (req.method === 'POST' && killMatch) {
    const result = await killSession(decodeURIComponent(killMatch[1]));
    if (!result) {
      sendJson(res, 404, { success: false, error: 'session not found' });
      return;
    }
    sendJson(res, 200, { success: true, result });
    return;
  }
  sendJson(res, 404, { success: false, error: 'not found' });
}

export async function createExecutorServer() {
  await ensureRuntimeDirectories();
  await pruneExecOutput().catch(() => 0);
  // Bound in-memory session growth on a long-running executor. unref() so the
  // sweeper never keeps the process alive on shutdown, matching the file's
  // other background timers.
  setInterval(() => pruneClosedSessions(), SESSION_EVICT_INTERVAL_MS).unref();
  return createServer((req, res) => {
    route(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { success: false, error: message });
    });
  });
}

if (require.main === module) {
  createExecutorServer()
    .then((server) => {
      server.listen(port, '0.0.0.0', () => {
        console.log(`xiaoni-executor listening on ${port}`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
