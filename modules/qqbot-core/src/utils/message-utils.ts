import { MessageAttachment, OB11Segment, QQMessage } from '../types';

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
    .filter(segment => segment.type !== 'text' && segment.type !== 'at')
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
