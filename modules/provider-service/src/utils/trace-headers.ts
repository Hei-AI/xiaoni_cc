import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export interface TraceCorrelationContext {
  traceId?: string;
  conversationId?: string;
  agentTurn?: number;
  llmCallId?: string;
  toolCallId?: string;
  sessionId?: string;
  turnId?: string;
  sandbox?: string;
}

type WorkspaceDescriptor = {
  associated_remote_urls?: {
    origin?: string;
  };
  latest_git_commit_hash?: string;
  has_changes?: boolean;
};

let cachedWorkspaceMetadata: Record<string, WorkspaceDescriptor> | null | undefined;

function findWorkspaceRoot(startDir: string) {
  let current = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function readGitValue(args: string[], cwd: string) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function resolveWorkspaceMetadata() {
  if (cachedWorkspaceMetadata !== undefined) {
    return cachedWorkspaceMetadata;
  }

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  if (!workspaceRoot) {
    cachedWorkspaceMetadata = null;
    return cachedWorkspaceMetadata;
  }

  const origin = readGitValue(['config', '--get', 'remote.origin.url'], workspaceRoot);
  const latestGitCommitHash = readGitValue(['rev-parse', 'HEAD'], workspaceRoot);
  const hasChanges = readGitValue(['status', '--porcelain'], workspaceRoot).length > 0;

  cachedWorkspaceMetadata = {
    [workspaceRoot]: {
      ...(origin ? { associated_remote_urls: { origin } } : {}),
      ...(latestGitCommitHash ? { latest_git_commit_hash: latestGitCommitHash } : {}),
      has_changes: hasChanges
    }
  };
  return cachedWorkspaceMetadata;
}

export function buildTraceHeaders(
  context?: TraceCorrelationContext
): Record<string, string> {
  if (!context) {
    return {};
  }

  const headers: Record<string, string> = {};

  if (context.traceId) {
    headers['x-trace-id'] = context.traceId;
  }
  if (context.conversationId) {
    headers['x-conversation-id'] = context.conversationId;
  }
  if (typeof context.agentTurn === 'number' && Number.isFinite(context.agentTurn)) {
    headers['x-agent-turn'] = String(context.agentTurn);
  }
  if (context.llmCallId) {
    headers['x-llm-call-id'] = context.llmCallId;
  }
  if (context.toolCallId) {
    headers['x-tool-call-id'] = context.toolCallId;
  }
  if (context.sessionId) {
    headers.session_id = context.sessionId;
  }
  if (context.sessionId || context.turnId) {
    const turnMetadata: Record<string, unknown> = {
      ...(context.sessionId ? { session_id: context.sessionId } : {}),
      ...(context.turnId ? { turn_id: context.turnId } : {}),
      sandbox: context.sandbox || 'none'
    };
    const workspaceMetadata = resolveWorkspaceMetadata();
    if (workspaceMetadata && Object.keys(workspaceMetadata).length > 0) {
      turnMetadata.workspaces = workspaceMetadata;
    }
    headers['x-codex-turn-metadata'] = JSON.stringify(turnMetadata);
  }

  return headers;
}
