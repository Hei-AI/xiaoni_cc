import test from 'node:test';
import assert from 'node:assert/strict';
import { XiaoniPromptReloadPolicy } from '../prompts/xiaoni-prompt-reload-policy';
import type { XiaoniPromptDirectoryChange } from '../prompts/xiaoni-prompt-directory-watcher';

function change(changedFiles: string[]): XiaoniPromptDirectoryChange {
  return {
    previousFingerprint: 'old',
    fingerprint: 'new',
    fileCount: changedFiles.length,
    files: changedFiles,
    changedFiles,
    changedAt: '2026-06-23T00:00:00.000Z'
  };
}

test('prefix-sensitive prompt changes are consumed only after core memory compression', () => {
  const policy = new XiaoniPromptReloadPolicy();

  const decision = policy.recordPromptDirectoryChange(change(['system_prompt.md']));

  assert.deepEqual(decision.prefixSensitiveFiles, ['system_prompt.md']);
  assert.equal(decision.reloadPolicy, 'after_core_memory_compression');
  assert.equal(policy.consumePostCompressionReload(), true);
  assert.equal(policy.consumePostCompressionReload(), false);
});

test('snippet-only prompt changes do not invalidate the stable prompt prefix', () => {
  const policy = new XiaoniPromptReloadPolicy();

  const decision = policy.recordPromptDirectoryChange(change(['phone_notification_reminder.md']));

  assert.deepEqual(decision.prefixSensitiveFiles, []);
  assert.equal(decision.reloadPolicy, 'snippet_only');
  assert.equal(policy.consumePostCompressionReload(), false);
});

test('manual force-load clears pending post-compression reload', () => {
  const policy = new XiaoniPromptReloadPolicy();

  policy.recordPromptDirectoryChange(change(['skills_instructions.md']));

  assert.equal(policy.clearPendingReload(), true);
  assert.equal(policy.consumePostCompressionReload(), false);
});
