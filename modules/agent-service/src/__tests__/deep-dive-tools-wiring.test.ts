import test from 'node:test';
import assert from 'node:assert';

import { AgentLoopService } from '../services/agent-loop-service';

// 三个深挖工具的**胶水层**:executeTool 的 case → store 方法 → 返回给她的形状。
//
// 这一层此前是个缺口:planDeepDiveUpdate(纯决策)有 19 条单测,persistence(存储不变量)有
// 13 条真库用例,但**中间这段谁都没测**。而第八轮 Spec 轴查出的 `get_deep_dive` 调错 store
// 方法(用 getActiveDeepDive 而不是 getCurrentDeepDive,导致 paused 的目标永远够不着、
// resume 结构性不可达)恰恰就是一个胶水 bug —— 靠人对着 spec 读出来的,不是测出来的。
//
// 用记账 store 桩,断言「调了哪个方法、拿什么参数调的」,而不是重跑一遍存储语义
// (那是真库用例的活)。

type Call = { method: string; args: unknown[] };

function makeService(storeOverrides: Record<string, any> = {}) {
  const calls: Call[] = [];
  const record = (method: string, result: unknown) => (...args: unknown[]) => {
    calls.push({ method, args });
    return Promise.resolve(typeof result === 'function' ? (result as any)(...args) : result);
  };
  const store: any = {
    getCurrentDeepDive: record('getCurrentDeepDive', { id: 'g1', revision: 3, question: '读完前六章', phase: 'paused' }),
    getActiveDeepDive: record('getActiveDeepDive', { id: 'g1', revision: 3, question: '读完前六章', phase: 'active' }),
    getDeepDiveById: record('getDeepDiveById', { id: 'g1', revision: 3, question: '读完前六章', phase: 'active' }),
    createDeepDive: record('createDeepDive', { id: 'g2', revision: 1, question: '新的', phase: 'active' }),
    updateDeepDive: record('updateDeepDive', { ok: true, dive: { id: 'g1', revision: 4, question: '读完前六章', phase: 'paused' } }),
    ...storeOverrides
  };
  const service = new AgentLoopService({} as any, {
    resolveForQueueMessage: async () => ({}) as any
  } as any);
  (service as any).store = store;
  return { service, calls };
}

const payload = { runId: 'run-1', traceId: 'trace-1' } as any;
const run = (service: any, name: string, args: Record<string, unknown>) =>
  service.executeTool({ callId: 'c1', name, args, rawArguments: JSON.stringify(args) }, payload);

test('get_deep_dive 走 getCurrentDeepDive —— 不是 getActiveDeepDive(否则 paused 的够不着)', async () => {
  const { service, calls } = makeService();
  const result: any = await run(service, 'get_deep_dive', {});

  const used = calls.map((c) => c.method);
  assert.ok(used.includes('getCurrentDeepDive'), `get_deep_dive 必须走 getCurrentDeepDive,实际调了 ${used.join(', ')}`);
  assert.ok(!used.includes('getActiveDeepDive'), 'get_deep_dive 不许走 getActiveDeepDive —— paused 的目标会永远够不着');
  // 返回形状:她要拿 deep_dive_id + revision 才能 update_deep_dive
  assert.equal(result.deep_dive.id, 'g1');
  assert.equal(result.deep_dive.revision, 3);
  assert.equal(result.deep_dive.phase, 'paused', 'paused 的那个问题必须原样回给她');
});

test('get_deep_dive 没有在挖的问题时回 { deep_dive: null },不是抛错也不是空对象', async () => {
  const { service } = makeService({ getCurrentDeepDive: async () => null });
  const result: any = await run(service, 'get_deep_dive', {});
  assert.deepEqual(result, { deep_dive: null });
});

