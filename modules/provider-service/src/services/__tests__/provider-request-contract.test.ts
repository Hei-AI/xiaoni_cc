import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodexLocalProvider } from '../llm-provider/codex-local-provider';
import { CodexProvider } from '../llm-provider/codex-provider';
import { GeminiCliProvider } from '../llm-provider/gemini-cli-provider';
import { OpenAIProvider } from '../llm-provider/openai-provider';
import type { OpenResponseCreateRequest, OpenResponseToolDefinition } from '../llm-provider/types';
import { buildRequestFromMessages, buildUnifiedConfig } from '../provider-debug-service';
import { buildTraceHeaders } from '../../utils/trace-headers';
import { runtimeStoreService } from '../runtime-store-service';

class TestOpenAIProvider extends OpenAIProvider {
  buildPayload(request: OpenResponseCreateRequest) {
    return this.buildResponsesPayload(request);
  }
}

class TestCodexProvider extends CodexProvider {
  buildPayload(request: OpenResponseCreateRequest) {
    return this.buildResponsesPayload(request);
  }

  transportDefaults() {
    return {
      baseUrl: this.baseUrl,
      responsesPath: this.responsesPath
    };
  }

  resolveApiKeyForTest() {
    return this.resolveApiKey();
  }

  postForTest(payload: Record<string, any>, traceHeaders: Record<string, string> = {}) {
    return this.postResponses(
      this.baseUrl,
      this.responsesPath,
      payload,
      'ignored-direct-token',
      1000,
      traceHeaders
    );
  }
}

class TestCodexLocalProvider extends CodexLocalProvider {
  buildPayload(request: OpenResponseCreateRequest) {
    return this.buildResponsesPayload(request);
  }

  transportDefaults() {
    return {
      baseUrl: this.baseUrl,
      responsesPath: this.responsesPath
    };
  }

  resolveApiKeyForTest() {
    return this.resolveApiKey();
  }
}

const TOOL_DEFINITIONS: OpenResponseToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Finish the current run.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          note: { type: 'string' }
        },
        required: ['reason'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'web_search',
    search_context_size: 'medium',
    external_web_access: true
  }
];

