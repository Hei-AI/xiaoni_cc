// 段边界锚的回归用例。
//
// 这一行**会进 cacheable 前缀**(拼进 context_summary,由 <xiaoni_status> 原样渲染),所以它
// 必须满足两条比措辞更重要的性质:
//   ① 确定性 —— 同样两个 stack 时刻,任何时候渲染都得到同一串字节。锚点里一旦混进 now 之类
//      会变的东西,两次压缩之间前缀就会漂,整段 message-tier 缓存作废(见 CLAUDE.md 双缓存铁律
//      和 runtime reminder 双戳漂移那次事故)。
//   ② fail-open —— 读不到时刻就返回 '',调用方原样提交她写的近况。压缩在关键路径上:任何在
//      这里抛出的异常都会同时废掉正常提交和 hard-cap 兜底提交 → read_cutoff 永不前移 →
//      上下文只涨不降 → 撞 30MiB 硬线 → 压缩永久卡死。
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderCompressionSpanAnchor } from '../services/east8-time';

const START = '2026-07-28T01:12:33+08:00';
const END_SAME_DAY = '2026-07-28T10:09:07+08:00';

test('span anchor: 同一天只写一次日期,终点只给时钟', () => {
  const line = renderCompressionSpanAnchor({ windowStartedAt: START, windowEndedAt: END_SAME_DAY });
  assert.equal(
    line,
    '（这一份近况覆盖 2026-07-28 01:12 到 10:09，8 小时 57 分钟。再往前的事在下面的日记目录里。）'
  );
});

test('span anchor: 跨天两头都带日期(否则 00:27 会被读成前一天)', () => {
  const line = renderCompressionSpanAnchor({
    windowStartedAt: '2026-07-27T20:34:00+08:00',
    windowEndedAt: '2026-07-28T00:27:53+08:00'
  });
  assert.ok(line.includes('2026-07-27 20:34 到 2026-07-28 00:27'), line);
});

test('span anchor: 不含秒 —— 秒级抖动不得让前缀漂移', () => {
  // 同一分钟内的两个不同秒必须渲染成同一串字节。stack item 落库时刻是不变的,但把秒写进
  // 前缀等于给未来的自己留一个「看起来无害的可变位」,这里直接钉死不允许。
  const a = renderCompressionSpanAnchor({ windowStartedAt: START, windowEndedAt: '2026-07-28T10:09:07+08:00' });
  const b = renderCompressionSpanAnchor({ windowStartedAt: START, windowEndedAt: '2026-07-28T10:09:59+08:00' });
  assert.equal(a, b);
  assert.ok(!/\d{2}:\d{2}:\d{2}/u.test(a), `锚点不得出现秒: ${a}`);
});

test('span anchor: 确定性 —— 重复渲染逐字节一致', () => {
  const once = renderCompressionSpanAnchor({ windowStartedAt: START, windowEndedAt: END_SAME_DAY });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(renderCompressionSpanAnchor({ windowStartedAt: START, windowEndedAt: END_SAME_DAY }), once);
  }
});

test('span anchor: 任何一头缺失/非法/倒挂都返回空串(fail-open)', () => {
  const empties = [
    { windowStartedAt: null, windowEndedAt: END_SAME_DAY },
    { windowStartedAt: START, windowEndedAt: null },
    { windowStartedAt: null, windowEndedAt: null },
    { windowStartedAt: 'not-a-date', windowEndedAt: END_SAME_DAY },
    { windowStartedAt: START, windowEndedAt: 'not-a-date' },
    // 倒挂:cutoff 回退这种不该发生的状态下,宁可不给锚点也不给一句负时长的胡话
    { windowStartedAt: END_SAME_DAY, windowEndedAt: START }
  ];
  for (const input of empties) {
    assert.equal(renderCompressionSpanAnchor(input), '', JSON.stringify(input));
  }
});

test('span anchor: 起止相同(空窗口)给 0 分钟而不是空串', () => {
  const line = renderCompressionSpanAnchor({ windowStartedAt: START, windowEndedAt: START });
  assert.ok(line.includes('0 分钟'), line);
});
