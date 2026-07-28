'use strict';

// T6 专题物化水位列 `agent_session_context_windows.topic_materialization_state`。
//
// 这一列和它旁边两个快照列(diary_index_snapshot / people_index_snapshot)**生命周期完全不同**,
// 这份用例钉的就是那个区别:
//   · 快照跟着 commitSessionContextSummaryAndReadCutoff 的原子提交一起写(它们进请求前缀);
//   · 水位在提交**之后**、文件真落盘成功之后,由 upsertSessionTopicMaterializationState 单独推进。
// 所以 commit 那条 SQL 里这一列只许出现在 RETURNING,**不许**出现在 INSERT 列表 / DO UPDATE SET
// —— 出现了就等于「提交时就宣布写过了」,落盘失败时水位却已前移 = 那一批进展永久丢掉。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentRuntimePersistence } = require('../agent-runtime');

const COLUMN = 'topic_materialization_state';

test('schema adds the topic-materialization watermark column with a repeat-safe guard', async () => {
  const statements = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      execute: async (sql) => {
        statements.push(sql);
        return 1;
      },
      query: async () => [],
      withTransaction: async () => {
        throw new Error('schema should not open transaction');
      },
      close: async () => undefined
    }
  });

  await persistence.ensureAgentRuntimeSchema({ profile: 'agent' });

  const alters = statements.filter((sql) => sql.includes(`ADD COLUMN IF NOT EXISTS ${COLUMN}`));
  assert.equal(alters.length, 1, '只许有一条加列 DDL');
  assert.match(alters[0], /ALTER TABLE agent_session_context_windows ADD COLUMN IF NOT EXISTS topic_materialization_state JSONB/);
  // `IF NOT EXISTS` 就是守卫 —— 重复执行安全,和同表另外 8 条 ALTER 同一种写法。
  // 这里**不能**用 CREATE INDEX CONCURRENTLY 那一套:那是给索引的,ADD COLUMN 不需要也不能那样写。
  assert.equal(alters[0].includes('CONCURRENTLY'), false);

  // 新列必须排在同表已有 ALTER 的**后面**(追加在最后)。插在中间会让按 params 下标断言的
  // 现有用例挂 —— 那是「改坏即红」的正确行为,不许靠改断言来绕。
  const peopleAt = statements.findIndex((sql) => sql.includes('ADD COLUMN IF NOT EXISTS people_index_snapshot'));
  const topicAt = statements.findIndex((sql) => sql.includes(`ADD COLUMN IF NOT EXISTS ${COLUMN}`));
  assert.notEqual(peopleAt, -1);
  assert.ok(topicAt > peopleAt, '新列追加在最后一条同表 ALTER 之后');

  // 跑第二遍(模拟每次启动都 ensure):完全相同的语句集合,没有任何非幂等语句。
  const first = statements.slice();
  statements.length = 0;
  await persistence.ensureAgentRuntimeSchema({ profile: 'agent' });
  assert.deepEqual(statements, first, '重复执行必须逐条相同(全部带守卫)');
});

test('getSessionReadCutoffState surfaces the watermark and tolerates a missing/broken value', async () => {
  const rows = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      execute: async () => 1,
      query: async (sql) => {
        if (sql.includes('FROM agent_session_context_windows')) {
          assert.match(sql, /topic_materialization_state/, 'SELECT 列表必须带上新列');
          return rows;
        }
        return [];
      },
      withTransaction: async () => {
        throw new Error('read should not open transaction');
      },
      close: async () => undefined
    }
  });

  // ① jsonb 已被驱动解析成对象
  rows.length = 0;
  rows.push({
    session_key: 'xiaoni:test-global',
    read_cutoff_after_stack_index: 171,
    last_context_window_tokens: null,
    last_target_budget_tokens: null,
    last_hard_budget_tokens: null,
    context_summary: null,
    diary_index_snapshot: null,
    people_index_snapshot: null,
    topic_materialization_state: { v: 1, watermarks: { '2026-07-27.md': 4821 }, candidates: {}, materialized: ['周蕊'] },
    pending_proactive_share: null,
    pending_proactive_share_age: 0,
    consecutive_over_compression_turns: 0,
    updated_at: null
  });
  let state = await persistence.getSessionReadCutoffState({ sessionKey: 'xiaoni:test-global' });
  assert.deepEqual(state.topicMaterializationState.watermarks, { '2026-07-27.md': 4821 });
  assert.deepEqual(state.topicMaterializationState.materialized, ['周蕊']);

  // ② 驱动给的是字符串(text 形态)
  rows[0].topic_materialization_state = '{"v":1,"watermarks":{"a.md":7},"candidates":{},"materialized":[]}';
  state = await persistence.getSessionReadCutoffState({ sessionKey: 'xiaoni:test-global' });
  assert.deepEqual(state.topicMaterializationState.watermarks, { 'a.md': 7 });

  // ③ 列还没建(老库) / 值是坏 JSON → null,调用方按「从零开始」处理,绝不抛。
  delete rows[0].topic_materialization_state;
  state = await persistence.getSessionReadCutoffState({ sessionKey: 'xiaoni:test-global' });
  assert.equal(state.topicMaterializationState, null);
  rows[0].topic_materialization_state = 'not json at all';
  state = await persistence.getSessionReadCutoffState({ sessionKey: 'xiaoni:test-global' });
  assert.equal(state.topicMaterializationState, null);

  // ④ 旁边两个快照列不受影响
  assert.equal(state.diaryIndexSnapshot, null);
  assert.equal(state.peopleIndexSnapshot, null);
});

