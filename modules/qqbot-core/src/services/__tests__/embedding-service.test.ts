import axios from 'axios';
import EmbeddingService from '../embedding-service';
import { AIConfig } from '../../types';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createAIConfig(overrides: Partial<AIConfig> = {}): AIConfig {
  return {
    gemini_api_keys: [],
    model_name: 'gemini-2.5-flash',
    embedding_enabled: true,
    embedding_base_url: 'http://embedding-server:8080',
    embedding_model_id: 'embeddinggemma-300m',
    embedding_model_source: 'hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf',
    embedding_timeout_ms: 30000,
    embedding_normalize: 2,
    authorized_user_id: 1,
    bot_qq_number: 2,
    ...overrides
  };
}

describe('EmbeddingService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('normalizes upstream embeddings into OpenAI-compatible shape', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        object: 'list',
        data: [
          { embedding: [0.1, 0.2, 0.3], index: 0 }
        ],
        usage: {
          prompt_tokens: 4,
          total_tokens: 4
        }
      }
    });

    const service = new EmbeddingService(createAIConfig());
    const response = await service.createEmbeddings({ input: 'hello' });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://embedding-server:8080/v1/embeddings',
      expect.objectContaining({
        input: 'hello',
        model: 'embeddinggemma-300m',
        encoding_format: 'float',
        normalize: 2
      }),
      expect.any(Object)
    );
    expect(response).toEqual({
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
        prompt_tokens: 4,
        total_tokens: 4
      }
    });
  });

  it('defaults usage to zero when upstream omits it', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        data: [{ embedding: [1, 2, 3], index: 0 }]
      }
    });

    const service = new EmbeddingService(createAIConfig());
    const response = await service.createEmbeddings({ input: ['hello', 'world'] });

    expect(response.usage).toEqual({
      prompt_tokens: 0,
      total_tokens: 0
    });
  });

  it('wraps upstream axios failures', async () => {
    mockedAxios.post.mockRejectedValue({
      isAxiosError: true,
      message: 'connect ECONNREFUSED',
      response: {
        data: {
          error: {
            message: 'upstream unavailable'
          }
        }
      }
    });

    const service = new EmbeddingService(createAIConfig());

    await expect(service.createEmbeddings({ input: 'hello' })).rejects.toThrow(
      'Embedding upstream request failed: upstream unavailable'
    );
  });
});
