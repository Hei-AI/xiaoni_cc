import {
  mergeSelectedActionStreamTags,
  parseActionStreamTagParam,
  serializeActionStreamTags,
  toggleActionStreamTag,
} from '../xiaoni-action-stream-tags';

describe('Xiaoni action stream tag helpers', () => {
  it('parses comma-separated tag params with normalization and de-duplication', () => {
    expect(parseActionStreamTagParam(' Source:LLM_Request,event:model_tool_request,source:llm_request ')).toEqual([
      'source:llm_request',
      'event:model_tool_request',
    ]);
  });

  it('serializes normalized tag params', () => {
    expect(serializeActionStreamTags(['Status:OK', 'status:ok', 'event:model_tool_request'])).toBe('status:ok,event:model_tool_request');
    expect(serializeActionStreamTags([])).toBeNull();
  });

  it('toggles selected tags by stable key', () => {
    expect(toggleActionStreamTag(['source:llm_request'], 'event:model_tool_request')).toEqual([
      'source:llm_request',
      'event:model_tool_request',
    ]);
    expect(toggleActionStreamTag(['source:llm_request'], 'source:llm_request')).toEqual([]);
  });

  it('keeps selected tags that are missing from the current available set', () => {
    expect(mergeSelectedActionStreamTags([
      { key: 'source:llm_request', label: 'LLM', count: 3 },
    ], ['source:llm_request', 'event:model_tool_request'])).toEqual([
      { key: 'source:llm_request', label: 'LLM', count: 3 },
      { key: 'event:model_tool_request', label: 'event:model_tool_request', tone: 'neutral', count: 0 },
    ]);
  });
});