function createJwtWithExp(expSeconds: number): string {
  const encode = (value: Record<string, unknown>) => Buffer
    .from(JSON.stringify(value), 'utf8')
    .toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp: expSeconds })}.signature`;
}

function createCanonicalRequest(): OpenResponseCreateRequest {
  return {
    model: 'gpt-5.4-mini',
    instructions: 'System prompt from canonical request.',
    previous_response_id: 'resp_prev_789',
    prompt_cache_key: 'qq:group:101',
    prompt_cache_retention: '24h',
    store: false,
    input: [
      {
        type: 'message',
        role: 'user',
        content: 'Hello from the user.'
      }
    ],
    tools: TOOL_DEFINITIONS,
    tool_choice: 'required',
    parallel_tool_calls: false
  };
}

function createAllowedToolsRequest(): OpenResponseCreateRequest {
  return {
    ...createCanonicalRequest(),
    tool_choice: {
      type: 'allowed_tools',
      mode: 'required',
      tools: [
        { type: 'function', name: 'finish' }
      ]
    }
  };
}

test('OpenAI provider keeps canonical instructions top-level and preserves parallel_tool_calls', () => {
  const provider = new TestOpenAIProvider({} as any);
  const payload = provider.buildPayload(createCanonicalRequest());

  assert.equal(payload.instructions, 'System prompt from canonical request.');
  assert.equal(payload.parallel_tool_calls, false);
  assert.equal(Array.isArray(payload.input), true);
  assert.equal(payload.input[0]?.role, 'user');
  assert.equal(payload.input.some((item: any) => item?.role === 'system'), false);
  assert.equal(payload.tool_choice, 'required');
  assert.equal(payload.previous_response_id, 'resp_prev_789');
  assert.equal(payload.prompt_cache_key, 'qq:group:101');
  assert.equal(payload.prompt_cache_retention, '24h');
  assert.equal(payload.store, false);
  assert.equal(payload.tools[1]?.type, 'web_search');
  assert.equal(payload.tools[1]?.search_context_size, 'medium');
  assert.equal(payload.tools[1]?.external_web_access, true);
  assert.equal(payload.tools[0]?.strict, true);
  assert.deepEqual(payload.tools[0]?.parameters?.required, ['reason', 'note']);
  assert.deepEqual(payload.tools[0]?.parameters?.properties?.note?.type, ['string', 'null']);
});

test('OpenAI provider preserves function_call_output image content arrays', () => {
  const provider = new TestOpenAIProvider({} as any);
  const payload = provider.buildPayload({
    ...createCanonicalRequest(),
    input: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '让我来看看这个图是啥意思' }]
      },
      {
        type: 'function_call',
        call_id: 'call-image-asset-123',
        name: 'inspect_image_placeholder',
        arguments: '{"image_id":"asset-img-123","detail":"original"}'
      },
      {
        type: 'function_call_output',
        call_id: 'call-image-asset-123',
        output: [{
          type: 'input_image',
          image_url: 'data:image/png;base64,QUJDREVGRw==',
          detail: 'original'
        }]
      }
    ]
  });

  assert.deepEqual(payload.input[2], {
    type: 'function_call_output',
    call_id: 'call-image-asset-123',
    output: [{
      type: 'input_image',
      image_url: 'data:image/png;base64,QUJDREVGRw==',
      detail: 'original'
    }]
  });
});

test('OpenAI provider serializes allowed_tools without changing the tool list', () => {
  const provider = new TestOpenAIProvider({} as any);
  const payload = provider.buildPayload(createAllowedToolsRequest());

  assert.deepEqual(payload.tool_choice, {
    type: 'allowed_tools',
    mode: 'required',
    tools: [
      { type: 'function', name: 'finish' }
    ]
  });
  assert.equal(payload.tools.length, TOOL_DEFINITIONS.length);
});

test('OpenAI provider preserves top-level strict false on function tools', () => {
  const provider = new TestOpenAIProvider({} as any);
  const payload = provider.buildPayload({
    ...createCanonicalRequest(),
    tools: [
      {
        type: 'function',
        strict: false,
        function: {
          name: 'loose_action',
          description: 'Loose action parser.',
          parameters: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              optional_note: { type: 'string' }
            },
            required: ['reason'],
            additionalProperties: false
          }
        }
      }
    ]
  });

  assert.equal(payload.tools[0]?.strict, false);
  assert.deepEqual(payload.tools[0]?.parameters?.required, ['reason']);
  assert.equal(payload.tools[0]?.parameters?.properties?.optional_note?.type, 'string');
});

test('OpenAI provider preserves Responses text and context management fields', () => {
  const provider = new TestOpenAIProvider({} as any);
  const payload = provider.buildPayload({
    ...createCanonicalRequest(),
    text: {
      verbosity: 'medium'
    },
    context_management: [
      { type: 'compaction', compact_threshold: 200000 }
    ]
  } as any);

  assert.deepEqual(payload.text, { verbosity: 'medium' });
  assert.deepEqual(payload.context_management, [
    { type: 'compaction', compact_threshold: 200000 }
  ]);
});

test('Codex provider keeps canonical instructions top-level and preserves parallel_tool_calls', () => {
  const provider = new TestCodexProvider({} as any);
  const payload = provider.buildPayload(createCanonicalRequest());

  assert.equal(payload.instructions, 'System prompt from canonical request.');
  assert.equal(payload.parallel_tool_calls, false);
  assert.equal(Array.isArray(payload.input), true);
  assert.equal(payload.input[0]?.role, 'user');
  assert.equal(payload.input.some((item: any) => item?.role === 'system'), false);
  assert.equal(payload.tool_choice, 'required');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'previous_response_id'), false);
  assert.equal(payload.prompt_cache_key, 'qq:group:101');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'prompt_cache_retention'), false);
  assert.equal(payload.tools[1]?.type, 'web_search');
  assert.equal(payload.tools[1]?.search_context_size, 'medium');
  assert.equal(payload.tools[1]?.external_web_access, true);
  assert.equal(payload.tools[0]?.strict, true);
  assert.deepEqual(payload.tools[0]?.parameters?.required, ['reason', 'note']);
  assert.deepEqual(payload.tools[0]?.parameters?.properties?.note?.type, ['string', 'null']);
  assert.deepEqual(payload.text, { verbosity: 'low' });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'reasoning'), false);
  assert.deepEqual(payload.include, ['reasoning.encrypted_content']);
});

test('Codex provider preserves function_call_output image content arrays', () => {
  const provider = new TestCodexProvider({} as any);
  const payload = provider.buildPayload({
    ...createCanonicalRequest(),
    input: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '让我来看看这个图是啥意思' }]
      },
      {
        type: 'function_call',
        call_id: 'call-image-asset-123',
        name: 'inspect_image_placeholder',
        arguments: '{"image_id":"asset-img-123","detail":"original"}'
      },
      {
        type: 'function_call_output',
        call_id: 'call-image-asset-123',
        output: [{
          type: 'input_image',
          image_url: 'data:image/png;base64,QUJDREVGRw==',
          detail: 'original'
        }]
      }
    ]
  });

  assert.deepEqual(payload.input[2], {
    type: 'function_call_output',
    call_id: 'call-image-asset-123',
    output: [{
      type: 'input_image',
      image_url: 'data:image/png;base64,QUJDREVGRw==',
      detail: 'original'
    }]
  });
});

test('Codex provider serializes allowed_tools without changing the tool list', () => {
  const provider = new TestCodexProvider({} as any);
  const payload = provider.buildPayload(createAllowedToolsRequest());

  assert.deepEqual(payload.tool_choice, {
    type: 'allowed_tools',
    mode: 'required',
    tools: [
      { type: 'function', name: 'finish' }
    ]
  });
  assert.equal(payload.tools.length, TOOL_DEFINITIONS.length);
});

test('Codex provider preserves explicit reasoning settings and include values', () => {
  const provider = new TestCodexProvider({} as any);
  const payload = provider.buildPayload({
    ...createCanonicalRequest(),
    reasoning: {
      effort: 'high',
      summary: 'detailed'
    },
    include: ['reasoning.encrypted_content', 'file_search_call.results']
  });

  assert.deepEqual(payload.reasoning, {
    effort: 'high',
    summary: 'detailed'
  });
  assert.deepEqual(payload.include, ['reasoning.encrypted_content', 'file_search_call.results']);
});

test('Codex provider accepts gpt-5.5 medium stateless reasoning replay contract', () => {
  const provider = new TestCodexProvider({} as any);
  const payload = provider.buildPayload({
    ...createCanonicalRequest(),
    model: 'gpt-5.5',
    reasoning: {
      effort: 'medium',
      summary: 'auto'
    },
    text: {
      verbosity: 'medium'
    },
    include: ['reasoning.encrypted_content'],
    context_management: [
      { type: 'compaction', compact_threshold: 200000 }
    ]
  } as any);

  assert.equal(payload.model, 'gpt-5.5');
  assert.deepEqual(payload.reasoning, {
    effort: 'medium',
    summary: 'auto'
  });
  assert.deepEqual(payload.text, { verbosity: 'medium' });
  assert.deepEqual(payload.include, ['reasoning.encrypted_content']);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'context_management'), false);
});

test('Codex provider preserves empty reasoning summary for encrypted replay input', () => {
  const provider = new TestCodexProvider({} as any);
  const payload = provider.buildPayload({
    ...createCanonicalRequest(),
    input: [
      {
        type: 'message',
        role: 'user',
        content: 'Continue from the previous tool result.'
      },
      {
        type: 'reasoning',
        summary: [],
        encrypted_content: 'enc-reasoning-state'
      }
    ]
  });

  assert.deepEqual(payload.input[1], {
    type: 'reasoning',
    summary: [],
    encrypted_content: 'enc-reasoning-state'
  });
});

test('Codex provider defaults proxy-key mode to CLIProxyAPI Codex direct route', async () => {
  const previousEnv = {
    CODEX_BASE_URL: process.env.CODEX_BASE_URL,
    CODEX_PROXY_BASE_URL: process.env.CODEX_PROXY_BASE_URL,
    CODEX_PROXY_API_KEY: process.env.CODEX_PROXY_API_KEY
  };

  try {
    delete process.env.CODEX_BASE_URL;
    delete process.env.CODEX_PROXY_BASE_URL;
    delete process.env.CODEX_PROXY_API_KEY;

    const provider = new TestCodexProvider({
      codex_proxy_api_key: 'proxy-key',
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    assert.deepEqual(provider.transportDefaults(), {
      baseUrl: 'http://host.docker.internal:8317/backend-api',
      responsesPath: '/codex/responses'
    });
    assert.equal(await provider.resolveApiKeyForTest(), 'proxy-key');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('Codex local provider uses Codex auth.json against the direct Codex backend', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-local-auth-'));
  const authPath = path.join(authDir, 'auth.json');
  const authProfilesPath = path.join(authDir, 'auth-profiles.json');
  const accessToken = createJwtWithExp(Math.floor(Date.now() / 1000) + 300);
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'local-refresh-token',
      expires_at: null
    }
  }), 'utf8');

  const previousEnv = {
    CODEX_LOCAL_BASE_URL: process.env.CODEX_LOCAL_BASE_URL,
    CODEX_LOCAL_RESPONSES_PATH: process.env.CODEX_LOCAL_RESPONSES_PATH,
    CODEX_LOCAL_OAUTH_ACCESS_TOKEN: process.env.CODEX_LOCAL_OAUTH_ACCESS_TOKEN,
    CODEX_LOCAL_AUTH_PROFILES_PATH: process.env.CODEX_LOCAL_AUTH_PROFILES_PATH,
    CODEX_OAUTH_ACCESS_TOKEN: process.env.CODEX_OAUTH_ACCESS_TOKEN,
    CODEX_PROXY_API_KEY: process.env.CODEX_PROXY_API_KEY
  };

  try {
    delete process.env.CODEX_LOCAL_BASE_URL;
    delete process.env.CODEX_LOCAL_RESPONSES_PATH;
    delete process.env.CODEX_LOCAL_OAUTH_ACCESS_TOKEN;
    process.env.CODEX_LOCAL_AUTH_PROFILES_PATH = authProfilesPath;
    delete process.env.CODEX_OAUTH_ACCESS_TOKEN;
    process.env.CODEX_PROXY_API_KEY = 'proxy-key-ignored-by-local-provider';

    const provider = new TestCodexLocalProvider({
      codex_oauth_path: authPath,
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    assert.deepEqual(provider.transportDefaults(), {
      baseUrl: 'https://chatgpt.com/backend-api',
      responsesPath: '/codex/responses'
    });
    assert.equal(await provider.resolveApiKeyForTest(), accessToken);

    const authProfiles = JSON.parse(fs.readFileSync(authProfilesPath, 'utf8'));
    assert.equal(authProfiles.version, 1);
    assert.equal(authProfiles.profiles['openai:default'].type, 'oauth');
    assert.equal(authProfiles.profiles['openai:default'].provider, 'openai');
    assert.equal(authProfiles.profiles['openai:default'].access, accessToken);
    assert.equal(authProfiles.profiles['openai:default'].refresh, 'local-refresh-token');

    const payload = provider.buildPayload({
      model: 'gpt-5.4-mini',
      stream: true,
      instructions: 'Be concise.',
      input: [{ type: 'message', role: 'user', content: 'ping' }]
    });

    assert.equal(payload.model, 'gpt-5.4-mini');
    assert.equal(payload.instructions, 'Be concise.');
    assert.equal(payload.stream, true);
    assert.deepEqual(payload.text, { verbosity: 'low' });
    assert.equal(payload.tool_choice, 'auto');
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'reasoning'), false);
    assert.deepEqual(payload.include, ['reasoning.encrypted_content']);
    assert.deepEqual(payload.input, [{ type: 'message', role: 'user', content: 'ping' }]);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(authDir, { recursive: true, force: true });
  }
});

test('Codex local provider prefers auth-profiles over the Codex CLI auth bootstrap', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-local-auth-profiles-'));
  const authPath = path.join(authDir, 'auth.json');
  const authProfilesPath = path.join(authDir, 'auth-profiles.json');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: 'cli-bootstrap-access-token',
      refresh_token: 'cli-bootstrap-refresh-token',
      expires_at: Date.now() + 300_000
    }
  }), 'utf8');
  fs.writeFileSync(authProfilesPath, JSON.stringify({
    version: 1,
    profiles: {
      'openai:default': {
        type: 'oauth',
        provider: 'openai',
        access: 'profile-access-token',
        refresh: 'profile-refresh-token',
        expires: Date.now() + 300_000
      }
    }
  }), 'utf8');

  const previousEnv = {
    CODEX_LOCAL_OAUTH_ACCESS_TOKEN: process.env.CODEX_LOCAL_OAUTH_ACCESS_TOKEN,
    CODEX_LOCAL_AUTH_PROFILES_PATH: process.env.CODEX_LOCAL_AUTH_PROFILES_PATH,
    CODEX_OAUTH_ACCESS_TOKEN: process.env.CODEX_OAUTH_ACCESS_TOKEN,
    CODEX_PROXY_API_KEY: process.env.CODEX_PROXY_API_KEY
  };

  try {
    delete process.env.CODEX_LOCAL_OAUTH_ACCESS_TOKEN;
    process.env.CODEX_LOCAL_AUTH_PROFILES_PATH = authProfilesPath;
    delete process.env.CODEX_OAUTH_ACCESS_TOKEN;
    process.env.CODEX_PROXY_API_KEY = 'proxy-key-ignored-by-local-provider';

    const provider = new TestCodexLocalProvider({
      codex_oauth_path: authPath,
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    assert.equal(await provider.resolveApiKeyForTest(), 'profile-access-token');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(authDir, { recursive: true, force: true });
  }
});

test('Codex local provider derives auth.json expiry from JWT and writes refresh results to auth-profiles only', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-local-jwt-expiry-auth-'));
  const authPath = path.join(authDir, 'auth.json');
  const authProfilesPath = path.join(authDir, 'auth-profiles.json');
  const expiredAccessToken = createJwtWithExp(Math.floor(Date.now() / 1000) - 300);
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: expiredAccessToken,
      refresh_token: 'local-refresh-token',
      expires_at: null
    }
  }), 'utf8');

  const previousFetch = globalThis.fetch;
  const previousEnv = {
    CODEX_LOCAL_OAUTH_ACCESS_TOKEN: process.env.CODEX_LOCAL_OAUTH_ACCESS_TOKEN,
    CODEX_LOCAL_OAUTH_REFRESH_TOKEN: process.env.CODEX_LOCAL_OAUTH_REFRESH_TOKEN,
    CODEX_LOCAL_OAUTH_EXPIRES_AT: process.env.CODEX_LOCAL_OAUTH_EXPIRES_AT,
    CODEX_LOCAL_AUTH_PROFILES_PATH: process.env.CODEX_LOCAL_AUTH_PROFILES_PATH,
    CODEX_OAUTH_ACCESS_TOKEN: process.env.CODEX_OAUTH_ACCESS_TOKEN,
    CODEX_OAUTH_REFRESH_TOKEN: process.env.CODEX_OAUTH_REFRESH_TOKEN,
    CODEX_OAUTH_EXPIRES_AT: process.env.CODEX_OAUTH_EXPIRES_AT,
    CODEX_PROXY_API_KEY: process.env.CODEX_PROXY_API_KEY
  };
  let refreshCalls = 0;

  try {
    delete process.env.CODEX_LOCAL_OAUTH_ACCESS_TOKEN;
    delete process.env.CODEX_LOCAL_OAUTH_REFRESH_TOKEN;
    delete process.env.CODEX_LOCAL_OAUTH_EXPIRES_AT;
    process.env.CODEX_LOCAL_AUTH_PROFILES_PATH = authProfilesPath;
    delete process.env.CODEX_OAUTH_ACCESS_TOKEN;
    delete process.env.CODEX_OAUTH_REFRESH_TOKEN;
    delete process.env.CODEX_OAUTH_EXPIRES_AT;
    process.env.CODEX_PROXY_API_KEY = 'proxy-key-ignored-by-local-provider';

    (globalThis as any).fetch = async () => {
      refreshCalls += 1;
      return {
        ok: true,
        json: async () => ({
          access_token: 'refreshed-from-jwt-expiry',
          refresh_token: 'refreshed-refresh-token',
          expires_in: 3600
        }),
        text: async () => ''
      };
    };

    const provider = new TestCodexLocalProvider({
      codex_oauth_path: authPath,
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    assert.equal(await provider.resolveApiKeyForTest(), 'refreshed-from-jwt-expiry');
    assert.equal(refreshCalls, 1);

    const persisted = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.equal(persisted.tokens.access_token, expiredAccessToken);
    assert.equal(persisted.tokens.refresh_token, 'local-refresh-token');
    assert.equal(persisted.tokens.expires_at, null);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'last_refresh'), false);

    const authProfiles = JSON.parse(fs.readFileSync(authProfilesPath, 'utf8'));
    assert.equal(authProfiles.profiles['openai:default'].access, 'refreshed-from-jwt-expiry');
    assert.equal(authProfiles.profiles['openai:default'].refresh, 'refreshed-refresh-token');
  } finally {
    (globalThis as any).fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(authDir, { recursive: true, force: true });
  }
});

test('Codex local provider does not persist refreshed OAuth credentials to auth.json', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-local-refresh-auth-'));
  const authPath = path.join(authDir, 'auth.json');
  const authProfilesPath = path.join(authDir, 'auth-profiles.json');
  const expiresAt = Date.now() - 300_000;
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: 'expired-local-access-token',
      refresh_token: 'local-refresh-token',
      expires_at: expiresAt
    }
  }), 'utf8');

  const previousFetch = globalThis.fetch;
  const previousEnv = {
    CODEX_LOCAL_BASE_URL: process.env.CODEX_LOCAL_BASE_URL,
    CODEX_LOCAL_RESPONSES_PATH: process.env.CODEX_LOCAL_RESPONSES_PATH,
    CODEX_LOCAL_OAUTH_ACCESS_TOKEN: process.env.CODEX_LOCAL_OAUTH_ACCESS_TOKEN,
    CODEX_LOCAL_OAUTH_REFRESH_TOKEN: process.env.CODEX_LOCAL_OAUTH_REFRESH_TOKEN,
    CODEX_LOCAL_OAUTH_EXPIRES_AT: process.env.CODEX_LOCAL_OAUTH_EXPIRES_AT,
    CODEX_LOCAL_AUTH_PROFILES_PATH: process.env.CODEX_LOCAL_AUTH_PROFILES_PATH,
    CODEX_OAUTH_ACCESS_TOKEN: process.env.CODEX_OAUTH_ACCESS_TOKEN,
    CODEX_OAUTH_REFRESH_TOKEN: process.env.CODEX_OAUTH_REFRESH_TOKEN,
    CODEX_OAUTH_EXPIRES_AT: process.env.CODEX_OAUTH_EXPIRES_AT,
    CODEX_PROXY_API_KEY: process.env.CODEX_PROXY_API_KEY
  };
  let refreshCalls = 0;

  try {
    delete process.env.CODEX_LOCAL_BASE_URL;
    delete process.env.CODEX_LOCAL_RESPONSES_PATH;
    delete process.env.CODEX_LOCAL_OAUTH_ACCESS_TOKEN;
    delete process.env.CODEX_LOCAL_OAUTH_REFRESH_TOKEN;
    delete process.env.CODEX_LOCAL_OAUTH_EXPIRES_AT;
    process.env.CODEX_LOCAL_AUTH_PROFILES_PATH = authProfilesPath;
    delete process.env.CODEX_OAUTH_ACCESS_TOKEN;
    delete process.env.CODEX_OAUTH_REFRESH_TOKEN;
    delete process.env.CODEX_OAUTH_EXPIRES_AT;
    process.env.CODEX_PROXY_API_KEY = 'proxy-key-ignored-by-local-provider';

    (globalThis as any).fetch = async (url: string, init: any) => {
      refreshCalls += 1;
      assert.equal(url, 'https://auth.openai.com/oauth/token');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.body?.get('grant_type'), 'refresh_token');
      assert.equal(init?.body?.get('refresh_token'), 'local-refresh-token');
      return {
        ok: true,
        json: async () => ({
          access_token: 'refreshed-local-access-token',
          refresh_token: 'refreshed-local-refresh-token',
          expires_in: 3600
        }),
        text: async () => ''
      };
    };

    const provider = new TestCodexLocalProvider({
      codex_oauth_path: authPath,
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    assert.equal(await provider.resolveApiKeyForTest(), 'refreshed-local-access-token');
    assert.equal(refreshCalls, 1);

    const persisted = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    assert.equal(persisted.tokens.access_token, 'expired-local-access-token');
    assert.equal(persisted.tokens.refresh_token, 'local-refresh-token');
    assert.equal(persisted.tokens.expires_at, expiresAt);
    assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'last_refresh'), false);

    const authProfiles = JSON.parse(fs.readFileSync(authProfilesPath, 'utf8'));
    assert.equal(authProfiles.profiles['openai:default'].access, 'refreshed-local-access-token');
    assert.equal(authProfiles.profiles['openai:default'].refresh, 'refreshed-local-refresh-token');

    const nextProvider = new TestCodexLocalProvider({
      codex_oauth_path: authPath,
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });
    assert.equal(await nextProvider.resolveApiKeyForTest(), 'refreshed-local-access-token');
    assert.equal(refreshCalls, 1);
  } finally {
    (globalThis as any).fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(authDir, { recursive: true, force: true });
  }
});

test('Codex provider sends CLIProxyAPI proxy requests as SSE and assembles the response', async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: any }> = [];

  try {
    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => [
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"hello"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}',
          ''
        ].join('\n')
      };
    };

    const provider = new TestCodexProvider({
      codex_base_url: 'http://proxy.test/backend-api',
      codex_proxy_api_key: 'proxy-key',
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    const response = await provider.postForTest({
      model: 'gpt-5.4-mini',
      stream: true,
      input: [{ type: 'message', role: 'user', content: 'ping' }]
    }, {
      session_id: 'qq:group:101',
      'x-codex-turn-metadata': '{"session_id":"qq:group:101"}'
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://proxy.test/backend-api/codex/responses');
    assert.equal(calls[0]?.init?.headers?.Authorization, 'Bearer proxy-key');
    assert.equal(calls[0]?.init?.headers?.accept, 'text/event-stream');
    assert.equal(calls[0]?.init?.headers?.['content-type'], 'application/json');
    assert.equal(calls[0]?.init?.headers?.session_id, 'qq:group:101');
    assert.equal(calls[0]?.init?.headers?.['x-client-request-id'], 'qq:group:101');
    assert.equal(calls[0]?.init?.headers?.['chatgpt-account-id'], undefined);
    assert.equal(calls[0]?.init?.headers?.originator, 'openclaw');
    assert.match(calls[0]?.init?.headers?.['User-Agent'], /^openclaw \(/);
    assert.equal(JSON.parse(calls[0]?.init?.body).stream, true);
    assert.equal(response.output_text, 'hello');
    assert.equal(response.usage.total_tokens, 4);
  } finally {
    (globalThis as any).fetch = previousFetch;
  }
});

test('Codex provider retries transient upstream fetch failures before failing the agent turn', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    CODEX_TRANSIENT_RETRY_ATTEMPTS: process.env.CODEX_TRANSIENT_RETRY_ATTEMPTS,
    CODEX_TRANSIENT_RETRY_BASE_DELAY_MS: process.env.CODEX_TRANSIENT_RETRY_BASE_DELAY_MS
  };
  const calls: Array<{ url: string; init: any }> = [];

  try {
    process.env.CODEX_TRANSIENT_RETRY_ATTEMPTS = '3';
    process.env.CODEX_TRANSIENT_RETRY_BASE_DELAY_MS = '1';

    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        const error = new TypeError('fetch failed') as TypeError & { cause?: { code: string } };
        error.cause = { code: 'ECONNRESET' };
        throw error;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => [
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"recovered"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}',
          ''
        ].join('\n')
      };
    };

    const provider = new TestCodexProvider({
      codex_base_url: 'http://proxy.test/backend-api',
      codex_proxy_api_key: 'proxy-key',
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    const response = await provider.postForTest({
      model: 'gpt-5.4-mini',
      stream: true,
      input: [{ type: 'message', role: 'user', content: 'ping' }]
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'http://proxy.test/backend-api/codex/responses');
    assert.equal(calls[1]?.url, 'http://proxy.test/backend-api/codex/responses');
    assert.equal(response.output_text, 'recovered');
    assert.equal(response.usage.total_tokens, 5);
  } finally {
    (globalThis as any).fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('Codex provider does not treat OAuth failures as transient retry errors', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    CODEX_TRANSIENT_RETRY_ATTEMPTS: process.env.CODEX_TRANSIENT_RETRY_ATTEMPTS,
    CODEX_TRANSIENT_RETRY_BASE_DELAY_MS: process.env.CODEX_TRANSIENT_RETRY_BASE_DELAY_MS
  };
  const calls: Array<{ url: string; init: any }> = [];

  try {
    process.env.CODEX_TRANSIENT_RETRY_ATTEMPTS = '3';
    process.env.CODEX_TRANSIENT_RETRY_BASE_DELAY_MS = '1';

    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push({ url, init });
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => '{"detail":"Unauthorized"}'
      };
    };

    const provider = new TestCodexProvider({
      codex_base_url: 'http://proxy.test/backend-api',
      codex_proxy_api_key: 'proxy-key',
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });

    await assert.rejects(
      () => provider.postForTest({
        model: 'gpt-5.4-mini',
        stream: true,
        input: [{ type: 'message', role: 'user', content: 'ping' }]
      }),
      /Codex API error \(401 Unauthorized\)/
    );
    assert.equal(calls.length, 1);
  } finally {
    (globalThis as any).fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('Gemini CLI provider rejects structured allowed_tools tool_choice', () => {
  const provider = new GeminiCliProvider({} as any);

  assert.throws(
    () => (provider as any).buildRequestPayload({
      modelName: 'gemini-2.5-flash',
      providerConfig: undefined,
      request: createAllowedToolsRequest()
    }, 'test-project'),
    /does not support structured tool_choice objects/
  );
});

test('Codex provider preserves reasoning summary and encrypted content from SSE output', () => {
  const provider = new TestCodexProvider({} as any);
  const parsed = (provider as any).parseCodexSsePayload([
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"reasoning","encrypted_content":"enc","summary":[{"type":"summary_text","text":"done"}]}}',
    '',
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}'
  ].join('\n'));

  assert.deepEqual(parsed.output[0], {
    type: 'reasoning',
    summary: [{
      type: 'summary_text',
      text: 'done'
    }],
    encrypted_content: 'enc'
  });
  assert.equal(parsed.output[1]?.type, 'message');
  assert.equal(parsed.output_text, 'hello');
});

test('Codex provider keeps empty reasoning summary on SSE output when omitted', () => {
  const provider = new TestCodexProvider({} as any);
  const parsed = (provider as any).parseCodexSsePayload([
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"reasoning","encrypted_content":"enc"}}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}'
  ].join('\n'));

  assert.deepEqual(parsed.output[0], {
    type: 'reasoning',
    summary: [],
    encrypted_content: 'enc'
  });
});

test('Codex provider preserves web search items from SSE output', () => {
  const provider = new TestCodexProvider({} as any);
  const parsed = (provider as any).parseCodexSsePayload([
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"web_search_call","id":"ws_1","status":"completed","action":{"type":"search","queries":["qq bot latest"]}}}',
    '',
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done","annotations":[{"type":"url_citation","url":"https://example.com","title":"Example"}]}]}}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"status":"completed"}}'
  ].join('\n'));

  assert.deepEqual(parsed.output[0], {
    type: 'web_search_call',
    id: 'ws_1',
    status: 'completed',
    action: {
      type: 'search',
      queries: ['qq bot latest']
    }
  });
  assert.equal(parsed.output[1]?.type, 'message');
  assert.deepEqual(parsed.output[1]?.content?.[0]?.annotations, [{
    type: 'url_citation',
    url: 'https://example.com',
    title: 'Example'
  }]);
});

test('buildTraceHeaders emits Codex-compatible session metadata headers', () => {
  const headers = buildTraceHeaders({
    traceId: 'trace-1',
    agentTurn: 2,
    llmCallId: 'llm-1',
    sessionId: 'qq:group:101',
    turnId: 'run-1',
    sandbox: 'none'
  });

  assert.equal(headers['x-trace-id'], 'trace-1');
  assert.equal(headers['x-agent-turn'], '2');
  assert.equal(headers['x-llm-call-id'], 'llm-1');
  assert.equal(headers.session_id, 'qq:group:101');
  assert.match(headers['x-codex-turn-metadata'], /"session_id":"qq:group:101"/);
  assert.match(headers['x-codex-turn-metadata'], /"turn_id":"run-1"/);
  assert.match(headers['x-codex-turn-metadata'], /"sandbox":"none"/);
});

test('Codex provider records only the recovered provider request after internal retry succeeds', async () => {
  const previousFetch = globalThis.fetch;
  const previousRecordProviderReplayEvent = runtimeStoreService.recordProviderReplayEvent;
  const previousEnv = {
    CODEX_TRANSIENT_RETRY_ATTEMPTS: process.env.CODEX_TRANSIENT_RETRY_ATTEMPTS,
    CODEX_TRANSIENT_RETRY_BASE_DELAY_MS: process.env.CODEX_TRANSIENT_RETRY_BASE_DELAY_MS
  };
  const replayEvents: any[] = [];
  let fetchCount = 0;

  try {
    process.env.CODEX_TRANSIENT_RETRY_ATTEMPTS = '2';
    process.env.CODEX_TRANSIENT_RETRY_BASE_DELAY_MS = '1';
    runtimeStoreService.recordProviderReplayEvent = async (event: any) => {
      replayEvents.push(event);
      return { eventId: 'provider:codex:llm-recovered' } as any;
    };
    (globalThis as any).fetch = async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return {
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          text: async () => '{"error":"temporary"}'
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => [
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"recovered"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"resp_recovered","status":"completed","usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}',
          ''
        ].join('\n')
      };
    };

    const provider = new TestCodexProvider({
      codex_base_url: 'http://proxy.test/backend-api',
      codex_proxy_api_key: 'proxy-key',
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });
    const config = buildUnifiedConfig('gpt-5.4-mini', 'codex', {}, 'Prompt from provider debug');

    const result = await provider.generateContent({
      request: {
        model: 'gpt-5.4-mini',
        input: [{ type: 'message', role: 'user', content: 'ping' }]
      },
      modelName: 'gpt-5.4-mini',
      providerConfig: config,
      context: {
        traceId: 'trace-recovered',
        llmCallId: 'llm-recovered',
        replayIdentityKey: 'xiaoni'
      }
    });

    assert.equal(fetchCount, 2);
    assert.equal(result.text, 'recovered');
    assert.equal(replayEvents.length, 1);
    assert.equal(replayEvents[0].errorMessage, null);
    assert.equal(replayEvents[0].wireProviderFormat, 'codex/responses');
    assert.equal(replayEvents[0].wireResponse.output_text, 'recovered');
  } finally {
    (globalThis as any).fetch = previousFetch;
    runtimeStoreService.recordProviderReplayEvent = previousRecordProviderReplayEvent;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('Codex provider does not write failed requests into the replay ledger after retry exhaustion', async () => {
  const previousFetch = globalThis.fetch;
  const previousRecordProviderReplayEvent = runtimeStoreService.recordProviderReplayEvent;
  const previousEnv = {
    CODEX_TRANSIENT_RETRY_ATTEMPTS: process.env.CODEX_TRANSIENT_RETRY_ATTEMPTS,
    CODEX_TRANSIENT_RETRY_BASE_DELAY_MS: process.env.CODEX_TRANSIENT_RETRY_BASE_DELAY_MS
  };
  let replayWrites = 0;

  try {
    process.env.CODEX_TRANSIENT_RETRY_ATTEMPTS = '2';
    process.env.CODEX_TRANSIENT_RETRY_BASE_DELAY_MS = '1';
    runtimeStoreService.recordProviderReplayEvent = async () => {
      replayWrites += 1;
      return { eventId: 'unexpected' } as any;
    };
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => '{"error":"still broken"}'
    });

    const provider = new TestCodexProvider({
      codex_base_url: 'http://proxy.test/backend-api',
      codex_proxy_api_key: 'proxy-key',
      authorized_user_id: 1,
      bot_qq_number: 2,
      gemini_api_keys: [],
      model_name: 'gpt-5.4-mini'
    });
    const config = buildUnifiedConfig('gpt-5.4-mini', 'codex', {}, 'Prompt from provider debug');

    await assert.rejects(
      () => provider.generateContent({
        request: {
          model: 'gpt-5.4-mini',
          input: [{ type: 'message', role: 'user', content: 'ping' }]
        },
        modelName: 'gpt-5.4-mini',
        providerConfig: config,
        context: {
          traceId: 'trace-failed',
          llmCallId: 'llm-failed',
          replayIdentityKey: 'xiaoni'
        }
      }),
      /Codex API error \(502 Bad Gateway\)/
    );
    assert.equal(replayWrites, 0);
  } finally {
    (globalThis as any).fetch = previousFetch;
    runtimeStoreService.recordProviderReplayEvent = previousRecordProviderReplayEvent;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('provider debug request builder maps systemPrompt into instructions instead of a synthetic system input message', () => {
  const config = buildUnifiedConfig('gpt-5.4-mini', 'codex', {}, 'Prompt from provider debug');
  const request = buildRequestFromMessages(
    'gpt-5.4-mini',
    'Prompt from provider debug',
    [
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First answer' }
    ],
    config
  );

  assert.equal(request.instructions, 'Prompt from provider debug');
  assert.equal(Array.isArray(request.input), true);
  assert.equal((request.input as any[])[0]?.role, 'user');
  assert.equal((request.input as any[]).some((item) => item?.role === 'system'), false);
});
