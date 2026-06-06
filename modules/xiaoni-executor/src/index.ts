import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  git_archive_dir?: string | null;
  git_archive_error?: string | null;
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
  truncated: boolean;
  maxOutputChars: number;
  timedOut: boolean;
  child: ChildProcess;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  closed: boolean;
  gitArchiveDir: string | null;
  gitArchiveError: string | null;
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
}): string {
  const lines = [
    `Chunk ID: ${input.chunkId}`,
    `Wall time: ${(input.durationMs / 1000).toFixed(4)} seconds`
  ];
  if (input.blocked) {
    lines.push('Process blocked by executor policy');
  } else if (input.running) {
    lines.push(`Process running with session ID ${input.sessionId || ''}`.trim());
  } else if (typeof input.exitCode === 'number') {
    lines.push(`Process exited with code ${input.exitCode}`);
  } else if (input.signal) {
    lines.push(`Process exited with signal ${input.signal}`);
  } else {
    lines.push('Process exited without an exit code');
  }
  lines.push(`Original token count: ${estimateTokenCount(input.output)}`);
  if (input.truncated) {
    lines.push('Output was truncated to max_output_tokens.');
  }
  lines.push('Output:', input.output);
  return lines.join('\n');
}

function estimateTokenCount(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
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

function appendCappedOutput(current: string, chunk: Buffer, maxChars: number): { value: string; truncated: boolean } {
  if (current.length >= maxChars) {
    return { value: current, truncated: true };
  }
  const next = current + chunk.toString('utf8');
  if (next.length <= maxChars) {
    return { value: next, truncated: false };
  }
  return { value: next.slice(0, maxChars), truncated: true };
}

async function ensureRuntimeDirectories() {
  await Promise.all([
    'sessions',
    'logs',
    'skills',
    'services',
    'artifacts',
    'registry',
    'git-archives'
  ].map((dir) => mkdir(path.join(runtimeRoot, dir), { recursive: true })));
}

function buildSessionFilePath(sessionId: string): string {
  return path.join(runtimeRoot, 'sessions', `${sessionId}.json`);
}

async function persistSession(session: RuntimeSession) {
  const snapshot = sessionToSnapshot(session);
  await writeFile(buildSessionFilePath(session.id), JSON.stringify(snapshot, null, 2));
}

async function appendAudit(event: string, payload: Record<string, unknown>, root = runtimeRoot) {
  const line = JSON.stringify({ event, at: new Date().toISOString(), ...payload });
  const logsDir = path.join(root, 'logs');
  await mkdir(logsDir, { recursive: true });
  await appendFile(path.join(logsDir, 'exec-command.jsonl'), `${line}\n`);
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
    duration_ms: Date.now() - session.startedAt,
    stdout: session.stdout,
    stderr: session.stderr,
    truncated: session.truncated,
    timed_out: session.timedOut,
    exit_code: session.exitCode,
    signal: session.signal,
    running: !session.closed,
    git_archive_dir: session.gitArchiveDir,
    git_archive_error: session.gitArchiveError
  };
}

function buildResultFromSession(session: RuntimeSession): ExecCommandResult {
  const output = session.stdout + session.stderr;
  const durationMs = Date.now() - session.startedAt;
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
    git_archive_dir: session.gitArchiveDir,
    git_archive_error: session.gitArchiveError,
    codex_output: formatCodexOutput({
      chunkId: session.chunkId,
      durationMs,
      exitCode: session.exitCode,
      signal: session.signal,
      running: !session.closed,
      sessionId: session.id,
      output,
      truncated: session.truncated
    })
  };
}

async function writeCommandOutput(filePath: string, command: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: workspaceRoot,
    maxBuffer: 50 * 1024 * 1024
  });
  await writeFile(filePath, `${stdout}${stderr}`);
}

function gitArgs(args: string[]): string[] {
  return ['-c', `safe.directory=${workspaceRoot}`, '-C', workspaceRoot, ...args];
}

