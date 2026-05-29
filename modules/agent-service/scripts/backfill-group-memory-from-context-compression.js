#!/usr/bin/env node
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://qqbot_user:qqbot_password@127.0.0.1:5432/qqbot_db?schema=public&options=-c%20timezone%3DAsia%2FShanghai';
process.env.PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://127.0.0.1:8091';
process.env.AI_MODEL_NAME = process.env.AI_MODEL_NAME || 'gpt-5.4-mini';
process.env.AGENT_COMPACT_MEMORY_MODEL = process.env.AGENT_COMPACT_MEMORY_MODEL || process.env.AI_MODEL_NAME;
process.env.AGENT_COMPACT_MEMORY_REFLECTION_MODEL = process.env.AGENT_COMPACT_MEMORY_REFLECTION_MODEL || process.env.AI_MODEL_NAME;

const { AgentLoopService } = require('../dist/services/agent-loop-service');
const { AgentPromptService } = require('../dist/services/agent-prompt-service');
const { RuntimeStore } = require('../dist/services/runtime-store');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, inlineValue] = token.slice(2).split('=');
    if (typeof inlineValue !== 'undefined') {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toUnixSeconds(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? Math.floor(Date.now() / 1000) : Math.floor(date.getTime() / 1000);
}

function buildQueuePayload(row, batchRows, runId) {
  const inboundContext = parseJson(row.inbound_context, {});
  const messages = batchRows.map((messageRow) => {
    const messageContext = parseJson(messageRow.inbound_context, {});
    return {
      queueMessageId: Number(messageRow.id),
      traceId: String(messageRow.trace_id || `manual-memory-${messageRow.id}`),
      source: String(messageRow.source || 'manual_memory_replay'),
      messageId: Number(messageRow.message_sid || messageRow.id),
      messageSid: String(messageRow.message_sid || messageRow.id),
      chatType: 'group',
      sessionKey: String(messageRow.session_key || `qq:group:${messageRow.peer_id}`),
      peerId: String(messageRow.peer_id),
      peerName: messageRow.peer_name || undefined,
      senderId: String(messageRow.sender_id),
      senderName: messageRow.sender_name || undefined,
      accountId: String(messageRow.account_id || '1129974489'),
      bodyForAgent: String(messageRow.body_for_agent || ''),
      rawBody: String(messageRow.raw_body || messageRow.body_for_agent || ''),
      commandBody: String(messageRow.command_body || messageRow.body_for_agent || ''),
      wasMentioned: Number(messageRow.was_mentioned || 0) > 0,
      receivedAt: toIso(messageRow.received_at),
      messageTimestamp: toIso(messageRow.message_timestamp || messageRow.received_at),
      rawPayload: parseJson(messageRow.raw_payload, {}),
      inboundContext: {
        Body: String(messageContext.Body || messageRow.body_for_agent || ''),
        BodyForAgent: String(messageContext.BodyForAgent || messageRow.body_for_agent || ''),
        BodyForCommands: String(messageContext.BodyForCommands || messageRow.command_body || messageRow.body_for_agent || ''),
        RawBody: String(messageContext.RawBody || messageRow.raw_body || messageRow.body_for_agent || ''),
        From: messageContext.From || `qq:${messageRow.sender_id}`,
        To: messageContext.To || `group:${messageRow.peer_id}`,
        SessionKey: messageContext.SessionKey || messageRow.session_key || `qq:group:${messageRow.peer_id}`,
        AccountId: messageContext.AccountId || messageRow.account_id || '1129974489',
        MessageSid: String(messageContext.MessageSid || messageRow.message_sid || messageRow.id),
        ChatType: 'group',
        ConversationLabel: messageContext.ConversationLabel || messageRow.peer_name || `group:${messageRow.peer_id}`,
        GroupSubject: messageContext.GroupSubject || messageRow.peer_name || null,
        SenderName: messageContext.SenderName || messageRow.sender_name || null,
        SenderId: String(messageContext.SenderId || messageRow.sender_id),
        Timestamp: Number(messageContext.Timestamp || toUnixSeconds(messageRow.message_timestamp || messageRow.received_at)),
        Provider: messageContext.Provider || 'manual_memory_replay',
        Surface: messageContext.Surface || 'qq',
        WasMentioned: Boolean(messageContext.WasMentioned || Number(messageRow.was_mentioned || 0) > 0),
        MentionedUsers: Array.isArray(messageContext.MentionedUsers) ? messageContext.MentionedUsers : [],
        NativeChannelId: String(messageContext.NativeChannelId || messageRow.peer_id),
        MediaAssets: Array.isArray(messageContext.MediaAssets) ? messageContext.MediaAssets : [],
        CommandAuthorized: Boolean(messageContext.CommandAuthorized)
      }
    };
  });

  return {
    traceId: `manual-memory-replay:${row.peer_id}:${row.id}:${Date.now()}`,
    runId,
    batchId: `manual-memory-replay:${row.peer_id}:${row.id}`,
    source: 'manual_memory_replay',
    chatType: 'group',
    sessionKey: String(row.session_key || `qq:group:${row.peer_id}`),
    peerId: String(row.peer_id),
    peerName: row.peer_name || undefined,
    senderId: String(row.sender_id),
    senderName: row.sender_name || undefined,
    accountId: String(row.account_id || inboundContext.AccountId || '1129974489'),
    bodyForAgent: String(row.body_for_agent || ''),
    rawBody: String(row.raw_body || row.body_for_agent || ''),
    commandBody: String(row.command_body || row.body_for_agent || ''),
    wasMentioned: Number(row.was_mentioned || 0) > 0,
    receivedAt: toIso(row.received_at),
    messageTimestamp: toIso(row.message_timestamp || row.received_at),
    rawPayload: parseJson(row.raw_payload, {}),
    inboundContext: {
      Body: String(inboundContext.Body || row.body_for_agent || ''),
      BodyForAgent: String(inboundContext.BodyForAgent || row.body_for_agent || ''),
      BodyForCommands: String(inboundContext.BodyForCommands || row.command_body || row.body_for_agent || ''),
      RawBody: String(inboundContext.RawBody || row.raw_body || row.body_for_agent || ''),
      From: inboundContext.From || `qq:${row.sender_id}`,
      To: inboundContext.To || `group:${row.peer_id}`,
      SessionKey: inboundContext.SessionKey || row.session_key || `qq:group:${row.peer_id}`,
      AccountId: inboundContext.AccountId || row.account_id || '1129974489',
      MessageSid: String(inboundContext.MessageSid || row.message_sid || row.id),
      ChatType: 'group',
      ConversationLabel: inboundContext.ConversationLabel || row.peer_name || `group:${row.peer_id}`,
      GroupSubject: inboundContext.GroupSubject || row.peer_name || null,
      SenderName: inboundContext.SenderName || row.sender_name || null,
      SenderId: String(inboundContext.SenderId || row.sender_id),
      Timestamp: Number(inboundContext.Timestamp || toUnixSeconds(row.message_timestamp || row.received_at)),
      Provider: inboundContext.Provider || 'manual_memory_replay',
      Surface: inboundContext.Surface || 'qq',
      WasMentioned: Boolean(inboundContext.WasMentioned || Number(row.was_mentioned || 0) > 0),
      MentionedUsers: Array.isArray(inboundContext.MentionedUsers) ? inboundContext.MentionedUsers : [],
      NativeChannelId: String(inboundContext.NativeChannelId || row.peer_id),
      MediaAssets: Array.isArray(inboundContext.MediaAssets) ? inboundContext.MediaAssets : [],
      CommandAuthorized: Boolean(inboundContext.CommandAuthorized)
    },
    messages
  };
}

function buildTurns(rows) {
  return rows.map((row) => {
    const messageId = toNumber(row.message_sid, Number(row.id));
    return {
      id: Number(row.id),
      userId: Number(row.sender_id) || 0,
      groupId: Number(row.peer_id) || null,
      batchId: null,
      sessionKey: String(row.session_key || `qq:group:${row.peer_id}`),
      userMessage: String(row.body_for_agent || ''),
      aiResponse: null,
      items: [{
        id: Number(row.id),
        conversationId: Number(row.id),
        sessionKey: String(row.session_key || `qq:group:${row.peer_id}`),
        role: 'user',
        phase: null,
        content: String(row.body_for_agent || ''),
        groupIndex: 0,
        itemIndex: 0,
        source: 'inbound_batch',
        deliveryMessageId: messageId,
        runId: null,
        traceId: String(row.trace_id || `manual-memory-${row.id}`)
      }],
      rawResponse: {}
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const groupId = String(args['group-id'] || '253631878');
  const batchSize = Math.max(1, Math.min(Number(args['batch-size'] || 120), 200));
  const startOffset = Math.max(0, Number(args.offset || 0));
  const limit = args.limit ? Math.max(1, Number(args.limit)) : null;
  const dryRun = Boolean(args['dry-run']);

  const store = new RuntimeStore();
  await store.initialize();
  const loopService = new AgentLoopService(store);
  const promptService = new AgentPromptService();
  const runId = `manual-memory-replay-${groupId}-${Date.now()}`;

  try {
    const rows = await store.listInboundMessagesForMemoryBackfill({
      groupId,
      offset: startOffset,
      limit
    });

    if (rows.length === 0) {
      console.log(`No inbound messages found for group ${groupId}.`);
      return;
    }

    console.log(JSON.stringify({
      groupId,
      rows: rows.length,
      firstId: Number(rows[0].id),
      lastId: Number(rows[rows.length - 1].id),
      batchSize,
      compactModel: process.env.AGENT_COMPACT_MEMORY_MODEL,
      reflectionModel: process.env.AGENT_COMPACT_MEMORY_REFLECTION_MODEL,
      providerServiceUrl: process.env.PROVIDER_SERVICE_URL,
      dryRun
    }));

    for (let index = 0; index < rows.length; index += batchSize) {
      const batchRows = rows.slice(index, index + batchSize);
      const queueMessage = buildQueuePayload(batchRows[batchRows.length - 1], batchRows, runId);
      const runtimePrompt = await promptService.resolveForQueueMessage(queueMessage);
      runtimePrompt.modelName = process.env.AI_MODEL_NAME || runtimePrompt.modelName;
      const evictedTurns = buildTurns(batchRows);

      console.log(JSON.stringify({
        event: 'batch_start',
        batchIndex: Math.floor(index / batchSize),
        offset: startOffset + index,
        count: batchRows.length,
        firstId: Number(batchRows[0].id),
        lastId: Number(batchRows[batchRows.length - 1].id)
      }));

      if (!dryRun) {
        await loopService.runContextCompressionMemoryWriter({
          queueMessage,
          conversationId: Number(batchRows[batchRows.length - 1].id),
          evictedTurns,
          runtimePrompt
        });
      }

      console.log(JSON.stringify({
        event: 'batch_end',
        batchIndex: Math.floor(index / batchSize),
        lastId: Number(batchRows[batchRows.length - 1].id)
      }));
    }
  } finally {
    await store.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
