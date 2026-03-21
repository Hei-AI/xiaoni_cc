import { LocalAttachment, MessageAttachment, OB11Segment, QQMessage } from '../types';

const ATTACHMENT_LABELS: Record<string, string> = {
  image: '图片',
  face: '表情',
  record: '语音',
  video: '视频',
  file: '文件',
  sticker: '贴纸',
  forward: '转发',
  json: '卡片',
  xml: '卡片',
  music: '音乐',
  share: '分享',
  location: '位置',
  contact: '名片',
  poke: '戳一戳'
};

export function extractTextFromSegments(segments: OB11Segment[]): string {
  return segments
    .map(segment => {
      if (segment.type === 'text') {
        return segment.data?.text || '';
      }
      if (segment.type === 'at') {
        const name = segment.data?.name || segment.data?.qq;
        return name ? `@${name}` : '@';
      }
      return '';
    })
    .join('')
    .trim();
}

export function extractAttachmentsFromSegments(
  segments: OB11Segment[]
): MessageAttachment[] {
  return segments
    .filter(segment => segment.type !== 'text' && segment.type !== 'at' && segment.type !== 'reply')
    .map(segment => ({
      type: segment.type,
      label: buildAttachmentLabel(segment),
      data: segment.data ?? {}
    }));
}

export function buildAttachmentHints(attachments: MessageAttachment[]): string[] {
  return attachments.map(attachment => `[${attachment.label}]`);
}

export function resolveAttachmentsFromMessage(
  message: QQMessage
): MessageAttachment[] {
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    return message.attachments;
  }

  if (Array.isArray(message.segments)) {
    return extractAttachmentsFromSegments(message.segments);
  }

  if (Array.isArray(message.message)) {
    return extractAttachmentsFromSegments(message.message);
  }

  return [];
}

export interface ResolvedAttachmentView {
  attachment_id: number;
  type: string;
  label: string;
  mime_type?: string;
  original_name?: string;
  base64?: string;
}

export function resolveAttachmentViewsFromMessage(
  message: QQMessage
): ResolvedAttachmentView[] {
  const attachments = resolveAttachmentsFromMessage(message);
  const localAttachments = Array.isArray(message.local_attachments)
    ? message.local_attachments
    : [];

  if (attachments.length === 0 && localAttachments.length === 0) {
    return [];
  }

  const imageSegments = getImageSegments(message);
  let imageIndex = 0;
  let localImageIndex = 0;

  const views = attachments.map((attachment, index) => {
    if (attachment.type !== 'image') {
      return {
        attachment_id: index,
        type: attachment.type,
        label: attachment.label
      };
    }

    const segment = imageSegments[imageIndex++];
    const localAttachment = findNextLocalImage(localAttachments, localImageIndex);
    if (localAttachment) {
      localImageIndex = localAttachment.nextIndex;
    }

    const base64 = extractImageBase64(segment?.data) || localAttachment?.entry.base64;
    const mimeType = resolveAttachmentMimeType(
      segment?.data?.mime || segment?.data?.mimetype || segment?.data?.content_type || localAttachment?.entry.mimeType,
      segment?.data?.file || segment?.data?.name || localAttachment?.entry.originalName
    );

    return {
      attachment_id: index,
      type: 'image',
      label: attachment.label,
      mime_type: mimeType,
      original_name:
        segment?.data?.file || segment?.data?.name || localAttachment?.entry.originalName,
      base64
    };
  });

  if (views.length > 0) {
    return views;
  }

  return localAttachments.map((attachment, index) => ({
    attachment_id: index,
    type: attachment.type,
    label: buildLocalAttachmentLabel(attachment),
    mime_type: attachment.mimeType,
    original_name: attachment.originalName,
    base64: attachment.type === 'image' ? attachment.base64 : undefined
  }));
}

function getImageSegments(message: QQMessage): OB11Segment[] {
  if (Array.isArray(message.message)) {
    return message.message.filter(segment => segment?.type === 'image');
  }

  if (Array.isArray(message.segments)) {
    return message.segments.filter(segment => segment?.type === 'image');
  }

  return [];
}

function findNextLocalImage(
  localAttachments: LocalAttachment[],
  startIndex: number
): { entry: LocalAttachment; nextIndex: number } | null {
  for (let index = startIndex; index < localAttachments.length; index++) {
    const entry = localAttachments[index];
    if (entry?.type === 'image' && typeof entry.base64 === 'string' && entry.base64.trim().length > 0) {
      return {
        entry,
        nextIndex: index + 1
      };
    }
  }

  return null;
}

function extractImageBase64(data: Record<string, any> | undefined): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const candidates = [
    data.base64,
    data.file_base64,
    data.image_base64,
    data.data,
    data.image
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.replace(/\s+/g, '');
    }
  }

  return undefined;
}

function resolveAttachmentMimeType(explicit?: string, fileName?: string): string | undefined {
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    const trimmed = explicit.trim();
    if (trimmed.includes('/')) {
      return trimmed;
    }
  }

  if (typeof fileName !== 'string' || fileName.trim().length === 0) {
    return undefined;
  }

  const lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.bmp')) {
    return 'image/bmp';
  }

  return undefined;
}

function buildLocalAttachmentLabel(attachment: LocalAttachment): string {
  if (attachment.type === 'face') {
    return attachment.originalName ? `表情:${attachment.originalName}` : '表情';
  }

  return attachment.originalName ? `图片:${attachment.originalName}` : '图片';
}

function buildAttachmentLabel(segment: OB11Segment): string {
  const base =
    ATTACHMENT_LABELS[segment.type] ?? segment.type;

  if (segment.type === 'image') {
    const file = segment.data?.file || segment.data?.name;
    if (file) {
      return `${base}:${file}`;
    }
    return base;
  }

  if (segment.type === 'face') {
    const expression = segment.data?.text || segment.data?.id;
    if (expression) {
      return `${base}:${expression}`;
    }
    return base;
  }

  if (segment.type === 'file') {
    const name = segment.data?.name;
    if (name) {
      return `${base}:${name}`;
    }
    return base;
  }

  if (segment.type === 'video') {
    const file = segment.data?.file || segment.data?.name;
    if (file) {
      return `${base}:${file}`;
    }
    return base;
  }

  return base;
}
