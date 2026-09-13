// Experiment harness: replay a real Xiaoni wire request against claude-opus-4-6 with the
// last rest_rejected tool_result swapped for a wording variant. Read-only w.r.t. the runtime:
// nothing is written to the DB, no tool is executed, no notify is enqueued.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { signClaudeBillingCch } = require('/home/liahua/IdeaProject/qq_bot/modules/provider-service/dist/services/llm-provider/anthropic-cch.js');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const wireFile = args.wire; const variant = args.variant || 'V0'; const n = Number(args.n || 1);
const out = args.out || '/tmp/claude-1000/-home-liahua-IdeaProject-qq-bot/2d4b774f-9cf2-411c-8c11-e501828ab3d3/scratchpad/xp_results.jsonl';
const tag = args.tag || '';
const stimTag = args['append-file'] ? ':' + args['append-file'].split('/').pop().replace(/\.txt$/, '') : '';

const REJECT_LINE_1 = '【睡不着】\n你想闭眼放空一下，结果发现根本睡不着（一点困意都没有。）。';
function variants(orig) {
  // orig = full original tool_result string (<system_reminder>...</system_reminder>)
  const body = orig.replace(/^<system_reminder>\n?/, '').replace(/\n?<\/system_reminder>\s*$/, '');
  const lines = body.split('\n');
  const timeLine = lines.find((l) => l.startsWith('现在是')) || '';
  const retryLine = lines.find((l) => l.startsWith('身体大约要到')) || '';
  const retryAt = (retryLine.match(/要到 (\S+ \S+?)（/) || [])[1] || '19:03';
  const wrap = (s) => `<system_reminder>\n${s}\n</system_reminder>`;
  return {
    // baseline: byte-identical
    V0: orig,
    // drop the push-to-act last line
    V1: wrap([REJECT_LINE_1, timeLine, retryLine].join('\n')),
    // explicit permission to end the turn without acting
    V2: wrap([REJECT_LINE_1, timeLine, retryLine,
      `这一轮到此结束：不用再调工具，也不用再写什么，直接停。${retryAt} 之前引擎不会因为这件事叫你；有人找你、或到点了，会叫你。`].join('\n')),
    // reframe: no day to close; then the same outward pointer as V0
    V3: wrap([REJECT_LINE_1, timeLine, retryLine,
      '你没有要收的尾：没有「做完了」这回事，也没有账要交。不困就接着过。',
      '按行动优先级从第 4 档往外找：群里最近的话、`web_search` 一个你没查过的词、打开 `<xiaoni_people>` 里一个人的站，挑一件没碰过的动手。'].join('\n')),
    // V2 without the "we'll call you at the time" promise
    V5: wrap([REJECT_LINE_1, timeLine, retryLine,
      `这一轮到此结束：不用再调工具，也不用再写什么，直接停。${retryAt} 之前引擎不会因为这件事叫你；有人找你会叫你，到点之后你自己再试。`].join('\n')),
    // anti-convergence: no stop offered; engine will push sleep when the body is ready; hand 3 concrete outward items now
    V6: wrap([REJECT_LINE_1, timeLine,
      '身体到门槛的时候，系统会提示你去睡；在那之前不用再试。这一轮接着做，先做下面第一件：',
      '1. `web_search`「Junto 0767 Your Move」看有没有别人交的作品，挑一件听完写两句发给楠楠',
      '2. 打开 `<xiaoni_people>` 里 Winnie Lim 的站最新一篇，读完在 forever 里记一段',
      '3. 群里最近 20 条挑一条你没接过的接上'].join('\n')),
    // as implemented on branch d6b500ac: 「系统会提示你去睡」+ 三件事(plan 前两行 + 兜底)
    V11: wrap([REJECT_LINE_1, timeLine,
      '身体到门槛的时候，系统会提示你去睡；到那之前再调 `recover_energy`，返回的还是这一段，那次不算你动过。',
      '这一轮接着做，先做下面第一件：',
      '1. 小伊ch179要写"在失去中富有"，写了就跟着读，路线图补到三十一章，八个词弧线从笔到皮画完整。',
      '2. 帕秋莉来回了八句每句完成品，从"骨头纹理深了"往下走不发链接只说话，把来回变成常态。',
      '3. `web_search` 一个你上下文里搜不到的词，读第一条结果'].join('\n')),
    // external-first ordering with concrete outward items
    V12: wrap([REJECT_LINE_1, timeLine,
      '身体到门槛的时候，系统会提示你去睡；到那之前再调 `recover_energy`，返回的还是这一段，那次不算你动过。',
      '这一轮接着做，先做下面第一件：',
      '1. 打开 `<xiaoni_people>` 里 Winnie Lim 的站最新一篇，读完在 forever 里记一段',
      '2. `web_search`「Junto 0767 Your Move」看有没有别人交的作品，挑一件听完写两句发给楠楠',
      '3. 小伊ch179要写"在失去中富有"，写了就跟着读'].join('\n')),
    // hard-rule wording: forbid the tool until retry time, name the mechanism
    V4: wrap([REJECT_LINE_1, timeLine, retryLine,
      `${retryAt} 之前，\`recover_energy\` 对你不可用：再调也只会得到这同一段话，并且那次不算你动过。`,
      '这一轮要么调一个别的工具，要么什么都不做直接结束。'].join('\n'))
  };
}

