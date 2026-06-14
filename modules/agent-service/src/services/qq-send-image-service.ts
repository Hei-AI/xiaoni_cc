import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<FetchResponseLike>;

export type QqSendImageActionContext = {
  traceId?: string | null;
  runId?: string | null;
  batchId?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  sessionKey?: string | null;
};

export type QqSendImageToolResult = {
  qq_send_image: true;
  action: string;
  content: string;
  failed?: boolean;
  status_key?: string;
  message_id?: string | null;
};

export type QqSendImageServiceOptions = {
  providerServiceUrl?: string;
  runtimeRoot?: string;
  statusDir?: string;
  allowedRoots?: string[];
  maxBytes?: number;
  fetchImpl?: FetchLike;
};

type SendMode = 'private' | 'group';

type StatusRecord = {
  status_key: string;
  status: 'pending' | 'sent' | 'failed' | 'unknown';
  mode: SendMode;
  target_id: string;
  image_path: string;
  caption: string;
  caption_sent: boolean;
  updated_at: string;
  started_at?: string;
  mime_type?: string;
  bytes?: number;
  message_id?: string | null;
  reason?: string;
  provider_response?: unknown;
};

const DEFAULT_RUNTIME_ROOT = '/xiaoni-runtime';
const STATUS_DIR_NAME = 'qq-send-image-status';
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const QQ_SEND_IMAGE_ACTION_LABELS: Record<string, string> = {
  send_group: 'qq_send_image.send_group',
  send_private: 'qq_send_image.send_private',
  check: 'qq_send_image.check'
};

