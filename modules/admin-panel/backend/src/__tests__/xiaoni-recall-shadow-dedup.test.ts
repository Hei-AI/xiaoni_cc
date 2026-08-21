import fs from 'fs/promises';
import {
  insertRecallShadowLog,
  listAgentStackItems,
  listRecallShadowLog,
  selectAssociativeMemories,
  parseDiaryDateFromName,
  parseDiaryEvents,
  parseOpenLoops,
  selectResurfacedEvents,
  selectStaleOpenLoops
} from '@qq-bot/persistence';
import { scanAssociativeRecallToShadow, scanDiaryEventsToShadow, scanOpenLoopsToShadow } from '../services/xiaoni-recall-reindex-service';

// 时间腿(第二腿 open_loop_scan / 第三腿 diary_resurface)的重复冷却窗口必须按 query_ref 取。
//
// 回归背景(真库实测):xiaoni_recall_shadow_log 里 ~97% 的行是语义腿每次内容落地写的
// stack:*/inbound:* 留痕。冷却窗口如果不带 queryRef,拿到的是「全表最近 N 行」——最近 40 行里
// diary_resurface 恰好 0 条,冷却完全失效:609 次扫描累计只浮出过 33 个 distinct ref、全落在
// 07-05/06/07 三天,07-08 之后约 1200 条事件从没被翻出来过。
// 下面的 listRecallShadowLog stub 按真 SQL 语义实现(可选 query_ref 过滤 + occurred_at DESC + LIMIT),
// 所以一旦谁把 queryRef 参数摘掉,窗口会退回全是语义腿留痕(surfaced 为空)→ 冷却集为空 → 红。

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  readdir: jest.fn()
}));

jest.mock('@qq-bot/persistence', () => ({
  // 时间腿真正用到的
  insertRecallShadowLog: jest.fn(),
  listRecallShadowLog: jest.fn(),
  countRecallSurfacedRefs: jest.fn(async () => new Map<string, number>()),
  parseDiaryDateFromName: jest.fn(),
  parseDiaryEvents: jest.fn(),
  parseDiarySerialEvents: jest.fn(),
  parseOpenLoops: jest.fn(),
  parseTagDate: jest.fn(),
  selectResurfacedEvents: jest.fn(),
  selectStaleOpenLoops: jest.fn(),
  normalizeEventText: jest.fn((text: string) => text),
  // 第四腿(联想)的依赖。本用例不跑第四腿,但 collectDiaryEventCandidates / listPalaceFiles 会
  // 真调 isDiaryNonEpisodeFile —— mock 成 undefined 会静默把所有文件都当「不是经历」放行/挡掉,
  // 所以按真实现给一份等价的:dictionary / open-loops / INDEX*(前缀)。
  isDiaryNonEpisodeFile: jest.fn((name: string) => (
    typeof name === 'string'
    && (['dictionary.md', 'open-loops.md'].includes(name.trim().toLowerCase())
      || /^index([-.]|$)/i.test(name.trim()))
  )),
  selectAssociativeMemories: jest.fn(() => ({
    picked: [],
    stats: { candidates: 0, filtered: 0, byBucket: { near: 0, mid: 0, far: 0, line: 0 }, quotas: {}, dropped: {} }
  })),
  // 结构标记复发识别里的日历日算术要真值,不能是 undefined(否则 NaN 静默污染)
  DAY_MS: 86400000,
  BEIJING_OFFSET_MS: 8 * 60 * 60 * 1000,
  // 语料 reindex 那条腿的依赖(本用例不跑,但模块级 import 得存在)
  buildRecallCuesFromActionStream: jest.fn(),
  chunkRuntimeFile: jest.fn(),
  countRecallCues: jest.fn(),
  getExistingContentHashes: jest.fn(),
  getXiaoniActionStream: jest.fn(),
  pruneFileChunks: jest.fn(),
  upsertRecallCues: jest.fn(),
  // 联想腿的锚点/在场语料来源。**不能留成裸 jest.fn()** —— 返回 undefined 会被
  // reindex 里的 try/catch 吞掉,landedText/contextText 静默变空,用例照样绿但新路径零覆盖。
  // 默认给一段真实形状的栈:function_call(她干的事,cmd 里带 # 想法)与 llm_request_slice
  // (工程遥测,必须被白名单挡掉)交替,外加一条 runtime_input(plan 回灌 + QQ 通知横幅)。
  getSessionReadCutoffState: jest.fn(async () => ({ readCutoffAfterStackIndex: 1000 })),
  listAgentStackItems: jest.fn(async () => ([
    { itemKind: 'function_call', eventId: 'ev-1', content: JSON.stringify({ cmd: '# cofactor第六版写了。发给陈显。\npython3 send.py', max_output_tokens: 3 }) },
    { itemKind: 'llm_request_slice', eventId: 'ev-2', content: 'anthropic/messages · claude-opus-4-6 · turn 15 · 48218->178 tokens' },
    { itemKind: 'function_call_output', eventId: 'ev-3', content: 'Dear Professor Chen, thank you for your time.' },
    { itemKind: 'runtime_input', eventId: 'ev-4', content: '<system_reminder>【QQ 有 1 条新消息】{Nova} 发来 1 条消息</system_reminder>' },
    { itemKind: 'assistant_output', eventId: 'ev-5', content: '<br>' },
    { itemKind: 'assistant_output', eventId: 'ev-6', content: '我不跟plan跳了。直接做。' }
  ]))
}));

