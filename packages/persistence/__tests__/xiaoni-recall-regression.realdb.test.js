'use strict';

// 召回回归集:拿 50 个**真实历史落地时刻**重跑一遍检索层,和冻结基线比。
//
//   node --test __tests__/xiaoni-recall-regression.realdb.test.js
//   RECALL_REGRESSION_UPDATE=1 node --test ...   # 刻意改了行为之后重录基线
//
// 为什么需要它:改权重/阈值/因子之后,「有没有变好」只有人能判断,但**「变了多少、变了哪些」
// 必须是机器算出来的**。这个项目已经吃过一次「样本不够就下结论」的亏 —— 2026-08-07 只看
// 一天就判定投递节奏没问题,08-13 才发现 24 条全投在她收尾睡觉的时间窗。
//
// 它也是「检索层保持确定性算术」这条设计的**兑现物**(docs/adr/0006):只要排序是算术的,
// 历史输入就能重放;一旦把判断整个交给模型,这个文件就失去意义。
//
// **它量的是排序算法,不是线上此刻的浮现率。** 为了 replay 可重复,几个「活的可变状态」
// 被冻住了(冷却窗、在场排除、去 anisotropy 的 μ,见下面 FROZEN)。所以这里的非空比例
// 跟线上对不上是**预期**的 —— 别拿它当线上指标看。它保证的是:同样的输入 + 同样的代码
// → 同样的输出;代码一改,变了多少、变了哪些,立刻看得见。
// 实测灵敏度:standoutMargin 0.25→0.10 会让 42/50 的 top-N 变化。
//
// 与其它 .realdb 用例不同,本用例读 **qqbot_db 真库**(她真实的语料向量),而不是隔离的
// qqbot_cache_test —— 回归集的价值就在于跑在真语料上。**全程只读,不写任何一行。**

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE = path.join(__dirname, 'fixtures', 'recall-regression-cases.json');
const DB_URL = process.env.RECALL_REGRESSION_DB_URL
  || `postgresql://${process.env.DB_USER || 'qqbot_user'}:${process.env.DB_PASSWORD || 'qqbot_password'}`
   + `@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/qqbot_db`;
const EMBED_URL = process.env.RECALL_REGRESSION_EMBED_URL || 'http://127.0.0.1:8091/v1/embeddings';
const UPDATE = process.env.RECALL_REGRESSION_UPDATE === '1';
const TOP_N = 5; // 指纹只比 top-5:再往下的次序对「她会看到什么」没有影响

async function embed(texts) {
  const resp = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, encoding_format: 'float' }),
    signal: AbortSignal.timeout(60000)
  });
  if (!resp.ok) throw new Error(`embed http ${resp.status}`);
  const json = await resp.json();
  return (json.data || []).map((d) => d.embedding);
}

