import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { XIAONI_PROMPT_DIR } from './xiaoni-prompt-files';

export type XiaoniPromptDirectoryFingerprint = {
  fingerprint: string;
  fileCount: number;
  files: string[];
  fileFingerprints: Record<string, string>;
};

export type XiaoniPromptDirectoryChange = {
  previousFingerprint: string;
  fingerprint: string;
  fileCount: number;
  files: string[];
  changedFiles: string[];
  changedAt: string;
};

type WatcherLogger = {
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
};

export async function computeXiaoniPromptDirectoryFingerprint(
  promptDir = XIAONI_PROMPT_DIR
): Promise<XiaoniPromptDirectoryFingerprint> {
  const entries = await readdir(promptDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const hash = createHash('sha256');
  const fileFingerprints: Record<string, string> = {};
  hash.update('xiaoni_prompt_directory_v1\0');
  for (const file of files) {
    const content = await readFile(join(promptDir, file));
    const fileHash = createHash('sha256');
    fileHash.update(file);
    fileHash.update('\0');
    fileHash.update(content);
    fileFingerprints[file] = fileHash.digest('hex');

    hash.update(file);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  return {
    fingerprint: hash.digest('hex'),
    fileCount: files.length,
    files,
    fileFingerprints
  };
}

function listChangedPromptFiles(
  previous: XiaoniPromptDirectoryFingerprint,
  current: XiaoniPromptDirectoryFingerprint
) {
  const files = new Set([...previous.files, ...current.files]);
  return Array.from(files)
    .filter((file) => previous.fileFingerprints[file] !== current.fileFingerprints[file])
    .sort((left, right) => left.localeCompare(right));
}

export class XiaoniPromptDirectoryWatcher {
  private readonly intervalMs: number;
  private readonly debounceMs: number;
  private readonly readFingerprint: () => Promise<XiaoniPromptDirectoryFingerprint>;
  private intervalTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private latestFingerprint: XiaoniPromptDirectoryFingerprint | null = null;
  private pendingChange: XiaoniPromptDirectoryChange | null = null;
  private polling = false;

  constructor(
    private readonly options: {
      intervalMs?: number;
      debounceMs?: number;
      readFingerprint?: () => Promise<XiaoniPromptDirectoryFingerprint>;
      onChange: (change: XiaoniPromptDirectoryChange) => void | Promise<void>;
      logger?: WatcherLogger;
    }
  ) {
    this.intervalMs = Math.max(250, options.intervalMs ?? 1000);
    this.debounceMs = Math.max(0, options.debounceMs ?? 300);
    this.readFingerprint = options.readFingerprint ?? (() => computeXiaoniPromptDirectoryFingerprint());
  }

  start() {
    if (this.intervalTimer) {
      return;
    }
    void this.pollOnce();
    this.intervalTimer = setInterval(() => {
      void this.pollOnce();
    }, this.intervalMs);
    this.intervalTimer.unref?.();
  }

  stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChange = null;
  }

  async pollOnce() {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const current = await this.readFingerprint();
      const previous = this.latestFingerprint;
      this.latestFingerprint = current;
      if (!previous || previous.fingerprint === current.fingerprint) {
        return;
      }

      this.scheduleChange({
        previousFingerprint: previous.fingerprint,
        fingerprint: current.fingerprint,
        fileCount: current.fileCount,
        files: current.files,
        changedFiles: listChangedPromptFiles(previous, current),
        changedAt: new Date().toISOString()
      });
    } catch (error) {
      this.options.logger?.warn?.('Failed to fingerprint Xiaoni prompt directory', {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.polling = false;
    }
  }

  private scheduleChange(change: XiaoniPromptDirectoryChange) {
    this.pendingChange = this.pendingChange
      ? {
          ...change,
          previousFingerprint: this.pendingChange.previousFingerprint,
          changedFiles: Array.from(new Set([
            ...this.pendingChange.changedFiles,
            ...change.changedFiles
          ])).sort((left, right) => left.localeCompare(right))
        }
      : change;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const pending = this.pendingChange;
      this.pendingChange = null;
      this.debounceTimer = null;
      if (!pending) {
        return;
      }
      Promise.resolve(this.options.onChange(pending)).catch((error) => {
        this.options.logger?.warn?.('Failed to handle Xiaoni prompt directory change', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }
}
