import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import { AgentLoopService, buildCanonicalAgentTurnRequest, buildInitialInput } from '../services/agent-loop-service';
import type { ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';
import type { QueueMessagePayload } from '../types';

function createQueuePayload(): QueueMessagePayload {
  return {
    traceId: 'trace-1',
    runId: 'run-1',
    batchId: 'batch-1',
    source: 'napcat',
    chatType: 'group',
    sessionKey: 'qq:group:101',
    peerId: '101',
    peerName: 'Test Group',
    senderId: '202',
    senderName: 'Alice',
    accountId: '303',
    bodyForAgent: '@bot 今天玩什么',
    rawBody: '@bot 今天玩什么',
    commandBody: '',
    wasMentioned: true,
    receivedAt: '2026-03-28T08:00:00.000Z',
    messageTimestamp: '2026-03-28T08:00:00.000Z',
    rawPayload: {},
    inboundContext: {
      Body: '@bot 今天玩什么',
      BodyForAgent: '@bot 今天玩什么',
      BodyForCommands: '@bot 今天玩什么',
      NativeChannelId: '101',
      CommandAuthorized: true
    },
    messages: [
      {
        queueMessageId: 1,
        traceId: 'trace-1',
        source: 'napcat',
        messageId: 11,
        messageSid: 'sid-1',
        chatType: 'group',
        sessionKey: 'qq:group:101',
        peerId: '101',
        peerName: 'Test Group',
        senderId: '202',
        senderName: 'Alice',
        accountId: '303',
        bodyForAgent: '@bot 今天玩什么',
        rawBody: '@bot 今天玩什么',
        commandBody: '',
        wasMentioned: true,
        receivedAt: '2026-03-28T08:00:00.000Z',
        messageTimestamp: '2026-03-28T08:00:00.000Z',
        rawPayload: {},
        inboundContext: {
          Body: '@bot 今天玩什么',
          BodyForAgent: '@bot 今天玩什么',
          BodyForCommands: '@bot 今天玩什么',
          NativeChannelId: '101',
          CommandAuthorized: true
        }
      }
    ]
  };
}

function createRuntimePrompt(overrides: Partial<ResolvedAgentRuntimePrompt> = {}): ResolvedAgentRuntimePrompt {
  return {
    source: 'default',
    promptId: null,
    promptName: 'agent_loop_v1',
    systemPrompt: agentConfig.systemPrompt,
    userPromptTemplate: null,
    contextVariables: {},
    runtimeVariables: {},
    modelName: agentConfig.modelName,
    parameters: {},
    ...overrides
  };
}

test('buildCanonicalAgentTurnRequest moves the synthetic system prompt into instructions', () => {
  const loopInput = buildInitialInput([
    {
      id: 1,
      userId: 202,
      groupId: 101,
      userMessage: '昨天有什么好玩的',
      aiResponse: '可以去看电影'
    }
  ], createQueuePayload());

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput);

  assert.equal(request.instructions, agentConfig.systemPrompt);
  assert.equal(request.input[0]?.type, 'message');
  assert.equal(request.input[0]?.role, 'user');
  assert.equal(request.input.some((item) => item.type === 'message' && item.role === 'system'), false);
  assert.equal(request.tool_choice, 'required');
  assert.equal(request.parallel_tool_calls, false);
});

test('executeAgentTurn sends the standard canonical request shape to provider-service', async () => {
  const loopInput = buildInitialInput([], createQueuePayload());
  loopInput.push({
    type: 'function_call',
    call_id: 'call-1',
    name: 'send_group_message',
    arguments: '{"message":"hi"}'
  });
  loopInput.push({
    type: 'function_call_output',
    call_id: 'call-1',
    output: '{"ok":true}'
  });

  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || '{}'))
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        llm_call_id: 'llm-1',
        canonical_response: {
          output: []
        }
      })
    } as any;
  }) as typeof fetch;

  try {
    await (service as any).executeAgentTurn(loopInput, 'trace-1', 2, createRuntimePrompt());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  const requestBody = calls[0].body;
  assert.equal(requestBody.trace_id, 'trace-1');
  assert.equal(requestBody.agent_turn, 2);
  assert.equal(requestBody.canonicalRequest.instructions, agentConfig.systemPrompt);
  assert.equal(requestBody.canonicalRequest.input[0].role, 'user');
  assert.equal(
    requestBody.canonicalRequest.input.some((item: any) => item.type === 'message' && item.role === 'system'),
    false
  );
  assert.deepEqual(
    requestBody.canonicalRequest.input.slice(-2).map((item: any) => item.type),
    ['function_call', 'function_call_output']
  );
  assert.equal(requestBody.canonicalRequest.tool_choice, 'required');
  assert.equal(requestBody.canonicalRequest.parallel_tool_calls, false);
});

test('buildInitialInput applies bound user prompt template to the current message block', () => {
  const loopInput = buildInitialInput([], createQueuePayload(), createRuntimePrompt({
    systemPrompt: '你是小腻主AGENT',
    userPromptTemplate: '群上下文如下：\n{{user_input}}\n签名：${sender_name}',
    runtimeVariables: {
      sender_name: 'Alice'
    }
  }));

  assert.equal(loopInput[0]?.type, 'message');
  assert.equal(loopInput[0]?.role, 'system');
  assert.equal(loopInput[0]?.content, '你是小腻主AGENT');
  assert.equal(loopInput[1]?.type, 'message');
  assert.equal(loopInput[1]?.role, 'user');
  assert.match(String(loopInput[1]?.content), /群上下文如下：/);
  assert.match(String(loopInput[1]?.content), /BatchMessages:/);
  assert.match(String(loopInput[1]?.content), /签名：Alice/);
});

test('executeAgentTurn forwards bound prompt metadata and prompt-specific model parameters', async () => {
  const service = new AgentLoopService({} as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<any> = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      json: async () => ({
        success: true,
        llm_call_id: 'llm-2',
        canonical_response: {
          output: []
        }
      })
    } as any;
  }) as typeof fetch;

  try {
    await (service as any).executeAgentTurn(
      buildInitialInput([], createQueuePayload()),
      'trace-2',
      1,
      createRuntimePrompt({
        source: 'group',
        promptId: 'prompt-1',
        promptName: '小腻主AGENT',
        modelName: 'gpt-5.4',
        parameters: {
          model_config: {
            providerSpecific: {
              reasoningEffort: 'high'
            }
          },
          advanced_config: {
            generationConfig: {
              maxOutputTokens: 4096
            }
          }
        }
      })
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt_name, '小腻主AGENT');
  assert.equal(calls[0].model, 'gpt-5.4');
  assert.deepEqual(calls[0].parameters, {
    model_config: {
      providerSpecific: {
        reasoningEffort: 'high'
      }
    },
    advanced_config: {
      generationConfig: {
        maxOutputTokens: 4096
      }
    }
  });
  assert.equal(calls[0].canonicalRequest.model, 'gpt-5.4');
});
