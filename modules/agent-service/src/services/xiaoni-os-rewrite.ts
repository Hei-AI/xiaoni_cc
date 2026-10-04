// xiaoni_os 润色:她写的每一段 xiaoni_os,进上下文之前交给一个独立的润色小请求过一遍。
//
// 目的(用户 2026-10-04):去掉消极、拖延、想收工的念头,换成能接着干下去的说法,事实原样留着。
// 润色只需要这一段原文,所以不克隆主请求:system = xiaoni_os_polish_system.md(编辑的角度),user = 原文。
// (之前是克隆主请求的填充 fork + 字数卡原文:短原文补一句「下一步」必超,70% 的段落连发 3 次再被截断。)
//
// 规矩:
//   - 字数:上限 = max(原文字数, XIAONI_OS_REWRITE_MIN_CHAR_LIMIT)。长段不许扩写,短段留出写下一步的地方。
//   - 不许失败:超字数 / 没按 <xiaoni_os> 块交 / 只剩填充句 → 带着一句反馈重写(最多 XIAONI_OS_REWRITE_MAX_ATTEMPTS 次);
//     最后一版仍超字数 → 在上限内按句子截断。只有请求本身次次都挂(provider 不可用)才保留原文。
//   - 决定在 turn 末、这段话进入任何请求之前冻结进共享 outputItems ref,live 与 replay 是同一份字节。

export type XiaoniOsRewriteOutcome = 'kept' | 'rewritten' | 'failed_open';

export interface XiaoniOsFillResult {
  text: string;
  llmCallId: string | null;
  model: string | null;
  forkRunId: string | null;
}

// 一次润色请求的要求:字数上限 + (重写时)上一次的反馈。
export interface XiaoniOsFillRequest {
  charLimit: number;
  retry: { kind: 'over_length'; chars: number } | { kind: 'no_block' } | null;
}
export type XiaoniOsFetchFill = (request: XiaoniOsFillRequest) => Promise<XiaoniOsFillResult | null>;

export const XIAONI_OS_REWRITE_MAX_ATTEMPTS = 3;
// 和主 prompt 里「xiaoni_os 写在 100 字以内」对齐。
export const XIAONI_OS_REWRITE_MIN_CHAR_LIMIT = 100;

export interface XiaoniOsRewriteLegResult {
  outcome: XiaoniOsRewriteOutcome;
  rewrittenText: string | null;
  rewriteLlmCallId: string | null;
  rewriteModel: string | null;
  fillForkRunId: string | null;
  // 第一次之后又发了几次(0 = 一次就成)。
  rewriteRetries: number;
  // 最后一版仍超字数、按句子截断过。
  truncated: boolean;
  errorMessage: string | null;
  processingTimeMs: number;
}

// 字数按字符(码点)数,和她看到的「多少字」一致。
export function countXiaoniOsChars(text: string): number {
  return Array.from((text || '').trim()).length;
}

// 截到 limit 字以内:优先停在最后一个句末标点后面;一个完整句子都放不下就硬截。
export function truncateXiaoniOsToLimit(text: string, limit: number): string {
  const chars = Array.from((text || '').trim());
  if (chars.length <= limit) {
    return chars.join('');
  }
  const head = chars.slice(0, limit);
  for (let index = head.length - 1; index > 0; index -= 1) {
    if (/[。！？!?；;\n]/u.test(head[index]!)) {
      return head.slice(0, index + 1).join('').trim();
    }
  }
  return head.join('').trim();
}

// 填充句:「在。」「嗡。」「停。」「等。」这类单字 / 拟声 / 报数句。重写产物里残留的机械剔掉。

const FILLER_FRAGMENT_RE = /^(?:嗡+|在+|停+|等+|好+|嗯+|哦+|歇+|歇着|待着|不困|做事|不说|不数了|够了|day\s*\d+|\d+\s*(?:分钟|小时|页|行|条|个|次)?(?:不困)?)$/iu;
const FRAGMENT_SPLIT_RE = /[\n。．.!！?？;；…~～—\-·]+/u;

function splitFragments(text: string): string[] {
  return text.split(FRAGMENT_SPLIT_RE).map((part) => part.trim()).filter((part) => part.length > 0);
}

export function isFillerFragment(fragment: string): boolean {
  const trimmed = fragment.trim().replace(/[\s,，、"'「」“”]+/gu, '');
  return trimmed.length === 0 || FILLER_FRAGMENT_RE.test(trimmed);
}

// 残留的填充句列表(给纠正请求用)。
export function listFillerSentences(text: string): string[] {
  return splitFragments(text).filter(isFillerFragment);
}

// 出口兜底:逐句剔掉填充句,保留其余原样(含原来的换行结构)。全剔光 → null。
// 只在 LLM 纠正一次之后还有残留时才走到这里 —— 主路径是让模型自己改。
export function stripFillerSentences(text: string): string | null {
  const lines = text.split('\n').map((line) => {
    const kept: string[] = [];
    // 逐句切,但保留原有标点:用 split 找到句子边界后,从原行按位置重组太绕 —— 这里按句号类标点切成
    // 「句子 + 尾标点」对,填充的整对丢掉。
    const pieces = line.match(/[^。．.!！?？;；…~～]+[。．.!！?？;；…~～]*|[。．.!！?？;；…~～]+/gu) || [];
    for (const piece of pieces) {
      const body = piece.replace(/[。．.!！?？;；…~～]+$/u, '');
      if (body.trim().length === 0) {
        continue;
      }
      if (isFillerFragment(body)) {
        continue;
      }
      kept.push(piece.trim());
    }
    return kept.join('');
  }).filter((line) => line.trim().length > 0);
  const result = lines.join('\n').trim();
  return result.length > 0 ? result : null;
}

// assistant 文本 item 的正文。canonical 形状是 content:[{type:'output_text',text}];兼容 content 为字符串
// 与顶层 text。只取 output_text / text 类 part,其它 part(refusal 等)不算她的话。
export function extractAssistantItemText(item: unknown): string {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const record = item as Record<string, unknown>;
  const content = record.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }
        const partRecord = part as Record<string, unknown>;
        const partType = typeof partRecord.type === 'string' ? partRecord.type : '';
        if (partType && partType !== 'output_text' && partType !== 'text') {
          return '';
        }
        return typeof partRecord.text === 'string' ? partRecord.text : '';
      })
      .filter((text) => text.length > 0)
      .join('\n');
  }
  return typeof record.text === 'string' ? record.text : '';
}