async function createWorkspaceGitArchive(sessionId: string): Promise<{ dir: string | null; error: string | null }> {
  const archiveDir = path.join(runtimeRoot, 'git-archives', sessionId);
  try {
    await mkdir(archiveDir, { recursive: true });
    await writeCommandOutput(path.join(archiveDir, 'HEAD'), 'git', gitArgs(['rev-parse', 'HEAD']));
    await writeCommandOutput(path.join(archiveDir, 'branch'), 'git', gitArgs(['branch', '--show-current']));
    await writeCommandOutput(path.join(archiveDir, 'status.txt'), 'git', gitArgs(['status', '--porcelain=v1', '-uall']));
    await writeCommandOutput(path.join(archiveDir, 'diff.patch'), 'git', gitArgs(['diff', '--binary']));
    await writeCommandOutput(path.join(archiveDir, 'staged.diff.patch'), 'git', gitArgs(['diff', '--cached', '--binary']));
    const untrackedListPath = path.join(archiveDir, 'untracked-files.txt');
    await writeCommandOutput(untrackedListPath, 'git', gitArgs(['ls-files', '--others', '--exclude-standard']));
    const untrackedNullListPath = path.join(archiveDir, 'untracked-files.z');
    const { stdout: untrackedNullList } = await execFileAsync('git', gitArgs(['ls-files', '--others', '--exclude-standard', '-z']), {
      cwd: workspaceRoot,
      encoding: 'buffer',
      maxBuffer: 50 * 1024 * 1024
    });
    const untrackedBuffer = Buffer.isBuffer(untrackedNullList) ? untrackedNullList : Buffer.from(String(untrackedNullList));
    await writeFile(untrackedNullListPath, untrackedBuffer);
    if (untrackedBuffer.length > 0) {
      await execFileAsync('tar', ['--null', '-czf', path.join(archiveDir, 'untracked.tar.gz'), '-T', untrackedNullListPath], {
        cwd: workspaceRoot,
        maxBuffer: 50 * 1024 * 1024
      });
    }
    return { dir: archiveDir, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(path.join(archiveDir, 'archive-error.txt'), message).catch(() => undefined);
    return { dir: archiveDir, error: message };
  }
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
  const maxOutputTokens = clampNumber(args.max_output_tokens, 10_000, 1, 200_000);
  const maxOutputChars = Math.max(1, maxOutputTokens * 4);
  const yieldMs = clampNumber(args.yield_time_ms, 10_000, 250, 30_000);
  const policy = evaluateCommandPolicy(translatedCmd);
  if (!policy.allowed) {
    return buildBlockedResult(originalCmd, workdir, shell, login, sandboxPermissions, policy.reason || 'command blocked');
  }

  const sessionId = `exec_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const chunkId = randomUUID().slice(0, 8);
  const gitArchive = await createWorkspaceGitArchive(sessionId);
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
    gitArchiveDir: gitArchive.dir,
    gitArchiveError: gitArchive.error
  };
  sessions.set(session.id, session);
  await persistSession(session);
  await appendAudit('exec_start', { session_id: session.id, cmd: originalCmd, translated_cmd: translatedCmd, workdir, shell, git_archive_dir: gitArchive.dir, git_archive_error: gitArchive.error });

  session.child.stdout?.on('data', (chunk: Buffer) => {
    const next = appendCappedOutput(session.stdout, chunk, session.maxOutputChars);
    session.stdout = next.value;
    session.truncated = session.truncated || next.truncated;
    void persistSession(session);
  });
  session.child.stderr?.on('data', (chunk: Buffer) => {
    const next = appendCappedOutput(session.stderr, chunk, session.maxOutputChars);
    session.stderr = next.value;
    session.truncated = session.truncated || next.truncated;
    void persistSession(session);
  });
  session.child.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const next = appendCappedOutput(session.stderr, Buffer.from(message), session.maxOutputChars);
    session.stderr = next.value;
    session.truncated = session.truncated || next.truncated;
    session.exitCode = null;
    session.signal = null;
    session.closed = true;
    void persistSession(session);
    void appendAudit('exec_error', { session_id: session.id, error_message: message });
  });
  session.child.on('close', (code, signal) => {
    session.exitCode = typeof code === 'number' ? code : null;
    session.signal = signal || null;
    session.closed = true;
    void persistSession(session);
    void appendAudit('exec_close', { session_id: session.id, exit_code: session.exitCode, signal: session.signal });
  });

  return await new Promise((resolve) => {
    const done = () => resolve(buildResultFromSession(session));
    if (session.closed) {
      done();
      return;
    }
    const timeout = setTimeout(done, yieldMs);
    timeout.unref();
    session.child.once('close', () => {
      clearTimeout(timeout);
      done();
    });
    session.child.once('error', () => {
      clearTimeout(timeout);
      done();
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
      running: Boolean(snapshot.running),
      git_archive_dir: typeof snapshot.git_archive_dir === 'string' ? snapshot.git_archive_dir : null,
      git_archive_error: typeof snapshot.git_archive_error === 'string' ? snapshot.git_archive_error : null,
      codex_output: formatCodexOutput({
        chunkId,
        durationMs,
        exitCode: typeof snapshot.exit_code === 'number' ? snapshot.exit_code : null,
        signal: typeof snapshot.signal === 'string' ? snapshot.signal as NodeJS.Signals : null,
        running: Boolean(snapshot.running),
        sessionId,
        output,
        truncated: Boolean(snapshot.truncated)
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