test('create_deep_dive 把 question 原样透传,max_requests 截断成整数', async () => {
  const { service, calls } = makeService();
  await run(service, 'create_deep_dive', { question: '  把 gorton 写到第 100 章  ', max_requests: 30.7 });
  const created = calls.find((c) => c.method === 'createDeepDive');
  assert.ok(created);
  const arg = created!.args[0] as any;
  assert.equal(arg.question, '把 gorton 写到第 100 章', '两端空白该去掉,中间一个字不动');
  assert.equal(arg.maxRequests, 30);
});

test('create_deep_dive 撞上「已经有一件在做」→ 回 already_active 并把当前那件还给她,不是抛内部错', async () => {
  const { service } = makeService({
    createDeepDive: async () => { throw new Error('Unique constraint failed on the fields: (`identity_key`)'); }
  });
  const result: any = await run(service, 'create_deep_dive', { question: '第二件' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already_active');
  assert.ok(result.deep_dive, '必须把当前那个还给她,否则她拿不到 deep_dive_id 没法收口');
});

test('create_deep_dive 空 question 当场拒绝,不落库', async () => {
  const { service, calls } = makeService();
  const result: any = await run(service, 'create_deep_dive', { question: '   ' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'question_required');
  assert.ok(!calls.some((c) => c.method === 'createDeepDive'), '拒绝了就不该调存储');
});

test('update_deep_dive 把**她给的** revision 原样透传做 compare-and-set,不拿库里的顶替', async () => {
  // 桩里 getDeepDiveById 回的 revision 故意与她传的**不同**(7 vs 3)。
  // 相等的话,引擎拿 current.revision 顶替也看不出来 —— 这条用例就成了瞎的
  // (第一版正是如此:改坏了照样绿,反向验才发现)。
  const { service, calls } = makeService({
    getDeepDiveById: async () => ({ id: 'g1', revision: 7, question: '读完前六章', phase: 'active' })
  });
  await run(service, 'update_deep_dive', { deep_dive_id: 'g1', revision: 3, action: 'pause' });
  const updated = calls.find((c) => c.method === 'updateDeepDive');
  assert.ok(updated);
  const arg = updated!.args[0] as any;
  assert.equal(arg.diveId, 'g1');
  assert.equal(
    arg.revision,
    3,
    'CAS 的意义就是拿**她读到的那个** revision 去比;引擎替她重读一下,并发覆盖就挡不住了'
  );
  assert.notEqual(arg.revision, 7, '不许用库里的当前值顶替');
  assert.equal(arg.phase, 'paused');
});

test('update_deep_dive 缺 deep_dive_id / revision 当场拒绝,不落库', async () => {
  for (const args of [{ action: 'pause' }, { deep_dive_id: 'g1', action: 'pause' }, { revision: 3, action: 'pause' }]) {
    const { service, calls } = makeService();
    const result: any = await run(service, 'update_deep_dive', args);
    assert.equal(result.ok, false, `${JSON.stringify(args)} 应被拒绝`);
    assert.equal(result.reason, 'invalid_ref');
    assert.ok(!calls.some((c) => c.method === 'updateDeepDive'));
  }
});

test('update_deep_dive 撞上 revision 不匹配 → 回当前值让她重读,不是静默成功', async () => {
  const { service } = makeService({
    updateDeepDive: async () => ({ ok: false, reason: 'revision_mismatch', dive: { id: 'g1', revision: 9, phase: 'active' } })
  });
  const result: any = await run(service, 'update_deep_dive', { deep_dive_id: 'g1', revision: 3, action: 'conclude' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'revision_mismatch');
  assert.equal(result.deep_dive.revision, 9, '必须把当前值给她,否则她无从重试');
});

test('need_outsider 缺 searched_paths → 拒绝且不落库(引擎不替她整理)', async () => {
  const { service, calls } = makeService();
  const result: any = await run(service, 'update_deep_dive', {
    deep_dive_id: 'g1', revision: 3, action: 'need_outsider'
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'searched_paths_required');
  assert.equal(calls.filter((c) => c.method === 'updateDeepDive').length, 0, '被拒的求助不许落库');
});
