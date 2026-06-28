import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runWebSearch,
  searchTavily,
  searchSearxng,
  normalizeWebSearchSource,
  type WebSearchClientConfig
} from '../services/web-search-client';

const BASE_CONFIG: WebSearchClientConfig = {
  defaultSource: 'tavily',
  maxResults: 3,
  timeoutMs: 5000,
  tavilyApiKey: 'tvly-test',
  tavilyApiUrl: 'https://api.tavily.com/search',
  searxngUrl: 'http://searxng:8080/search'
};

function fakeFetch(responder: (url: string, init?: any) => { ok?: boolean; status?: number; statusText?: string; text: string } | Promise<never>) {
  return (async (url: string, init?: any) => {
    const r = await responder(url, init);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: r.statusText ?? 'OK',
      text: async () => r.text
    };
  }) as any;
}

test('searchTavily maps raw_content to content and omits the answer', async () => {
  let sentBody: any = null;
  const fetchImpl = fakeFetch((_url, init) => {
    sentBody = JSON.parse(init.body);
    return {
      text: JSON.stringify({
        answer: 'should be ignored',
        results: [
          { title: 'A', url: 'https://a.example', content: 'short', raw_content: 'full body text', score: 0.9 },
          { title: '', url: 'https://b.example', content: 'snippet only', score: 0.5 }
        ]
      })
    };
  });
  const outcome = await searchTavily('hello', BASE_CONFIG, fetchImpl);
  assert.equal(outcome.ok, true);
  assert.equal(sentBody.include_answer, false);
  assert.equal(sentBody.include_raw_content, true);
  if (outcome.ok) {
    assert.equal(outcome.results.length, 2);
    assert.equal(outcome.results[0].content, 'full body text');
    assert.equal(outcome.results[1].title, 'https://b.example'); // falls back to url
    assert.equal(outcome.results[1].content, 'snippet only');
  }
});

test('searchTavily without a key returns ok:false', async () => {
  const outcome = await searchTavily('q', { ...BASE_CONFIG, tavilyApiKey: '' }, fakeFetch(() => ({ text: '{}' })));
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.match(outcome.error, /key not configured/i);
  }
});

test('searchTavily maps a timeout/abort to a graceful error, never throws', async () => {
  const fetchImpl = (async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  }) as any;
  const outcome = await searchTavily('q', BASE_CONFIG, fetchImpl);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.match(outcome.error, /timed out/i);
    assert.equal(outcome.rateLimited, false);
  }
});

test('searchTavily flags 429 as rate limited', async () => {
  const outcome = await searchTavily('q', BASE_CONFIG, fakeFetch(() => ({ ok: false, status: 429, statusText: 'Too Many', text: 'quota' })));
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.rateLimited, true);
  }
});

test('searchTavily returns empty results cleanly', async () => {
  const outcome = await searchTavily('q', BASE_CONFIG, fakeFetch(() => ({ text: JSON.stringify({ results: [] }) })));
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.results.length, 0);
  }
});

test('searchSearxng maps results, slices to maxResults, sends safesearch=0 + format=json', async () => {
  let calledUrl = '';
  const fetchImpl = fakeFetch((url) => {
    calledUrl = url;
    return {
      text: JSON.stringify({
        results: [
          { title: 'one', url: 'https://1.example', content: 'c1', score: 1 },
          { title: 'two', url: 'https://2.example', content: 'c2' },
          { title: 'three', url: 'https://3.example', content: 'c3' },
          { title: 'four', url: 'https://4.example', content: 'c4' }
        ]
      })
    };
  });
  const outcome = await searchSearxng('hi there', { ...BASE_CONFIG, maxResults: 2 }, fetchImpl);
  assert.match(calledUrl, /format=json/);
  assert.match(calledUrl, /safesearch=0/);
  assert.match(calledUrl, /q=hi%20there/);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.results.length, 2);
    assert.equal(outcome.results[0].url, 'https://1.example');
  }
});

test('searchSearxng surfaces a 403 limiter hint', async () => {
  const outcome = await searchSearxng('q', BASE_CONFIG, fakeFetch(() => ({ ok: false, status: 403, statusText: 'Forbidden', text: 'blocked' })));
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.match(outcome.error, /limiter/i);
  }
});

test('runWebSearch routes by source and rejects empty query', async () => {
  const empty = await runWebSearch('   ', 'tavily', BASE_CONFIG, fakeFetch(() => ({ text: '{}' })));
  assert.equal(empty.ok, false);

  let hitSearxng = false;
  await runWebSearch('q', 'searxng', BASE_CONFIG, fakeFetch((url) => {
    hitSearxng = url.includes('searxng');
    return { text: JSON.stringify({ results: [] }) };
  }));
  assert.equal(hitSearxng, true);
});

test('normalizeWebSearchSource falls back for unknown values', () => {
  assert.equal(normalizeWebSearchSource('searxng', 'tavily'), 'searxng');
  assert.equal(normalizeWebSearchSource('google', 'tavily'), 'tavily');
  assert.equal(normalizeWebSearchSource(undefined, 'searxng'), 'searxng');
});
