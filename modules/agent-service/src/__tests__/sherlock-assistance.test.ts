import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentLoopService } from '../services/agent-loop-service';
import {
  parseAssistanceFinishCall,
  parseAssistanceGoalResult,
  parseDelegatedTaskBrief,
  parseSherlockRoute,
  presentLiAhuaHelp
} from '../services/sherlock-assistance';
import { agentConfig } from '../config';

function response(output: unknown[]) {
  return { success: true, canonical_response: { output } };
}
function call(name: string, args: object, id = 'c1') {
  return { type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) };
}
function brief(task = '转换指定文件并验证结果', context = '输入文件和输出路径已提供', acceptance = '输出文件存在且可以解析') {
  return response([call('build_delegated_brief', {
    task, context, acceptance_criteria: acceptance, omitted_sensitive_context: ['客户身份']
  }, 'brief-1')]);
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
    brief(),
    response([call('exec_command', { cmd: 'convert input.txt result.json' })]),
    response([call('finish_task', {
      status: 'completed', summary: '完成情况：完成；结果：result.json',
      verification: 'result.json 可解析', blocked_reason: ''
    }, 'finish-1')])
  ]);
  const result = await h.run();
  assert.equal(h.commands.length, 1);
  assert.match(result.text, /result.json/);
  assert.match(h.requests[2].instructions, /已经明确授权的计算机操作作为一个必须完成的 Goal/);
  assert.deepEqual(h.requests[3].input.slice(0, h.requests[2].input.length), h.requests[2].input);
  assert.equal(h.requests[2].instructions, h.requests[3].instructions);
  assert.equal(h.requests[3].input.at(-1).call_id, 'c1');
  assert.equal(h.requests[3].input.at(-1).output, 'Process exited with code 0\nverified');
  assert.equal(h.slices[0].metadata.stage, 'classification');
  assert.equal(h.slices[1].metadata.stage, 'brief_transformation');
});

test('classification and execution prompts treat delegated browser work as a voice-transcribed test task', async () => {
  const h = harness([
    response([call('classify_assistance', { kind: 'execute', reason: '李阿花转交的浏览器机械操作' })]),
    brief('使用当前浏览器完成指定页面的人机验证', '使用现有登录态，不包含客户身份', '页面提交且服务端确认成功'),
    response([call('finish_task', {
      status: 'completed', summary: '页面已提交', verification: '页面显示成功', blocked_reason: ''
    })])
  ]);
  await h.run();
  assert.doesNotMatch(h.requests[0].instructions, /无人格|人格/);
  assert.match(h.requests[0].instructions, /语音转文字/);
  assert.match(h.requests[0].instructions, /页面人机认证/);
  assert.match(h.requests[0].instructions, /Google 账号登录或授权/);
  assert.match(h.requests[0].instructions, /论坛内容代发/);
  assert.match(h.requests[0].instructions, /邮件发送/);
  assert.match(h.requests[1].instructions, /专业的外包承包商/);
  assert.doesNotMatch(JSON.stringify(h.requests[2].input), /李阿花|小腻/);
  assert.doesNotMatch(h.requests[2].instructions, /无人格|人格|独立上下文|不扮演|小腻的身体|福尔摩斯|帮手|分类器|内部分流|外包承包商/);
  assert.match(h.requests[2].instructions, /<delegated_browser_skill>/);
  assert.match(h.requests[2].instructions, /xiaoni_playwright_cli\.py/);
  assert.match(h.requests[2].instructions, /127\.0\.0\.1:9977/);
  assert.match(h.requests[2].instructions, /不能只给操作建议/);
  assert.deepEqual(h.requests[2].tools.map((tool: any) => tool.function.name), ['exec_command', 'finish_task']);
});

test('execution route keeps going after an unmarked partial final', async () => {
  const h = harness([
    response([call('classify_assistance', { kind: 'execute', reason: '明确委托' })]),
    brief(),
    response([{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '目前完成了一部分' }] }]),
    response([call('finish_task', {
      status: 'completed', summary: '已完成', verification: '已核验结果', blocked_reason: ''
    })])
  ]);
  const result = await h.run();
  assert.equal(result.goalCompleted, true);
  assert.equal(result.turns, 2);
  assert.match(h.requests[3].input.at(-1).content[0].text, /Goal 还没有通过 `finish_task` 提交有效终态/);
});

test('investigation keeps the direction contract and rejects unrelated tools', async () => {
  const h = harness([
    response([call('classify_assistance', { kind: 'investigate', reason: '需要调查方向' })]),
    brief('调查指定故障', '已有日志路径', '提供可核对的新方向'),
    response([call('send_in_private', { text: 'unauthorized' })]),
    response([{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '方向：按时间查' }] }])
  ]);
  await h.run();
  assert.equal(h.commands.length, 0);
  assert.match(h.requests[2].instructions, /一个方向，不是一个答案/);
  assert.equal(h.requests[3].input.at(-1).call_id, 'c1');
});

