import test from 'node:test';
import assert from 'node:assert/strict';
import { QqUsageSkillRuntime } from '../services/qq-usage-service';

class FakeQqUsageService {
  calls: Array<{ method: string; args: unknown[] }> = [];

  async openInbox(offset = 0) {
    this.calls.push({ method: 'openInbox', args: [offset] });
    return { qq_usage: true as const, action: 'qq_usage.open_inbox', content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', inbox_offset: offset };
  }

  async scrollInbox(direction: 'older' | 'newer', currentOffset = 0) {
    this.calls.push({ method: 'scrollInbox', args: [direction, currentOffset] });
    return { qq_usage: true as const, action: 'qq_usage.scroll_inbox', content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', inbox_offset: direction === 'older' ? currentOffset + 10 : Math.max(0, currentOffset - 10) };
  }

  async focusThread(threadKey: string) {
    this.calls.push({ method: 'focusThread', args: [threadKey] });
    return { qq_usage: true as const, action: 'qq_usage.focus_thread', content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', thread_key: threadKey, earliest_message_id: 10, latest_message_id: 19 };
  }

  async scrollThread(threadKey: string, direction: 'older' | 'newer', anchorMessageId: number | string | null) {
    this.calls.push({ method: 'scrollThread', args: [threadKey, direction, anchorMessageId] });
    return { qq_usage: true as const, action: 'qq_usage.scroll_thread', content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', thread_key: threadKey, earliest_message_id: 1, latest_message_id: 9 };
  }

  async jumpToLatest(threadKey: string) {
    this.calls.push({ method: 'jumpToLatest', args: [threadKey] });
    return { qq_usage: true as const, action: 'qq_usage.jump_to_latest', content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', thread_key: threadKey, earliest_message_id: 20, latest_message_id: 29 };
  }

  async putAway(threadKey?: string | null) {
    this.calls.push({ method: 'putAway', args: [threadKey] });
    return { qq_usage: true as const, action: 'qq_usage.put_qq_away', content: '<IM_INBOX_WINDOW mode="closed"></IM_INBOX_WINDOW>', thread_key: threadKey || null };
  }

  error(action: string, args: Record<string, unknown>, reason: string) {
    this.calls.push({ method: 'error', args: [action, args, reason] });
    return { qq_usage: true as const, action, content: `<QQ_USAGE_ERROR reason="${reason}"></QQ_USAGE_ERROR>`, failed: true };
  }
}

test('QqUsageSkillRuntime executes skill commands through engineering service state', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  await runtime.execute('open_inbox');
  await runtime.execute('scroll_inbox', { direction: 'older' });
  await runtime.execute('focus_thread', { thread_key: 'qq:group:123' });
  await runtime.execute('scroll_thread', { thread_key: 'qq:group:123', direction: 'older' });

  assert.deepEqual(service.calls.map((call) => call.method), [
    'openInbox',
    'scrollInbox',
    'focusThread',
    'scrollThread'
  ]);
  assert.deepEqual(service.calls[1]?.args, ['older', 0]);
  assert.deepEqual(service.calls[3]?.args, ['qq:group:123', 'older', 10]);
});

test('QqUsageSkillRuntime returns truthful QQ usage errors without throwing', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  const result = await runtime.execute('scroll_thread', { thread_key: 'qq:group:123', direction: 'older' });

  assert.equal(result.failed, true);
  assert.match(result.content, /<QQ_USAGE_ERROR/);
  assert.match(result.content, /focus_thread or jump_to_latest/);
});
