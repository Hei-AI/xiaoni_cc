// 召回侧小模型调用的**唯一**出口。
//
// query 展开和投递闸判官是两件不同的事,但它们和模型之间的接口是同一个:
// 走 provider-service 的 /api/internal/llm/debug(支持 model 覆盖、不落 agent slice)。
// 原本两处各写了一遍同样的 fetch / resp.ok / json.response(code review 指出的
// Duplicated Code)——收口在这里,免得以后一处改了另一处没跟上。
//
// **独立请求,绝不克隆主请求。** 这个栈的 fork 惯例是克隆主请求骑热前缀,但那意味着每次
// 调用都要过一遍她那几十万 token 的上下文;一个几千 token 的独立请求便宜一个数量级。
// 见 docs/adr/0006。

export interface RecallPrompt {
  system: string;
  user: string;
}

const PROVIDER_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';

export interface RecallLlmOptions {
  /** 默认 claude-haiku-4-5:同一份 OAuth 凭据、同一条已在维护的认证路径。 */
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  label?: string;
  /** 5xx / 网络错误重试几次(默认 2 = 最多请求 3 次)。4xx 不重试。 */
  retries?: number;
}

// 这台机器到 api.anthropic.com 大约一半的请求会失败(docker-compose.yml 里那条注释同源),
// 单发一次的调用就有一半概率拿不到答案。判官是**主闸**:它拿不到答案 = 整条腿退回模板钩子
// 加最小间隔节流,量直接塌下来。2026-08-21 15:00–18:00 实测:32 拍里 21 拍 `http 500`,
// 而在给判官的崩溃加留痕之前,这**完全看不见**。
// 所以这里退避重试。5xx / 超时 / 网络错才重试;4xx 是请求本身不对,重试没有意义。
const RETRY_BASE_MS = 400;

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status >= 500 || error.status === 429;
  }
  return true; // 超时 / 连接错 —— 都值得再试一次
}

class HttpStatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

export async function callRecallLlm(prompt: RecallPrompt, options: RecallLlmOptions = {}): Promise<string> {
  const attempts = Math.max(1, (options.retries ?? 2) + 1);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(RETRY_BASE_MS * (2 ** (attempt - 1)));
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      return await callOnce(prompt, options);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) {
        break;
      }
    }
  }
  throw lastError;
}

async function callOnce(prompt: RecallPrompt, options: RecallLlmOptions): Promise<string> {
  const model = options.model || 'claude-haiku-4-5';
  const resp = await fetch(`${PROVIDER_URL}/api/internal/llm/debug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      systemPrompt: prompt.system,
      userInput: prompt.user,
      parameters: { max_tokens: options.maxTokens ?? 512 }
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000)
  });
  if (!resp.ok) {
    throw new HttpStatusError(`${options.label || 'recall-llm'} http ${resp.status}`, resp.status);
  }
  const json = (await resp.json()) as { response?: unknown };
  return typeof json?.response === 'string' ? json.response : '';
}
