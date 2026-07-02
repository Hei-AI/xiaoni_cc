import axios, { AxiosInstance } from 'axios';
import { napcatConfig } from '../config';
import { logger } from '../utils/logger';
import { QQ_FACE_IDS } from '../data/qq-face-names';

// 出站表情编码:把显式记号 [表情:名字] 替换成 NapCat 系统表情 CQ 码 [CQ:face,id=N]。
// 只认带 "表情:" 前缀的显式 sigil —— 裸 [OK]/[流泪] 等字面文本原样通过,不会被误当成表情
// (与入站解码对称但不贪婪:入站把 face 段渲染成可读的 [笑哭],出站要求显式 [表情:笑哭] 才编码)。
// 已存在的 [CQ:...](如 at、raw face)不匹配此正则,原样透传。未知名字保持字面。
const FACE_SIGIL_REGEX = /\[表情:([^\]]{1,16})\]/g;

// 字符串消息路(send_private_msg / send_group_msg):把 [表情:名字] 编成 [CQ:face,id=N]。
// NapCat 对字符串消息解析 CQ 码,所以这里输出 CQ 码即可。裸 [CQ:...] 原样透传(NapCat 自解析)。
export function encodeOutboundFaces(text: string): string {
  if (!text) {
    return text;
  }
  return text.replace(FACE_SIGIL_REGEX, (whole, rawName: string) => {
    const id = QQ_FACE_IDS[rawName.trim()];
    return id ? `[CQ:face,id=${id}]` : whole;
  });
}

// 数组消息路(图片 caption):数组里的 text 段是字面、NapCat 不解析 CQ,所以不能靠 CQ 码,
// 必须把 [表情:名字](或裸 [CQ:face,id=N])拆出来注入真正的 {type:'face'} 段。与字符串路
// 共用同一张 QQ_FACE_IDS 反表 —— 内容同源,只是信封格式不同,故行为一致:两条路都出真表情。
const CAPTION_FACE_TOKEN_REGEX = /\[表情:([^\]]{1,16})\]|\[CQ:face,id=(\d+)\]/g;

export function encodeCaptionSegments(caption: string): Array<Record<string, unknown>> {
  const segments: Array<Record<string, unknown>> = [];
  let lastIndex = 0;
  for (const match of caption.matchAll(CAPTION_FACE_TOKEN_REGEX)) {
    const id = match[2] ?? QQ_FACE_IDS[(match[1] ?? '').trim()];
    if (!id) {
      continue; // 未知名字:保留字面,交给后续 text 段原样带出
    }
    const before = caption.slice(lastIndex, match.index);
    if (before) {
      segments.push({ type: 'text', data: { text: before } });
    }
    segments.push({ type: 'face', data: { id } });
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  const rest = caption.slice(lastIndex);
  if (rest) {
    segments.push({ type: 'text', data: { text: rest } });
  }
  if (segments.length === 0 && caption) {
    segments.push({ type: 'text', data: { text: caption } });
  }
  return segments;
}

type NapcatActionResponse<T> = {
  status?: string;
  retcode?: number;
  data?: T;
  message?: string;
  wording?: string;
};

export type ForwardMessageSegment = {
  type?: string;
  data?: Record<string, unknown>;
};

export type ForwardMessageItem = {
  sender?: { nickname?: string; user_id?: number | string };
  time?: number;
  content?: ForwardMessageSegment[];
  message?: ForwardMessageSegment[];
};

export type NapcatGroupInfo = {
  group_id?: number;
  group_name?: string;
  group_remark?: string;
  member_count?: number;
  max_member_count?: number;
};

function normalizeMentionUserId(value: string | number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid mention user id: ${value}`);
  }
  return String(Math.trunc(numeric));
}

export function buildGroupMessageText(message: string, mentionUserIds: Array<string | number> = []) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new Error('Group message text cannot be empty');
  }

  // 先编码正文里的表情记号,再拼 @ 前缀。at 的 [CQ:at,...] 不匹配表情正则,互不干扰。
  const encodedBody = encodeOutboundFaces(trimmedMessage);

  const normalizedMentionIds = Array.from(new Set(
    mentionUserIds.map((value) => normalizeMentionUserId(value))
  ));

  if (normalizedMentionIds.length === 0) {
    return encodedBody;
  }

  const mentionPrefix = normalizedMentionIds
    .map((userId) => `[CQ:at,qq=${userId}]`)
    .join(' ');

  return `${mentionPrefix} ${encodedBody}`;
}

export function normalizeImageFileReference(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Image file cannot be empty');
  }

  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (dataUrlMatch) {
    return `base64://${dataUrlMatch[2]}`;
  }

  return trimmed;
}

export function buildImageMessage(imageFile: string, caption?: string) {
  const message: Array<Record<string, unknown>> = [
    {
      type: 'image',
      data: {
        file: normalizeImageFileReference(imageFile)
      }
    }
  ];
  if (typeof caption === 'string' && caption.trim()) {
    // caption 里的表情记号拆成 face 段(与文字路同表同行为);无表情时就是单一 text 段,和原来一样。
    message.push(...encodeCaptionSegments(caption.trim()));
  }
  return message;
}

