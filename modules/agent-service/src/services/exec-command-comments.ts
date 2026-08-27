// exec_command 注释剥离(2026-08-28 用户拍板:禁止她用 exec_command 写注释,要「引导」)。
//
// prompt 禁令已经证明没用(08-23 上线后注释率 67.6%→76.1%)——因为注释是代偿:function_call 参数原样回放,
// 那是她唯一能被下一轮自己看到的地方。所以引导不能只靠说,要让通道**物理上失效**:
//   turn 末、在这条 function_call 进入执行 / stack / 下一轮上下文之前,把 `cmd` 里的整行 `#` 注释删掉。
//   → 执行的是没有注释的命令(bash 里注释本来就是空操作,行为不变);
//   → stack 与 live requestInput 拿到的是同一份删过的参数(与 text_admit 同一落点,双缓存一致);
//   → 下一轮她看不到自己的注释 —— 写了等于没写;
//   → 这条命令的工具结果末尾附一句固定的纠正(exec_command_comment_stripped.md),告诉她删了几行、去哪写。
// 她的原文仍在 provider 写的 llm_request_slices.canonical_response 里,可观测、可回溯。
//
// 只删「整行注释」:行首(可有空白)是 `#`,且不在 heredoc 体内、不在未闭合的引号里。
//   - heredoc(`<<EOF` / `<<'EOF'` / `<<-EOF`)体内的 `#` 是文件内容(她写 markdown / html / python 都靠它),动了会毁文件;
//   - 多行引号串里的 `#`(python -c "..." 里的注释)是别的语言的内容,同样不动;
//   - `#!` shebang 不动;行中间的 `# 尾注`不动(解析成本高、她几乎不这么写)。

export interface StripExecCommandCommentsResult {
  cmd: string;
  removedLines: number;
  removed: string[];
}

const HEREDOC_RE = /<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g;
const FULL_LINE_COMMENT_RE = /^\s*#(?!!)/u;

// 扫一行,更新「行末是否仍在引号里」的状态。只认最简单的 ' 和 "(不处理 $'…' / 反引号嵌套)。
function scanQuoteState(line: string, inQuote: '' | "'" | '"'): '' | "'" | '"' {
  let state = inQuote;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (state === '') {
      if (ch === '\\') {
        index += 1;
        continue;
      }
      if (ch === '#') {
        // 引号外的 # 到行尾都是注释,后面的引号不算
        break;
      }
      if (ch === "'" || ch === '"') {
        state = ch;
      }
    } else if (state === '"') {
      if (ch === '\\') {
        index += 1;
        continue;
      }
      if (ch === '"') {
        state = '';
      }
    } else if (ch === "'") {
      state = '';
    }
  }
  return state;
}

export function stripExecCommandComments(rawCmd: unknown): StripExecCommandCommentsResult {
  const cmd = typeof rawCmd === 'string' ? rawCmd : '';
  if (!cmd.includes('#')) {
    return { cmd, removedLines: 0, removed: [] };
  }
  const lines = cmd.split('\n');
  const kept: string[] = [];
  const removed: string[] = [];
  const pendingHeredocs: Array<{ delimiter: string; stripTabs: boolean }> = [];
  let activeHeredoc: { delimiter: string; stripTabs: boolean } | null = null;
  let inQuote: '' | "'" | '"' = '';

  for (const line of lines) {
    if (activeHeredoc) {
      kept.push(line);
      const probe = activeHeredoc.stripTabs ? line.replace(/^\t+/u, '') : line;
      if (probe === activeHeredoc.delimiter) {
        activeHeredoc = pendingHeredocs.shift() || null;
      }
      continue;
    }
    if (inQuote === '' && FULL_LINE_COMMENT_RE.test(line)) {
      removed.push(line);
      continue;
    }
    kept.push(line);
    // 这一行(引号外)有没有开 heredoc —— 有就从下一行起进入 heredoc 体。
    if (inQuote === '') {
      HEREDOC_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      const opened: Array<{ delimiter: string; stripTabs: boolean }> = [];
      while ((match = HEREDOC_RE.exec(line)) !== null) {
        const delimiter = match[1] ?? match[2] ?? match[3] ?? '';
        if (delimiter) {
          opened.push({ delimiter, stripTabs: match[0].startsWith('<<-') });
        }
      }
      if (opened.length > 0) {
        activeHeredoc = opened[0]!;
        pendingHeredocs.push(...opened.slice(1));
        continue;
      }
    }
    inQuote = scanQuoteState(line, inQuote);
  }
  return { cmd: kept.join('\n'), removedLines: removed.length, removed };
}

// 就地改 canonical_response.output 里的 exec_command function_call:arguments 是 JSON 字符串,
// 解析 → 剥 cmd 注释 → 有改动才重新序列化(保持原键序)。返回 call_id → 删掉的行数(只含真删过的)。
// 调用时机:extractCanonicalResponseOutputItems 之前 —— 执行路由、stack ledger、live requestInput
// 三处都从这份 canonical_response 派生,改一处三处同源。
export function stripExecCommandCommentsInCanonicalResponse(
  canonicalResponse: unknown,
  toolName = 'exec_command'
): Map<string, number> {
  const stripped = new Map<string, number>();
  const output = canonicalResponse && typeof canonicalResponse === 'object'
    ? (canonicalResponse as { output?: unknown }).output
    : null;
  if (!Array.isArray(output)) {
    return stripped;
  }
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.type !== 'function_call' || record.name !== toolName || typeof record.arguments !== 'string') {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(record.arguments);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      parsed = value as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof parsed.cmd !== 'string') {
      continue;
    }
    const result = stripExecCommandComments(parsed.cmd);
    if (result.removedLines === 0) {
      continue;
    }
    parsed.cmd = result.cmd;
    record.arguments = JSON.stringify(parsed);
    const callId = typeof record.call_id === 'string' ? record.call_id : null;
    if (callId) {
      stripped.set(callId, result.removedLines);
    }
  }
  return stripped;
}
