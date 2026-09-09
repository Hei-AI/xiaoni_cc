import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnadmittedAssistantText } from '../services/xiaoni-recall-hook';

// 没进过她上下文的 assistant 文本(xiaoni_os 改写腿 evicted / 老的被 text 门剥掉的行)不是她的落地:
// 行动流投影 metadata.textAdmit === false 的 llm_stack_item 不嵌入、不当 query。

test('isUnadmittedAssistantText: 只拦 llm_stack_item 且 textAdmit === false 的行', () => {
  assert.equal(isUnadmittedAssistantText({ source: 'llm_stack_item', metadata: { textAdmit: false } }), true, 'evicted 的 xiaoni_os');
  assert.equal(isUnadmittedAssistantText({ source: 'llm_stack_item', metadata: { textAdmit: true } }), false, '准入的 xiaoni_os');
  assert.equal(isUnadmittedAssistantText({ source: 'llm_stack_item', metadata: { textAdmit: null } }), false, '工具调用 / 工具结果');
  assert.equal(isUnadmittedAssistantText({ source: 'llm_stack_item', metadata: {} }), false, '老投影没这个字段 → 不拦');
  assert.equal(isUnadmittedAssistantText({ source: 'life_event', metadata: { textAdmit: false } }), false, '别的来源不看这个字段');
  assert.equal(isUnadmittedAssistantText({} as Record<string, unknown>), false);
});