async function ready() {
  try {
    await embed(['ping']);
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

test('召回回归集:50 个历史落地时刻的 top-N 与基线一致', async (t) => {
  if (!(await ready())) {
    t.skip('真库或 embedding server 不可达');
    return;
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const real = require('../index.js');
  const { createRecallIngest } = require('../xiaoni-recall-ingest');
  const cfg = { databaseUrl: DB_URL };

  // **跑生产那条路本身**,只把落库换成捕获。
  // 第一版是在测试里重写了一遍检索流程 —— 结果少了主成分去除、少了双域分别选拔、
  // 少了在场排除,50 例里 49 例浮出空,比 [] 和 [] 永远绿。回归集必须跑真路径,
  // 否则它保护的是一个生产从不执行的配置。
  const { Client } = require('pg');
  const muClient = new Client({ connectionString: DB_URL });
  await muClient.connect();
  let frozenModel = null;
  const captured = [];
  // **活的可变状态必须冻住**,否则 replay 不确定:冷却窗读的是实时 shadow 日志、在场排除读的是
  // 当前栈尾,而生产系统就在旁边并发写 —— 同一份代码连跑两次结果都不一样(踩过)。
  // 这些机制各自有单元测,回归集要量的是**排序算法**。
  const FROZEN = {
    // 无冷却:让每次 replay 面对同一个候选池。
    listRecentlySurfacedRecallRefs: async () => [],
    // 无结构式在场排除,cutoff 钉在 0。
    getSessionReadCutoffState: async () => ({ readCutoffAfterStackIndex: 0 }),
    listInContextStackSourceRefs: async () => [],
    // 遗忘线钉在很晚 → 所有已读 inbound 砖都算「早就忘了」,一致地进池。
    getAgentStackItemTimeByIndex: async () => '2099-01-01T00:00:00.000Z',
    getInboundReadStates: async (ids) => (Array.isArray(ids) ? ids : [])
      .map((id) => ({ id: Number(id), isRead: true, readAt: '2000-01-01T00:00:00.000Z' })),
    // 语义式在场排除的近窗向量:回归集不喂,保持池子干净。
    getRecallCueVectorsByRefs: async () => [],
    // 去 anisotropy 的 μ:生产取**最新** 4000 行(ORDER BY id DESC),而生产系统一直在写新 cue
    // → μ 一直在漂 → 擦边候选每次 replay 翻面(实测残余 2/50 就是它)。
    // 回归集改取**最旧** 4000 行:这批行不再变化,μ 因此固定。
    getRecallDeanisotropyModel: async () => {
      if (!frozenModel) {
        const { rows } = await muClient.query(
          `SELECT embedding FROM xiaoni_recall_cues
            WHERE identity_key = 'xiaoni' AND embedding_vec IS NOT NULL
              AND (source_kind = 'inbound'
                   OR (source_kind = 'file_chunk' AND source_ref ~ '/notes/(diary|people|topics)/'))
            ORDER BY id ASC LIMIT 4000`
        );
        const vecs = rows.map((r) => r.embedding).filter((v) => Array.isArray(v) && v.length);
        const dim = vecs[0] ? vecs[0].length : 0;
        const mean = new Array(dim).fill(0);
        for (const v of vecs) for (let i = 0; i < dim; i += 1) mean[i] += v[i];
        for (let i = 0; i < dim; i += 1) mean[i] /= vecs.length || 1;
        frozenModel = { mean, components: [] };
      }
      return frozenModel;
    }
  };
  const facade = new Proxy({}, {
    get(_t, name) {
      if (Object.prototype.hasOwnProperty.call(FROZEN, name)) {
        return FROZEN[name];
      }
      if (name === 'insertRecallShadowLog') {
        return async (record) => { captured.push(record); return { id: null }; };
      }
      if (name === 'upsertRecallCues' || name === 'getExistingContentHashes') {
        // runShadowRecall 不该碰写路径;真被调到就让它响,别静默。
        return async () => { throw new Error(`回归集只读,不该调用 ${String(name)}`); };
      }
      const fn = real[name];
      if (typeof fn !== 'function') return fn;
      return (...args) => {
        // 末位补上 databaseUrl —— persistence 的函数签名都是 (..., config)。
        const last = args[args.length - 1];
        const withCfg = last && typeof last === 'object' && !Array.isArray(last) && 'databaseUrl' in last
          ? args
          : [...args, cfg];
        return fn(...withCfg);
      };
    }
  });

  const ingest = createRecallIngest({ embed, persistence: facade, identityKey: 'xiaoni' });
  const drift = [];
  for (const c of fixture.cases) {
    captured.length = 0;
    // eslint-disable-next-line no-await-in-loop
    await ingest.runShadowRecall({
      landedText: c.queryText,
      landedRef: c.queryRef,
      occurredAt: c.occurredAt
    }).catch(() => null);
    const log = captured[0];
    const got = ((log && log.surfaced) || []).map((e) => e.sourceRef).slice(0, TOP_N);
    if (UPDATE) {
      c.currentTopN = got;
    } else {
      const want = (c.currentTopN || []).slice(0, TOP_N);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        drift.push({ queryRef: c.queryRef, want, got });
      }
    }
  }

  await muClient.end();

  if (UPDATE) {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    const nonEmpty = fixture.cases.filter((x) => (x.currentTopN || []).length).length;
    t.diagnostic(`已重录基线:${fixture.cases.length} 例,其中 ${nonEmpty} 例非空`);
    // 基线几乎全空 = 回归集没有保护力,当场喊出来,别留个绿灯骗人。
    assert.ok(nonEmpty >= fixture.cases.length * 0.3,
      `只有 ${nonEmpty}/${fixture.cases.length} 例浮出了东西,回归集失去意义 —— 先查为什么大面积静默`);
    return;
  }

  const recorded = fixture.cases.filter((x) => (x.currentTopN || []).length).length;
  if (recorded === 0) {
    t.diagnostic('基线还没录过 —— 先跑 RECALL_REGRESSION_UPDATE=1');
    return;
  }
  assert.deepStrictEqual(
    drift,
    [],
    `${drift.length}/${fixture.cases.length} 个案例的 top-N 变了。`
    + '\n刻意改了行为就用 RECALL_REGRESSION_UPDATE=1 重录,并在 commit 里说清为什么:\n'
    + JSON.stringify(drift.slice(0, 5), null, 2)
  );
});
