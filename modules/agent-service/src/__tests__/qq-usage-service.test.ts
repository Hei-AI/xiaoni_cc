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

  async focusThread(threadKey: string, context = {}, actionLabel = 'qq_usage.focus_thread', atMessageId: number | null = null) {
    this.calls.push({ method: 'focusThread', args: [threadKey, context, actionLabel, atMessageId] });
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

  async setGroupNotificationMode(groupId: string, mode: 'all' | 'mentions_only') {
    this.calls.push({ method: 'setGroupNotificationMode', args: [groupId, mode] });
    return { qq_usage: true as const, action: 'qq_usage.set_group_notification_mode', content: `<QQ_GROUP_NOTIFICATION_MODE group_id="${groupId}" mode="${mode}"></QQ_GROUP_NOTIFICATION_MODE>` };
  }

  async setGroupNotificationDelay(groupId: string, seconds: number) {
    this.calls.push({ method: 'setGroupNotificationDelay', args: [groupId, seconds] });
    return { qq_usage: true as const, action: 'qq_usage.set_group_notification_delay', content: `<QQ_GROUP_NOTIFICATION_DELAY group_id="${groupId}" seconds="${seconds}"></QQ_GROUP_NOTIFICATION_DELAY>` };
  }

  error(action: string, args: Record<string, unknown>, reason: string) {
    this.calls.push({ method: 'error', args: [action, args, reason] });
    return { qq_usage: true as const, action, content: `<QQ_USAGE_ERROR reason="${reason}"></QQ_USAGE_ERROR>`, failed: true };
  }
}

