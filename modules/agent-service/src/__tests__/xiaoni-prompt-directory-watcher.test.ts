import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  XiaoniPromptDirectoryWatcher,
  computeXiaoniPromptDirectoryFingerprint,
  type XiaoniPromptDirectoryChange,
  type XiaoniPromptDirectoryFingerprint
} from '../prompts/xiaoni-prompt-directory-watcher';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fingerprint(value: string): XiaoniPromptDirectoryFingerprint {
  return {
    fingerprint: value,
    fileCount: 1,
    files: ['system_prompt.md'],
    fileFingerprints: {
      'system_prompt.md': value
    }
  };
}

test('computeXiaoniPromptDirectoryFingerprint changes when prompt markdown changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xiaoni-prompt-'));
  try {
    await writeFile(join(dir, 'system_prompt.md'), 'first', 'utf8');
    await writeFile(join(dir, 'notes.txt'), 'ignored', 'utf8');
    const first = await computeXiaoniPromptDirectoryFingerprint(dir);

    await writeFile(join(dir, 'system_prompt.md'), 'second', 'utf8');
    await writeFile(join(dir, 'notes.txt'), 'ignored but changed', 'utf8');
    const second = await computeXiaoniPromptDirectoryFingerprint(dir);

    assert.notEqual(first.fingerprint, second.fingerprint);
    assert.deepEqual(first.files, ['system_prompt.md']);
    assert.deepEqual(second.files, ['system_prompt.md']);
    assert.notEqual(first.fileFingerprints['system_prompt.md'], second.fileFingerprints['system_prompt.md']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('XiaoniPromptDirectoryWatcher reports only changed markdown files', async () => {
  const changes: XiaoniPromptDirectoryChange[] = [];
  const fingerprints: XiaoniPromptDirectoryFingerprint[] = [
    {
      fingerprint: 'a',
      fileCount: 2,
      files: ['phone_notification_reminder.md', 'system_prompt.md'],
      fileFingerprints: {
        'phone_notification_reminder.md': 'phone-a',
        'system_prompt.md': 'system-a'
      }
    },
    {
      fingerprint: 'b',
      fileCount: 2,
      files: ['phone_notification_reminder.md', 'system_prompt.md'],
      fileFingerprints: {
        'phone_notification_reminder.md': 'phone-b',
        'system_prompt.md': 'system-a'
      }
    }
  ];
  let last = fingerprints[fingerprints.length - 1]!;
  const watcher = new XiaoniPromptDirectoryWatcher({
    debounceMs: 0,
    readFingerprint: async () => {
      last = fingerprints.shift() ?? last;
      return last;
    },
    onChange: (change) => {
      changes.push(change);
    }
  });

  await watcher.pollOnce();
  await watcher.pollOnce();
  await wait(10);
  watcher.stop();

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0]?.changedFiles, ['phone_notification_reminder.md']);
});

test('XiaoniPromptDirectoryWatcher debounces multiple prompt changes into one reload event', async () => {
  const changes: XiaoniPromptDirectoryChange[] = [];
  const fingerprints = [fingerprint('a'), fingerprint('b'), fingerprint('c')];
  let last = fingerprints[fingerprints.length - 1]!;
  const watcher = new XiaoniPromptDirectoryWatcher({
    debounceMs: 10,
    readFingerprint: async () => {
      last = fingerprints.shift() ?? last;
      return last;
    },
    onChange: (change) => {
      changes.push(change);
    }
  });

  await watcher.pollOnce();
  await watcher.pollOnce();
  await watcher.pollOnce();
  await wait(30);
  watcher.stop();

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.previousFingerprint, 'a');
  assert.equal(changes[0]?.fingerprint, 'c');
});
