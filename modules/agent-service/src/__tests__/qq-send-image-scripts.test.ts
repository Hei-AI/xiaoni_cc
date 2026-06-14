import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const scriptsDir = path.resolve(process.cwd(), 'skills/qq-send-image/scripts');

function runPython(args: string[], env: Record<string, string>) {
  return execFileSync('python3', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONPATH: scriptsDir,
      ...env
    },
    encoding: 'utf8'
  });
}

test('qq-send-image status check resolves sent records by original arguments and message_id', () => {
  const statusDir = mkdtempSync(path.join(tmpdir(), 'qq-send-image-status-'));
  const imagePath = path.join(statusDir, 'image.png');
  writeFileSync(imagePath, 'not validated by status checker');
  const env = { QQ_SEND_IMAGE_STATUS_DIR: statusDir };

  const statusKey = runPython([
    '-c',
    [
      'from pathlib import Path',
      'from image_send_status import build_status_record, write_status',
      `image_path = str(Path(${JSON.stringify(imagePath)}).resolve(strict=True))`,
      'record = build_status_record("private", "85178516", image_path, "caption", status="sent", message_id="msg-123")',
      'write_status(record)',
      'print(record["status_key"])'
    ].join('\n')
  ], env).trim();

  const byArgs = runPython([
    path.join(scriptsDir, 'check_image_send.py'),
    'private',
    '85178516',
    imagePath,
    '--caption',
    'caption'
  ], env);
  assert.match(byArgs, /<QQ_IMAGE_SEND_STATUS /);
  assert.match(byArgs, /status="sent"/);
  assert.match(byArgs, /message_id="msg-123"/);
  assert.match(byArgs, new RegExp(`status_key="${statusKey}"`));

  const byMessageId = runPython([
    path.join(scriptsDir, 'check_image_send.py'),
    'private',
    '85178516',
    imagePath,
    '--message-id',
    'msg-123'
  ], env);
  assert.match(byMessageId, /status="sent"/);
  assert.match(byMessageId, /message_id="msg-123"/);
});

test('qq-send-image status helper extracts message_id from provider response data', () => {
  const output = runPython([
    '-c',
    [
      'from image_send_status import extract_message_id',
      'print(extract_message_id({"success": True, "data": {"message_id": 98765}}))'
    ].join('\n')
  ], {});

  assert.equal(output.trim(), '98765');
});
