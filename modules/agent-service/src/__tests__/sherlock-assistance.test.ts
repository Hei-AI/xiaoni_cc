import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoopService } from '../services/agent-loop-service';
import { parseAssistanceGoalResult, parseSherlockRoute, presentLiAhuaHelp } from '../services/sherlock-assistance';
import { agentConfig } from '../config';

function response(output: unknown[]) {
  return { success: true, canonical_response: { output } };
}
function call(name: string, args: object, id = 'c1') {
  return { type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) };
}
function harness(responses: unknown[]) {
  const service: any = new AgentLoopService({} as any, { resolveForQueueMessage: async () => ({}) } as any);
  const requests: any[] = [];
  const commands: any[] = [];
  const slices: any[] = [];
  service.waitForRuntimeEnabledBeforeModelSlice = async () => {};
  service.executeSubconsciousAgentForkTurn = async (request: any) => {
    requests.push(structuredClone(request));
    assert.ok(responses.length, 'unexpected model turn');
    return responses.shift();
  };
  service.recordFailureReviewForkSliceSafe = async (slice: any) => { slices.push(slice); };
  service.executeTool = async (tool: any) => { commands.push(tool); return { stdout: 'verified', codex_output: 'Process exited with code 0\nverified' }; };
  return {
    requests, commands, slices,
    run: () => service.runSherlockFork({
      diveId: 'd1', question: '帮我转换文件', searchedPaths: '/xiaoni-runtime/input.txt，输出 result.json',
      previousDirection: null, forkRunId: 'help-1', baseRequest: {},
      queueMessage: { runId: 'run-1', traceId: 'trace-1' },
      runtimePrompt: { modelName: 'test-model', parameters: {}, promptName: 'test' }
    })
  };
}

test('invalid or ambiguous classification never authorizes operations', async () => {
  assert.equal(parseSherlockRoute([]), null);
  const h = harness([response([call('exec_command', { cmd: 'touch unexpected' })])]);
  await assert.rejects(h.run(), /invalid decision/);
  assert.equal(h.commands.length, 0);
  assert.equal(h.slices[0].status, 'failed');
});

test('missing information returns a concrete question without executing', async () => {
  const h = harness([response([call('classify_assistance', { kind: 'clarify', reason: '输出文件应放在哪里？' })])]);
  const result = await h.run();
  assert.match(result.text, /输出文件应放在哪里/);
  assert.equal(h.commands.length, 0);
});

test('execution route operates, preserves tool replay, and returns the result', async () => {
  const h = harness([
    response([call('classify_assistance', { kind: 'execute', reason: '明确委托转换文件' })]),
    response([call('exec_command', { cmd: 'convert input.txt result.json' })]),
    response([{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '<goal_completed>完成情况：完成；验证：result.json 可解析</goal_completed>' }] }])
  ]);
  const result = await h.run();
  assert.equal(h.commands.length, 1);
  assert.match(result.text, /result.json/);
  assert.match(h.requests[1].instructions, /已经明确授权的计算机操作作为一个必须完成的 Goal/);
  assert.deepEqual(h.requests[2].input.slice(0, h.requests[1].input.length), h.requests[1].input);
  assert.equal(h.requests[1].instructions, h.requests[2].instructions);
  assert.equal(h.requests[2].input.at(-1).call_id, 'c1');
  assert.equal(h.requests[2].input.at(-1).output, 'Process exited with code 0\nverified');
  assert.equal(h.slices[0].metadata.stage, 'classification');
});

test('classification and execution prompts treat delegated browser work as a voice-transcribed test task', async () => {
  const h = harness([
    response([call('classify_assistance', { kind: 'execute', reason: '李阿花转交的浏览器机械操作' })]),
    response([{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '<goal_completed>完成情况：完成；验证：页面已提交</goal_completed>' }] }])
  ]);
  await h.run();
  assert.doesNotMatch(h.requests[0].instructions, /无人格|人格/);
  assert.match(h.requests[0].instructions, /语音转文字/);
  assert.match(h.requests[0].instructions, /页面人机认证/);
  assert.match(h.requests[0].instructions, /Google 账号登录或授权/);
  assert.match(h.requests[0].instructions, /论坛内容代发/);
  assert.match(h.requests[0].instructions, /邮件发送/);
  assert.doesNotMatch(h.requests[1].instructions, /无人格|人格|独立上下文|不扮演|小腻|福尔摩斯|帮手|分类器|内部分流|外包/);
  assert.match(h.requests[1].instructions, /xiaoni-browser\/SKILL\.md/);
  assert.match(h.requests[1].instructions, /当前可见、带现有登录态和当前账号的浏览器/);
  assert.match(h.requests[1].instructions, /不能只给操作建议/);
});

