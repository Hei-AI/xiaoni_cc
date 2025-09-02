import { QQMessage, OB11Segment } from '../../src/types';

export function createMockPrivateMessage(
  message_id: number,
  user_id: number, 
  message: string | OB11Segment[],
  options: Partial<QQMessage> = {}
): QQMessage {
  return {
    message_type: 'private',
    sub_type: 'friend',
    message_id,
    user_id,
    message,
    raw_message: typeof message === 'string' ? message : JSON.stringify(message),
    font: 0,
    sender: {
      user_id,
      nickname: `user${user_id}`,
      card: '',
      sex: 'unknown' as const
    },
    time: Math.floor(Date.now() / 1000),
    self_id: 1129974489,
    post_type: 'message',
    ...options
  };
}

export function createMockGroupMessage(
  message_id: number,
  user_id: number,
  group_id: number,
  message: string | OB11Segment[],
  options: Partial<QQMessage> = {}
): QQMessage {
  return {
    message_type: 'group',
    message_id,
    user_id,
    group_id,
    message,
    raw_message: typeof message === 'string' ? message : JSON.stringify(message),
    font: 0,
    sender: {
      user_id,
      nickname: `user${user_id}`,
      card: '',
      sex: 'unknown' as const,
      age: 25,
      area: '',
      level: '1',
      role: 'member' as const,
      title: ''
    },
    time: Math.floor(Date.now() / 1000),
    self_id: 1129974489,
    post_type: 'message',
    ...options
  };
}

export function createMockReplyMessage(
  message_id: number,
  user_id: number,
  reply_to_message_id: number,
  message: string,
  options: Partial<QQMessage> = {}
): QQMessage {
  const replySegments: OB11Segment[] = [
    { type: 'reply', data: { id: reply_to_message_id.toString() } },
    { type: 'text', data: { text: message } }
  ];

  return createMockPrivateMessage(
    message_id,
    user_id,
    replySegments,
    {
      raw_message: `[CQ:reply,id=${reply_to_message_id}]${message}`,
      ...options
    }
  );
}