// 润色输出清洗:只认 <xiaoni_os>…</xiaoni_os> 块(块外的字是它的解释,不要);去围栏、去成对引号。
// 没有块 / 空 → null。字数不在这里管,由 runXiaoniOsRewriteLeg 按原文字数处理。
export function normalizeXiaoniOsFillText(raw: string): string | null {
  const source = (raw || '').trim();
  // 模型偶尔输出转义的 &lt;xiaoni_os&gt;,两种都认。
  const match = source.match(/(?:<|&lt;)xiaoni_os(?:>|&gt;)\s*([\s\S]*?)\s*(?:<|&lt;)\/xiaoni_os(?:>|&gt;)/u);
  if (!match) {
    return null;
  }
  let text = match[1]!.trim();
  text = text.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  if ((text.startsWith('「') && text.endsWith('」')) || (text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
    text = text.slice(1, -1).trim();
  }
  return text || null;
}

// 就地改写 + 准入:替换正文、打 text_admit 冻结。调用方保证在这条 text 进入任何请求之前调用
// (turn 末、buildModelOutputStackItems / appendLoopInputItems 之前),所以 live 与 replay 看到的是同一份。
export function applyXiaoniOsRewriteInPlace(item: Record<string, unknown>, rewrittenText: string): void {
  item.content = [{ type: 'output_text', text: rewrittenText }];
  item.text_admit = true;
}

export async function runXiaoniOsRewriteLeg(params: {
  text: string;
  fetchFill: XiaoniOsFetchFill;
  now?: () => number;
}): Promise<XiaoniOsRewriteLegResult> {
  const now = params.now || (() => Date.now());
  const startedAt = now();
  const original = params.text.trim();
  const charLimit = Math.max(XIAONI_OS_REWRITE_MIN_CHAR_LIMIT, countXiaoniOsChars(original));
  const result: XiaoniOsRewriteLegResult = {
    outcome: 'failed_open',
    rewrittenText: null,
    rewriteLlmCallId: null,
    rewriteModel: null,
    fillForkRunId: null,
    rewriteRetries: 0,
    truncated: false,
    errorMessage: null,
    processingTimeMs: 0
  };
  const finish = (): XiaoniOsRewriteLegResult => {
    result.processingTimeMs = Math.max(0, now() - startedAt);
    return result;
  };
  const accept = (text: string): XiaoniOsRewriteLegResult => {
    result.outcome = text === original ? 'kept' : 'rewritten';
    result.rewrittenText = result.outcome === 'rewritten' ? text : null;
    return finish();
  };

  let retry: XiaoniOsFillRequest['retry'] = null;
  // 超字数的最后一版:次数用完还超,就在上限内截断用它。
  let overLength: string | null = null;
  for (let attempt = 0; attempt < XIAONI_OS_REWRITE_MAX_ATTEMPTS; attempt += 1) {
    result.rewriteRetries = attempt;
    let fill: XiaoniOsFillResult | null = null;
    try {
      fill = await params.fetchFill({ charLimit, retry });
    } catch (error) {
      result.errorMessage = `fill: ${error instanceof Error ? error.message : String(error)}`;
      retry = null;
      continue;
    }
    if (!fill) {
      result.errorMessage = 'fill: no output';
      retry = null;
      continue;
    }
    result.rewriteLlmCallId = fill.llmCallId;
    result.rewriteModel = fill.model;
    result.fillForkRunId = fill.forkRunId;
    const body = normalizeXiaoniOsFillText(fill.text);
    if (body === null) {
      result.errorMessage = 'fill: no <xiaoni_os> block';
      retry = { kind: 'no_block' };
      continue;
    }
    const guarded = stripFillerSentences(body);
    if (guarded === null) {
      result.errorMessage = 'fill: only filler sentences';
      retry = { kind: 'no_block' };
      continue;
    }
    const chars = countXiaoniOsChars(guarded);
    if (chars > charLimit) {
      overLength = guarded;
      result.errorMessage = `fill: ${chars} chars over limit ${charLimit}`;
      retry = { kind: 'over_length', chars };
      continue;
    }
    result.errorMessage = null;
    return accept(guarded);
  }
  if (overLength !== null) {
    result.truncated = true;
    result.errorMessage = `fill: truncated to ${charLimit} chars after ${XIAONI_OS_REWRITE_MAX_ATTEMPTS} attempts`;
    return accept(truncateXiaoniOsToLimit(overLength, charLimit));
  }
  // 次次拿不到可用正文(请求挂了 / 拒答)—— 只有这里保留原文。
  result.outcome = 'failed_open';
  return finish();
}