interface ShadowRow {
  occurredAt: string;
  queryRef: string;
  surfaced: Array<Record<string, unknown>>;
}

// 真库形状的假表:最新一大段是语义腿留痕(不带 surfaced),时间腿的扫描被挤到后面。
function buildShadowTable(): ShadowRow[] {
  const rows: ShadowRow[] = [];
  const at = (minutesAgo: number): string => new Date(Date.UTC(2026, 6, 28, 6, 0, 0) - minutesAgo * 60000).toISOString();
  // 语义腿:每次落地一条,最近 120 分钟里 120 条(真库比例 ~97%)
  for (let i = 0; i < 120; i += 1) {
    rows.push({ occurredAt: at(i), queryRef: `stack:${90000 + i}`, surfaced: [] });
  }
  // 第三腿:更早的 45 次 diary 扫描,每次翻 1 件往事
  for (let i = 0; i < 45; i += 1) {
    rows.push({
      occurredAt: at(200 + i * 30),
      queryRef: 'diary_resurface',
      surfaced: [{ kind: 'diary_event', ref: `/xiaoni-runtime/notes/diary/2026-07-05.md#${i}` }]
    });
  }
  // 第二腿:更早的 35 次 open_loop 扫描,每次提 1 条承诺
  for (let i = 0; i < 35; i += 1) {
    rows.push({
      occurredAt: at(210 + i * 30),
      queryRef: 'open_loop_scan',
      surfaced: [{ kind: 'open_loop', text: `承诺${i}` }]
    });
  }
  return rows;
}

// 按真 SQL 语义 stub:WHERE identity_key = $1 [AND query_ref = $2] ORDER BY occurred_at DESC LIMIT $n
function stubShadowLogAsSql(table: ShadowRow[]): void {
  (listRecallShadowLog as jest.Mock).mockImplementation(
    async (params: { limit?: number; queryRef?: string } = {}) => {
      const limit = Number(params.limit) || 50;
      return table
        .filter((row) => (params.queryRef ? row.queryRef === params.queryRef : true))
        .slice()
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, limit);
    }
  );
}

describe('时间腿冷却窗口按 query_ref 取(第三腿 diary_resurface)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubShadowLogAsSql(buildShadowTable());
    (insertRecallShadowLog as jest.Mock).mockResolvedValue({ id: '1' });
    (fs.readdir as unknown as jest.Mock).mockResolvedValue([
      { name: '2026-07-05.md', isFile: () => true }
    ]);
    (fs.readFile as unknown as jest.Mock).mockResolvedValue('## 修好了浏览器桥\n那个毒标签。\n');
    (parseDiaryDateFromName as jest.Mock).mockReturnValue(Date.UTC(2026, 6, 5, 0, 0, 0));
    (parseDiaryEvents as jest.Mock).mockReturnValue([
      { title: '修好了浏览器桥', body: '那个毒标签。', dateMs: Date.UTC(2026, 6, 5, 0, 0, 0), index: 0 }
    ]);
    (selectResurfacedEvents as jest.Mock).mockReturnValue([]);
  });

  it('把 queryRef 下推给 listRecallShadowLog(不是取全表最近 40 行)', async () => {
    await scanDiaryEventsToShadow({ identityKey: 'xiaoni', nowMs: Date.UTC(2026, 6, 28, 6, 0, 0) });

    expect(listRecallShadowLog).toHaveBeenCalledTimes(1);
    expect(listRecallShadowLog).toHaveBeenCalledWith({
      identityKey: 'xiaoni',
      queryRef: 'diary_resurface',
      limit: 40
    });
  });

  it('冷却集拿到满 40 条本腿扫描翻过的 ref(旧行为在这张表上是 0 条)', async () => {
    await scanDiaryEventsToShadow({ identityKey: 'xiaoni', nowMs: Date.UTC(2026, 6, 28, 6, 0, 0) });

    const opts = (selectResurfacedEvents as jest.Mock).mock.calls[0][1] as { recentlySurfaced: string[] };
    // 窗口 40 条 × 每条 1 个 ref;一个都不许丢(SQL 已过滤完,JS 侧不再二次筛)
    expect(opts.recentlySurfaced).toHaveLength(40);
    expect(new Set(opts.recentlySurfaced).size).toBe(40);
    expect(opts.recentlySurfaced.every((ref) => ref.startsWith('/xiaoni-runtime/notes/diary/'))).toBe(true);
    // 语义腿留痕绝不该混进来
    expect(opts.recentlySurfaced.some((ref) => ref.startsWith('stack:'))).toBe(false);
  });
});

