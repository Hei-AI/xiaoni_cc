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
}

export async function callRecallLlm(prompt: RecallPrompt, options: RecallLlmOptions = {}): Promise<string> {
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
    throw new Error(`${options.label || 'recall-llm'} http ${resp.status}`);
  }
  const json = (await resp.json()) as { response?: unknown };
  return typeof json?.response === 'string' ? json.response : '';
}