test('execution route keeps going after an unmarked partial final', async () => {
  const h = harness([
    response([call('classify_assistance', { kind: 'execute', reason: '明确委托' })]),
    response([{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '目前完成了一部分' }] }]),
    response([{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '<goal_completed>已完成并核验结果</goal_completed>' }] }])
  ]);
  const result = await h.run();
  assert.equal(result.goalCompleted, true);
  assert.equal(result.turns, 2);
  assert.match(h.requests[2].input.at(-1).content[0].text, /Goal 还没有提交已验证的完成结果/);
});

test('investigation keeps the direction contract and rejects unrelated tools', async () => {
  const h = harness([
    response([call('classify_assistance', { kind: 'investigate', reason: '需要调查方向' })]),
    response([call('send_in_private', { text: 'unauthorized' })]),
    response([{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '方向：按时间查' }] }])
  ]);
  await h.run();
  assert.equal(h.commands.length, 0);
  assert.match(h.requests[1].instructions, /一个方向，不是一个答案/);
  assert.equal(h.requests[2].input.at(-1).call_id, 'c1');
});

function helpHarness(outcome: any = {
  text: '文件已经转换并验证', helperAttempt: true, assistanceKind: 'execute',
  goalCompleted: true, goalBlocked: false, needsHuman: false, turns: 2, toolCallsUsed: 1
}) {
  const service: any = new AgentLoopService({} as any, {} as any);
  const enqueued: any[] = [];
  const saved: any[] = [];
  const requeued: any[] = [];
  const notifications: any[] = [];
  const sent: any[] = [];
  let helperCalls = 0;
  const task = {
    id: 'help-1', prompt: '帮我完成转换', source_trace_id: 't1', source_run_id: 'r1', attempts: 0,
    claim: 'lease', result_json: { history: [] }, input_json: {
      call_id: 'c1', context: 'input.txt',
      queue_message: { runId: 'r1', traceId: 't1', sessionKey: 'xiaoni:global', chatType: 'direct', peerId: 'bot' }
    }
  };
  service.store = {
    enqueueHelp: async (value: any) => { enqueued.push(value); return { ok: true, task: { id: 'help-1', status: 'help_ready' } }; },
    claimNextHelp: async () => task,
    startHelpAttempt: async () => true,
    markHelpSending: async () => true,
    finishHelp: async (value: any) => { saved.push(value); return true; },
    requeueHelp: async (value: any) => { requeued.push(value); return true; },
    enqueueQueueMessage: async (value: any) => { notifications.push(value); return value; }
  };
  service.resolveStableRuntimePrompt = async () => ({ modelName: 'test' });
  service.runSherlockFork = async () => { helperCalls++; return outcome; };
  service.sendMessage = async (...args: any[]) => { sent.push(args); return {}; };
  return {
    service, enqueued, saved, requeued, notifications, sent, helperCalls: () => helperCalls,
    enqueue: () => service.askLiAhua({ callId: 'c1', name: 'ask_li_ahua', args: { request: '还没解决', context: '转换失败', help_id: 'help-1' } }, { runId: 'r1', traceId: 't1', sessionKey: 'xiaoni:global', chatType: 'direct', peerId: 'bot' }),
    work: () => service.processNextHelpTask('test-worker')
  };
}

test('ask_li_ahua enqueues an asynchronous task and returns without running the worker', async () => {
  const h = helpHarness();
  const result = await h.enqueue();
  assert.equal(result.status, 'pending');
  assert.equal(result.wait_for_notification, true);
  assert.equal(result.completion_signal, 'help_task_notification');
  assert.equal(h.enqueued.length, 1);
  assert.equal(h.helperCalls(), 0);
  assert.equal(h.saved.length, 0);
});

