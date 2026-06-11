import { normalizePrivateChatUser } from '@/pages/PrivateChatManagementPage';

describe('private chat normalization', () => {
  it('converts string counters into numbers before metrics are derived', () => {
    expect(normalizePrivateChatUser({
      user_id: 1129974489,
      nickname: 'self_1129974489',
      last_conversation_time: '2026-03-30 00:14:07.013',
      status: 'success',
      total_conversations: '10' as unknown as number,
      successful_replies: '9' as unknown as number,
      failed_replies: '1' as unknown as number,
      success_rate: '90.0' as unknown as number,
      avg_response_time: '5250ms',
      is_enabled: 1,
      auto_reply_enabled: 1,
      user_notes: undefined,
    })).toMatchObject({
      total_conversations: 10,
      successful_replies: 9,
      failed_replies: 1,
      success_rate: 90,
    });
  });
});