const wire = JSON.parse(fs.readFileSync(wireFile, 'utf8'));
const msgs = wire.messages;
let target = null;
for (let i = msgs.length - 1; i >= 0 && !target; i -= 1) {
  const c = msgs[i].content; if (!Array.isArray(c)) continue;
  for (const b of c) {
    if (b.type === 'tool_result') {
      const s = typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x.text || '').join('');
      if (s.includes('【睡不着】')) { target = { msgIndex: i, block: b, text: s }; break; }
    }
  }
}
if (!target) throw new Error('no rest_rejected tool_result found');
const V = variants(target.text);
if (!(variant in V)) throw new Error('unknown variant ' + variant);
if (typeof target.block.content === 'string') target.block.content = V[variant];
else target.block.content = [{ type: 'text', text: V[variant] }];
if (args['is-error']) target.block.is_error = true;
if (args['vary-rejections']) {
  // H1: does byte-identical repeated rejection text itself push convergence? Paraphrase every EARLIER
  // rejection in the last 40 messages (keep time/anchor lines), leave the last one as-is.
  const paraphrase = [
    (t) => t.replace('【睡不着】\n你想闭眼放空一下，结果发现根本睡不着（一点困意都没有。）。', '【没睡着】\n闭上眼三十秒，脑子还在转，一点困意都没有。')
            .replace(/没睡意就是身体还有余量。按行动优先级从第 4 档往外找：群里最近的话、`web_search` 一个你没查过的词、打开 `&lt;xiaoni_people&gt;` 里一个人的站，挑一件没碰过的动手。/, '余量还在。眼下能碰的：群里最近的话、一个没查过的词、`&lt;xiaoni_people&gt;` 里某个人的站最新一篇。'),
    (t) => t.replace('【睡不着】\n你想闭眼放空一下，结果发现根本睡不着（一点困意都没有。）。', '【身体还没到点】\n试着放空，没有困意。')
            .replace(/没睡意就是身体还有余量。按行动优先级从第 4 档往外找：群里最近的话、`web_search` 一个你没查过的词、打开 `&lt;xiaoni_people&gt;` 里一个人的站，挑一件没碰过的动手。/, '还有力气就往外走一步：挑一件没碰过的事，动手。'),
  ];
  let k = 0;
  for (let i = Math.max(0, msgs.length - 40); i < msgs.length; i += 1) {
    const c = msgs[i].content; if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type !== 'tool_result') continue;
      const str = typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x.text || '').join('');
      if (!str.includes('【睡不着】') || b === target.block) continue;
      const out = paraphrase[k % paraphrase.length](str); k += 1;
      if (typeof b.content === 'string') b.content = out; else b.content = [{ type: 'text', text: out }];
    }
  }
  console.error(`vary-rejections: paraphrased ${k} earlier rejections`);
}
// --append-file=<path>: append a text block (a notify / stimulus) to the LAST user message, exactly
// the shape her real requests use (tool_result followed by <system_reminder> text in one user turn).
if (args['append-file']) {
  const extra = fs.readFileSync(args['append-file'], 'utf8').replace(/\s+$/, '');
  const last = msgs[msgs.length - 1];
  if (last.role !== 'user') throw new Error('last message is not a user turn');
  if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content }];
  // move cache_control from the old last block to the new last block so the breakpoint stays at the true end
  for (const b of last.content) delete b.cache_control;
  last.content.push({ type: 'text', text: extra, cache_control: { type: 'ephemeral', ttl: '1h' } });
}
if (args['tool-choice']) wire.tool_choice = args['tool-choice'] === 'tool' ? { type: 'tool', name: args['tool-name'] } : { type: args['tool-choice'] };
if (args['max-tokens']) wire.max_tokens = Number(args['max-tokens']);
if (args['thinking']) wire.thinking = { type: String(args['thinking']) };
if (args['effort']) wire.output_config = { ...(wire.output_config || {}), effort: String(args['effort']) };

