const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyRuntimePath,
  extractPassiveRecallCueFromActionStreamItem,
  extractRuntimePaths
} = require('../xiaoni-passive-recall-extractor');

test('passive recall extractor treats qq_usage exec_command as a transient cue only', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'tool-exec:qq-1',
    source: 'tool_execution',
    kind: 'exec_command',
    title: 'tool: exec_command',
    body: '<IM_INBOX_WINDOW>用户说：我今天看了一部电影</IM_INBOX_WINDOW>',
    timestamp: '2026-06-24T12:00:00.000Z',
    metadata: {
      toolName: 'exec_command',
      toolArgumentsPreview: JSON.stringify({
        cmd: 'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_private 2294133947'
      }),
      toolResultPreview: '<IM_INBOX_WINDOW>用户说：我今天看了一部电影</IM_INBOX_WINDOW>'
    },
    tags: [
      { key: 'source:tool_execution' },
      { key: 'tool:exec_command' }
    ]
  });

  assert.equal(cue.cueClass, 'db_life_cue');
  assert.equal(cue.memoryCandidate, null);
  assert.deepEqual(cue.qqUsage, {
    mode: 'focus_private',
    peerId: '2294133947'
  });
  assert.ok(cue.features.includes('skill:qq_usage'));
  assert.ok(cue.features.includes('im:focus_private'));
  assert.ok(cue.features.includes('peer:2294133947'));
  assert.match(cue.safeEmbeddingText, /xiaoni qq usage cue/);
  assert.doesNotMatch(cue.safeEmbeddingText, /我今天看了一部电影/);
});

test('passive recall extractor detects whitelisted Xiaoni runtime file writes', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'tool-exec:file-1',
    source: 'tool_execution',
    kind: 'exec_command',
    title: 'tool: exec_command',
    timestamp: '2026-06-24T12:05:00.000Z',
    metadata: {
      toolName: 'exec_command',
      toolArgumentsPreview: JSON.stringify({
        cmd: "cat > /xiaoni-runtime/notes/2026-06-24/iron-fist-education-first-watch-card.md <<'EOF'\n# card\nEOF"
      })
    },
    tags: [
      { key: 'source:tool_execution' },
      { key: 'tool:exec_command' }
    ]
  });

  assert.equal(cue.cueClass, 'db_file_provenance');
  assert.equal(cue.memoryCandidate, 'file_memory');
  assert.equal(cue.runtimePaths.length, 1);
  assert.equal(cue.runtimePaths[0].path, '/xiaoni-runtime/notes/2026-06-24/iron-fist-education-first-watch-card.md');
  assert.equal(cue.runtimePaths[0].runtimeDir, 'notes');
  assert.equal(cue.runtimePaths[0].indexable, true);
  assert.equal(cue.runtimePaths[0].operation, 'write');
  assert.ok(cue.features.includes('runtime_dir:notes'));
  assert.ok(cue.features.includes('file_op:write'));
  assert.match(cue.safeEmbeddingText, /iron fist education first watch card/);
});

test('passive recall extractor omits runtime directories from returned cue paths', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'tool-exec:file-dir-1',
    source: 'tool_execution',
    kind: 'exec_command',
    timestamp: '2026-06-24T12:07:00.000Z',
    metadata: {
      toolName: 'exec_command',
      toolArgumentsPreview: JSON.stringify({
        cmd: "mkdir -p /xiaoni-runtime/notes/2026-06-24 && cat > /xiaoni-runtime/notes/2026-06-24/card.md <<'EOF'\n# card\nEOF"
      })
    },
    tags: [{ key: 'source:tool_execution' }]
  });

  assert.equal(cue.cueClass, 'db_file_provenance');
  assert.deepEqual(cue.runtimePaths.map((entry) => entry.path), [
    '/xiaoni-runtime/notes/2026-06-24/card.md'
  ]);
});

test('passive recall extractor treats Xiaoni visible sends as scoped spoken fragments', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'life:42',
    source: 'life_event',
    kind: 'qq_self_message',
    title: '发出消息',
    body: '我刚又看了下，停在第一集 5 分多钟那里。',
    timestamp: '2026-06-24T12:10:00.000Z',
    tags: [
      { key: 'source:life_event' },
      { key: 'event:visible_delivery_committed' }
    ]
  });

  assert.equal(cue.cueClass, 'db_spoken_fragment');
  assert.equal(cue.memoryCandidate, 'spoken_fragment');
  assert.equal(cue.privacyScope, 'self_private');
  assert.match(cue.safeEmbeddingText, /xiaoni spoken fragment/);
  assert.match(cue.safeEmbeddingText, /停在第一集 5 分多钟/);
});

test('passive recall extractor skips operational traces as candidate cues', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'llm-slice:slice_1',
    source: 'llm_request',
    kind: 'llm_request_slice',
    title: 'LLM 请求',
    body: 'provider wire payload',
    timestamp: '2026-06-24T12:15:00.000Z',
    tags: [{ key: 'source:llm_request' }]
  });

  assert.equal(cue, null);
});

test('passive recall extractor skips generic lifecycle events without recall-bearing terms', () => {
  const cue = extractPassiveRecallCueFromActionStreamItem({
    id: 'life:24680',
    source: 'life_event',
    kind: 'phone_notification',
    title: '手机 QQ 通知',
    timestamp: '2026-06-24T12:16:00.000Z',
    tags: [
      { key: 'source:life_event' },
      { key: 'event:phone_notification' }
    ]
  });

  assert.equal(cue, null);
});

test('runtime path classifier excludes generated and media paths', () => {
  assert.equal(classifyRuntimePath('/xiaoni-runtime/notes/a.md').indexable, true);
  assert.equal(classifyRuntimePath('/home/liahua/.qqbot-local/xiaoni-runtime/reading/book/card.md').path, '/xiaoni-runtime/reading/book/card.md');
  assert.equal(classifyRuntimePath('/xiaoni-runtime/notes/2026-06-24').indexable, false);
  assert.equal(classifyRuntimePath('/xiaoni-runtime/picture/a.png').indexable, false);
  assert.equal(classifyRuntimePath('/xiaoni-runtime/toys/demo/dist/index.html').indexable, false);

  const paths = extractRuntimePaths('cat /xiaoni-runtime/notes/a.md && cat /xiaoni-runtime/notes/a.md');
  assert.equal(paths.length, 1);
});

test('normalizeRecallText:剥样板/脚手架,留信号(闲聊+她真plan不动)', () => {
  const { normalizeRecallText } = require('../xiaoni-passive-recall-extractor');
  // 纯工具输出 → 废
  assert.strictEqual(normalizeRecallText('External URLs ignored.\nGenerated by /x/check_markdown_local_paths.py.'), '');
  assert.strictEqual(normalizeRecallText('Markdown local path check — actual 2026-06-17\nsource: /x'), '');
  // system_reminder 注入模板 → 整块移除
  assert.strictEqual(normalizeRecallText('当前输入 <system_reminder> 模板文 xxx </system_reminder>'), '');
  // xiaoni_plan 包壳 → 剥壳留她真 plan
  assert.strictEqual(
    normalizeRecallText('当前输入 <xiaoni_plan> 歇了一下，脑子里冒出来接下来想干嘛的念头（要不要照做随你）： 去把ch86读了'),
    '去把ch86读了'
  );
  // 闲聊 = 信号,原样
  assert.strictEqual(normalizeRecallText('兄弟对面少个人'), '兄弟对面少个人');
  assert.strictEqual(normalizeRecallText(''), '');
  assert.strictEqual(normalizeRecallText(null), '');
});
