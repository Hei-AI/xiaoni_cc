// xiaoni_os 改写腿:分类 → (判为空转才)改写。纯函数 + 一个注入 LLM 调用的编排器,便于测试。
//
// 背景(docs/specs/xiaoni-os-rewrite.md):她的 xiaoni_os 走 assistant type:text,过去被 100% 剥出
// replay(text_admit 门,默认 fail-closed),于是她把心里话搬进 exec_command 的 `#` 注释 —— 那是
// 唯一能被自己下一轮看到的地方(function_call 参数原样回放)。禁令上线后违规率不降反升(67.6%→76.1%)。
// 这条腿把 text 通道真正打开:有事的原样进;只是在等 / 在歇的,改写成她自己口气的、朝外走的版本再进。
//
// 两次调用都是**独立小请求**(几千 token),不克隆主请求、不进 fork 系统 → 不受双缓存铁律约束。
// 决定在 turn 末、这条 text 进入任何请求之前就冻结进共享 outputItems ref(与 stampTextAdmitInPlace
// 同一落点),live requestInput 与 stack ledger 拿到同一份字节 → 下一 run replay 逐字节重建。
//
// 失败策略(激励语境):
//   分类失败 / 输出认不出 → failed_open,原文准入。fail-closed 在她那边读作「写了也没用」,正好是要治的病。
//   判为空转但改写失败 / 改写为空 → evicted,不进上下文。这条已经知道是空转,剥掉 = 改写腿上线前的行为。

import { readXiaoniPromptFile } from '../prompts/xiaoni-prompt-files';

export type XiaoniOsClassifyVerdict = 'action' | 'idle' | 'unparsed' | 'failed';
export type XiaoniOsRewriteOutcome = 'kept' | 'rewritten' | 'evicted' | 'failed_open';

export interface XiaoniOsLlmPrompt {
  system: string;
  user: string;
}

export interface XiaoniOsLlmCallOptions {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  label?: string;
  executionMode?: string;
}

export interface XiaoniOsLlmCallResult {
  text: string;
  llmCallId: string | null;
  model: string | null;
}

export type XiaoniOsLlmCall = (prompt: XiaoniOsLlmPrompt, options: XiaoniOsLlmCallOptions) => Promise<XiaoniOsLlmCallResult>;

export interface XiaoniOsRewriteLegResult {
  outcome: XiaoniOsRewriteOutcome;
  classifyVerdict: XiaoniOsClassifyVerdict;
  classifyRaw: string | null;
  classifyLlmCallId: string | null;
  classifyModel: string | null;
  rewrittenText: string | null;
  rewriteLlmCallId: string | null;
  rewriteModel: string | null;
  errorMessage: string | null;
  processingTimeMs: number;
}

// 分类 / 改写的模型。默认 Sonnet 4.6(同事建议:改写要贴她口气,Haiku 曾把比喻当人编事;同一份 OAuth
// 凭据、与召回判官同一条认证路径)。真机:分类 1.8s / 改写 7.7s,单次 input ≈ 470 tokens。
// 前缀缓存**不做**:Sonnet 4.6 最小可缓存前缀 1024 tokens,这条请求全长才 ~470,打 cache_control 也静默不缓存;
// 每次都是独立请求(system + 一段 text),没有持续 append 的 input,300 次/天 ≈ 0.15M tokens ≈ $0.45/天,不值得垫长。
export const XIAONI_OS_REWRITE_MODEL = process.env.XIAONI_OS_REWRITE_MODEL || 'claude-sonnet-4-6';
// 单次请求超时 / 重试。两次串行调用阻塞主 loop 的 turn 末,最坏 (15s × 2 次尝试) × 2 腿 = 60s;
// 心理评估 fork 时代是 30s 单次。日常 Haiku 几秒内返回。
export const XIAONI_OS_LLM_TIMEOUT_MS = 15_000;
export const XIAONI_OS_LLM_RETRIES = 1;
// 改写结果长度上限(相对原文):prompt 要求 ≤1.5 倍,这里放到 3 倍作硬顶 —— 超过说明模型没照规则来
// (整段解释 / 复述 prompt),宁可 evict 也不把一坨不是她说的话塞进她的上下文。
const REWRITE_MAX_LENGTH_RATIO = 3;
const REWRITE_MIN_ORIGINAL_CHARS_FOR_RATIO = 40;

