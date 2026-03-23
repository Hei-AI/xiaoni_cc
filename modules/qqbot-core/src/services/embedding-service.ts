import axios, { AxiosError } from 'axios';
import { AIConfig } from '../types';
import { logger } from '../utils/logger';

export interface OpenAIEmbeddingDataItem {
  object: 'embedding';
  index: number;
  embedding: number[];
}

export interface OpenAIEmbeddingListResponse {
  object: 'list';
  data: OpenAIEmbeddingDataItem[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIModelListResponse {
  object: 'list';
  data: Array<{
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
  }>;
}

type CreateEmbeddingsParams = {
  input: string | string[];
  model?: string;
  user?: string;
};

type HealthCheckResult = {
  status: 'ok';
  model: string;
  dimensions: number;
  latency_ms: number;
};

class EmbeddingService {
  private readonly moduleLogger = logger.createModuleLogger('embedding-service');
  private readonly enabled: boolean;
  private readonly baseUrl?: string;
  private readonly publicModelId: string;
  private readonly timeoutMs: number;
  private readonly dimensions = 768;
  private readonly defaultNormalize: number;

  constructor(private readonly aiConfig: AIConfig) {
    this.enabled = aiConfig.embedding_enabled === true;
    this.baseUrl = aiConfig.embedding_base_url?.replace(/\/$/, '');
    this.publicModelId = aiConfig.embedding_model_id || 'embeddinggemma-300m';
    this.timeoutMs = aiConfig.embedding_timeout_ms || 30000;
    this.defaultNormalize = aiConfig.embedding_normalize || 2;
  }

  public isEnabled(): boolean {
    return this.enabled && Boolean(this.baseUrl);
  }

  public getPublicModelId(): string {
    return this.publicModelId;
  }

  public getDimensions(): number {
    return this.dimensions;
  }

  public listModels(): OpenAIModelListResponse {
    return {
      object: 'list',
      data: [
        {
          id: this.publicModelId,
          object: 'model',
          created: 0,
          owned_by: 'qqbot'
        }
      ]
    };
  }

  public async createEmbeddings(params: CreateEmbeddingsParams): Promise<OpenAIEmbeddingListResponse> {
    if (!this.isEnabled()) {
      throw new Error('Embedding service is not enabled');
    }

    const response = await this.postEmbeddings(params);
    return this.normalizeEmbeddingResponse(response);
  }

  public async healthCheck(): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    const response = await this.createEmbeddings({ input: 'healthcheck' });

    return {
      status: 'ok',
      model: response.model,
      dimensions: response.data[0]?.embedding.length || this.dimensions,
      latency_ms: Date.now() - startedAt
    };
  }

  private async postEmbeddings(params: CreateEmbeddingsParams): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/embeddings`,
        {
          input: params.input,
          model: params.model || this.publicModelId,
          user: params.user,
          encoding_format: 'float',
          normalize: this.defaultNormalize
        },
        {
          timeout: this.timeoutMs,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) || (typeof error === 'object' && error !== null && (error as any).isAxiosError === true)) {
        const axiosError = error as AxiosError<any>;
        const upstreamMessage =
          typeof axiosError.response?.data?.error?.message === 'string'
            ? axiosError.response?.data?.error?.message
            : typeof axiosError.response?.data?.message === 'string'
              ? axiosError.response?.data?.message
              : axiosError.message;

        throw new Error(`Embedding upstream request failed: ${upstreamMessage}`);
      }

      throw error;
    }
  }

  private normalizeEmbeddingResponse(payload: any): OpenAIEmbeddingListResponse {
    const rawData = Array.isArray(payload?.data) ? payload.data : [];
    const normalizedData = rawData.map((item: any, index: number) => {
      const embedding = Array.isArray(item?.embedding) ? item.embedding : [];
      if (!embedding.every((value: unknown) => typeof value === 'number')) {
        throw new Error('Embedding upstream returned non-numeric vector values');
      }

      return {
        object: 'embedding' as const,
        index: Number.isInteger(item?.index) ? item.index : index,
        embedding
      };
    });

    if (normalizedData.length === 0) {
      throw new Error('Embedding upstream returned no embeddings');
    }

    return {
      object: 'list',
      data: normalizedData,
      model: this.publicModelId,
      usage: {
        prompt_tokens: Number.isFinite(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens : 0,
        total_tokens: Number.isFinite(payload?.usage?.total_tokens) ? payload.usage.total_tokens : 0
      }
    };
  }
}

export default EmbeddingService;
