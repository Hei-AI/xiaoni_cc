// 她常驻上下文里那三张菜单的读取。**唯一**一份。
//
// 真库实测(2026-08-19,近 3 天 5631/5631 次请求):`<xiaoni_status>`、
// `<xiaoni_diary_index>`、`<xiaoni_people>` 100% 出现在她的每一次请求里。
// 菜单已经点到的事,她看一眼就想得起来 —— 那不是「她不知道自己做过」,不该再召回一遍。
//
// 读的是**菜单的来源文件**而不是渲染后的块:两边的比较都是语义/文本级的,不需要逐字一致。
// 两条腿用法不同但料相同:向量腿把它逐行嵌成向量走语义式在场排除;扫描腿把正文接进
// contextText 走文本包含。所以读取收口在这里,不在两处各写一遍(code review 指出的
// Duplicated Code —— admin-backend 侧有一份几乎相同的实现)。

import fs from 'node:fs/promises';
import path from 'node:path';

export const DIARY_INDEX_FILE_RE = /^INDEX([-.]|$)/i;

async function readIfExists(absolutePath: string): Promise<string | null> {
  try {
    return await fs.readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

/** 三张菜单的正文,一份一条。读不到的静默跳过 —— 少一层信号,不阻断。 */
export async function readContextMenuTexts(runtimeRoot: string): Promise<string[]> {
  const out: string[] = [];

  // 日记目录是分层的(顶层 INDEX.md + 月度 INDEX-<YYYY-MM>.md),按前缀全收。
  try {
    const dir = path.join(runtimeRoot, 'notes/diary');
    for (const name of await fs.readdir(dir)) {
      if (DIARY_INDEX_FILE_RE.test(name) && /\.(md|txt)$/i.test(name)) {
        const text = await readIfExists(path.join(dir, name));
        if (text) out.push(text);
      }
    }
  } catch {
    // 目录还没建
  }

  const people = await readIfExists(path.join(runtimeRoot, 'notes/people/INDEX.md'));
  if (people) out.push(people);

  // 近况:compress 目录下最新的一份(脚本每轮起一个全新文件名)。
  try {
    const dir = path.join(runtimeRoot, 'compress');
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.md')).sort();
    const latest = names[names.length - 1];
    if (latest) {
      const text = await readIfExists(path.join(dir, latest));
      if (text) out.push(text);
    }
  } catch {
    // 还没压缩过
  }

  return out.filter((d) => d.trim().length > 0);
}
