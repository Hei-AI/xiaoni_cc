import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { QqSendImageService, QqSendImageSkillRuntime } from '../services/qq-send-image-service';

const scriptsDir = path.resolve(process.cwd(), 'skills/qq-send-image/scripts');

function runPython(args: string[], env: Record<string, string>) {
  return new Promise<string>((resolve, reject) => {
    execFile('python3', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      ...env
    },
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve(stdout);
    });
  });
}

function writeSmallPng(filePath: string) {
  writeFileSync(filePath, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00
  ]));
}

function extractComposeService(compose: string, serviceName: string) {
  const pattern = new RegExp(`^  ${serviceName}:\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:|^networks:|(?![\\s\\S]))`, 'm');
  const match = compose.match(pattern);
  return match?.[1] || '';
}

test('docker compose mounts Xiaoni runtime into agent-service for qq-send-image', () => {
  const repoRoot = path.resolve(process.cwd(), '../..');
  const compose = readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const agentService = extractComposeService(compose, 'agent-service');

  assert.ok(agentService, 'agent-service compose block should exist');
  assert.match(agentService, /- XIAONI_RUNTIME_ROOT=\/xiaoni-runtime/);
  assert.match(agentService, /\$\{HOME\}\/\.qqbot-local\/xiaoni-runtime:\/xiaoni-runtime/);
});

test('qq-send-image script posts actions to the engineering API like qq-usage', async () => {
  const requests: any[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        result: {
          content: '<QQ_IMAGE_SEND_STATUS status="sent" message_id="msg-123"></QQ_IMAGE_SEND_STATUS>'
        }
      }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const output = await runPython([
      path.join(scriptsDir, 'qq_send_image.py'),
      'check',
      '--message-id',
      'msg-123'
    ], {
      QQ_SEND_IMAGE_ENDPOINT: `http://127.0.0.1:${address.port}`,
      XIAONI_TRACE_ID: 'trace-send-image'
    });

    assert.match(output, /<QQ_IMAGE_SEND_STATUS /);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].action, 'check');
    assert.deepEqual(requests[0].args, {
      caption: '',
      message_id: 'msg-123',
      status_key: ''
    });
    assert.deepEqual(requests[0].context, {
      trace_id: 'trace-send-image'
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('QqSendImageSkillRuntime sends images and resolves status by message_id and status_key', async () => {
  const runtimeRoot = mkdtempSync(path.join(tmpdir(), 'qq-send-image-runtime-'));
  const statusDir = path.join(runtimeRoot, 'status');
  const imagePath = path.join(runtimeRoot, 'image.png');
  writeSmallPng(imagePath);

  const fetchCalls: any[] = [];
  const service = new QqSendImageService({
    providerServiceUrl: 'http://provider-service',
    runtimeRoot,
    statusDir,
    fetchImpl: async (url, init) => {
      fetchCalls.push({
        url,
        body: JSON.parse(init.body)
      });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            success: true,
            data: {
              message_id: 98765
            }
          });
        }
      };
    }
  });
  const runtime = new QqSendImageSkillRuntime(service);

  const sent = await runtime.execute('send_group', {
    group_id: '123',
    image_path: imagePath,
    caption: 'caption'
  }, {
    sessionKey: 'xiaoni:test-global'
  });

  assert.equal(sent.failed, undefined);
  assert.match(sent.content, /<QQ_IMAGE_SEND_RESULT /);
  assert.match(sent.content, /message_id="98765"/);
  assert.ok(sent.status_key);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://provider-service/api/internal/send_group_image');
  assert.equal(fetchCalls[0].body.group_id, 123);
  assert.equal(fetchCalls[0].body.caption, 'caption');
  assert.equal(fetchCalls[0].body.session_key, 'xiaoni:test-global');
  assert.match(fetchCalls[0].body.data_url, /^data:image\/png;base64,/);

  const byMessageId = await runtime.execute('check', {
    message_id: '98765'
  });
  assert.match(byMessageId.content, /status="sent"/);
  assert.match(byMessageId.content, /message_id="98765"/);

  const byStatusKey = await runtime.execute('check', {
    status_key: sent.status_key
  });
  assert.match(byStatusKey.content, /status="sent"/);
  assert.match(byStatusKey.content, /status_key="/);
});

test('QqSendImageSkillRuntime rejects internal QQ thread keys', async () => {
  const service = new QqSendImageService({
    providerServiceUrl: 'http://provider-service',
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    }
  });
  const runtime = new QqSendImageSkillRuntime(service);

  const result = await runtime.execute('send_group', {
    group_id: 'qq:group:123',
    image_path: '/xiaoni-runtime/image.png'
  });

  assert.equal(result.failed, true);
  assert.match(result.content, /<QQ_IMAGE_SEND_ERROR /);
  assert.match(result.content, /plain QQ id/);
});
