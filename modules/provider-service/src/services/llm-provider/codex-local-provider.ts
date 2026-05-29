import { AIConfig } from '../../types';
import { CodexProvider } from './codex-provider';

function resolveCodexLocalBaseUrl(): string {
  return (
    process.env.CODEX_LOCAL_BASE_URL ||
    'https://chatgpt.com/backend-api'
  ).replace(/\/+$/, '');
}

function resolveCodexLocalResponsesPath(): string {
  const value = process.env.CODEX_LOCAL_RESPONSES_PATH || '/codex/responses';
  return value.startsWith('/') ? value : `/${value}`;
}

export class CodexLocalProvider extends CodexProvider {
  readonly id = 'codex-local' as const;

  constructor(aiConfig: AIConfig) {
    super(aiConfig, {
      id: 'codex-local',
      disableProxy: true,
      localOAuth: true,
      baseUrl: resolveCodexLocalBaseUrl(),
      responsesPath: resolveCodexLocalResponsesPath()
    });
  }
}