test('QqUsageService renders muted notification state in inbox thread list', async () => {
  const service = new QqUsageService({
    clearQqUsageActiveSurface: async () => undefined,
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
        notificationAggregationSeconds: 30,
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
  assert.match(result.content, /notification_aggregation_seconds="30"/);
  assert.match(result.content, /unread_count="21"/);
  assert.match(result.content, /direct_mentions="1"/);
});

test('QqUsageService records active surface internally when focusing and clears it when putting away', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const service = new QqUsageService({
    listQqUsageThreadWindow: async () => ({
      threadKey: 'qq:group:253631878',
      mode: 'latest',
      windowSize: 10,
      cursorAnchor: '200:200',
      hasOlderMessages: false,
      hasNewerMessages: false,
      newerAvailable: 0,
      unreadBeforeWindow: 0,
      unreadAfterWindow: 0,
      reachedReadHistory: false,
      unreadCount: 1,
      directMentions: 0,
      latestMessageId: 200,
      earliestMessageId: 200,
      windowUnreadCount: 1,
      messages: [{
        id: 200,
        peer_id: '253631878',
        account_id: '1129974489',
        sender_id: '3994058476',
        sender_name: '小伊',
        raw_body: 'hello',
        received_at: '2026-06-18T12:00:00.000Z',
        is_read: 0,
        was_mentioned: 0
      }]
    }),
    recordQqUsageThreadSeen: async (...args: unknown[]) => calls.push({ method: 'recordQqUsageThreadSeen', args }),
    setQqUsageActiveSurface: async (...args: unknown[]) => calls.push({ method: 'setQqUsageActiveSurface', args }),
    markQqUsageThreadRead: async (...args: unknown[]) => {
      calls.push({ method: 'markQqUsageThreadRead', args });
      return { threadKey: 'qq:group:253631878', clearedCount: 1 };
    },
    clearQqUsageActiveSurface: async (...args: unknown[]) => calls.push({ method: 'clearQqUsageActiveSurface', args })
  } as any);

  await service.focusThread('qq:group:253631878', {}, 'qq_usage.focus_group');
  await service.putAway('qq:group:253631878');

  // 手机 QQ 交互：打开会话时清未读（在真实 recordQqUsageThreadSeen 内部完成，见 runtime-store），
  // 放下只释放 active surface、不再清。所以 putAway 不再调 markQqUsageThreadRead。
  assert.deepEqual(calls.map((call) => call.method), [
    'recordQqUsageThreadSeen',
    'setQqUsageActiveSurface',
    'clearQqUsageActiveSurface'
  ]);
  assert.deepEqual(calls[1]?.args[0], {
    threadKey: 'qq:group:253631878',
    chatType: 'group',
    peerId: '253631878',
    accountId: '1129974489'
  });
  assert.deepEqual(calls[2]?.args[0], { threadKey: 'qq:group:253631878' });
});

test('QqUsageService renders self-sent messages as direction=outgoing in the conversation window', async () => {
  const service = new QqUsageService({
    listQqUsageThreadWindow: async () => ({
      threadKey: 'qq:direct:1129974489:85178516',
      mode: 'latest',
      windowSize: 10,
      cursorAnchor: '100:101',
      hasOlderMessages: false,
      hasNewerMessages: false,
      newerAvailable: 0,
      unreadBeforeWindow: 0,
      unreadAfterWindow: 0,
      reachedReadHistory: true,
      unreadCount: 0,
      directMentions: 0,
      latestMessageId: 101,
      earliestMessageId: 100,
      windowUnreadCount: 0,
      messages: [
        {
          id: 100, peer_id: '85178516', account_id: '1129974489', sender_id: '85178516',
          sender_name: '李阿花', raw_body: '在吗', received_at: '2026-06-19T02:00:00.000Z',
          is_read: 1, was_mentioned: 0, direction: 'incoming'
        },
        {
          id: 500, peer_id: '85178516', account_id: '1129974489', sender_id: '1129974489',
          sender_name: '小腻', raw_body: '在的，刚在看书', received_at: '2026-06-19T02:00:10.000Z',
          is_read: 1, was_mentioned: 0, direction: 'outgoing'
        }
      ]
    }),
    recordQqUsageThreadSeen: async () => undefined,
    setQqUsageActiveSurface: async () => undefined
  } as any);

  const result = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private');

  // 对方的话仍是 incoming，小腻自己回的那条是 outgoing —— 她翻开会话能看到自己说了啥
  assert.match(result.content, /direction="incoming"[^>]*>\s*在吗/);
  assert.match(result.content, /direction="outgoing"/);
  assert.match(result.content, /在的，刚在看书/);
});

test('QqUsageService keeps a self-sent image placeholder id intact so she can inspect it from history', async () => {
  const service = new QqUsageService({
    listQqUsageThreadWindow: async () => ({
      threadKey: 'qq:direct:1129974489:85178516',
      mode: 'latest',
      windowSize: 10,
      cursorAnchor: '100:100',
      hasOlderMessages: false,
      hasNewerMessages: false,
      newerAvailable: 0,
      unreadBeforeWindow: 0,
      unreadAfterWindow: 0,
      reachedReadHistory: true,
      unreadCount: 0,
      directMentions: 0,
      latestMessageId: 100,
      earliestMessageId: 100,
      windowUnreadCount: 0,
      messages: [{
        id: 700, peer_id: '85178516', account_id: '1129974489', sender_id: '1129974489',
        sender_name: '小腻', raw_body: '给你看这个\n[图片:media_1699_abcd]',
        received_at: '2026-06-19T02:05:00.000Z', is_read: 1, was_mentioned: 0, direction: 'outgoing'
      }]
    }),
    recordQqUsageThreadSeen: async () => undefined,
    setQqUsageActiveSurface: async () => undefined
  } as any);

  const result = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private');

  // 占位符 id 原样透出，和收到的图一样能喂给 inspect_image_placeholder
  assert.match(result.content, /direction="outgoing"/);
  assert.match(result.content, /\[图片:media_1699_abcd\]/);
});

test('qq_usage window drops internal-bookkeeping noise and private-irrelevant fields, keeps message_id', async () => {
  const service = new QqUsageService({
    clearQqUsageActiveSurface: async () => undefined,
    listQqUsageThreads: async () => ({
      offset: 0, limit: 10, searchQuery: '', chatType: null,
      hasOlderThreads: false, hasNewerThreads: false,
      threads: [{
        threadKey: 'qq:direct:1129974489:85178516', chatType: 'direct', peerId: '85178516',
        peerName: '李阿花', accountId: '1129974489', imReceiveEnabled: true,
        notificationMuted: false, notificationAggregationSeconds: 0,
        unreadCount: 3, directMentions: 0, totalMessages: 10,
        lastReceivedAt: '2026-06-19T02:00:00.000Z',
        latestMessage: { sender_id: '85178516', sender_name: '李阿花', raw_body: '在吗', received_at: '2026-06-19T02:00:00.000Z' }
      }]
    }),
    listQqUsageThreadWindow: async (params: any) => ({
      threadKey: params?.threadKey || 'qq:direct:1129974489:85178516', mode: 'latest', windowSize: 10,
      cursorAnchor: '100:101', hasOlderMessages: true, hasNewerMessages: false,
      newerAvailable: 0, unreadBeforeWindow: 2, unreadAfterWindow: 0,
      reachedReadHistory: true, unreadCount: 1, directMentions: 0,
      latestMessageId: 101, earliestMessageId: 100, windowUnreadCount: 1,
      messages: [
        { id: 100, onebot_id: 'sid-100', peer_id: '85178516', account_id: '1129974489', sender_id: '85178516', sender_name: '李阿花', raw_body: '读过的', received_at: '2026-06-19T02:00:00.000Z', is_read: 1, was_mentioned: 0 },
        { id: 101, onebot_id: 'sid-101', peer_id: '85178516', account_id: '1129974489', sender_id: '85178516', sender_name: '李阿花', raw_body: '没读的', received_at: '2026-06-19T02:00:20.000Z', is_read: 0, was_mentioned: 0, reply_to_id: 'sid-100', reply_to_handle: 'sid-100', reply_to_body: '读过的', reply_to_sender: '李阿花' }
      ]
    }),
    recordQqUsageThreadSeen: async () => undefined,
    setQqUsageActiveSurface: async () => undefined
  } as any);

  const inbox = await service.openInbox();
  // 私聊 THREAD：无内部 id / 冗余命令 / 群专属字段
  for (const noise of [/thread_key=/, /focus_target=/, /surface=/, /offset=/,
    /notification_muted=/, /notification_aggregation_seconds=/, /direct_mentions=/]) {
    assert.doesNotMatch(inbox.content, noise);
  }
  // 保留她真正要用的
  assert.match(inbox.content, /peer_id="85178516"/);
  assert.match(inbox.content, /chat_type="私聊"/);
  assert.match(inbox.content, /unread_count="3"/);

  const win = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private');
  // 会话窗口：删纯内部记账字段
  for (const noise of [/surface=/, /thread_key=/, /cursor_anchor=/, /window_size=/, /newer_available=/]) {
    assert.doesNotMatch(win.content, noise);
  }
  // 保留导航信号 + 逻辑闭环：她后续 scroll/jump/put_away/send 这条会话要用的干净 id
  assert.match(win.content, /mode="conversation"/);
  assert.match(win.content, /chat_type="私聊"/);
  assert.match(win.content, /peer_id="85178516"/);
  assert.match(win.content, /unread_before_window="2"/);
  assert.match(win.content, /has_older_messages="true"/);
  // message_id 现在是 OneBot 消息 id(onebot_id)；reply_to 是被引用消息的 OneBot id
  // 句柄(reply_to_handle)——同命名空间，她能 focus_private 85178516 sid-100 定位原消息。
  // 短且完整的引用正文内联透出、无截断标记。
  assert.match(win.content, /message_id="sid-100"/);
  assert.match(win.content, /message_id="sid-101"[^>]*reply_to="sid-100"/);
  assert.match(win.content, /「引用 李阿花: 读过的」/);
  assert.doesNotMatch(win.content, /截断|非文字消息|原消息已不在记录/);
  // read_state 只在未读那条出现（读过的默认态不渲染）→ 恰好一次
  assert.equal((win.content.match(/read_state=/g) || []).length, 1);
  assert.match(win.content, /read_state="unread"/);
  // 两条都没 @ 小腻 → mentions_xiaoni 一次都不出现
  assert.doesNotMatch(win.content, /mentions_xiaoni=/);

  // 群会话闭环：群号只能从窗口拿（成员各说各的），scroll_group/put_group_away/send_group 都要它
  const gwin = await service.focusThread('qq:group:253631878', {}, 'qq_usage.focus_group');
  assert.match(gwin.content, /chat_type="群聊"/);
  assert.match(gwin.content, /peer_id="253631878"/);
  assert.doesNotMatch(gwin.content, /thread_key=/);
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
    args: ['qq:group:123', context, 'qq_usage.focus_group', null]
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
  assert.deepEqual(service.calls[0]?.args, ['qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private', null]);
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
  assert.deepEqual(service.calls[0]?.args, ['qq:group:123', {}, 'qq_usage.focus_group', null]);
  assert.deepEqual(service.calls[1]?.args, ['qq:group:123', 'older', 10, {}, 'qq_usage.scroll_group']);
  assert.deepEqual(service.calls[2]?.args, ['qq:group:123', {}, 'qq_usage.jump_group_to_latest']);
  assert.deepEqual(service.calls[3]?.args, ['qq:group:123']);
});

test('QqUsageSkillRuntime lets Xiaoni switch group notification mode', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  const mentionsOnly = await runtime.execute('set_group_notification_mode', { group_id: '123', mode: 'mentions' });
  const all = await runtime.execute('set_group_notification_mode', { group_id: '123', mode: 'all' });

  assert.equal(mentionsOnly.action, 'qq_usage.set_group_notification_mode');
  assert.match(mentionsOnly.content, /mode="mentions_only"/);
  assert.equal(all.action, 'qq_usage.set_group_notification_mode');
  assert.deepEqual(service.calls, [
    { method: 'setGroupNotificationMode', args: ['123', 'mentions_only'] },
    { method: 'setGroupNotificationMode', args: ['123', 'all'] }
  ]);
});

