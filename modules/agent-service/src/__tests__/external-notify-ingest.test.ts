import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentLoopService,
  isExternalNotifyPayload,
  renderExternalNotify
} from '../services/agent-loop-service';

// 通用 notify 投递口。小腻自己写的后台观察脚本(check-email 这类)靠它把「发生了什么」送到她面前;
// 在此之前那些脚本只能往日志里 print,没人读。
//
// 两条性质承载整条腿:① 正文在 enqueue 时刻冻结进 payload.systemReminder.reminder(下一 run 的
// stack replay 逐字节重建,不能有任何随时间变化的东西);② 它走 source='system_reminder' 这条既有
// 渲染路径,不新增分支。

type EnqueueCall = {
  message: Record<string, unknown>;
  payload: Record<string, unknown>;
  availableAt: unknown;
};

function serviceWithCapturingStore() {
  const calls: EnqueueCall[] = [];
  const store = {
    enqueueQueueMessage(input: EnqueueCall) {
      calls.push(input);
      return Promise.resolve({ queueId: 4242 });
    }
  };
  const service = new AgentLoopService(store as never);
  return { service, calls };
}

// ── 入参校验(路由只转译,校验全在服务里)────────────────────────────────────────

test('空 text → 400 empty_text，且不入队', async () => {
  const { service, calls } = serviceWithCapturingStore();
  for (const text of ['', '   ', '\n\t ', undefined, null, 123]) {
    const result = await service.ingestExternalNotify({ text, sourceSystem: 'check-email' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.reason, 'empty_text');
    }
  }
  assert.equal(calls.length, 0, '校验失败绝不能入队');
});

test('超长 text → 400 text_too_long（截断会让投递方以为送到了，所以直接拒）', async () => {
  const { service, calls } = serviceWithCapturingStore();
  const justOk = 'a'.repeat(4000);
  const tooLong = 'a'.repeat(4001);

  assert.equal((await service.ingestExternalNotify({ text: justOk, sourceSystem: 'x' })).ok, true);
  const result = await service.ingestExternalNotify({ text: tooLong, sourceSystem: 'x' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'text_too_long');
  }
  assert.equal(calls.length, 1, '只有合法的那条入了队');
});

test('非法 source_system → 400 invalid_source_system', async () => {
  const { service, calls } = serviceWithCapturingStore();
  // source_system 逐字进她的上下文，所以字符集必须收窄:大写/空格/中文/斜杠/超长全拒。
  const bad = ['', '  ', 'Check-Email', 'check email', '检查邮件', 'a/b', '-leading', 'a'.repeat(33), undefined, 7];
  for (const sourceSystem of bad) {
    const result = await service.ingestExternalNotify({ text: '有新邮件', sourceSystem });
    assert.equal(result.ok, false, `应当拒绝: ${String(sourceSystem)}`);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.reason, 'invalid_source_system');
    }
  }
  assert.equal(calls.length, 0);

  for (const sourceSystem of ['check-email', 'a', 'x_1', '0abc', 'a'.repeat(32)]) {
    const result = await service.ingestExternalNotify({ text: '有新邮件', sourceSystem });
    assert.equal(result.ok, true, `应当接受: ${sourceSystem}`);
  }
});

// ── 入队形状 ────────────────────────────────────────────────────────────────

test('入队走 source=system_reminder，dedupe key 带 external-notify: 前缀，trace_id 非空', async () => {
  const { service, calls } = serviceWithCapturingStore();
  const result = await service.ingestExternalNotify({
    text: '收件箱有 3 封新邮件',
    sourceSystem: 'check-email'
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.queueId, 4242);
  }
  assert.equal(calls.length, 1);

  const { message } = calls[0];
  assert.equal(message.source, 'system_reminder', '必须走既有的 system_reminder 渲染路径');
  assert.equal(message.chatType, 'direct');
  assert.match(String(message.dedupeKey), /^external-notify:check-email:/);
  assert.equal(message.messageSid, message.dedupeKey);
  // 空 trace_id 会让 stack 的 runtime-input event_id 塌到 runId 兜底，同一 run 两条撞 ON CONFLICT
  // 被吞 → 下个 run replay 变短 → run 边界缓存击穿(docs/CACHE_CONTRACT.md §3)。
  assert.match(String(message.traceId), /^runtrace_\d+_[0-9a-f]{8}$/, 'trace_id 必须显式给足，不能靠兜底');

  const rawPayload = message.rawPayload as Record<string, unknown>;
  assert.equal(rawPayload.reason, 'external_notify');
  assert.equal(rawPayload.source_system, 'check-email');
  assert.equal(rawPayload.notify_template, 'external_notify.md');

  const inboundContext = message.inboundContext as Record<string, unknown>;
  assert.equal(inboundContext.Surface, 'system_reminder');
  assert.equal(inboundContext.Provider, 'runtime');
  assert.equal(inboundContext.WasMentioned, false);
});