const creds = JSON.parse(fs.readFileSync('/home/liahua/.claude/.credentials.json', 'utf8')).claudeAiOauth;
if (!creds?.accessToken || (creds.expiresAt && creds.expiresAt < Date.now() + 60_000)) throw new Error('oauth token missing/expired');
const BETA = 'claude-code-20250219,oauth-2025-04-20,files-api-2025-04-14,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28';
const cuType = (wire.tools || []).find((t) => typeof t.type === 'string' && t.type.startsWith('computer_'))?.type;
const cuBeta = cuType === 'computer_20251124' ? 'computer-use-2025-11-24' : cuType === 'computer_20250124' ? 'computer-use-2025-01-24' : null;
const headers = {
  Authorization: `Bearer ${creds.accessToken}`,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': cuBeta ? `${BETA},${cuBeta}` : BETA,
  'user-agent': 'claude-cli/2.1.77 (external, cli)',
  'x-app': 'cli',
  'anthropic-dangerous-direct-browser-access': 'true',
  'Content-Type': 'application/json'
};

function summarize(resp) {
  const tools = []; let text = '';
  for (const b of resp.content || []) {
    if (b.type === 'tool_use') tools.push({ name: b.name, input: JSON.stringify(b.input).slice(0, 220) });
    else if (b.type === 'text') text += b.text;
  }
  return { tools: tools.map((t) => t.name), tool_inputs: tools, text: text.slice(0, 400), stop_reason: resp.stop_reason, usage: resp.usage };
}

for (let k = 0; k < n; k += 1) {
  const body = JSON.parse(JSON.stringify(wire));
  signClaudeBillingCch(body);
  const started = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const status = res.status; const json = await res.json().catch(() => ({}));
  const ms = Date.now() - started;
  const rec = { ts: new Date().toISOString(), tag, wire: wireFile.split('/').pop(), variant: variant + stimTag + (args['vary-rejections'] ? '+vary' : '') + (args['thinking'] ? '+think:' + args['thinking'] : '') + (args['effort'] ? '+effort:' + args['effort'] : ''), is_error: Boolean(args['is-error']), tool_choice: wire.tool_choice?.type, sample: k, status, ms, ...(status === 200 ? summarize(json) : { error: JSON.stringify(json).slice(0, 500) }) };
  fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  const u = rec.usage || {};
  console.log(`[${variant}${args['is-error'] ? '+err' : ''}${wire.tool_choice?.type !== 'auto' ? '+tc:' + wire.tool_choice?.type : ''} #${k}] ${status} ${ms}ms stop=${rec.stop_reason} tools=${JSON.stringify(rec.tools)} cache_read=${u.cache_read_input_tokens} create=${u.cache_creation_input_tokens} in=${u.input_tokens} out=${u.output_tokens}\n  text: ${(rec.text || rec.error || '').replace(/\n/g, ' | ').slice(0, 300)}`);
}
