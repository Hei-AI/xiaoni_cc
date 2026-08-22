'use strict';

// 三个服务 Dockerfile 的 persistence COPY allowlist,必须覆盖 index.js 真正 require 的
// 每一个文件。
//
// 这是本仓库的**历史事故**(见 CLAUDE.md / reference_persistence_dockerfile_allowlist):
// 新增一个 packages/persistence 文件而忘了同步三个 Dockerfile 的 COPY 白名单 →
// 镜像里少那个文件 → 容器起来就 MODULE_NOT_FOUND 崩掉。
//
// 本地跑测试**发现不了**这个:本地 require 走的是真实目录,文件当然在。
// 只有构建镜像才现形,而那时已经在部署路径上了。所以静态核对。
//
// 逐条 COPY 行分别核对,不是把整个文件的匹配并起来 —— Dockerfile 里有多个 stage
// (deps / prod-deps),任一条漏了那个 stage 的镜像就少文件。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PERSISTENCE_INDEX = path.join(REPO_ROOT, 'packages/persistence/index.js');
const DOCKERFILES = [
  'modules/agent-service/Dockerfile',
  'modules/admin-panel/backend/Dockerfile',
  'modules/provider-service/Dockerfile'
];

function requiredPersistenceFiles() {
  const source = fs.readFileSync(PERSISTENCE_INDEX, 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/require\('\.\/([a-z0-9-]+)'\)/g)) {
    names.add(`${match[1]}.js`);
  }
  return [...names].sort();
}

test('index.js 至少 require 了一批 persistence 文件(断言本身没失效)', () => {
  const files = requiredPersistenceFiles();
  assert.ok(files.length > 20, `只解析到 ${files.length} 个,正则大概率已经失配`);
  // 本分支新增的那个必须在里面,否则下面的覆盖断言对它是空转
  assert.ok(files.includes('xiaoni-goal.js'), 'xiaoni-goal.js 应当被 index.js require');
});

for (const dockerfile of DOCKERFILES) {
  test(`${dockerfile} 的每一条 COPY 行都覆盖了 index.js require 的全部文件`, () => {
    const full = path.join(REPO_ROOT, dockerfile);
    const text = fs.readFileSync(full, 'utf8');
    const required = requiredPersistenceFiles();

    const copyLines = text
      .split('\n')
      .filter((line) => line.startsWith('COPY packages/persistence/index.js'));
    assert.ok(
      copyLines.length > 0,
      '没找到 persistence 的 COPY 行 —— Dockerfile 结构变了,这条断言需要跟着改'
    );

    copyLines.forEach((line, i) => {
      const listed = new Set([...line.matchAll(/packages\/persistence\/([a-z0-9-]+\.js)/g)].map((m) => m[1]));
      const missing = required.filter((name) => !listed.has(name));
      assert.deepEqual(
        missing,
        [],
        `第 ${i + 1} 条 COPY 行漏了 ${missing.join(', ')} —— 该 stage 的镜像会 MODULE_NOT_FOUND`
      );
    });
  });
}
