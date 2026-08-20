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
