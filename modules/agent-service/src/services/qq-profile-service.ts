import { promises as fs } from 'node:fs';
import path from 'node:path';

// 小腻资料面能力（只作用于她自己的 QQ 号）：换自己头像 / 改个性签名 / 改在线状态。
// 链路与 qq-send-image 同款：agent-service 读文件 -> base64 -> provider-service ->
// NapCat。NapCat 独立容器读不到 agent 侧文件，所以头像走 data_url 让 provider materialize
// 成可拉取 URL。NapCat 无法改他人资料，本 service 结构上只写自己。
// 真机验证见 docs/XIAONI_QQ_PROFILE_OPS_RESEARCH.md。

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

export type QqProfileActionContext = {
  traceId?: string | null;
  runId?: string | null;
  batchId?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  sessionKey?: string | null;
};

export type QqProfileToolResult = {
  qq_profile: true;
  action: string;
  content: string;
  failed?: boolean;
};

export type QqProfileServiceOptions = {
  providerServiceUrl?: string;
  runtimeRoot?: string;
  allowedRoots?: string[];
  maxBytes?: number;
  fetchImpl?: FetchLike;
  botAccountId?: string;
};

const DEFAULT_RUNTIME_ROOT = '/xiaoni-runtime';
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

// 在线状态名 -> NapCat/go-cqhttp 枚举码。真机验证过 set_online_status 用这套枚举写入。
const ONLINE_STATUS_CODES: Record<string, number> = {
  online: 10,
  在线: 10,
  away: 30,
  离开: 30,
  invisible: 40,
  隐身: 40,
  busy: 50,
  忙碌: 50,
  qme: 60,
  q我吧: 60,
  dnd: 70,
  请勿打扰: 70
};

// 读侧展示：枚举码 -> 人话（set 用的同一套枚举，round-trips）。用于资料卡上的在线状态。
const ONLINE_STATUS_LABELS: Record<number, string> = {
  10: 'online 在线',
  30: 'away 离开',
  40: 'invisible 隐身',
  50: 'busy 忙碌',
  60: 'qme Q我吧',
  70: 'dnd 请勿打扰'
};

