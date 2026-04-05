#!/usr/bin/env node
'use strict';

const path = require('path');

const {
  buildInitialInput,
  buildCanonicalAgentTurnRequest
} = require(path.resolve(__dirname, '../../../modules/agent-service/dist/services/agent-loop-service.js'));
const { agentConfig } = require(path.resolve(__dirname, '../../../modules/agent-service/dist/config.js'));

function estimateTokens(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 0;
  }
  return Math.ceil(value.length / 4);
}

function createQueuePayload() {
  return {
    traceId: 'trace-preview-1',
    runId: 'run-preview-1',
    batchId: 'batch-preview-1',
    source: 'napcat',
    chatType: 'group',
    sessionKey: 'qq:group:101',
    peerId: '101',
    peerName: 'Test Group',
    senderId: '202',
    senderName: 'Alice',
    accountId: '303',
    bodyForAgent: '你昨天说的奶茶圣经到底是什么梗',
    rawBody: '你昨天说的奶茶圣经到底是什么梗',
    commandBody: '',
    wasMentioned: true,
    receivedAt: '2026-04-04T01:00:00.000Z',
    messageTimestamp: '2026-04-04T01:00:00.000Z',
    rawPayload: {},
    inboundContext: {
      Body: '你昨天说的奶茶圣经到底是什么梗',
      BodyForAgent: '你昨天说的奶茶圣经到底是什么梗',
      BodyForCommands: '你昨天说的奶茶圣经到底是什么梗',
      NativeChannelId: '101',
      MentionedUsers: [{ userId: '1129974489', label: '小腻' }],
      CommandAuthorized: true
    },
    messages: [
      {
        queueMessageId: 1,
        traceId: 'trace-preview-1',
        source: 'napcat',
        messageId: 11,
        messageSid: 'sid-preview-1',
        chatType: 'group',
        sessionKey: 'qq:group:101',
        peerId: '101',
        peerName: 'Test Group',
        senderId: '202',
        senderName: 'Alice',
        accountId: '303',
        bodyForAgent: '你昨天说的奶茶圣经到底是什么梗',
        rawBody: '你昨天说的奶茶圣经到底是什么梗',
        commandBody: '',
        wasMentioned: true,
        receivedAt: '2026-04-04T01:00:00.000Z',
        messageTimestamp: '2026-04-04T01:00:00.000Z',
        rawPayload: {},
        inboundContext: {
          Body: '你昨天说的奶茶圣经到底是什么梗',
          BodyForAgent: '你昨天说的奶茶圣经到底是什么梗',
          BodyForCommands: '你昨天说的奶茶圣经到底是什么梗',
          NativeChannelId: '101',
          MentionedUsers: [{ userId: '1129974489', label: '小腻' }],
          CommandAuthorized: true
        }
      }
    ]
  };
}

function main() {
  const queuePayload = createQueuePayload();
  const loopInput = buildInitialInput([], queuePayload, {
    systemPrompt: agentConfig.systemPrompt,
    userPromptTemplate: null,
    contextVariables: {},
    runtimeVariables: {}
  }, {
    preReplyMemoryGateDecision: {
      shouldReply: true,
      cueToBot: true,
      addresseeUserId: 202,
      relevantMemoryIds: [7, 9],
      rationale: 'explicit_cue'
    },
    presentSelf: {
      shouldSurface: true,
      presenceLevel: 'light',
      currentSelfMode: 'already_in_thread',
      feltPull: 'explicit follow-up question',
      activeRelationLines: ['with current sender: light continuity'],
      activePastEchoes: ['recent shared joke thread'],
      familiarityLimitNow: 'warm_not_performative',
      answerShape: 'brief_explain_then_stop',
      rendererGuidance: ['先答字面问题', '一句或两句就停'],
      rationale: 'the thread is active and directly asks for clarification'
    }
  });

  const request = buildCanonicalAgentTurnRequest(agentConfig.modelName, loopInput, 'group');
  request.prompt_cache_key = queuePayload.sessionKey;
  request.prompt_cache_retention = agentConfig.promptCacheRetention;

  const preview = {
    model: request.model,
    prompt_cache_key: request.prompt_cache_key,
    prompt_cache_retention: request.prompt_cache_retention,
    instructions_estimated_tokens: estimateTokens(request.instructions || ''),
    instructions_preview: String(request.instructions || '').split('\n').slice(0, 18).join('\n'),
    first_input_role: request.input[0] && request.input[0].type === 'message' ? request.input[0].role : null,
    first_input_preview: request.input[0] && request.input[0].type === 'message'
      ? String(request.input[0].content).split('\n').slice(0, 18).join('\n')
      : null,
    tool_names: Array.isArray(request.tools) ? request.tools.map((tool) => tool.function.name) : [],
    input_item_count: Array.isArray(request.input) ? request.input.length : 0
  };

  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
}

main();