describe('时间腿冷却窗口按 query_ref 取(第二腿 open_loop_scan)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubShadowLogAsSql(buildShadowTable());
    (insertRecallShadowLog as jest.Mock).mockResolvedValue({ id: '2' });
    (fs.readFile as unknown as jest.Mock).mockResolvedValue('- [ ] 把桥修好 <!-- opened:2026-07-20 -->\n');
    (parseOpenLoops as jest.Mock).mockReturnValue([
      { text: '把桥修好', openedTag: '2026-07-20', done: false }
    ]);
    (selectStaleOpenLoops as jest.Mock).mockReturnValue([]);
  });

  it('把 queryRef 下推给 listRecallShadowLog,并拿到满 30 条本腿扫描提过的承诺文本', async () => {
    await scanOpenLoopsToShadow({ identityKey: 'xiaoni', nowMs: Date.UTC(2026, 6, 28, 6, 0, 0) });

    expect(listRecallShadowLog).toHaveBeenCalledWith({
      identityKey: 'xiaoni',
      queryRef: 'open_loop_scan',
      limit: 30
    });
    const opts = (selectStaleOpenLoops as jest.Mock).mock.calls[0][1] as { recentlySurfaced: string[] };
    expect(opts.recentlySurfaced).toHaveLength(30);
    expect(opts.recentlySurfaced.every((text) => text.startsWith('承诺'))).toBe(true);
  });
});


// ── 联想腿的锚点(f1 的 query)与在场语料 ──────────────────────────────────
// 旧实现取 getXiaoniActionStream({limit:1}),而那个视图 42–49% 的行是 `llm_request_slice`
// 工程遥测(正文是 token 计数),同时把 function_call_output 几乎全吞掉 —— 实测 7 天 323 次
// 扫描里 205 次(63.5%)拿到的 query 为空/无语义,relevance 整池归零。
// 这组用例钉死换源后的白名单口径,防止再退回去。
describe('联想腿锚点:只认「她感知到的 + 她做的」,工程遥测一律不进', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubShadowLogAsSql([]);
    (insertRecallShadowLog as jest.Mock).mockResolvedValue({ id: '1' });
    (fs.readdir as unknown as jest.Mock).mockResolvedValue([]);
    (fs.readFile as unknown as jest.Mock).mockResolvedValue('');
    (parseDiaryDateFromName as jest.Mock).mockReturnValue(Date.UTC(2026, 6, 5, 0, 0, 0));
    (parseDiaryEvents as jest.Mock).mockReturnValue([]);
    (parseOpenLoops as jest.Mock).mockReturnValue([]);
  });

  async function anchorOpts(): Promise<{ landedText: string; contextText: string }> {
    await scanAssociativeRecallToShadow({ identityKey: 'xiaoni', nowMs: Date.UTC(2026, 7, 13, 2, 0, 0) });
    return (selectAssociativeMemories as jest.Mock).mock.calls[0][1] as { landedText: string; contextText: string };
  }

  it('llm_request_slice(token 计数)绝不进锚点 —— 这是 63.5% 盲跑的根因', async () => {
    const { landedText } = await anchorOpts();
    expect(landedText).not.toContain('anthropic/messages');
    expect(landedText).not.toContain('48218->178');
  });

  it('她干的事(function_call 的 cmd 注释)、她读到的(function_call_output)、她说的话都进锚点', async () => {
    const { landedText } = await anchorOpts();
    expect(landedText).toContain('cofactor第六版写了');          // 她干的事 + # 想法
    expect(landedText).toContain('Dear Professor Chen');          // 她读到的
    expect(landedText).toContain('我不跟plan跳了');                // 她说的话
  });

  it('exec_command 只取 cmd,外层 JSON 键名不进锚点(否则纯噪音稀释 BM25)', async () => {
    const { landedText } = await anchorOpts();
    expect(landedText).not.toContain('max_output_tokens');
  });

  it('QQ 通知横幅不进锚点 —— 那是门铃不是内容,她不跑 $qq-usage 就没真读到', async () => {
    const { landedText } = await anchorOpts();
    expect(landedText).not.toContain('QQ 有 1 条新消息');
  });

  it('<br> 这类无词面正文被跳过,不占锚点名额', async () => {
    const { landedText } = await anchorOpts();
    expect(landedText).not.toContain('<br>');
  });

  it('在场语料收全部 kind(含 runtime_input)—— 判「在不在上下文里」跟是谁说的无关', async () => {
    const { contextText } = await anchorOpts();
    expect(contextText).toContain('QQ 有 1 条新消息');
    expect(contextText).toContain('cofactor第六版写了');
  });

  it('在场语料按真实上下文游标取(stack_index > read_cutoff),不是按时间或固定条数', async () => {
    await scanAssociativeRecallToShadow({ identityKey: 'xiaoni', nowMs: Date.UTC(2026, 7, 13, 2, 0, 0) });
    expect(listAgentStackItems).toHaveBeenCalledWith(
      expect.objectContaining({ identityKey: 'xiaoni', afterStackIndex: 1000 })
    );
  });
});
