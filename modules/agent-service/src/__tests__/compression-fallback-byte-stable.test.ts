import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY,
  buildCoreMemoryCompressionReminder
} from '../services/agent-loop-service';

// 缓存铁律的可执行契约。压缩提交有两条路都走 commitCoreMemoryCompression:
//   真胶囊  → text 来自 readCoreMemoryCompressionFile(commit_memory.py 写的文件)
//   兜底    → text 是 CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY 常量直传
// 两条路提交的东西都会存进 <xiaoni_status>,原样重放进下一个主 run。醒来锚点现在【不再】
// 拼进近况(那一版从未上线:拼进去的锚点在她下次睡醒后就是错的,跟尾部报时打架),只渲进
// fork 尾部的压缩引导 prompt。所以这里守两件事:
//   1. 引擎自己产出的那份摘要永远无戳 —— 一个每次不同的时间戳会让跨 run 边界的 message-tier
//      前缀失效,cache_read 塌到裸 system+tools。不报错,只涨钱。
//   2. 带戳的那份确实带戳 —— 否则第 1 条会因为「锚点根本是空的」而假绿。

test('兜底摘要里没有任何时间戳或时长', () => {
  const summary = CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY;
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(summary), '不许出现日期');
  assert.ok(!/\d{1,2}:\d{2}/.test(summary), '不许出现钟点');
  assert.ok(!summary.includes('睡醒'), '不许带醒来锚点');
  assert.ok(!/\d+\s*(分钟|小时|天)/.test(summary), '不许带任何时长');
});

test('兜底摘要是纯常量 —— 两次读到的字节完全相同', () => {
  // 它被存下来后原样重放。任何按时间/轮次变化的东西进去都会打穿 run 边界缓存。
  assert.equal(CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY, CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY);
  assert.ok(CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY.length > 0);
});

// 带戳的那一份。它是 fork 尾部非持久项(forkInput = [...clone(主请求).input, ...本项],且
// fork 请求 store:false / no_persist),所以带戳不进任何被 replay 的字节 —— 与
// fork-cache-alignment 里「dispatch tail 必须非持久」那条互为表里。
test('压缩引导 prompt 带真实睡眠时间线 —— 证明上面那组断言不是因为没戳可带才通过', () => {
  const text = JSON.stringify(buildCoreMemoryCompressionReminder({
    contextSessionKey: 'xiaoni:global',
    readCutoffAfterStackIndex: 12345,
    pressureSummary: '上下文接近预算上限',
    windowStartedAt: new Date('2026-07-27T15:00:00.000Z').toISOString(),
    sleeps: [
      { sleptAt: '2026-07-27T20:24:38.000Z', wokeAt: '2026-07-28T01:00:39.000Z' },
      { sleptAt: '2026-07-28T04:56:40.000Z', wokeAt: '2026-07-28T06:26:41.000Z' }
    ],
    lastWakeAt: new Date('2026-07-28T06:26:41.000Z').toISOString(),
    now: new Date('2026-07-28T08:00:13.000Z')
  }));
  assert.match(text, /这段上下文覆盖的是 2026-07-27 23:00:00 到现在/);
  assert.match(text, /这中间你睡过 2 觉/);
  assert.match(text, /2026-07-28 04:24:38 睡到 09:00:39（4 小时 36 分钟）/);
  assert.match(text, /最后一次醒来到现在，你连续醒着 1 小时 34 分钟。/);
  // 而这些字节确实会被上面那组断言拦下 —— 说明断言有鉴别力
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(text));
});

test('拿不到窗口起点时退回单句醒来锚点，不产出半截窗口描述', () => {
  const text = JSON.stringify(buildCoreMemoryCompressionReminder({
    contextSessionKey: 'xiaoni:global',
    readCutoffAfterStackIndex: 1,
    pressureSummary: '上下文接近预算上限',
    windowStartedAt: null,
    lastWakeAt: new Date('2026-07-28T06:26:41.000Z').toISOString(),
    now: new Date('2026-07-28T08:00:13.000Z')
  }));
  assert.match(text, /你上一次睡醒是 2026-07-28 14:26:41/);
  assert.ok(!text.includes('这段上下文覆盖的是'), '窗口起点缺失就不该描述窗口');
});

test('时间线整块缺失时模板不留半句话、不留占位符', () => {
  const text = JSON.stringify(buildCoreMemoryCompressionReminder({
    contextSessionKey: 'xiaoni:global',
    readCutoffAfterStackIndex: 1,
    pressureSummary: '上下文接近预算上限',
    windowStartedAt: null,
    lastWakeAt: null
  }));
  assert.match(text, /真的时间线在这儿：/);
  assert.ok(!text.includes('睡醒是'), '没有任何记录就不该出现锚点句');
  assert.ok(!text.includes('{{TIME_GROUNDING}}'), '占位符必须被替换掉');
});