function escapeXmlAttr(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlText(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatTaggedBlock(tag: string, attrs: Record<string, unknown>, body = '') {
  const renderedAttrs = Object.entries(attrs)
    .filter(([, value]) => value !== null && typeof value !== 'undefined' && value !== '')
    .map(([key, value]) => `${key}="${escapeXmlAttr(value)}"`)
    .join(' ');
  const open = renderedAttrs ? `<${tag} ${renderedAttrs}>` : `<${tag}>`;
  return body ? `${open}\n${escapeXmlText(body)}\n</${tag}>` : `${open}</${tag}>`;
}

function normalizeIdentifier(value: unknown) {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeCaption(caption: unknown) {
  return typeof caption === 'string' ? caption.trim() : '';
}

function utcNowIso() {
  return new Date().toISOString();
}

function statusKey(mode: SendMode, targetId: string, imagePath: string, caption = '') {
  const payload = {
    mode,
    target_id: targetId.trim(),
    image_path: imagePath.trim(),
    caption: normalizeCaption(caption)
  };
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 32);
}

function safeStatusFileName(key: string) {
  const safeKey = Array.from(String(key))
    .filter((ch) => /[A-Za-z0-9_-]/.test(ch))
    .join('')
    .slice(0, 80);
  return `${safeKey || 'invalid'}.json`;
}

function isPathInside(child: string, root: string) {
  const relative = path.relative(root, child);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseRootsEnv(value: string) {
  return value
    .replace(/,/g, path.delimiter)
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
}

function parseQqNumber(value: unknown, label: string) {
  const raw = normalizeIdentifier(value);
  if (!raw) {
    throw new Error(`${label} is required`);
  }
  if (raw.startsWith('qq:')) {
    throw new Error(`${label} must be a plain QQ id, not an internal QQ thread key`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive QQ number`);
  }
  return { raw, value: parsed };
}

function getGroupId(args: Record<string, unknown>) {
  return args.group_id ?? args.groupId ?? args.target_id ?? args.targetId;
}

function getUserId(args: Record<string, unknown>) {
  return args.user_id ?? args.userId ?? args.target_id ?? args.targetId;
}

function getImagePath(args: Record<string, unknown>) {
  return firstNonEmptyString(args.image_path, args.imagePath);
}

function getMode(args: Record<string, unknown>): SendMode | '' {
  const mode = firstNonEmptyString(args.mode).toLowerCase();
  return mode === 'private' || mode === 'group' ? mode : '';
}

function extractMessageId(providerResponse: unknown) {
  if (!providerResponse || typeof providerResponse !== 'object' || Array.isArray(providerResponse)) {
    return null;
  }
  const candidates: Array<Record<string, unknown>> = [providerResponse as Record<string, unknown>];
  const data = (providerResponse as Record<string, unknown>).data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    candidates.push(data as Record<string, unknown>);
  }
  for (const candidate of candidates) {
    for (const field of ['message_id', 'messageId', 'id']) {
      const value = candidate[field];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    }
  }
  return null;
}

function sniffMime(data: Buffer) {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'image/gif';
  }
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  throw new Error('unsupported image format');
}

export class QqSendImageService {
  private readonly providerServiceUrl: string;
  private readonly runtimeRoot: string;
  private readonly explicitStatusDir?: string;
  private readonly explicitAllowedRoots?: string[];
  private readonly maxBytes: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: QqSendImageServiceOptions = {}) {
    this.providerServiceUrl = (options.providerServiceUrl || process.env.PROVIDER_SERVICE_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
    this.runtimeRoot = options.runtimeRoot || process.env.XIAONI_RUNTIME_ROOT || DEFAULT_RUNTIME_ROOT;
    this.explicitStatusDir = options.statusDir || process.env.QQ_SEND_IMAGE_STATUS_DIR || undefined;
    this.explicitAllowedRoots = options.allowedRoots;
    this.maxBytes = options.maxBytes || Number.parseInt(process.env.QQ_SEND_IMAGE_MAX_BYTES || '', 10) || DEFAULT_MAX_BYTES;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  private statusDir() {
    return this.explicitStatusDir || path.join(this.runtimeRoot, STATUS_DIR_NAME);
  }

  private statusPath(key: string) {
    return path.join(this.statusDir(), safeStatusFileName(key));
  }

  private async configuredAllowedRoots() {
    const rawRoots = this.explicitAllowedRoots && this.explicitAllowedRoots.length > 0
      ? this.explicitAllowedRoots
      : parseRootsEnv(process.env.QQ_SEND_IMAGE_ALLOWED_ROOTS || '') || [];
    const rootsToUse = rawRoots.length > 0 ? rawRoots : [this.runtimeRoot];
    const roots: string[] = [];
    const seen = new Set<string>();
    for (const rawRoot of rootsToUse) {
      try {
        const resolved = await fs.realpath(rawRoot);
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory() || seen.has(resolved)) continue;
        roots.push(resolved);
        seen.add(resolved);
      } catch {
        continue;
      }
    }
    if (roots.length === 0) {
      throw new Error('no readable image roots are configured');
    }
    return roots;
  }

  private async resolveImagePath(inputPath: string) {
    const roots = await this.configuredAllowedRoots();
    const candidate = path.isAbsolute(inputPath) ? inputPath : path.join(roots[0], inputPath);
    const resolved = await fs.realpath(candidate);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      throw new Error('image_path must point to a file');
    }
    if (roots.some((root) => isPathInside(resolved, root))) {
      return resolved;
    }
    throw new Error(`image_path must be under one of the configured image roots: ${roots.join(', ')}`);
  }

  private async resolveExistingPath(inputPath: string) {
    try {
      return await fs.realpath(inputPath);
    } catch {
      return inputPath;
    }
  }

  private async readImage(imagePath: string) {
    const stat = await fs.stat(imagePath);
    if (stat.size <= 0) {
      throw new Error('image file is empty');
    }
    if (stat.size > this.maxBytes) {
      throw new Error(`image file is too large: ${stat.size} bytes > ${this.maxBytes} bytes`);
    }
    const data = await fs.readFile(imagePath);
    return {
      data,
      mimeType: sniffMime(data),
      size: stat.size
    };
  }

  private buildStatusRecord(mode: SendMode, targetId: string, imagePath: string, caption = '', status: StatusRecord['status'] = 'pending', extra: Partial<StatusRecord> = {}): StatusRecord {
    const now = utcNowIso();
    return {
      status_key: statusKey(mode, targetId, imagePath, caption),
      status,
      mode,
      target_id: targetId,
      image_path: imagePath,
      caption: normalizeCaption(caption),
      caption_sent: Boolean(normalizeCaption(caption)),
      updated_at: now,
      started_at: extra.started_at || now,
      ...extra
    };
  }

  private async writeStatus(record: StatusRecord) {
    try {
      await fs.mkdir(this.statusDir(), { recursive: true });
      const statusPath = this.statusPath(record.status_key);
      const tmpPath = `${statusPath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(record), 'utf8');
      await fs.rename(tmpPath, statusPath);
    } catch {
      // Status is best-effort; sending should not fail because local bookkeeping failed.
    }
  }

  private async readStatus(key: string) {
    try {
      const payload = JSON.parse(await fs.readFile(this.statusPath(key), 'utf8'));
      return payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as StatusRecord
        : null;
    } catch {
      return null;
    }
  }

  private async findStatusByMessageId(messageId: string) {
    if (!messageId.trim()) return null;
    try {
      const names = await fs.readdir(this.statusDir());
      const records = await Promise.all(names
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const filePath = path.join(this.statusDir(), name);
          try {
            return { filePath, mtimeMs: (await fs.stat(filePath)).mtimeMs };
          } catch {
            return null;
          }
        }));
      const newest = records
        .filter((record): record is { filePath: string; mtimeMs: number } => Boolean(record))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 500);
      for (const record of newest) {
        try {
          const payload = JSON.parse(await fs.readFile(record.filePath, 'utf8')) as Record<string, unknown>;
          if (String(payload.message_id || '').trim() === messageId.trim()) {
            return payload as StatusRecord;
          }
        } catch {
          continue;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private async providerPost(mode: SendMode, payload: Record<string, unknown>) {
    const endpoint = mode === 'private' ? '/api/internal/send_private_image' : '/api/internal/send_group_image';
    const response = await this.fetchImpl(`${this.providerServiceUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const raw = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    } catch {
      throw new Error(`provider-service returned non-JSON response: ${raw.slice(0, 500)}`);
    }
    if (!response.ok || parsed.success === false) {
      throw new Error(String(parsed.error || `provider-service returned HTTP ${response.status}`));
    }
    return parsed;
  }

  private async sendImage(mode: SendMode, target: { raw: string; value: number }, imagePathArg: string, captionArg: unknown, context: QqSendImageActionContext): Promise<QqSendImageToolResult> {
    let statusRecord: StatusRecord | null = null;
    try {
      const imagePath = await this.resolveImagePath(imagePathArg);
      const image = await this.readImage(imagePath);
      const caption = normalizeCaption(captionArg);
      statusRecord = this.buildStatusRecord(mode, target.raw, imagePath, caption, 'pending', {
        mime_type: image.mimeType,
        bytes: image.size
      });
      await this.writeStatus(statusRecord);

      const targetField = mode === 'private' ? 'user_id' : 'group_id';
      const payload: Record<string, unknown> = {
        [targetField]: target.value,
        data_url: `data:${image.mimeType};base64,${image.data.toString('base64')}`
      };
      if (caption) {
        payload.caption = caption;
      }
      if (mode === 'group' && context.sessionKey) {
        payload.session_key = context.sessionKey;
      }

      const providerResponse = await this.providerPost(mode, payload);
      const messageId = extractMessageId(providerResponse);
      const sentRecord: StatusRecord = {
        ...statusRecord,
        status: 'sent',
        updated_at: utcNowIso(),
        message_id: messageId,
        provider_response: providerResponse
      };
      await this.writeStatus(sentRecord);

      const content = formatTaggedBlock('QQ_IMAGE_SEND_RESULT', {
        success: 'true',
        [targetField]: target.value,
        image_path: imagePath,
        mime_type: image.mimeType,
        bytes: image.size,
        caption_sent: String(Boolean(caption)),
        status_key: statusRecord.status_key,
        message_id: messageId
      }, mode === 'private' ? '图片已发送到 QQ 私聊。' : '图片已发送到 QQ 群。');
      return {
        qq_send_image: true,
        action: `qq_send_image.send_${mode === 'private' ? 'private' : 'group'}`,
        content,
        status_key: statusRecord.status_key,
        message_id: messageId
      };
    } catch (error) {
      if (statusRecord) {
        await this.writeStatus({
          ...statusRecord,
          status: 'failed',
          updated_at: utcNowIso(),
          reason: error instanceof Error ? error.message : String(error)
        });
      }
      throw error;
    }
  }

  async sendGroup(args: Record<string, unknown>, context: QqSendImageActionContext = {}) {
    const group = parseQqNumber(getGroupId(args), 'group_id');
    const imagePath = getImagePath(args);
    if (!imagePath) throw new Error('image_path is required');
    return this.sendImage('group', group, imagePath, args.caption, context);
  }

  async sendPrivate(args: Record<string, unknown>, context: QqSendImageActionContext = {}) {
    const user = parseQqNumber(getUserId(args), 'user_id');
    const imagePath = getImagePath(args);
    if (!imagePath) throw new Error('image_path is required');
    return this.sendImage('private', user, imagePath, args.caption, context);
  }

  async check(args: Record<string, unknown>): Promise<QqSendImageToolResult> {
    const messageId = firstNonEmptyString(args.message_id, args.messageId);
    let key = firstNonEmptyString(args.status_key, args.statusKey);
    const mode = getMode(args);
    const targetId = firstNonEmptyString(args.target_id, args.targetId, args.user_id, args.userId, args.group_id, args.groupId);
    const rawImagePath = getImagePath(args);
    const imagePath = rawImagePath ? await this.resolveExistingPath(rawImagePath) : '';

    let record = messageId ? await this.findStatusByMessageId(messageId) : null;
    if (!record && key) {
      record = await this.readStatus(key);
    }
    if (!record && !key && mode && targetId && imagePath) {
      key = statusKey(mode, targetId, imagePath, normalizeCaption(args.caption));
      record = await this.readStatus(key);
    }

    if (!record) {
      const reason = !messageId && !key && !(mode && targetId && imagePath)
        ? '需要提供 --message-id、--status-key，或完整的 mode target_id image_path。'
        : '没有找到这次图片发送的本地状态记录。';
      return {
        qq_send_image: true,
        action: 'qq_send_image.check',
        content: formatTaggedBlock('QQ_IMAGE_SEND_STATUS', {
          status: 'unknown',
          mode,
          target_id: targetId,
          image_path: imagePath,
          status_key: key,
          message_id: messageId
        }, reason),
        failed: false
      };
    }

    const status = record.status || 'unknown';
    const content = formatTaggedBlock('QQ_IMAGE_SEND_STATUS', {
      status,
      mode: record.mode || mode,
      target_id: record.target_id || targetId,
      image_path: record.image_path || imagePath,
      caption_sent: String(Boolean(record.caption_sent)),
      status_key: record.status_key || key,
      message_id: record.message_id,
      updated_at: record.updated_at,
      reason: status === 'failed' ? record.reason || 'unknown' : undefined
    }, status === 'sent'
      ? '图片已提交到 QQ 发送链路。'
      : status === 'failed'
        ? '图片发送失败。'
        : status === 'pending'
          ? '图片发送命令已经启动，但本地状态还没有记录到成功或失败。'
          : '图片发送状态未知。');
    return {
      qq_send_image: true,
      action: 'qq_send_image.check',
      content,
      failed: false,
      status_key: record.status_key,
      message_id: record.message_id
    };
  }

  error(action: string, args: Record<string, unknown>, reason: string): QqSendImageToolResult {
    return {
      qq_send_image: true,
      action,
      failed: true,
      content: formatTaggedBlock('QQ_IMAGE_SEND_ERROR', {
        action,
        arguments: JSON.stringify(args),
        reason
      })
    };
  }
}

export class QqSendImageSkillRuntime {
  constructor(private readonly service: QqSendImageService) {}

  async execute(action: string, args: Record<string, unknown> = {}, context: QqSendImageActionContext = {}): Promise<QqSendImageToolResult> {
    try {
      if (action === 'send_group') {
        return await this.service.sendGroup(args, context);
      }
      if (action === 'send_private') {
        return await this.service.sendPrivate(args, context);
      }
      if (action === 'check') {
        return await this.service.check(args);
      }
      throw new Error(`Unsupported qq_send_image action: ${action}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.service.error(QQ_SEND_IMAGE_ACTION_LABELS[action] || `qq_send_image.${action || 'unknown'}`, args, message);
    }
  }
}