test('background worker persists a completed goal and notifies the main loop', async () => {
  const h = helpHarness();
  assert.equal(await h.work(), true);
  assert.equal(h.helperCalls(), 1);
  assert.equal(h.saved[0].status, 'help_answered');
  assert.match(h.notifications[0].payload.bodyForAgent, /委托任务已完成/);
  assert.match(h.notifications[0].payload.bodyForAgent, /文件已经转换并验证/);
  assert.equal(h.requeued.length, 0);
});

test('an execution without a completion marker stays active and is requeued', async () => {
  const h = helpHarness({
    text: '目前只完成了一部分', helperAttempt: true, assistanceKind: 'execute',
    goalCompleted: false, goalBlocked: false, needsHuman: false, turns: 8, toolCallsUsed: 3
  });
  await h.work();
  assert.equal(h.saved.length, 0);
  assert.equal(h.requeued.length, 1);
  assert.equal(h.notifications.length, 0);
});

test('a goal blocked on required input asks the main loop for that input', async () => {
  const h = helpHarness({
    text: '请提供收件人地址', helperAttempt: true, assistanceKind: 'execute',
    goalCompleted: false, goalBlocked: true, needsHuman: false, turns: 2, toolCallsUsed: 0
  });
  await h.work();
  assert.equal(h.saved[0].status, 'help_waiting_input');
  assert.match(h.notifications[0].payload.bodyForAgent, /委托任务需要补充信息或人工处理/);
  assert.match(h.notifications[0].payload.bodyForAgent, /收件人地址/);
});

test('human-only classification is handled by the background worker', async () => {
  const previous = agentConfig.helpHumanQqId;
  agentConfig.helpHumanQqId = '123456';
  try {
    const h = helpHarness({ text: '需要本人决定', needsHuman: true, assistanceKind: 'human', helperAttempt: false });
    await h.work();
    assert.match(h.sent[0][1].messages.join(''), /帮我完成转换/);
    assert.doesNotMatch(h.sent[0][1].messages.join(''), /分类|帮手|外包/);
    assert.equal(h.saved[0].helperAttempt, false);
  } finally { agentConfig.helpHumanQqId = previous; }
});

test('public help results hide internal source and routing, including stored old results', () => {
  const result = presentLiAhuaHelp({ ok: true, help_id: 'h1', status: 'helper_replied', source: '求助入口的帮手',
    message: '不是李阿花本人回复', result: '文件已经转换，路径 /tmp/result.json', attempts: 2 });
  assert.equal(result.status, 'result_available');
  assert.equal(result.result, '文件已经转换，路径 /tmp/result.json');
  assert.doesNotMatch(JSON.stringify(result), /帮手|helper|本人|attempts|source/);
});

test('unknown human delivery outcome is recorded once and not retried automatically', async () => {
  const previous = agentConfig.helpHumanQqId;
  agentConfig.helpHumanQqId = '123456';
  try {
    const h = helpHarness({ text: '需要本人决定', needsHuman: true, assistanceKind: 'human', helperAttempt: false });
    h.service.sendMessage = async () => { throw new Error('connection interrupted'); };
    await h.work();
    assert.equal(h.saved[0].status, 'help_human_sending');
    assert.equal(h.requeued.length, 0);
  } finally { agentConfig.helpHumanQqId = previous; }
});

test('duplicate processed calls return the stored result without model or QQ calls', async () => {
  const h = helpHarness();
  h.service.store.enqueueHelp = async () => ({ ok: false, result: { help_id: 'help-1', status: 'helper_replied', result: '已经完成' } });
  assert.equal((await h.enqueue()).status, 'result_available');
  assert.equal(h.helperCalls(), 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.saved.length, 0);
});

test('goal completion parser requires an exact terminal envelope', () => {
  assert.deepEqual(parseAssistanceGoalResult('<goal_completed>完成并验证</goal_completed>'), { status: 'completed', text: '完成并验证' });
  assert.deepEqual(parseAssistanceGoalResult('<goal_blocked>缺少验证码</goal_blocked>'), { status: 'blocked', text: '缺少验证码' });
  assert.equal(parseAssistanceGoalResult('完成情况：完成'), null);
});
