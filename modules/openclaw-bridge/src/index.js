const express = require('express');
const axios = require('axios');
const pino = require('pino');
require('dotenv').config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const cfg = {
  port: Number(process.env.BRIDGE_PORT || 8090),
  onebotApiBaseUrl: (process.env.ONEBOT_API_BASE_URL || '').replace(/\/$/, ''),
  onebotAccessToken: process.env.ONEBOT_ACCESS_TOKEN || '',
  onebotSelfId: (process.env.ONEBOT_SELF_ID || '').trim(),

  openclawBaseUrl: (process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789').replace(/\/$/, ''),
  openclawToken: process.env.OPENCLAW_TOKEN || '',
  openclawAgentId: process.env.OPENCLAW_AGENT_ID || 'main',
  openclawApiMode: process.env.OPENCLAW_API_MODE || 'openresponses',

  sessionPrefix: process.env.SESSION_PREFIX || 'qq',
  groupRequireAt: String(process.env.GROUP_REQUIRE_AT || 'true').toLowerCase() !== 'false',
  groupTriggerPrefix: process.env.GROUP_TRIGGER_PREFIX || '',
  groupWhitelist: parseCsvSet(process.env.GROUP_WHITELIST || ''),
  userWhitelist: parseCsvSet(process.env.USER_WHITELIST || ''),
};

if (!cfg.onebotApiBaseUrl) {
  logger.error('ONEBOT_API_BASE_URL is required');
  process.exit(1);
}
if (!cfg.openclawToken) {
  logger.error('OPENCLAW_TOKEN is required');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'openclaw-bridge' });
});

app.post('/onebot/event', async (req, res) => {
  const event = req.body || {};

  // Ack immediately to avoid OneBot timeout retries
  res.json({ status: 'ok' });

  try {
    await handleOneBotEvent(event);
  } catch (err) {
    logger.error({ err, event }, 'handle event failed');
  }
});

app.listen(cfg.port, () => {
  logger.info({ port: cfg.port, mode: cfg.openclawApiMode }, 'openclaw bridge started');
});

async function handleOneBotEvent(event) {
  if (event.post_type !== 'message') return;

  const messageType = event.message_type; // private | group
  if (messageType !== 'private' && messageType !== 'group') return;

  const userId = String(event.user_id || '');
  const groupId = messageType === 'group' ? String(event.group_id || '') : '';

  if (cfg.userWhitelist.size && !cfg.userWhitelist.has(userId)) return;
  if (messageType === 'group' && cfg.groupWhitelist.size && !cfg.groupWhitelist.has(groupId)) return;

  const parsed = parseMessage(event.message);
  let text = parsed.text.trim();
  if (!text) return;

  if (messageType === 'group') {
    const atMe = cfg.onebotSelfId ? parsed.atIds.has(cfg.onebotSelfId) : false;
    const hitPrefix = cfg.groupTriggerPrefix && text.startsWith(cfg.groupTriggerPrefix);

    if (cfg.groupRequireAt && !atMe && !hitPrefix) return;

    if (atMe) {
      // Remove CQ at mention forms in plain/cq text mode
      text = text
        .replace(/\[CQ:at,qq=\d+\]/g, '')
        .replace(/\[CQ:at,qq=all\]/g, '')
        .trim();
    }
    if (hitPrefix) {
      text = text.slice(cfg.groupTriggerPrefix.length).trim();
    }
    if (!text) return;
  }

  const sessionKey = `${cfg.sessionPrefix}:${messageType}:${messageType === 'private' ? userId : groupId}`;

  const reply = await queryOpenClaw({
    text,
    sessionKey,
    user: sessionKey,
  });

  if (!reply) {
    logger.warn({ sessionKey, text }, 'empty reply from openclaw');
    return;
  }

  if (messageType === 'private') {
    await sendPrivateMsg(userId, reply);
  } else {
    await sendGroupMsg(groupId, reply);
  }
}

async function queryOpenClaw({ text, sessionKey, user }) {
  if (cfg.openclawApiMode === 'chatcompletions') {
    const url = `${cfg.openclawBaseUrl}/v1/chat/completions`;
    const resp = await axios.post(
      url,
      {
        model: `openclaw:${cfg.openclawAgentId}`,
        user,
        messages: [{ role: 'user', content: text }],
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.openclawToken}`,
          'Content-Type': 'application/json',
          'x-openclaw-agent-id': cfg.openclawAgentId,
          'x-openclaw-session-key': sessionKey,
        },
        timeout: 120000,
      },
    );

    return (
      resp?.data?.choices?.[0]?.message?.content ||
      resp?.data?.output_text ||
      ''
    ).toString();
  }

  const url = `${cfg.openclawBaseUrl}/v1/responses`;
  const resp = await axios.post(
    url,
    {
      model: `openclaw:${cfg.openclawAgentId}`,
      user,
      input: text,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${cfg.openclawToken}`,
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': cfg.openclawAgentId,
        'x-openclaw-session-key': sessionKey,
      },
      timeout: 120000,
    },
  );

  return extractResponseText(resp.data);
}

function extractResponseText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();

  if (Array.isArray(data.output)) {
    const parts = [];
    for (const item of data.output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (typeof part?.text === 'string') parts.push(part.text);
        if (typeof part?.output_text === 'string') parts.push(part.output_text);
      }
    }
    const joined = parts.join('\n').trim();
    if (joined) return joined;
  }

  if (Array.isArray(data.content)) {
    const joined = data.content
      .map((c) => c?.text)
      .filter((x) => typeof x === 'string')
      .join('\n')
      .trim();
    if (joined) return joined;
  }

  return '';
}

async function sendPrivateMsg(userId, message) {
  await onebotPost('/send_private_msg', {
    user_id: Number(userId),
    message,
    auto_escape: false,
  });
}

async function sendGroupMsg(groupId, message) {
  await onebotPost('/send_group_msg', {
    group_id: Number(groupId),
    message,
    auto_escape: false,
  });
}

async function onebotPost(path, payload) {
  const url = `${cfg.onebotApiBaseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.onebotAccessToken) {
    headers.Authorization = `Bearer ${cfg.onebotAccessToken}`;
  }

  await axios.post(url, payload, { headers, timeout: 30000 });
}

function parseCsvSet(v) {
  return new Set(
    String(v || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

function parseMessage(msg) {
  // OneBot message can be string / CQ string / segment[]
  if (Array.isArray(msg)) {
    const atIds = new Set();
    const chunks = [];

    for (const seg of msg) {
      if (!seg || typeof seg !== 'object') continue;
      const type = seg.type;
      const data = seg.data || {};

      if (type === 'text' && typeof data.text === 'string') {
        chunks.push(data.text);
      } else if (type === 'at' && data.qq) {
        atIds.add(String(data.qq));
      }
    }

    return { text: chunks.join(' ').replace(/\s+/g, ' ').trim(), atIds };
  }

  const text = typeof msg === 'string' ? msg : '';
  const atIds = new Set();
  const reg = /\[CQ:at,qq=([^\]]+)\]/g;
  let m;
  while ((m = reg.exec(text))) {
    atIds.add(String(m[1]));
  }

  return { text, atIds };
}
