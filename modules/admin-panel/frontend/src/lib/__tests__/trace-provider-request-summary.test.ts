import { summarizeProviderRequestInputBody } from '@/lib/trace-provider-request-summary';

describe('summarizeProviderRequestInputBody', () => {
  it('surfaces the final prompt-facing system_reminder from provider request input', () => {
    const summary = summarizeProviderRequestInputBody({
      input: [
        {
          role: 'assistant',
          type: 'message',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '暂停。' }],
        },
        {
          role: 'developer',
          type: 'message',
          content: [
            {
              type: 'input_text',
              text: '<system_reminder>外界很安静，没有新消息或弹窗。</system_reminder>',
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      inputCount: 2,
      lastItemIndex: 1,
      lastItemLabel: 'developer / message',
      lastSystemReminderIndex: 1,
      lastSystemReminderText: '<system_reminder>外界很安静，没有新消息或弹窗。</system_reminder>',
    });
  });

  it('still reports the tail item when no system_reminder exists', () => {
    const summary = summarizeProviderRequestInputBody({
      input: [
        {
          role: 'assistant',
          type: 'message',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '继续收着。' }],
        },
      ],
    });

    expect(summary).toMatchObject({
      inputCount: 1,
      lastItemIndex: 0,
      lastItemLabel: 'assistant / message / final_answer',
      lastItemText: '继续收着。',
      lastSystemReminderIndex: null,
      lastSystemReminderText: null,
    });
  });
});
