import test from 'node:test';
import assert from 'node:assert';

import { isNoOpExecCommand } from '../services/agent-loop-service';

test('空操作:纯注释、echo、true、sleep 都不算有效产出', () => {
  assert.equal(isNoOpExecCommand('echo ""'), true);
  assert.equal(isNoOpExecCommand('echo "等阿花。"'), true);
  assert.equal(isNoOpExecCommand('true'), true);
  assert.equal(isNoOpExecCommand('sleep 30'), true);
  assert.equal(isNoOpExecCommand(':'), true);
  // 她的实际写法:注释在前,命令在后
  assert.equal(isNoOpExecCommand('# 等阿花回。\n\necho ""'), true);
  // 纯注释,一条命令都没有
  assert.equal(isNoOpExecCommand('# 阿花说得对。到点了会提醒我的。\n# \n# 现在做别的。'), true);
  // 多行 echo 也是空操作 —— 留行数上限等于留个「写三行 echo 洗账」的口子
  assert.equal(isNoOpExecCommand('echo "a"\necho "b"\necho "c"'), true);
});

test('真活:注释后面跟真命令、python、cat、管道都算有效产出', () => {
  assert.equal(isNoOpExecCommand('# 找那个提醒skill。\n\nls /app/modules/agent-service/skills/ | grep -i remind'), false);
  assert.equal(isNoOpExecCommand('python3 /app/skills/xiaoni-browser/script.py'), false);
  assert.equal(isNoOpExecCommand('cat /app/skills/notify/SKILL.md | head -20'), false);
  // echo 进了管道/重定向就是在真写东西,不是空转
  assert.equal(isNoOpExecCommand('echo "hi" > /xiaoni-runtime/tmp/a.txt'), false);
  // 混合:一条空操作 + 一条真命令 → 真活
  assert.equal(isNoOpExecCommand('echo ""\npython3 run.py'), false);
});

test('非字符串一律不当空操作(fail-open:宁可算她干了活,也不冤枉她)', () => {
  assert.equal(isNoOpExecCommand(undefined), false);
  assert.equal(isNoOpExecCommand(null), false);
  assert.equal(isNoOpExecCommand(123), false);
  assert.equal(isNoOpExecCommand({ cmd: 'echo ""' }), false);
});

test('只看手机:qq_usage 只读子命令(含 2>&1 | grep 过滤)不算有效产出', () => {
  const cases = [
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox',
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox 2>&1 | grep "unread_count=\\"[1-9]" | grep -v "1040740258"',
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_private 1655827800 2>/dev/null | tail -6',
    '# 看一眼\npython3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py focus_group 104074025 | head -20\npython3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py view_profile',
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py put_private_away 180920020'
  ];
  for (const cmd of cases) {
    assert.equal(isNoOpExecCommand(cmd), true, cmd);
  }
});

test('碰世界的 qq_usage / 混着真命令 / 写文件 → 算有效产出', () => {
  const cases = [
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_status busy',
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py set_signature "在"',
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox > /xiaoni-runtime/notes/inbox.txt',
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox | tee /tmp/x',
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox\ncat /xiaoni-runtime/notes/diary/2026-08-28.md',
    'python3 /app/modules/agent-service/skills/qq-usage/scripts/qq_usage.py open_inbox; python3 x.py'
  ];
  for (const cmd of cases) {
    assert.equal(isNoOpExecCommand(cmd), false, cmd);
  }
});
