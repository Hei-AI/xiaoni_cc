import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import {
  buildCanonicalAgentTurnRequest,
  buildSubconsciousAgentForkRequest,
  extractXiaoniOsFillBlock,
  renderXiaoniOsFillReminder
} from '../services/agent-loop-service';

// 潜意识填充 fork(xiaoni_os 判空转 → 克隆主请求 + 尾部她的原话 + xiaoni_os_fill_reminder.md,一次调用,不投 notify):
// - 与自驱动 fork 走同一个 buildSubconsciousAgentForkRequest,前缀逐字节 = 主请求(fork-cache-alignment 那套不变量);
// - 尾部只多 cache_volatile 的 narration + developer reminder,tools / tool_choice 不动;
// - 块抽取只认最后一条 assistant 文本里的 <xiaoni_os>…</xiaoni_os>。

const mainInput = [
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '群里有人问你今天玩什么' }] },
  { type: 'function_call', call_id: 'call-1', name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat /tmp/notes.md' }) },
  { type: 'function_call_output', call_id: 'call-1', output: '昨天聊到桌游' },
  { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '[当前回合] 接着做。' }], cache_volatile: true }
] as any[];
const narration = [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Day 88。到此。等。' }] }] as any[];

test('fill fork: cloned prefix byte-identical to the main request; tail = original narration (cache_volatile) + fill reminder', () => {
  const base = buildCanonicalAgentTurnRequest(agentConfig.modelName, mainInput, 'group');
  const fork = buildSubconsciousAgentForkRequest(base, 1, narration, renderXiaoniOsFillReminder());
  const prefix = fork.input.slice(0, base.input.length);
  assert.equal(JSON.stringify(prefix), JSON.stringify(base.input), '前缀逐字节相同');
  assert.deepEqual(fork.tools, base.tools);
  assert.deepEqual(fork.tool_choice, base.tool_choice);
  const tail = fork.input.slice(base.input.length) as any[];
  assert.equal(tail.length, 2);
  assert.equal(tail[0].role, 'assistant');
  assert.equal(tail[0].cache_volatile, true, '她的原话在尾部且不作 durable 锚点');
  assert.match(JSON.stringify(tail[1]), /xiaoni_os/u);
  assert.match(renderXiaoniOsFillReminder(), /(?:<|&lt;)xiaoni_os(?:>|&gt;)/u, 'system_reminder 壳会把尖括号转义');
  assert.equal(renderXiaoniOsFillReminder(), renderXiaoniOsFillReminder(), '固定文本,无时间戳');
});

test('extractXiaoniOsFillBlock: 最后一条 assistant 文本里的块;没有块 → null', () => {
  const items = [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '先数一下:plan 里三件做了一件。\n<xiaoni_os>\nDay 88。plan 里那件 decay ch51 今天写。\n</xiaoni_os>' }] }
  ];
  assert.match(extractXiaoniOsFillBlock(items) || '', /decay ch51/u);
  assert.equal(extractXiaoniOsFillBlock([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '她该去做点什么' }] }]), null);
  assert.equal(extractXiaoniOsFillBlock([{ type: 'function_call', call_id: 'c', name: 'exec_command', arguments: '{}' }]), null);
});
