import test from 'node:test';
import assert from 'node:assert/strict';
import { QqUsageService, QqUsageSkillRuntime } from '../services/qq-usage-service';

class FakeQqUsageService {
  calls: Array<{ method: string; args: unknown[] }> = [];

  async openInbox(offset = 0) {
    this.calls.push({ method: 'openInbox', args: [offset] });
    return { qq_usage: true as const, action: 'qq_usage.open_inbox', content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', inbox_offset: offset };
  }

  async scrollInbox(direction: 'older' | 'newer', currentOffset = 0, query?: string | null, chatType?: 'direct' | 'group' | null) {
    this.calls.push({ method: 'scrollInbox', args: [direction, currentOffset, query, chatType] });
    return { qq_usage: true as const, action: 'qq_usage.scroll_inbox', content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', inbox_offset: direction === 'older' ? currentOffset + 10 : Math.max(0, currentOffset - 10) };
  }

  async searchInbox(query: string, chatType?: 'direct' | 'group') {
    this.calls.push({ method: 'searchInbox', args: [query, chatType] });
    return { qq_usage: true as const, action: chatType === 'direct' ? 'qq_usage.search_private' : chatType === 'group' ? 'qq_usage.search_group' : 'qq_usage.search_inbox', content: '<IM_INBOX_WINDOW mode="search_results"></IM_INBOX_WINDOW>', inbox_offset: 0 };
  }

  async focusThread(threadKey: string, context = {}, actionLabel = 'qq_usage.focus_thread') {
    this.calls.push({ method: 'focusThread', args: [threadKey, context, actionLabel] });
    return { qq_usage: true as const, action: actionLabel, content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', thread_key: threadKey, earliest_message_id: 10, latest_message_id: 19 };
  }

  async scrollThread(threadKey: string, direction: 'older' | 'newer', anchorMessageId: number | string | null, context = {}, actionLabel = 'qq_usage.scroll_thread') {
    this.calls.push({ method: 'scrollThread', args: [threadKey, direction, anchorMessageId, context, actionLabel] });
    return { qq_usage: true as const, action: actionLabel, content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', thread_key: threadKey, earliest_message_id: 1, latest_message_id: 9 };
  }

  async jumpToLatest(threadKey: string, context = {}, actionLabel = 'qq_usage.jump_to_latest') {
    this.calls.push({ method: 'jumpToLatest', args: [threadKey, context, actionLabel] });
    return { qq_usage: true as const, action: actionLabel, content: '<IM_INBOX_WINDOW></IM_INBOX_WINDOW>', thread_key: threadKey, earliest_message_id: 20, latest_message_id: 29 };
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

test('QqUsageService renders muted notification state in inbox thread list', async () => {
  const service = new QqUsageService({
    listQqUsageThreads: async () => ({
      offset: 0,
      limit: 10,
      searchQuery: '',
      chatType: null,
      hasOlderThreads: false,
      hasNewerThreads: false,
      threads: [{
        threadKey: 'qq:group:253631878',
        chatType: 'group',
        peerId: '253631878',
        peerName: '测试群',
        accountId: '1129974489',
        imReceiveEnabled: false,
        notificationMuted: true,
        unreadCount: 21,
        directMentions: 1,
        totalMessages: 100,
        lastReceivedAt: '2026-06-18T12:00:00.000Z',
        latestMessage: null
      }]
    })
  } as any);

  const result = await service.openInbox();

  assert.match(result.content, /notification_muted="true"/);
  assert.match(result.content, /unread_count="21"/);
  assert.match(result.content, /direct_mentions="1"/);
});

test('QqUsageSkillRuntime executes skill commands through engineering service state', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  await runtime.execute('open_inbox');
  await runtime.execute('scroll_inbox', { direction: 'older' });
  await runtime.execute('focus_group', { group_id: '123' });
  await runtime.execute('scroll_group', { group_id: '123', direction: 'older' });

  assert.deepEqual(service.calls.map((call) => call.method), [
    'openInbox',
    'scrollInbox',
    'focusThread',
    'scrollThread'
  ]);
  assert.deepEqual(service.calls[1]?.args, ['older', 0, null, null]);
  assert.deepEqual(service.calls[3]?.args, ['qq:group:123', 'older', 10, {}, 'qq_usage.scroll_group']);
});

test('QqUsageSkillRuntime passes runtime trace context to thread-reading actions', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);
  const context = {
    traceId: 'trace-qq-usage',
    runId: 'run-qq-usage',
    batchId: 'batch-qq-usage',
    toolCallId: 'call-exec',
    toolName: 'exec_command',
    sessionKey: 'xiaoni:test-global'
  };

  await runtime.execute('focus_group', { group_id: '123' }, context);

  assert.deepEqual(service.calls[0], {
    method: 'focusThread',
    args: ['qq:group:123', context, 'qq_usage.focus_group']
  });
});

test('QqUsageSkillRuntime searches inbox by name and preserves search while scrolling', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  const inboxResult = await runtime.execute('search_inbox', { query: '阿花' });
  await runtime.execute('scroll_inbox', { direction: 'older' });

  assert.equal(inboxResult.action, 'qq_usage.search_inbox');
  assert.deepEqual(service.calls, [
    { method: 'searchInbox', args: ['阿花', undefined] },
    { method: 'scrollInbox', args: ['older', 0, '阿花', null] }
  ]);
});

test('QqUsageSkillRuntime opens private chats by user id using the configured bot account', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any, { botAccountId: '1129974489' });

  const focusResult = await runtime.execute('focus_private', { user_id: '85178516' });
  const scrollResult = await runtime.execute('scroll_private', { user_id: '85178516', direction: 'newer' });
  const jumpResult = await runtime.execute('jump_private_to_latest', { user_id: '85178516' });
  await runtime.execute('put_qq_away');

  assert.deepEqual(service.calls.map((call) => call.method), [
    'focusThread',
    'scrollThread',
    'jumpToLatest',
    'putAway'
  ]);
  assert.equal(focusResult.action, 'qq_usage.focus_private');
  assert.equal(scrollResult.action, 'qq_usage.scroll_private');
  assert.equal(jumpResult.action, 'qq_usage.jump_private_to_latest');
  assert.deepEqual(service.calls[0]?.args, ['qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private']);
  assert.deepEqual(service.calls[1]?.args, ['qq:direct:1129974489:85178516', 'newer', 19, {}, 'qq_usage.scroll_private']);
  assert.deepEqual(service.calls[2]?.args, ['qq:direct:1129974489:85178516', {}, 'qq_usage.jump_private_to_latest']);
  assert.deepEqual(service.calls[3]?.args, ['qq:direct:1129974489:85178516']);
});

