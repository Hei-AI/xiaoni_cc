import path from 'path';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';

const moduleLogger = logger.createModuleLogger('token-estimator');

export type TokenEstimate = {
  inputTokens: number;
  model: string;
  encoding: string;
  source: 'tiktoken' | 'heuristic';
};

function resolveTokenizerScriptPath() {
  const explicitPath = process.env.AGENT_TOKENIZER_SCRIPT;
  if (typeof explicitPath === 'string' && explicitPath.trim()) {
    return explicitPath.trim();
  }

  const candidates = [
    path.resolve(process.cwd(), 'scripts/token_count.py'),
    path.resolve(process.cwd(), 'modules/agent-service/scripts/token_count.py')
  ];

  return candidates[0];
}

function fallbackEstimate(text: string, model: string): TokenEstimate {
  return {
    inputTokens: Math.max(1, Math.ceil(text.length * 0.8)),
    model,
    encoding: 'heuristic',
    source: 'heuristic'
  };
}

export async function estimateTextTokens(params: {
  model: string;
  text: string;
}): Promise<TokenEstimate> {
  const scriptPath = resolveTokenizerScriptPath();
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.env.AGENT_TOKENIZER_PYTHON || 'python3',
        [scriptPath],
        {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `tokenizer exited with ${code}`));
          return;
        }
        resolve(stdout);
      });
      child.stdin.end(JSON.stringify({
        model: params.model,
        text: params.text
      }));
    });
    const payload = JSON.parse(stdout || '{}') as {
      ok?: boolean;
      input_tokens?: number;
      model?: string;
      encoding?: string;
      error?: string;
    };
    if (!payload.ok || !Number.isFinite(Number(payload.input_tokens))) {
      throw new Error(payload.error || 'token_count_failed');
    }
    return {
      inputTokens: Math.trunc(Number(payload.input_tokens)),
      model: typeof payload.model === 'string' ? payload.model : params.model,
      encoding: typeof payload.encoding === 'string' ? payload.encoding : 'unknown',
      source: 'tiktoken'
    };
  } catch (error) {
    moduleLogger.warn('Falling back to heuristic token estimate', {
      model: params.model,
      scriptPath,
      error: error instanceof Error ? error.message : String(error)
    });
    return fallbackEstimate(params.text, params.model);
  }
}
