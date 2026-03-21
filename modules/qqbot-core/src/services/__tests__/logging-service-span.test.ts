import { LoggingService } from '../logging-service';

describe('LoggingService span lifecycle', () => {
  it('writes trace root, span records, attributes, events and links through the database layer', async () => {
    const executeUpdate = jest.fn(async () => 1);
    const executeQuery = jest.fn(async (query: string) => {
      if (query.includes('SELECT trace_id, started_at FROM spans')) {
        return [{ trace_id: 'trace-1', started_at: '2026-03-22T10:00:00.000Z' }];
      }
      return [];
    });

    const service = new LoggingService({
      executeUpdate,
      executeQuery,
    } as any);

    const spanId = await service.startSpan({
      traceId: 'trace-1',
      conversationId: 'conv-1',
      name: 'tool.invocation',
      kind: 'internal',
      summary: 'run tool',
      input: { args: { q: 'hello' } },
      attributes: {
        'semantic.role': 'invocation',
        'tool.name': 'web_search',
      },
    });

    await service.recordSpanEvent({
      spanId,
      name: 'tool.invocation.start',
      attributes: { phase: 'start' },
    });

    await service.recordSpanLink({
      spanId,
      linkedTraceId: 'trace-child',
      linkedSpanId: 'child-root',
      attributes: { relation: 'spawn' },
    });

    await service.endSpan(spanId, {
      statusCode: 'ok',
      summary: 'tool done',
      output: { ok: true },
      attributes: {
        'tool.result_count': 3,
      },
    });

    expect(typeof spanId).toBe('string');
    expect(executeUpdate).toHaveBeenCalled();
    expect(executeQuery).toHaveBeenCalledWith(
      'SELECT trace_id, started_at FROM spans WHERE span_id = ? LIMIT 1',
      [spanId]
    );

    const sqlCalls = (executeUpdate as jest.Mock).mock.calls.map((call: any[]) => String(call[0]));
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO traces'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO spans'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO span_attributes'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO span_events'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO span_links'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE spans'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE traces'))).toBe(true);
  });
});
