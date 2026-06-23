import type { XiaoniPromptDirectoryChange } from './xiaoni-prompt-directory-watcher';

export const PREFIX_SENSITIVE_PROMPT_FILES = new Set([
  'system_prompt.md',
  'skills_instructions.md'
]);

export type XiaoniPromptReloadDecision = {
  changedFiles: string[];
  prefixSensitiveFiles: string[];
  reloadPolicy: 'after_core_memory_compression' | 'snippet_only';
};

export class XiaoniPromptReloadPolicy {
  private postCompressionReloadPending = false;

  recordPromptDirectoryChange(change: XiaoniPromptDirectoryChange): XiaoniPromptReloadDecision {
    const changedFiles = change.changedFiles.length > 0 ? change.changedFiles : change.files;
    const prefixSensitiveFiles = changedFiles.filter((file) => PREFIX_SENSITIVE_PROMPT_FILES.has(file));
    if (prefixSensitiveFiles.length > 0) {
      this.postCompressionReloadPending = true;
    }
    return {
      changedFiles,
      prefixSensitiveFiles,
      reloadPolicy: prefixSensitiveFiles.length > 0 ? 'after_core_memory_compression' : 'snippet_only'
    };
  }

  consumePostCompressionReload() {
    if (!this.postCompressionReloadPending) {
      return false;
    }
    this.postCompressionReloadPending = false;
    return true;
  }

  clearPendingReload() {
    const hadPendingReload = this.postCompressionReloadPending;
    this.postCompressionReloadPending = false;
    return hadPendingReload;
  }
}