test('upsertSessionTopicMaterializationState touches ONLY the watermark column', async () => {
  const executes = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      execute: async (sql, params = []) => {
        executes.push({ sql, params });
        return 1;
      },
      query: async () => [],
      withTransaction: async () => {
        throw new Error('watermark write should not need a transaction');
      },
      close: async () => undefined
    }
  });

  await persistence.upsertSessionTopicMaterializationState({
    sessionKey: 'xiaoni:test-global',
    state: { v: 1, watermarks: { 'a.md': 3 }, candidates: {}, materialized: [] }
  });
  assert.equal(executes.length, 1);
  const { sql, params } = executes[0];
  assert.match(sql, /INSERT INTO agent_session_context_windows \(session_key, topic_materialization_state, updated_at\)/);
  assert.match(sql, /topic_materialization_state = EXCLUDED\.topic_materialization_state/);
  // 绝不许顺手覆盖压缩提交那一批列 —— 它们是进请求前缀的快照,被这条更频繁的写覆盖 = 缓存击穿。
  for (const forbidden of ['context_summary', 'diary_index_snapshot', 'people_index_snapshot', 'read_cutoff_after_stack_index']) {
    assert.equal(sql.includes(forbidden), false, `水位写入口不许碰 ${forbidden}`);
  }
  assert.equal(params[0], 'xiaoni:test-global');
  assert.equal(params[1], '{"v":1,"watermarks":{"a.md":3},"candidates":{},"materialized":[]}');

  // 非对象一律当 null(清空 = 回到从零开始),绝不写进半个形状。
  for (const bad of [null, undefined, 'x', 7, ['a']]) {
    executes.length = 0;
    await persistence.upsertSessionTopicMaterializationState({ sessionKey: 's', state: bad });
    assert.equal(executes[0].params[1], null, `state=${JSON.stringify(bad)} 应当写 null`);
  }
});

test('commitSessionContextSummaryAndReadCutoff never writes the watermark column (only returns it)', async () => {
  const queries = [];
  const existing = {
    session_key: 'xiaoni:test-global',
    read_cutoff_after_stack_index: 100,
    last_context_window_tokens: null,
    last_target_budget_tokens: null,
    last_hard_budget_tokens: null,
    context_summary: '旧近况',
    diary_index_snapshot: '旧日记快照',
    people_index_snapshot: '旧人物快照',
    topic_materialization_state: { v: 1, watermarks: { 'a.md': 3 }, candidates: {}, materialized: ['decay'] },
    pending_proactive_share: null,
    pending_proactive_share_age: 0,
    updated_at: null
  };
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      execute: async () => {
        throw new Error('atomic commit should not use execute');
      },
      query: async () => [],
      withTransaction: async (fn) => fn({
        query: async (sql, params = []) => {
          queries.push({ sql, params });
          if (sql.includes('pg_advisory_xact_lock')) {
            return [];
          }
          if (sql.includes('FOR UPDATE')) {
            return [existing];
          }
          if (sql.includes('INSERT INTO agent_session_context_windows')) {
            // 模拟 ON CONFLICT DO UPDATE:没被 SET 到的列保持原值。
            return [{ ...existing, context_summary: params[1], read_cutoff_after_stack_index: params[4] }];
          }
          return [];
        }
      }),
      close: async () => undefined
    }
  });

  const result = await persistence.commitSessionContextSummaryAndReadCutoff({
    sessionKey: 'xiaoni:test-global',
    contextSummary: '新近况',
    readCutoffAfterStackIndex: 171,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  });
  assert.equal(result.committed, true);

  const insert = queries.find((entry) => entry.sql.includes('INSERT INTO agent_session_context_windows'));
  assert.ok(insert);
  // 这一列只许在 RETURNING 里出现一次;INSERT 列表和 DO UPDATE SET 一次都不许有。
  const insertColumnList = insert.sql.slice(insert.sql.indexOf('('), insert.sql.indexOf('VALUES'));
  const updateSet = insert.sql.slice(insert.sql.indexOf('DO UPDATE SET'), insert.sql.indexOf('RETURNING'));
  assert.equal(insertColumnList.includes(COLUMN), false, 'INSERT 列表不许有水位列');
  assert.equal(updateSet.includes(COLUMN), false, 'DO UPDATE SET 不许有水位列');
  assert.match(insert.sql.slice(insert.sql.indexOf('RETURNING')), /topic_materialization_state/);

  // params 下标不许被顺移(现有冻结用例按下标断言 diary/people 快照和 cutoff)。
  assert.equal(insert.params[0], 'xiaoni:test-global');
  assert.equal(insert.params[1], '新近况');
  assert.equal(insert.params[2], '旧日记快照', '未传 → 保留库里旧快照');
  assert.equal(insert.params[3], '旧人物快照');
  assert.equal(insert.params[4], 171);
  assert.equal(insert.params.length, 8, '参数个数不许变(加列绝不许挤进 params)');

  // 提交返回的状态里水位原样带回来,而不是被清成 null。
  assert.deepEqual(result.state.topicMaterializationState.materialized, ['decay']);
});