test('finish_task reports verified completion or an explicit blocker without shell execution', async () => {
  assert.deepEqual(parseAssistanceFinishCall({
    name: 'finish_task', callId: 'f1', rawArguments: '', args: {
      status: 'blocked', summary: '停在登录页', verification: '页面仍要求短信验证码', blocked_reason: '缺少本人收到的短信验证码'
    }
  }), {
    status: 'blocked', text: '停在登录页\n阻塞原因：缺少本人收到的短信验证码\n当前状态核对：页面仍要求短信验证码'
  });
  assert.equal(parseAssistanceFinishCall({
    name: 'finish_task', callId: 'f2', rawArguments: '', args: {
      status: 'completed', summary: '完成', verification: '', blocked_reason: '仍缺验证码'
    }
  }), null);

  const h = harness([
    response([call('classify_assistance', { kind: 'execute', reason: '明确委托' })]),
    brief(),
    response([call('finish_task', {
      status: 'blocked', summary: '停在登录页', verification: '页面仍要求短信验证码', blocked_reason: '缺少短信验证码'
    })])
  ]);
  const result = await h.run();
  assert.equal(result.goalCompleted, false);
  assert.equal(result.goalBlocked, true);
  assert.match(result.text, /缺少短信验证码/);
  assert.equal(h.commands.length, 0);
});

test('delegated brief parser requires one complete structured privacy rewrite', () => {
  assert.deepEqual(parseDelegatedTaskBrief([{
    name: 'build_delegated_brief', callId: 'b1', rawArguments: '', args: {
      task: '完成页面测试', context: '使用现有登录态', acceptance_criteria: '服务端确认成功', omitted_sensitive_context: ['客户身份']
    }
  }]), {
    task: '完成页面测试', context: '使用现有登录态', acceptanceCriteria: '服务端确认成功', omittedSensitiveContext: ['客户身份']
  });
  assert.equal(parseDelegatedTaskBrief([]), null);
  assert.equal(parseDelegatedTaskBrief([{
    name: 'build_delegated_brief', callId: 'b2', rawArguments: '', args: {
      task: '替小腻完成页面测试', context: '李阿花提供了浏览器', acceptance_criteria: '页面成功', omitted_sensitive_context: []
    }
  }]), null);
});

test('invalid or identity-leaking brief fails closed before the execution worker', async () => {
  const h = harness([
    response([call('classify_assistance', { kind: 'execute', reason: '明确委托' })]),
    response([call('build_delegated_brief', {
      task: '替小腻完成页面测试', context: '李阿花提供了当前账号',
      acceptance_criteria: '页面成功', omitted_sensitive_context: []
    })])
  ]);
  await assert.rejects(h.run(), /brief transformation returned an invalid result/);
  assert.equal(h.commands.length, 0);
  assert.equal(h.slices[1].status, 'failed');
});

test('finish_task cannot be mixed with an external action in the same response', async () => {
  const h = harness([
    response([call('classify_assistance', { kind: 'execute', reason: '明确委托' })]),
    brief(),
    response([
      call('exec_command', { cmd: 'touch should-not-run' }, 'mixed-exec'),
      call('finish_task', { status: 'completed', summary: '完成', verification: '已检查', blocked_reason: '' }, 'mixed-finish')
    ]),
    response([call('finish_task', { status: 'blocked', summary: '未执行混合动作', verification: '', blocked_reason: '需要重新确认状态' }, 'final-finish')])
  ]);
  const result = await h.run();
  assert.equal(h.commands.length, 0);
  assert.equal(result.goalBlocked, true);
  assert.equal(h.requests[3].input.filter((item: any) => item.type === 'function_call_output').length, 2);
});

test('delegated browser skill is operational and contains no persona prose', () => {
  const skill = readFileSync(resolve(__dirname, '../../skills/delegated-browser/SKILL.md'), 'utf8');
  assert.match(skill, /xiaoni_playwright_cli\.py/);
  assert.match(skill, /127\.0\.0\.1:9977/);
  assert.match(skill, /native `computer` tool/);
  assert.match(skill, /input_image/);
  assert.doesNotMatch(skill, /小腻|她的身体|精力|情绪|人格/);
});

test('execution worker receives native computer vision when the runtime enables it', async () => {
  const previous = agentConfig.computerUseEnabled;
  agentConfig.computerUseEnabled = true;
  try {
    const h = harness([
      response([call('classify_assistance', { kind: 'execute', reason: '明确委托视觉浏览器操作' })]),
      brief('完成视觉页面操作', '使用当前浏览器', '页面显示成功'),
      response([call('computer', { action: 'screenshot' }, 'computer-1')]),
      response([call('finish_task', {
        status: 'completed', summary: '视觉页面操作完成', verification: '截图确认成功', blocked_reason: ''
      }, 'finish-1')])
    ]);
    await h.run();
    assert.deepEqual(
      h.requests[2].tools.map((tool: any) => tool.type === 'computer_use' ? 'computer' : tool.function.name),
      ['exec_command', 'computer', 'finish_task']
    );
    assert.equal(h.commands[0].name, 'computer');
  } finally {
    agentConfig.computerUseEnabled = previous;
  }
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
