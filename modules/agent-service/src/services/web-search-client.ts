// Custom web search for 小腻's main loop.
//
// Why this exists: Anthropic's server-side web_search (web_search_20260209) is
// gated on the Claude Code subscription cloak (its code-exec side_query is
// throttled — claude-code#27074). This client runs in agent-service and calls a
// third-party search API over plain HTTPS, so it never touches that cloak.
//
// Two sources, selectable per call (the tool exposes a `source` arg):
//   - tavily (default): one call returns ranked results WITH cleaned page text
//     (include_raw_content). include_answer is OFF — we return raw results, no
//     synthesis layer ("不做任何过滤").
//   - searxng: self-hosted open-source metasearch (aggregates DuckDuckGo/Brave/
//     Bing/Qwant/...). No API key, no quota. Snippet only (deep reading via her
//     browser/curl). We control safesearch=0 → truly no filtering.
//
// No filtering: queries and results pass through untouched. The ONLY shaping is
// (a) capping max_results and (b) the caller spilling oversized content to a file
// and windowing the view — never silently dropping the tail. See web-search-archive.ts.

export type WebSearchSource = 'tavily' | 'searxng';

export interface WebSearchResultItem {
  title: string;
  url: string;
  /** Full content (Tavily raw_content) or snippet (SearXNG). Not truncated here. */
  content: string;
  score: number | null;
}

export type WebSearchOutcome =
  | { ok: true; source: WebSearchSource; query: string; results: WebSearchResultItem[] }
  | { ok: false; source: WebSearchSource; query: string; error: string; rateLimited: boolean };

export interface WebSearchClientConfig {
  defaultSource: WebSearchSource;
  maxResults: number;
  timeoutMs: number;
  tavilyApiKey: string;
  tavilyApiUrl: string;
  /** SearXNG /search endpoint, e.g. http://qqbot-searxng:8080/search */
  searxngUrl: string;
}

interface FetchLike {
  (input: string, init?: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    text(): Promise<string>;
  }>;
}

function clampMaxResults(value: number): number {
  if (!Number.isFinite(value)) {
    return 6;
  }
  return Math.min(20, Math.max(1, Math.trunc(value)));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  timeoutMs: number,
  fetchImpl: FetchLike
): Promise<{ ok: boolean; status: number; statusText: string; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, statusText: response.statusText, text };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike
): Promise<{ ok: boolean; status: number; statusText: string; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, statusText: response.statusText, text };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = text ? JSON.parse(text) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function searchTavily(
  query: string,
  config: WebSearchClientConfig,
  fetchImpl: FetchLike
): Promise<WebSearchOutcome> {
  if (!config.tavilyApiKey) {
    return { ok: false, source: 'tavily', query, error: 'Tavily API key not configured (AGENT_WEB_SEARCH_TAVILY_API_KEY).', rateLimited: false };
  }
  let response;
  try {
    response = await postJson(
      config.tavilyApiUrl,
      {
        query,
        max_results: clampMaxResults(config.maxResults),
        search_depth: 'basic',
        include_raw_content: true,
        include_answer: false
      },
      { authorization: `Bearer ${config.tavilyApiKey}` },
      config.timeoutMs,
      fetchImpl
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = /abort/i.test(message);
    return { ok: false, source: 'tavily', query, error: aborted ? `Tavily request timed out after ${config.timeoutMs}ms` : `Tavily request failed: ${message}`, rateLimited: false };
  }
  if (!response.ok) {
    const rateLimited = response.status === 429;
    return { ok: false, source: 'tavily', query, error: `Tavily HTTP ${response.status}: ${(response.text || response.statusText).slice(0, 300)}`, rateLimited };
  }
  const payload = parseJsonObject(response.text);
  const rawResults = payload && Array.isArray(payload.results) ? payload.results : [];
  const results: WebSearchResultItem[] = rawResults.map((entry) => {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const raw = asString(item.raw_content);
    return {
      title: asString(item.title) || asString(item.url),
      url: asString(item.url),
      content: (raw || asString(item.content)).trim(),
      score: typeof item.score === 'number' ? item.score : null
    };
  }).filter((item) => item.url);
  return { ok: true, source: 'tavily', query, results };
}

export async function searchSearxng(
  query: string,
  config: WebSearchClientConfig,
  fetchImpl: FetchLike
): Promise<WebSearchOutcome> {
  if (!config.searxngUrl) {
    return { ok: false, source: 'searxng', query, error: 'SearXNG URL not configured (AGENT_WEB_SEARCH_SEARXNG_URL).', rateLimited: false };
  }
  // safesearch=0 → no content filtering. format=json must be enabled in the
  // instance settings.yml (search.formats), and server.limiter must be false or
  // programmatic JSON requests get a 403.
  const url = `${config.searxngUrl}?q=${encodeURIComponent(query)}&format=json&safesearch=0`;
  let response;
  try {
    response = await getJson(url, config.timeoutMs, fetchImpl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = /abort/i.test(message);
    return { ok: false, source: 'searxng', query, error: aborted ? `SearXNG request timed out after ${config.timeoutMs}ms` : `SearXNG request failed: ${message}`, rateLimited: false };
  }
  if (!response.ok) {
    const rateLimited = response.status === 429;
    const hint = response.status === 403
      ? ' (403 — enable json in search.formats and set server.limiter:false in settings.yml)'
      : '';
    return { ok: false, source: 'searxng', query, error: `SearXNG HTTP ${response.status}${hint}: ${(response.text || response.statusText).slice(0, 300)}`, rateLimited };
  }
  const payload = parseJsonObject(response.text);
  const rawResults = payload && Array.isArray(payload.results) ? payload.results : [];
  const limit = clampMaxResults(config.maxResults);
  const results: WebSearchResultItem[] = rawResults.map((entry) => {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    return {
      title: asString(item.title) || asString(item.url),
      url: asString(item.url),
      content: asString(item.content).trim(),
      score: typeof item.score === 'number' ? item.score : null
    };
  }).filter((item) => item.url).slice(0, limit);
  return { ok: true, source: 'searxng', query, results };
}

/** Run a search against the requested source. Never throws — errors become {ok:false}. */
export async function runWebSearch(
  query: string,
  source: WebSearchSource,
  config: WebSearchClientConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<WebSearchOutcome> {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed) {
    return { ok: false, source, query: '', error: 'web_search requires a non-empty query', rateLimited: false };
  }
  return source === 'searxng'
    ? searchSearxng(trimmed, config, fetchImpl)
    : searchTavily(trimmed, config, fetchImpl);
}

export function normalizeWebSearchSource(value: unknown, fallback: WebSearchSource): WebSearchSource {
  return value === 'searxng' || value === 'tavily' ? value : fallback;
}
