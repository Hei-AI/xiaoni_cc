import { formatStructuredData } from '@/components/StructuredDataViewer';

describe('formatStructuredData', () => {
  it('pretty-prints JSON strings by default', () => {
    expect(formatStructuredData('{"answer":{"text":"ok"},"items":[1,2]}')).toBe([
      '{',
      '  "answer": {',
      '    "text": "ok"',
      '  },',
      '  "items": [',
      '    1,',
      '    2',
      '  ]',
      '}',
    ].join('\n'));
  });

  it('preserves raw strings when rawText is enabled', () => {
    expect(formatStructuredData('{"answer":{"text":"ok"}}', true)).toBe('{"answer":{"text":"ok"}}');
  });
});