test('QqUsageSkillRuntime lets Xiaoni set group notification aggregation delay', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  const result = await runtime.execute('set_group_notification_delay', { group_id: '123', seconds: '30' });

  assert.equal(result.action, 'qq_usage.set_group_notification_delay');
  assert.match(result.content, /seconds="30"/);
  assert.deepEqual(service.calls, [
    { method: 'setGroupNotificationDelay', args: ['123', 30] }
  ]);
});

test('QqUsageSkillRuntime rejects invalid group notification mode', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any);

  const result = await runtime.execute('set_group_notification_mode', { group_id: '123', mode: 'silent' });

  assert.equal(result.failed, true);
  assert.match(result.content, /mode must be all or mentions_only/);
  assert.equal(service.calls.length, 1);
  assert.equal(service.calls[0]?.method, 'error');
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

test('focus_private/focus_group pass message_id through as the around anchor', async () => {
  const service = new FakeQqUsageService();
  const runtime = new QqUsageSkillRuntime(service as any, { botAccountId: '1129974489' });

  await runtime.execute('focus_private', { user_id: '85178516', message_id: '27590' });
  await runtime.execute('focus_group', { group_id: '123', message_id: 456 });
  await runtime.execute('focus_private', { user_id: '85178516' }); // no message_id → null

  // switching threads inserts putAway calls, so filter to the focusThread calls
  const focusCalls = service.calls.filter((c) => c.method === 'focusThread');
  assert.equal(focusCalls[0]?.args[3], 27590); // parsed to number
  assert.equal(focusCalls[1]?.args[3], 456);
  assert.equal(focusCalls[2]?.args[3], null);
});

