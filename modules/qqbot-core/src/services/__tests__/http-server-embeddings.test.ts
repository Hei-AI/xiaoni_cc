import http from 'http';
import HttpServer from '../http-server';

type MockEmbeddingService = {
  isEnabled: jest.Mock<boolean, []>;
  getPublicModelId: jest.Mock<string, []>;
  getDimensions: jest.Mock<number, []>;
  listModels: jest.Mock<any, []>;
  createEmbeddings: jest.Mock<any, [any]>;
  healthCheck: jest.Mock<any, []>;
};

function createMockEmbeddingService(): MockEmbeddingService {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    getPublicModelId: jest.fn().mockReturnValue('embeddinggemma-300m'),
    getDimensions: jest.fn().mockReturnValue(768),
    listModels: jest.fn().mockReturnValue({
      object: 'list',
      data: [
        {
          id: 'embeddinggemma-300m',
          object: 'model',
          created: 0,
          owned_by: 'qqbot'
        }
      ]
    }),
    createEmbeddings: jest.fn(),
    healthCheck: jest.fn().mockResolvedValue({
      status: 'ok',
      model: 'embeddinggemma-300m',
      dimensions: 768,
      latency_ms: 12
    })
  };
}

async function withServer<T>(handler: (baseUrl: string) => Promise<T>, embeddingService: MockEmbeddingService): Promise<T> {
  const serverInstance = new HttpServer({ port: 0, host: '127.0.0.1' }, { embeddingService: embeddingService as any });
  const app = serverInstance.getApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    return await handler(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestJson(baseUrl: string, path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; payload: any }> {
  const url = new URL(path, baseUrl);
  const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;

  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: init?.method || 'GET',
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body)
            }
          : undefined
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: response.statusCode || 0,
            payload: raw.length > 0 ? JSON.parse(raw) : null
          });
        });
      }
    );

    request.on('error', reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

describe('HttpServer embedding routes', () => {
  it('returns OpenAI-compatible models list', async () => {
    const embeddingService = createMockEmbeddingService();

    await withServer(async (baseUrl) => {
      const response = await requestJson(baseUrl, '/v1/models');

      expect(response.status).toBe(200);
      expect(response.payload).toEqual({
        object: 'list',
        data: [
          {
            id: 'embeddinggemma-300m',
            object: 'model',
            created: 0,
            owned_by: 'qqbot'
          }
        ]
      });
    }, embeddingService);
  });

  it('rejects unsupported dimensions with OpenAI-style error payload', async () => {
    const embeddingService = createMockEmbeddingService();

    await withServer(async (baseUrl) => {
      const response = await requestJson(baseUrl, '/v1/embeddings', {
        method: 'POST',
        body: {
          input: 'hello',
          dimensions: 256
        }
      });

      expect(response.status).toBe(400);
      expect(response.payload).toEqual({
        error: {
          message: 'Only dimensions=768 is supported',
          type: 'invalid_request_error',
          param: 'dimensions',
          code: 'unsupported_dimensions'
        }
      });
      expect(embeddingService.createEmbeddings).not.toHaveBeenCalled();
    }, embeddingService);
  });

  it('passes through valid embedding requests', async () => {
    const embeddingService = createMockEmbeddingService();
    embeddingService.createEmbeddings.mockResolvedValue({
      object: 'list',
      data: [
        {
          object: 'embedding',
          index: 0,
          embedding: [0.1, 0.2, 0.3]
        }
      ],
      model: 'embeddinggemma-300m',
      usage: {
        prompt_tokens: 0,
        total_tokens: 0
      }
    });

    await withServer(async (baseUrl) => {
      const response = await requestJson(baseUrl, '/v1/embeddings', {
        method: 'POST',
        body: {
          input: ['hello', 'world'],
          model: 'embeddinggemma-300m'
        }
      });

      expect(response.status).toBe(200);
      expect(response.payload.data).toHaveLength(1);
      expect(embeddingService.createEmbeddings).toHaveBeenCalledWith({
        input: ['hello', 'world'],
        model: 'embeddinggemma-300m',
        user: undefined
      });
    }, embeddingService);
  });
});