test('正文在 enqueue 时刻冻结进 payload.systemReminder.reminder（replay 就读这份字节）', async () => {
  const { service, calls } = serviceWithCapturingStore();
  await service.ingestExternalNotify({ text: '收件箱有 3 封新邮件', sourceSystem: 'check-email' });

  const { message, payload } = calls[0];
  const expected = renderExternalNotify('check-email', '收件箱有 3 封新邮件');
  const systemReminder = payload.systemReminder as Record<string, unknown>;

  assert.equal(systemReminder.reminder, expected);
  assert.equal(systemReminder.reason, 'external_notify');
  assert.equal(systemReminder.sourceSystem, 'check-email');
  // 三处必须是同一份字节:消费端 getSystemReminderText 优先读 systemReminder.reminder，
  // 兜底读 bodyForAgent —— 两者不一致会让「走哪条路」决定她看到什么。
  assert.equal(message.bodyForAgent, expected);
  assert.equal(payload.rawBody, expected);
});

test('★没有幂等★ 同一件事投两次 = 两条独立 notify（服务端随机 key 的既定后果）', async () => {
  // 用户拍板:dedupe key 服务端生成。代价就是这个 —— 投递方(skill)必须自己保证只在状态真变化时投。
  // 这条用例把「无幂等」钉成显式契约，将来谁想改成幂等，得先改这里并说明白。
  const { service, calls } = serviceWithCapturingStore();
  await service.ingestExternalNotify({ text: '同一句话', sourceSystem: 'check-email' });
  await service.ingestExternalNotify({ text: '同一句话', sourceSystem: 'check-email' });

  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].message.dedupeKey, calls[1].message.dedupeKey);
  assert.notEqual(calls[0].message.traceId, calls[1].message.traceId);
});

test('入队抛错 → 500 enqueue_failed，不吞异常也不假装成功', async () => {
  const service = new AgentLoopService({
    enqueueQueueMessage() {
      return Promise.reject(new Error('db down'));
    }
  } as never);
  const result = await service.ingestExternalNotify({ text: 'x', sourceSystem: 'check-email' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
    assert.equal(result.reason, 'enqueue_failed');
  }
});

test('持久化不可用 → 500，而不是静默丢掉这条通知', async () => {
  const service = new AgentLoopService({} as never);
  const result = await service.ingestExternalNotify({ text: 'x', sourceSystem: 'check-email' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
  }
});

// ── 渲染 ────────────────────────────────────────────────────────────────────

test('来源标记机械拼接，正文原样透传', () => {
  assert.equal(
    renderExternalNotify('check-email', '收件箱有 3 封新邮件'),
    '【check-email】收件箱有 3 封新邮件'
  );
});

test('模板正文不自带标签——<system_reminder> 包裹由消费端做', () => {
  // renderSystemReminder → formatSystemReminderBlock 会包裹并转义 body。模板里写标签会让她收到
  // 字面量 &lt;system_reminder&gt; 套在真标签里面。
  const text = renderExternalNotify('check-email', '收件箱有 3 封新邮件');
  assert.ok(!text.includes('<'));
  assert.ok(!text.includes('>'));
});

test('★缓存★ 渲染是纯函数，且模板里没有时间戳（replay 逐字节一致）', () => {
  const a = renderExternalNotify('check-email', '收件箱有 3 封新邮件');
  const b = renderExternalNotify('check-email', '收件箱有 3 封新邮件');
  assert.equal(a, b);
  // 报时是 clock_ping 的职责。这里一旦混进时间戳，下一 run 的 replay 就对不上冻结字节 →
  // run 边界缓存击穿。这条用例是那个防线。
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(a), '模板不能带日期');
  assert.ok(!/\d{2}:\d{2}:\d{2}/.test(a), '模板不能带时钟');
});

// ── 判定 ────────────────────────────────────────────────────────────────────

test('isExternalNotifyPayload 认自己，且不与 subconscious / clock_ping 混淆', () => {
  const base = { source: 'system_reminder' } as never;

  assert.equal(
    isExternalNotifyPayload({
      ...(base as object),
      systemReminder: { reason: 'external_notify' },
      rawPayload: { reason: 'external_notify', notify_template: 'external_notify.md' }
    } as never),
    true
  );

  // reason 对但模板不对(或反之)一律不认 —— 两者同时成立才是这条腿。
  assert.equal(
    isExternalNotifyPayload({
      ...(base as object),
      rawPayload: { reason: 'external_notify', notify_template: 'subconscious_agent_notify.md' }
    } as never),
    false
  );
  assert.equal(
    isExternalNotifyPayload({
      ...(base as object),
      rawPayload: { reason: 'subconscious_agent', notify_template: 'subconscious_agent_notify.md' }
    } as never),
    false
  );
  assert.equal(
    isExternalNotifyPayload({
      ...(base as object),
      rawPayload: { reason: 'clock_ping' }
    } as never),
    false
  );
  // 非 system_reminder 的东西一律不认。
  assert.equal(
    isExternalNotifyPayload({
      source: 'phone_notification',
      rawPayload: { reason: 'external_notify', notify_template: 'external_notify.md' }
    } as never),
    false
  );
});