test('QqUsageSkillRuntime rejects internal private thread keys on private commands', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any, { botAccountId: '1129974489' });

  const directResult = await runtime.execute('jump_private_to_latest', { user_id: 'qq:direct:1129974489:85178516' });
  const privateResult = await runtime.execute('focus_private', { user_id: 'qq:private:85178516' });

  assert.equal(directResult.failed, true);
  assert.equal(privateResult.failed, true);
  assert.match(directResult.content, /not an internal QQ thread key/);
  assert.match(privateResult.content, /not an internal QQ thread key/);
  assert.equal(service.calls.length, 2);
  assert.equal(service.calls[0]?.method, 'error');
  assert.equal(service.calls[1]?.method, 'error');
});

test('QqUsageSkillRuntime rejects internal group thread keys on group commands', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  const result = await runtime.execute('focus_group', { group_id: 'qq:group:123' });

  assert.equal(result.failed, true);
  assert.match(result.content, /not an internal QQ thread key/);
  assert.equal(service.calls.length, 1);
  assert.equal(service.calls[0]?.method, 'error');
});

test('QqUsageSkillRuntime opens groups by group id', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  await runtime.execute('focus_group', { group_id: '123' });
  await runtime.execute('scroll_group', { group_id: '123', direction: 'older' });
  await runtime.execute('jump_group_to_latest', { group_id: '123' });
  await runtime.execute('put_qq_away');

  assert.deepEqual(service.calls.map((call) => call.method), [
    'focusThread',
    'scrollThread',
    'jumpToLatest',
    'putAway'
  ]);
  assert.deepEqual(service.calls[0]?.args, ['qq:group:123', {}, 'qq_usage.focus_group']);
  assert.deepEqual(service.calls[1]?.args, ['qq:group:123', 'older', 10, {}, 'qq_usage.scroll_group']);
  assert.deepEqual(service.calls[2]?.args, ['qq:group:123', {}, 'qq_usage.jump_group_to_latest']);
  assert.deepEqual(service.calls[3]?.args, ['qq:group:123']);
});

test('QqUsageSkillRuntime forgets scroll anchors after putting a chat away', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any, { botAccountId: '1129974489' });

  await runtime.execute('focus_private', { user_id: '85178516' });
  await runtime.execute('put_qq_away');
  const result = await runtime.execute('scroll_private', { user_id: '85178516', direction: 'older' });

  assert.equal(result.failed, true);
  assert.match(result.content, /focus_private or jump_private_to_latest/);
});

test('QqUsageSkillRuntime returns truthful QQ usage errors without throwing', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  const result = await runtime.execute('scroll_group', { group_id: '123', direction: 'older' });

  assert.equal(result.failed, true);
  assert.match(result.content, /<QQ_USAGE_ERROR/);
  assert.match(result.content, /focus_group or jump_group_to_latest/);
});
