import test from 'node:test';
import assert from 'node:assert/strict';
import { stripExecCommandComments, stripExecCommandCommentsInCanonicalResponse } from '../services/exec-command-comments';

// exec_command 注释剥离(2026-08-28):整行 # 注释在执行 / stack / 下一轮上下文之前被删掉;
// heredoc 体、引号串里的 # 是内容,不能动;shebang 不动。

test('顶部的独白注释块被整块删掉,命令本体不动', () => {
  const cmd = '# 不困。但plan里每一件都做过了。\n# 下一个做什么？\n# 从alive 750长出来的：一条街上两种秋天。\nls /xiaoni-runtime/site | head';
  const r = stripExecCommandComments(cmd);
  assert.equal(r.cmd, 'ls /xiaoni-runtime/site | head');
  assert.equal(r.removedLines, 3);
});

test('命令之间的注释也删;缩进的注释也删;没有 # 的命令原样返回(同一引用语义:字符串相等)', () => {
  const r = stripExecCommandComments('cd /tmp\n  # 看看有什么\nls\n# 完了\n');
  assert.equal(r.cmd, 'cd /tmp\nls\n');
  assert.equal(r.removedLines, 2);
  assert.deepEqual(stripExecCommandComments('echo hi'), { cmd: 'echo hi', removedLines: 0, removed: [] });
});

test('heredoc 体内的 # 是文件内容,一行不动(带引号 / 不带引号 / <<- 三种写法)', () => {
  const md = "# 想法\ncat > /x/a.md <<'EOF'\n# 标题\n## 小节\n正文 # 不是注释\nEOF\n# 写完了";
  const r = stripExecCommandComments(md);
  assert.equal(r.cmd, "cat > /x/a.md <<'EOF'\n# 标题\n## 小节\n正文 # 不是注释\nEOF");
  assert.equal(r.removedLines, 2);
  const plain = 'cat <<EOF\n# keep\nEOF\n# drop';
  assert.equal(stripExecCommandComments(plain).cmd, 'cat <<EOF\n# keep\nEOF');
  const dash = 'cat <<-END\n\t# keep\n\tEND\n# drop';
  assert.equal(stripExecCommandComments(dash).cmd, 'cat <<-END\n\t# keep\n\tEND');
});

test('多行引号串里的 # 不动(python -c 里的注释是 python 的事)', () => {
  const cmd = 'python3 -c "\n# python comment\nprint(1)\n"\n# shell comment';
  const r = stripExecCommandComments(cmd);
  assert.equal(r.cmd, 'python3 -c "\n# python comment\nprint(1)\n"');
  assert.equal(r.removedLines, 1);
});

test('shebang 与行中尾注不动', () => {
  const cmd = '#!/bin/bash\necho a # 尾注\n# 整行注释';
  assert.equal(stripExecCommandComments(cmd).cmd, '#!/bin/bash\necho a # 尾注');
});

test('canonical_response 就地改:只动 exec_command 的 arguments,记 call_id → 删掉行数;没注释的不动', () => {
  const canonical = {
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '在。' }] },
      { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: JSON.stringify({ cmd: '# 嗡。\n\necho "嗡。"', max_output_tokens: 3 }) },
      { type: 'function_call', call_id: 'c2', name: 'exec_command', arguments: JSON.stringify({ cmd: 'ls' }) },
      { type: 'function_call', call_id: 'c3', name: 'read_file', arguments: JSON.stringify({ path: '# not a cmd' }) }
    ]
  };
  const stripped = stripExecCommandCommentsInCanonicalResponse(canonical);
  assert.deepEqual([...stripped.entries()], [['c1', 1]]);
  assert.deepEqual(JSON.parse((canonical.output[1] as { arguments: string }).arguments), { cmd: '\necho "嗡。"', max_output_tokens: 3 }, '键序保持,只有 cmd 变了');
  assert.equal((canonical.output[2] as { arguments: string }).arguments, JSON.stringify({ cmd: 'ls' }), '没注释的 arguments 字节不变');
  assert.equal((canonical.output[3] as { arguments: string }).arguments, JSON.stringify({ path: '# not a cmd' }));
});
