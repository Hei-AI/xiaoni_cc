'use strict';

// 2026-08-07 真库诊断的回归锁。三件事,都是「投递前必须先修」那一档:
//   ① 她自己不是「别人」—— 动作流 peerName 回退到 session_key='xiaoni',把她自己的
//      plan post / 工具调用渲染成「xiaoni 提过：…」并塞进他人域(近 7 天 peer_message
//      2369 条里 1899 条是她自己,真人只剩 ~350)。
//   ② plan/skill 提交的围栏 + heredoc 命令外壳是逐字不变的样板,上千条 cue 因此互为最近邻。
//   ③ 自驱动工具参数信封 {"clock":..,"reason":..,"xiaoni_os":..} 里只有话是记忆。

const test = require('node:test');
const assert = require('node:assert');
const {
  buildRecallCueFromActionStreamItem,
  isSelfPeerName,
  resolvePeerNameForItem,
  stripHeredocScaffold,
  normalizeRecallText,
  isMachineParamsOnly
} = require('../xiaoni-passive-recall-extractor');
const { renderRecallLead } = require('../xiaoni-recall-bandpass');

test('self peer: 动作流回退到 session_key 的 xiaoni 不算「别人」', () => {
  assert.strictEqual(isSelfPeerName('xiaoni'), true);
  assert.strictEqual(isSelfPeerName('XiaoNi'), true);
  assert.strictEqual(isSelfPeerName('小腻'), true);
  assert.strictEqual(isSelfPeerName('Nova'), false);
  assert.strictEqual(isSelfPeerName('李阿花'), false);
  assert.strictEqual(resolvePeerNameForItem({ peerName: 'xiaoni' }), null);
  assert.strictEqual(resolvePeerNameForItem({ peerName: 'Nova' }), 'Nova');
});

test('self peer: 她自己的动作流不再走 peer_message 措辞', () => {
  const cue = buildRecallCueFromActionStreamItem({
    id: 'stack:248685',
    source: 'runtime_input',
    peerName: 'xiaoni',
    title: '模型输出',
    body: '今天读了将近六十篇鵝庵筆記',
    timestamp: '2026-08-07T03:00:00Z'
  });
  assert.ok(cue);
  assert.strictEqual(cue.provenance.peer, null, 'self peer 必须写成 null(域判定据此)');
  assert.notStrictEqual(cue.provenance.leadTemplate, 'peer_message');
  const lead = renderRecallLead(cue);
  assert.ok(!/^xiaoni 提过/.test(lead.text), `不能对她说「xiaoni 提过」,实得:${lead.text}`);
});

test('real peer: 真人说的话仍然走 peer_message', () => {
  const cue = buildRecallCueFromActionStreamItem({
    id: 'stack:1',
    source: 'runtime_input',
    peerName: 'Nova',
    title: '收到消息',
    body: '最近没画画 在往更小的方向跑',
    timestamp: '2026-08-06T03:00:00Z'
  });
  assert.strictEqual(cue.provenance.peer, 'Nova');
  assert.strictEqual(cue.provenance.leadTemplate, 'peer_message');
  assert.match(renderRecallLead(cue).text, /^Nova 提过：/);
});

test('heredoc: 剥掉围栏 + 命令外壳,一字不动地留下正文', () => {
  const body = '给陈显写一封配得上被介绍的信——论文走完了但还没消化成自己的东西。';
  const raw = "``` /app/modules/agent-service/skills-internal/xiaoni-plan/xiaoni-plan post <<'PLAN'\n"
    + `${body}\nPLAN\n\`\`\``;
  assert.strictEqual(stripHeredocScaffold(raw), body);
  assert.strictEqual(normalizeRecallText(raw), body);
});

test('heredoc: 正文里的 << 不被误当成开标记', () => {
  const plain = '她说 a << b 是左移,不是 heredoc';
  assert.strictEqual(stripHeredocScaffold(plain), plain);
});

test('heredoc: exec_command JSON 里套着的 plan 提交也剥到正文', () => {
  const body = '明天写信发出去,不是后天。';
  const cmd = `xiaoni-plan post <<'PLAN'\n${body}\nPLAN`;
  assert.strictEqual(normalizeRecallText(JSON.stringify({ cmd })), body);
});

test('自驱动工具参数信封:只留 xiaoni_os / reason 里的话', () => {
  const out = normalizeRecallText(JSON.stringify({
    clock: 120,
    reason: '做了够多了。等CC和帕秋莉回。',
    xiaoni_os: '第三十八天。早上九点半。'
  }));
  assert.ok(!out.includes('clock'), `参数壳必须剥掉,实得:${out}`);
  assert.ok(out.includes('第三十八天。早上九点半。'));
  assert.ok(out.includes('等CC和帕秋莉回。'));
});

// ── 纯参数不进语料 ────────────────────────────────────────────────────────
// 被动召回的命题是「她不知道自己做过」。一次滚动没有任何值得她想起来的内容,
// 而 2026-08-21 回归集实测:这类行抢到过一个 top-1(挤掉一条日记条目)。
// 判据按**形状**不按长度 —— 按长度会误杀短中文句子。
test('纯参数 payload 不进语料;她的话一个字都不能误伤', () => {
  const junk = [
    '{"action":"scroll","coordinate":[400,300],"scroll_amount":5,"scroll_direction":"down"}',
    '{"action":"key","text":"Return"}',
    '{"coordinate":[400,300]}'
  ];
  const keep = [
    '{"cmd":"# 不困。53分钟。在 synth 里继续。"}',
    '{"reason":"一天半了。脑子在空转。"}',           // 短中文:按长度卡会被误杀
    '{"path":"/xiaoni-runtime/reading/liangzhuang_full.txt","limit":100}', // 她读了哪一段
    '{"action":"type","text":"你好啊"}',
    '今天做了一件事'
  ];
  for (const text of junk) {
    assert.equal(isMachineParamsOnly(text), true, `该判为纯参数：${text}`);
  }
  for (const text of keep) {
    assert.equal(isMachineParamsOnly(text), false, `不该误伤：${text}`);
  }
});