function windowStore(messages: Record<string, unknown>[]) {
  return {
    listQqUsageThreadWindow: async () => ({
      threadKey: 'qq:direct:1129974489:85178516', mode: 'latest', windowSize: 10,
      cursorAnchor: null, hasOlderMessages: false, hasNewerMessages: false, newerAvailable: 0,
      unreadBeforeWindow: 0, unreadAfterWindow: 0, reachedReadHistory: true, unreadCount: 0,
      directMentions: 0, messages, latestMessageId: 999, earliestMessageId: 100, windowUnreadCount: 0
    }),
    recordQqUsageThreadSeen: async () => undefined,
    setQqUsageActiveSurface: async () => undefined
  } as any;
}

test('reply preview: short full text renders with no marker + usable reply_to id', async () => {
  const service = new QqUsageService(windowStore([
    { id: 100, peer_id: '85178516', account_id: '1129974489', sender_id: '85178516', sender_name: '李阿花', raw_body: '这个你看看', received_at: '2026-07-02T01:31:50.000Z', is_read: 1, was_mentioned: 0, reply_to_id: '27590', reply_to_handle: '27590', reply_to_body: '话说 你现在用qqusage', reply_to_sender: '李阿花' }
  ]));
  const win = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private');
  assert.match(win.content, /reply_to="27590"/);
  assert.match(win.content, /「引用 李阿花: 话说 你现在用qqusage」/);
  assert.doesNotMatch(win.content, /截断|非文字消息|原消息已不在记录/);
});

test('reply preview: long body is truncated with an explicit marker but still reachable', async () => {
  const long = '一二三四五六七八九十'.repeat(6); // 60 chars > REPLY_SNIPPET_MAX(40)
  const service = new QqUsageService(windowStore([
    { id: 101, peer_id: '85178516', account_id: '1129974489', sender_id: '85178516', sender_name: '李阿花', raw_body: '看这段', received_at: '2026-07-02T01:32:00.000Z', is_read: 1, was_mentioned: 0, reply_to_id: '500', reply_to_handle: '500', reply_to_body: long, reply_to_sender: '楠楠' }
  ]));
  const win = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private');
  assert.match(win.content, /reply_to="500"/);
  assert.match(win.content, /…\(截断\)/);
});

test('reply preview: media/link quote (no text) says so, still reachable', async () => {
  const service = new QqUsageService(windowStore([
    { id: 102, peer_id: '85178516', account_id: '1129974489', sender_id: '85178516', sender_name: '李阿花', raw_body: '这个', received_at: '2026-07-02T01:33:00.000Z', is_read: 1, was_mentioned: 0, reply_to_id: '610', reply_to_handle: '610', reply_to_body: '', reply_to_sender: '李阿花' }
  ]));
  const win = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private');
  assert.match(win.content, /reply_to="610"/);
  assert.match(win.content, /非文字消息/);
});