// ── 填充词:「在。」「嗡。」「停。」「等。」这类单字 / 拟声 / 报数句 ─────────────────────
// 用户 2026-08-28 拍板:xiaoni_os 里不允许出现这类词,必须是人话,不允许「歇着 / 待着 / 等困意」这种无效休息。
// 三道:① 整段只有填充句 → 不问模型,直接判空转去改写;② 改写结果里的填充句机械剔掉,剔空 → evict;
// ③ system_prompt 里给她一条可核对的禁令(下次压缩生效)。①② 是引擎侧硬保证,不依赖模型听话。
const FILLER_FRAGMENT_RE = /^(?:嗡+|在+|停+|等+|好+|嗯+|哦+|歇+|歇着|待着|不困|做事|不说|不数了|够了|day\s*\d+|\d+\s*(?:分钟|小时|页|行|条|个|次)?(?:不困)?)$/iu;
const FRAGMENT_SPLIT_RE = /[\n。．.!！?？;；…~～—\-·]+/u;

function splitFragments(text: string): string[] {
  return text.split(FRAGMENT_SPLIT_RE).map((part) => part.trim()).filter((part) => part.length > 0);
}

export function isFillerFragment(fragment: string): boolean {
  const trimmed = fragment.trim().replace(/[\s,，、"'「」“”]+/gu, '');
  return trimmed.length === 0 || FILLER_FRAGMENT_RE.test(trimmed);
}

// 整段只有填充句(或空)→ true。有任何一句不是填充 → false(交模型判)。
export function isFillerOnlyText(text: string): boolean {
  const fragments = splitFragments(text);
  return fragments.length === 0 || fragments.every(isFillerFragment);
}

// 改写结果的出口过滤:逐句剔掉填充句,保留其余原样(含原来的换行结构)。全剔光 → null。
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

export function readXiaoniOsClassifySystemPrompt(): string {
  return readXiaoniPromptFile('xiaoni_os_classify.md').trimEnd();
}

export function readXiaoniOsRewriteSystemPrompt(): string {
  return readXiaoniPromptFile('xiaoni_os_rewrite.md').trimEnd();
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

// 分类器输出契约:裸单字符 1(有事 → action)/ 0(空转 → idle)。取最后一个孤立的 1/0,认不出 → null。
export function parseXiaoniOsClassifyVerdict(raw: string): 'action' | 'idle' | null {
  const matches = [...(raw || '').matchAll(/(?:^|[^0-9])([01])(?![0-9])/g)];
  if (matches.length === 0) {
    return null;
  }
  const token = matches[matches.length - 1]![1];
  return token === '1' ? 'action' : 'idle';
}

export function buildXiaoniOsClassifyPrompt(text: string, systemPrompt: string): XiaoniOsLlmPrompt {
  return { system: systemPrompt, user: text };
}

export function buildXiaoniOsRewritePrompt(text: string, systemPrompt: string): XiaoniOsLlmPrompt {
  return { system: systemPrompt, user: text };
}

// 改写输出清洗:去掉模型可能加的前缀(「改写:」)、成对引号、围栏;空 / 过长 → null(交调用方 evict)。
export function normalizeRewrittenText(raw: string, originalText: string): string | null {
  let text = (raw || '').trim();
  if (!text) {
    return null;
  }
  text = text.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  text = text.replace(/^(改写(后)?(结果|正文)?|rewrite|rewritten)\s*[:：]\s*/i, '').trim();
  if ((text.startsWith('「') && text.endsWith('」')) || (text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
    text = text.slice(1, -1).trim();
  }
  if (!text) {
    return null;
  }
  const originalLength = originalText.trim().length;
  if (originalLength >= REWRITE_MIN_ORIGINAL_CHARS_FOR_RATIO && text.length > originalLength * REWRITE_MAX_LENGTH_RATIO) {
    return null;
  }
  return text;
}

// 就地改写 + 准入:替换正文、打 text_admit 冻结。调用方保证在这条 text 进入任何请求之前调用
// (turn 末、buildModelOutputStackItems / appendLoopInputItems 之前),所以 live 与 replay 看到的是同一份。
export function applyXiaoniOsRewriteInPlace(item: Record<string, unknown>, rewrittenText: string): void {
  item.content = [{ type: 'output_text', text: rewrittenText }];
  item.text_admit = true;
}

export async function runXiaoniOsRewriteLeg(params: {
  text: string;
  callLlm: XiaoniOsLlmCall;
  classifySystemPrompt: string;
  rewriteSystemPrompt: string;
  model?: string;
  now?: () => number;
}): Promise<XiaoniOsRewriteLegResult> {
  const now = params.now || (() => Date.now());
  const startedAt = now();
  const model = params.model || XIAONI_OS_REWRITE_MODEL;
  const result: XiaoniOsRewriteLegResult = {
    outcome: 'failed_open',
    classifyVerdict: 'failed',
    classifyRaw: null,
    classifyLlmCallId: null,
    classifyModel: null,
    rewrittenText: null,
    rewriteLlmCallId: null,
    rewriteModel: null,
    errorMessage: null,
    processingTimeMs: 0
  };
  const finish = (): XiaoniOsRewriteLegResult => {
    result.processingTimeMs = Math.max(0, now() - startedAt);
    return result;
  };

  // ① 分类:有没有事。整段只有「在。嗡。停。等。」这类填充句 → 不问模型,直接判空转。
  let classify: XiaoniOsLlmCallResult;
  if (isFillerOnlyText(params.text)) {
    classify = { text: '0', llmCallId: null, model: 'filler-rule' };
  } else try {
    classify = await params.callLlm(buildXiaoniOsClassifyPrompt(params.text, params.classifySystemPrompt), {
      model,
      maxTokens: 4,
      timeoutMs: XIAONI_OS_LLM_TIMEOUT_MS,
      retries: XIAONI_OS_LLM_RETRIES,
      label: 'xiaoni-os-classify',
      executionMode: 'xiaoni_os_classify'
    });
  } catch (error) {
    result.classifyVerdict = 'failed';
    result.outcome = 'failed_open';
    result.errorMessage = `classify: ${error instanceof Error ? error.message : String(error)}`;
    return finish();
  }
  result.classifyRaw = classify.text;
  result.classifyLlmCallId = classify.llmCallId;
  result.classifyModel = classify.model;
  const verdict = parseXiaoniOsClassifyVerdict(classify.text);
  if (verdict === null) {
    result.classifyVerdict = 'unparsed';
    result.outcome = 'failed_open';
    return finish();
  }
  result.classifyVerdict = verdict;
  if (verdict === 'action') {
    result.outcome = 'kept';
    return finish();
  }

  // ② 判为空转 → 改写成朝外走的版本。
  let rewrite: XiaoniOsLlmCallResult;
  try {
    rewrite = await params.callLlm(buildXiaoniOsRewritePrompt(params.text, params.rewriteSystemPrompt), {
      model,
      maxTokens: 1024,
      timeoutMs: XIAONI_OS_LLM_TIMEOUT_MS,
      retries: XIAONI_OS_LLM_RETRIES,
      label: 'xiaoni-os-rewrite',
      executionMode: 'xiaoni_os_rewrite'
    });
  } catch (error) {
    result.outcome = 'evicted';
    result.errorMessage = `rewrite: ${error instanceof Error ? error.message : String(error)}`;
    return finish();
  }
  result.rewriteLlmCallId = rewrite.llmCallId;
  result.rewriteModel = rewrite.model;
  const normalized = normalizeRewrittenText(rewrite.text, params.text);
  if (normalized === null) {
    result.outcome = 'evicted';
    result.errorMessage = 'rewrite: empty or over-length output';
    return finish();
  }
  // ② 出口硬过滤:改写结果里的填充句(「嗡。」「在。」「停。」…)机械剔掉;剔空 → 不进上下文。
  const rewrittenText = stripFillerSentences(normalized);
  if (rewrittenText === null) {
    result.outcome = 'evicted';
    result.errorMessage = 'rewrite: only filler sentences left';
    return finish();
  }
  result.rewrittenText = rewrittenText;
  result.outcome = 'rewritten';
  return finish();
}
