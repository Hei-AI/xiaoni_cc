import { ResponseComparator } from '../services/response-comparator';

describe('ResponseComparator', () => {
  it('keeps semantic judge results alongside structural diff results', async () => {
    const comparator = new ResponseComparator({
      semanticJudge: async () => ({
        semanticMatch: true,
        semanticSummary: '字段顺序变了，但用户可见语义没变。',
        semanticJudgeModel: 'gpt-5.4-mini',
        semanticJudgeReason: null
      })
    });

    const comparison = await comparator.compareWithSemanticJudge({
      id: 1,
      response_status: 200,
      response_headers: { 'content-type': 'application/json' },
      response_body: '{"message":"ok"}',
      response_size: 30,
      duration_ms: 100
    }, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"message":"ok","trace_id":"abc"}',
      duration: 120,
      size: 30
    });

    expect(comparison.bodyMatch).toBe(false);
    expect(comparison.semanticMatch).toBe(true);
    expect(comparison.semanticSummary).toContain('语义没变');
    expect(comparison.semanticJudgeModel).toBe('gpt-5.4-mini');
  });

  it('skips semantic judge when responses already match exactly', async () => {
    const semanticJudge = jest.fn();
    const comparator = new ResponseComparator({ semanticJudge });

    const comparison = await comparator.compareWithSemanticJudge({
      id: 2,
      response_status: 200,
      response_headers: { 'content-type': 'application/json' },
      response_body: '{"message":"ok"}',
      response_size: 16,
      duration_ms: 100
    }, {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"message":"ok"}',
      duration: 100,
      size: 16
    });

    expect(comparison.bodyMatch).toBe(true);
    expect(semanticJudge).not.toHaveBeenCalled();
    expect(comparison.semanticMatch).toBeNull();
  });
});