export class NapcatClient {
  private readonly moduleLogger = logger.createModuleLogger('napcat-client');
  private readonly httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: napcatConfig.baseUrl,
      timeout: napcatConfig.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(napcatConfig.accessToken
          ? { Authorization: `Bearer ${napcatConfig.accessToken}` }
          : {})
      }
    });
  }

  getAccessToken() {
    return napcatConfig.accessToken;
  }

  async probe(): Promise<{ reachable: boolean; selfId?: number | null; error?: string }> {
    try {
      const response = await this.callAction<{ user_id?: number }>('get_login_info', {});
      return {
        reachable: true,
        selfId: response?.user_id ?? null
      };
    } catch (error) {
      return {
        reachable: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // Liveness probe for the inbound watchdog. Wraps get_status so a failed call
  // surfaces as reachable:false rather than throwing. `online` mirrors NapCat's
  // login heartbeat — note it stays true even when the receive pipe is dead, so
  // the watchdog must combine it with event staleness.
  async probeLiveness(): Promise<{ reachable: boolean; online: boolean | null }> {
    try {
      const data = await this.callAction<{ online?: boolean }>('get_status', {});
      return { reachable: true, online: typeof data?.online === 'boolean' ? data.online : null };
    } catch (error) {
      this.moduleLogger.warn('NapCat liveness probe failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { reachable: false, online: null };
    }
  }

  async sendPrivateMessage(userId: number, message: string): Promise<any> {
    return this.callAction('send_private_msg', {
      user_id: userId,
      message: encodeOutboundFaces(message)
    });
  }

  async sendPrivateImage(userId: number, imageFile: string, caption?: string): Promise<any> {
    return this.callAction('send_private_msg', {
      user_id: userId,
      message: buildImageMessage(imageFile, caption)
    });
  }

  async sendGroupMessage(groupId: number, message: string, mentionUserIds: Array<string | number> = []): Promise<any> {
    return this.callAction('send_group_msg', {
      group_id: groupId,
      message: buildGroupMessageText(message, mentionUserIds)
    });
  }

  async sendGroupImage(groupId: number, imageFile: string, caption?: string): Promise<any> {
    return this.callAction('send_group_msg', {
      group_id: groupId,
      message: buildImageMessage(imageFile, caption)
    });
  }

  async getFile(fileId: string): Promise<any> {
    return this.callAction('get_file', {
      file_id: fileId
    });
  }

  async getForwardMessage(id: string): Promise<ForwardMessageItem[]> {
    const result = await this.callAction<{ messages?: ForwardMessageItem[] }>('get_forward_msg', { id });
    return result?.messages ?? [];
  }

  async getGroupInfo(groupId: number): Promise<NapcatGroupInfo | null> {
    const result = await this.callAction<NapcatGroupInfo>('get_group_info', {
      group_id: groupId
    });
    return result || null;
  }

  // 资料面写入（只作用于登录账号自己）——见 docs/XIAONI_QQ_PROFILE_OPS_RESEARCH.md 的真机验证。
  // NapCat 无法修改他人头像/签名/状态，故这几个都只写自己。

  // 更换自己头像。file 可为本地路径 / http(s) URL / data:image;base64 / base64://。
  async setQqAvatar(file: string): Promise<any> {
    return this.callAction('set_qq_avatar', {
      file: normalizeImageFileReference(file)
    });
  }

  // 更改自己的个性签名（longNick）。空串合法（清空签名）。
  async setSelfLongnick(longNick: string): Promise<any> {
    return this.callAction('set_self_longnick', {
      longNick
    });
  }

  // 更改自己的在线状态。status 用 NapCat/go-cqhttp 枚举（10 在线 / 30 离开 / 40 隐身 /
  // 50 忙碌 / 60 Q我吧 / 70 请勿打扰）；DIY 状态用 status=10 + extStatus。
  async setOnlineStatus(status: number, extStatus = 0, batteryStatus = 0): Promise<any> {
    return this.callAction('set_online_status', {
      status,
      ext_status: extStatus,
      battery_status: batteryStatus
    });
  }

  // 查看任意人的资料卡（昵称/个性签名/等级/性别等）。自己和别人都可查。
  async getStrangerProfile(userId: number): Promise<Record<string, any> | null> {
    const result = await this.callAction<Record<string, any>>('get_stranger_info', {
      user_id: userId
    });
    return result || null;
  }

  // 查看任意人的在线状态。返回 { status, ext_status }，status 与 setOnlineStatus 同一套枚举
  // （set 忙碌(50) → 这里读回 50），比 get_stranger_info 的内部态编码更适合展示。
  async getUserStatus(userId: number): Promise<{ status?: number; ext_status?: number } | null> {
    const result = await this.callAction<{ status?: number; ext_status?: number }>('nc_get_user_status', {
      user_id: userId
    });
    return result || null;
  }

  private async callAction<T>(action: string, params: Record<string, unknown>): Promise<T> {
    const response = await this.httpClient.post<NapcatActionResponse<T>>(`/${action}`, params);
    const payload = response.data;

    if (payload?.status === 'failed' || (typeof payload?.retcode === 'number' && payload.retcode !== 0)) {
      const message = payload?.wording || payload?.message || `NapCat action failed: ${action}`;
      this.moduleLogger.error('NapCat action failed', { action, params, message, retcode: payload?.retcode });
      throw new Error(message);
    }

    return payload?.data as T;
  }
}