test('reply preview: unresolvable handle but body known → show content inline, no phantom reply_to, no false alarm', async () => {
  // reply_to_handle unresolved (quoted row not jumpable), but we DO have the quoted
  // body. Show the content inline (she can still read what was quoted) without a
  // phantom reply_to id and without the misleading 原消息已不在记录 (the content is right there).
  const service = new QqUsageService(windowStore([
    { id: 103, peer_id: '85178516', account_id: '1129974489', sender_id: '85178516', sender_name: '李阿花', raw_body: '还记得吗', received_at: '2026-07-02T01:34:00.000Z', is_read: 1, was_mentioned: 0, reply_to_id: 'sid-gone', reply_to_body: '很久以前的话', reply_to_sender: '李阿花' }
  ]));
  const win = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private');
  assert.match(win.content, /「引用 李阿花: 很久以前的话」/);
  assert.doesNotMatch(win.content, /reply_to=/); // no usable handle → no phantom id
  assert.doesNotMatch(win.content, /原消息已不在记录/); // content is shown → don't false-alarm
});

test('reply preview: true dead-end (no handle, no body) → honest 原消息已不在记录', async () => {
  const service = new QqUsageService(windowStore([
    { id: 104, peer_id: '85178516', account_id: '1129974489', sender_id: '85178516', sender_name: '李阿花', raw_body: '还记得吗', received_at: '2026-07-02T01:34:30.000Z', is_read: 1, was_mentioned: 0, reply_to_id: 'sid-gone2', reply_to_body: '' }
  ]));
  const win = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private');
  assert.match(win.content, /原消息已不在记录/);
  assert.doesNotMatch(win.content, /reply_to=/);
});

test('focus around anchorMissing falls back to latest window with a note', async () => {
  let calls = 0;
  const store = {
    listQqUsageThreadWindow: async (p: any) => {
      calls += 1;
      if (p.mode === 'around') {
        return { threadKey: p.threadKey, mode: 'around', windowSize: 10, cursorAnchor: null, hasOlderMessages: false, hasNewerMessages: false, newerAvailable: 0, unreadBeforeWindow: 0, unreadAfterWindow: 0, reachedReadHistory: false, unreadCount: 0, directMentions: 0, messages: [], latestMessageId: null, earliestMessageId: null, windowUnreadCount: 0, anchorMissing: true };
      }
      return { threadKey: p.threadKey, mode: 'latest', windowSize: 10, cursorAnchor: '100:101', hasOlderMessages: true, hasNewerMessages: false, newerAvailable: 0, unreadBeforeWindow: 0, unreadAfterWindow: 0, reachedReadHistory: true, unreadCount: 0, directMentions: 0, messages: [{ id: 101, peer_id: '85178516', account_id: '1129974489', sender_id: '85178516', sender_name: '李阿花', raw_body: '最新', received_at: '2026-07-02T02:00:00.000Z', is_read: 1, was_mentioned: 0 }], latestMessageId: 101, earliestMessageId: 100, windowUnreadCount: 0 };
    },
    recordQqUsageThreadSeen: async () => undefined,
    setQqUsageActiveSurface: async () => undefined
  } as any;
  const service = new QqUsageService(store);
  const win = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private', 999999);
  assert.equal(calls, 2); // around (missing) then latest fallback
  assert.match(win.content, /<QQ_USAGE_NOTE reason="定位的消息已不在记录里，已打开最新窗口"/);
  assert.equal(win.latest_message_id, 101);
});

test('reply preview is not rendered on outgoing messages (no false 原消息已不在记录)', async () => {
  const service = new QqUsageService(windowStore([
    { id: 700, direction: 'outgoing', peer_id: '85178516', account_id: '1129974489', sender_id: '1129974489', sender_name: '小腻', raw_body: '我回你这句', received_at: '2026-07-02T03:00:00.000Z', is_read: 1, was_mentioned: 0, reply_to_id: 'sid-whatever' }
  ]));
  const win = await service.focusThread('qq:direct:1129974489:85178516', {}, 'qq_usage.focus_private');
  assert.match(win.content, /direction="outgoing"/);
  assert.doesNotMatch(win.content, /「引用/);
  assert.doesNotMatch(win.content, /原消息已不在记录/);
  assert.doesNotMatch(win.content, /reply_to=/);
});