const QQ_PROFILE_ACTION_LABELS: Record<string, string> = {
  view_profile: 'qq_profile.view_profile',
  set_avatar: 'qq_profile.set_avatar',
  set_signature: 'qq_profile.set_signature',
  set_status: 'qq_profile.set_status'
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

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function isPathInside(child: string, root: string) {
  const relative = path.relative(root, child);
  return relative === '' || (Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseRootsEnv(value: string) {
  return value
    .replace(/,/g, path.delimiter)
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
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

// 把状态入参（名字或数字）解析成枚举码。
function resolveStatusCode(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  const text = firstNonEmptyString(raw);
  if (!text) {
    throw new Error('status is required (online|away|invisible|busy|qme|dnd 或数字枚举码)');
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && String(numeric) === text) {
    return numeric;
  }
  const code = ONLINE_STATUS_CODES[text.toLowerCase()] ?? ONLINE_STATUS_CODES[text];
  if (typeof code !== 'number') {
    throw new Error(`unsupported status "${text}"; 用 online|away|invisible|busy|qme|dnd 或数字枚举码`);
  }
  return code;
}

export class QqProfileService {
  private readonly providerServiceUrl: string;
  private readonly runtimeRoot: string;
  private readonly explicitAllowedRoots?: string[];
  private readonly maxBytes: number;
  private readonly fetchImpl: FetchLike;
  private readonly botAccountId: string;

  constructor(options: QqProfileServiceOptions = {}) {
    this.providerServiceUrl = (options.providerServiceUrl || process.env.PROVIDER_SERVICE_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
    this.runtimeRoot = options.runtimeRoot || process.env.XIAONI_RUNTIME_ROOT || DEFAULT_RUNTIME_ROOT;
    this.explicitAllowedRoots = options.allowedRoots;
    this.maxBytes = options.maxBytes || Number.parseInt(process.env.QQ_SEND_IMAGE_MAX_BYTES || '', 10) || DEFAULT_MAX_BYTES;
    this.fetchImpl = options.fetchImpl || fetch;
    this.botAccountId = firstNonEmptyString(options.botAccountId, process.env.XIAONI_BOT_ACCOUNT_ID) || '1129974489';
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
      throw new Error('avatar path must point to a file');
    }
    if (roots.some((root) => isPathInside(resolved, root))) {
      return resolved;
    }
    throw new Error(`avatar path must be under one of the configured image roots: ${roots.join(', ')}`);
  }

  private async readImage(imagePath: string) {
    const stat = await fs.stat(imagePath);
    if (stat.size <= 0) {
      throw new Error('avatar file is empty');
    }
    if (stat.size > this.maxBytes) {
      throw new Error(`avatar file is too large: ${stat.size} bytes > ${this.maxBytes} bytes`);
    }
    const data = await fs.readFile(imagePath);
    return { data, mimeType: sniffMime(data), size: stat.size };
  }

  private async providerPost(endpoint: string, payload: Record<string, unknown>) {
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

  // 打开资料卡（默认自己；给 qq 就看别人）。这是编辑前的「看」——头像/签名/在线状态一屏看全。
  async getProfile(args: Record<string, unknown>): Promise<QqProfileToolResult> {
    const requested = firstNonEmptyString(args.qq, args.user_id, args.userId);
    const isSelf = !requested;
    const targetId = requested || this.botAccountId;
    const numeric = Number(targetId);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      throw new Error(`invalid QQ id "${targetId}"`);
    }
    const response = await this.providerPost('/api/internal/get_profile', { user_id: numeric });
    const data = (response?.data && typeof response.data === 'object' ? response.data : {}) as Record<string, unknown>;
    const statusCode = Number(data.status);
    const statusLabel = Number.isFinite(statusCode)
      ? (ONLINE_STATUS_LABELS[statusCode] || `status=${statusCode}`)
      : 'unknown';
    const longNick = typeof data.long_nick === 'string' ? data.long_nick : '';
    return {
      qq_profile: true,
      action: QQ_PROFILE_ACTION_LABELS.view_profile,
      content: formatTaggedBlock('QQ_PROFILE_CARD', {
        who: isSelf ? 'self' : 'other',
        user_id: numeric,
        nickname: data.nickname ?? '',
        signature: longNick,
        online_status: statusLabel,
        qq_level: data.qq_level ?? '',
        avatar_url: data.avatar_url ?? ''
      }, isSelf
        ? `这是你自己的资料卡。签名${longNick ? `：${longNick}` : '为空'}；在线状态：${statusLabel}。头像用 avatar_url（可在浏览器打开查看）。改头像/签名/状态用 set_avatar / set_signature / set_status。`
        : `这是 ${numeric} 的资料卡（只读，改不了别人的）。签名${longNick ? `：${longNick}` : '为空'}；在线状态：${statusLabel}。`)
    };
  }

  async setAvatar(args: Record<string, unknown>): Promise<QqProfileToolResult> {
    const inputPath = firstNonEmptyString(args.file, args.image_path, args.imagePath, args.path);
    if (!inputPath) throw new Error('file is required (小腻 runtime 下头像图片的路径)');
    const imagePath = await this.resolveImagePath(inputPath);
    const image = await this.readImage(imagePath);
    await this.providerPost('/api/internal/set_qq_avatar', {
      data_url: `data:${image.mimeType};base64,${image.data.toString('base64')}`
    });
    return {
      qq_profile: true,
      action: QQ_PROFILE_ACTION_LABELS.set_avatar,
      content: formatTaggedBlock('QQ_PROFILE_RESULT', {
        field: 'avatar',
        success: 'true',
        image_path: imagePath,
        mime_type: image.mimeType,
        bytes: image.size
      }, '你自己的 QQ 头像已更换。')
    };
  }

  async setSignature(args: Record<string, unknown>): Promise<QqProfileToolResult> {
    // 空串合法（清空签名），所以不能用 firstNonEmptyString 兜底。
    const raw = args.text ?? args.signature ?? args.long_nick ?? args.longNick;
    if (typeof raw !== 'string') throw new Error('text is required (个性签名文本，空串=清空)');
    const longNick = raw;
    await this.providerPost('/api/internal/set_self_longnick', { long_nick: longNick });
    return {
      qq_profile: true,
      action: QQ_PROFILE_ACTION_LABELS.set_signature,
      content: formatTaggedBlock('QQ_PROFILE_RESULT', {
        field: 'signature',
        success: 'true',
        length: longNick.length
      }, longNick ? `你自己的个性签名已改为：${longNick}` : '你自己的个性签名已清空。')
    };
  }

  async setStatus(args: Record<string, unknown>): Promise<QqProfileToolResult> {
    const status = resolveStatusCode(args.status);
    const extStatusRaw = args.ext_status ?? args.extStatus;
    const extStatus = Number.isFinite(Number(extStatusRaw)) ? Number(extStatusRaw) : 0;
    await this.providerPost('/api/internal/set_online_status', {
      status,
      ext_status: extStatus
    });
    return {
      qq_profile: true,
      action: QQ_PROFILE_ACTION_LABELS.set_status,
      content: formatTaggedBlock('QQ_PROFILE_RESULT', {
        field: 'online_status',
        success: 'true',
        status,
        ext_status: extStatus
      }, `你自己的在线状态已更新（status=${status}${extStatus ? `, ext_status=${extStatus}` : ''}）。`)
    };
  }

  error(action: string, args: Record<string, unknown>, reason: string): QqProfileToolResult {
    return {
      qq_profile: true,
      action,
      failed: true,
      content: formatTaggedBlock('QQ_PROFILE_ERROR', {
        action,
        arguments: JSON.stringify(args),
        reason
      })
    };
  }
}

export const QQ_PROFILE_ACTIONS = new Set(['view_profile', 'set_avatar', 'set_signature', 'set_status']);

export class QqProfileSkillRuntime {
  constructor(private readonly service: QqProfileService) {}

  async execute(action: string, args: Record<string, unknown> = {}, _context: QqProfileActionContext = {}): Promise<QqProfileToolResult> {
    try {
      if (action === 'view_profile') {
        return await this.service.getProfile(args);
      }
      if (action === 'set_avatar') {
        return await this.service.setAvatar(args);
      }
      if (action === 'set_signature') {
        return await this.service.setSignature(args);
      }
      if (action === 'set_status') {
        return await this.service.setStatus(args);
      }
      throw new Error(`Unsupported qq_profile action: ${action}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.service.error(QQ_PROFILE_ACTION_LABELS[action] || `qq_profile.${action || 'unknown'}`, args, message);
    }
  }
}
