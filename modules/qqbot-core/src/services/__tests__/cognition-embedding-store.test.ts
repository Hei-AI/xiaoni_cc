import { CognitionEmbeddingStore } from '../cognition-embedding-store';

describe('CognitionEmbeddingStore', () => {
  const database = {
    executeQuery: jest.fn(),
    executeUpdate: jest.fn()
  };

  const embeddingService = {
    isEnabled: jest.fn().mockReturnValue(true),
    getPublicModelId: jest.fn().mockReturnValue('embeddinggemma-300m'),
    createEmbeddings: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes multiline embedding text deterministically', () => {
    const store = new CognitionEmbeddingStore(database as any, embeddingService as any);

    expect(store.normalizeText('  hello   world \r\n\r\n  foo\tbar  ')).toBe('hello world\nfoo bar');
  });

  it('upserts memory embeddings and reloads the stored row', async () => {
    const store = new CognitionEmbeddingStore(database as any, embeddingService as any);

    embeddingService.createEmbeddings
      .mockResolvedValueOnce({
        object: 'list',
        model: 'embeddinggemma-300m',
        data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
        usage: {
          prompt_tokens: 3,
          total_tokens: 3
        }
      })
      .mockResolvedValueOnce({
        object: 'list',
        model: 'embeddinggemma-300m',
        data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
        usage: {
          prompt_tokens: 3,
          total_tokens: 3
        }
      });

    database.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 7,
          entity_type: 'memory',
          entity_id: 42,
          scope_type: 'private_user',
          scope_key: 'user:42',
          content_hash: 'hash-1',
          source_text: '我喜欢蓝莓',
          normalized_text: '我喜欢蓝莓',
          embedding_model: 'embeddinggemma-300m',
          embedding_dimensions: 3,
          embedding_encoding: 'float',
          embedding_json: JSON.stringify([0.1, 0.2, 0.3]),
          metadata_json: JSON.stringify({ subject: 'user:42' }),
          last_accessed_at: null,
          created_at: new Date('2026-03-23T00:00:00.000Z'),
          updated_at: new Date('2026-03-23T00:00:00.000Z')
        }
      ]);

    const result = await store.upsertMemoryEmbedding({
      entity_id: 42,
      scope_type: 'private_user',
      scope_key: 'user:42',
      source_text: '我喜欢蓝莓',
      metadata_json: { subject: 'user:42' }
    });

    expect(embeddingService.createEmbeddings).toHaveBeenCalledTimes(1);
    expect(database.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_cognition_embeddings'),
      expect.arrayContaining([
        'memory',
        42,
        'private_user',
        'user:42',
        expect.any(String),
        '我喜欢蓝莓',
        '我喜欢蓝莓',
        'embeddinggemma-300m',
        3,
        JSON.stringify([0.1, 0.2, 0.3]),
        JSON.stringify({ subject: 'user:42' })
      ])
    );
    expect(result).toMatchObject({
      id: 7,
      entity_type: 'memory',
      entity_id: 42,
      scope_type: 'private_user',
      scope_key: 'user:42',
      embedding_json: [0.1, 0.2, 0.3]
    });
  });

  it('scores candidates locally when a query embedding is provided', async () => {
    const store = new CognitionEmbeddingStore(database as any, embeddingService as any);

    database.executeQuery.mockResolvedValueOnce([
      {
        id: 1,
        entity_type: 'memory',
        entity_id: 1,
        scope_type: 'private_user',
        scope_key: 'user:1',
        content_hash: 'hash-1',
        source_text: 'a',
        normalized_text: 'a',
        embedding_model: 'embeddinggemma-300m',
        embedding_dimensions: 3,
        embedding_encoding: 'float',
        embedding_json: JSON.stringify([1, 0, 0]),
        metadata_json: null,
        last_accessed_at: null,
        created_at: new Date('2026-03-23T00:00:00.000Z'),
        updated_at: new Date('2026-03-23T00:00:00.000Z')
      },
      {
        id: 2,
        entity_type: 'memory',
        entity_id: 2,
        scope_type: 'private_user',
        scope_key: 'user:1',
        content_hash: 'hash-2',
        source_text: 'b',
        normalized_text: 'b',
        embedding_model: 'embeddinggemma-300m',
        embedding_dimensions: 3,
        embedding_encoding: 'float',
        embedding_json: JSON.stringify([0, 1, 0]),
        metadata_json: null,
        last_accessed_at: null,
        created_at: new Date('2026-03-23T00:00:00.000Z'),
        updated_at: new Date('2026-03-23T00:00:00.000Z')
      }
    ]);

    const candidates = await store.fetchCandidatesByScope({
      scopeTypes: ['private_user'],
      queryEmbedding: [1, 0, 0],
      includeEmbedding: true
    });

    expect(candidates[0].entity_id).toBe(1);
    expect(candidates[0].similarity).toBeCloseTo(1);
    expect(candidates[1].entity_id).toBe(2);
    expect(candidates[1].similarity).toBeCloseTo(0);
  });
});
