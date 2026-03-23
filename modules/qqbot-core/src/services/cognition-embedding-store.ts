import crypto from 'crypto';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import EmbeddingService, { OpenAIEmbeddingDataItem } from './embedding-service';

export type CognitionEmbeddingEntityType = 'memory' | 'evidence';
export type CognitionEmbeddingScopeType =
  | 'private_user'
  | 'group_context'
  | 'user_global'
  | 'self_global'
  | 'local_field';
export type CognitionEmbeddingEncoding = 'float';

export interface CognitionEmbeddingMetadata {
  [key: string]: unknown;
}

export interface CognitionEmbeddingRecord {
  id: number;
  entity_type: CognitionEmbeddingEntityType;
  entity_id: number;
  scope_type: CognitionEmbeddingScopeType;
  scope_key: string;
  content_hash: string;
  source_text: string;
  normalized_text: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_encoding: CognitionEmbeddingEncoding;
  embedding_json: number[];
  metadata_json?: CognitionEmbeddingMetadata | null;
  last_accessed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertCognitionEmbeddingInput {
  entity_id: number;
  scope_type: CognitionEmbeddingScopeType;
  scope_key: string;
  source_text: string;
  metadata_json?: CognitionEmbeddingMetadata | null;
  model?: string;
}

export interface CreateQueryEmbeddingResult {
  model: string;
  dimensions: number;
  normalized_text: string;
  embedding: number[];
}

export interface FetchEmbeddingCandidatesFilters {
  scopeTypes?: CognitionEmbeddingScopeType[];
  entityTypes?: CognitionEmbeddingEntityType[];
  entityIds?: number[];
  scopeKeys?: string[];
  limit?: number;
  includeEmbedding?: boolean;
  queryEmbedding?: number[];
}

export interface CognitionEmbeddingCandidate {
  id: number;
  entity_type: CognitionEmbeddingEntityType;
  entity_id: number;
  scope_type: CognitionEmbeddingScopeType;
  scope_key: string;
  content_hash: string;
  source_text: string;
  normalized_text: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_encoding: CognitionEmbeddingEncoding;
  metadata_json?: CognitionEmbeddingMetadata | null;
  last_accessed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  embedding_json?: number[];
  similarity?: number;
}

type EmbeddingGenerator = Pick<
  EmbeddingService,
  'isEnabled' | 'getPublicModelId' | 'createEmbeddings'
>;

type EmbeddingDatabase = Pick<
  DatabaseManager,
  'executeQuery' | 'executeUpdate'
>;

const DEFAULT_LIMIT = 50;

export class CognitionEmbeddingStore {
  private readonly moduleLogger = logger.createModuleLogger('cognition-embedding-store');

  constructor(
    private readonly database: EmbeddingDatabase,
    private readonly embeddingService: EmbeddingGenerator
  ) {}

  public normalizeText(text: string): string {
    return String(text ?? '')
      .replace(/\u0000/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();
  }

  public async createQueryEmbedding(
    text: string,
    options?: { model?: string; user?: string }
  ): Promise<CreateQueryEmbeddingResult> {
    const normalizedText = this.normalizeText(text);
    if (!normalizedText) {
      throw new Error('Embedding input must not be empty after normalization');
    }

    const response = await this.ensureEmbeddingService().createEmbeddings({
      input: normalizedText,
      model: options?.model,
      user: options?.user
    });

    const embedding = this.extractEmbeddingVector(response.data[0]);

    return {
      model: response.model,
      dimensions: embedding.length,
      normalized_text: normalizedText,
      embedding
    };
  }

  public async upsertMemoryEmbedding(
    input: UpsertCognitionEmbeddingInput
  ): Promise<CognitionEmbeddingRecord> {
    return this.upsertEmbedding('memory', input);
  }

  public async upsertEvidenceEmbedding(
    input: UpsertCognitionEmbeddingInput
  ): Promise<CognitionEmbeddingRecord> {
    return this.upsertEmbedding('evidence', input);
  }

  public async fetchCandidatesByScope(
    filters: FetchEmbeddingCandidatesFilters
  ): Promise<CognitionEmbeddingCandidate[]> {
    const limit = Math.max(1, Math.min(DEFAULT_LIMIT, Math.floor(filters.limit || DEFAULT_LIMIT)));
    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters.scopeTypes && filters.scopeTypes.length > 0) {
      const placeholders = filters.scopeTypes.map(() => '?').join(', ');
      whereClauses.push(`scope_type IN (${placeholders})`);
      params.push(...filters.scopeTypes);
    }

    if (filters.entityTypes && filters.entityTypes.length > 0) {
      const placeholders = filters.entityTypes.map(() => '?').join(', ');
      whereClauses.push(`entity_type IN (${placeholders})`);
      params.push(...filters.entityTypes);
    }

    if (filters.entityIds && filters.entityIds.length > 0) {
      const placeholders = filters.entityIds.map(() => '?').join(', ');
      whereClauses.push(`entity_id IN (${placeholders})`);
      params.push(...filters.entityIds);
    }

    if (filters.scopeKeys && filters.scopeKeys.length > 0) {
      const placeholders = filters.scopeKeys.map(() => '?').join(', ');
      whereClauses.push(`scope_key IN (${placeholders})`);
      params.push(...filters.scopeKeys);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rows = await this.database.executeQuery<any>(
      `
        SELECT
          id,
          entity_type,
          entity_id,
          scope_type,
          scope_key,
          content_hash,
          source_text,
          normalized_text,
          embedding_model,
          embedding_dimensions,
          embedding_encoding,
          embedding_json,
          metadata_json,
          last_accessed_at,
          created_at,
          updated_at
        FROM agent_cognition_embeddings
        ${whereSql}
        ORDER BY updated_at DESC, id DESC
        LIMIT ${limit}
      `,
      params
    );

    const candidates = rows.map((row: any) => this.mapCandidateRow(row));
    const scoredCandidates = typeof filters.queryEmbedding !== 'undefined'
      ? this.scoreCandidates(candidates, filters.queryEmbedding, filters.includeEmbedding !== false)
      : candidates.map(candidate => ({
          ...candidate,
          embedding_json: filters.includeEmbedding ? candidate.embedding_json : undefined
        }));

    return scoredCandidates.slice(0, limit);
  }

  public async searchByQuery(
    query: string,
    filters: Omit<FetchEmbeddingCandidatesFilters, 'queryEmbedding'> = {}
  ): Promise<CognitionEmbeddingCandidate[]> {
    const queryEmbedding = await this.createQueryEmbedding(query);
    return this.fetchCandidatesByScope({
      ...filters,
      queryEmbedding: queryEmbedding.embedding
    });
  }

  public async getEmbeddingByEntity(
    entityType: CognitionEmbeddingEntityType,
    entityId: number
  ): Promise<CognitionEmbeddingRecord | null> {
    const rows = await this.database.executeQuery<any>(
      `
        SELECT
          id,
          entity_type,
          entity_id,
          scope_type,
          scope_key,
          content_hash,
          source_text,
          normalized_text,
          embedding_model,
          embedding_dimensions,
          embedding_encoding,
          embedding_json,
          metadata_json,
          last_accessed_at,
          created_at,
          updated_at
        FROM agent_cognition_embeddings
        WHERE entity_type = ? AND entity_id = ?
        LIMIT 1
      `,
      [entityType, entityId]
    );

    const row = rows[0];
    return row ? this.mapRecordRow(row) : null;
  }

  private async upsertEmbedding(
    entityType: CognitionEmbeddingEntityType,
    input: UpsertCognitionEmbeddingInput
  ): Promise<CognitionEmbeddingRecord> {
    const normalizedText = this.normalizeText(input.source_text);
    if (!normalizedText) {
      throw new Error('Embedding source text must not be empty');
    }

    const model = input.model || this.ensureEmbeddingService().getPublicModelId();
    const queryEmbedding = await this.ensureEmbeddingService().createEmbeddings({
      input: normalizedText,
      model
    });
    const vector = this.extractEmbeddingVector(queryEmbedding.data[0]);
    const contentHash = this.computeContentHash(
      entityType,
      input.entity_id,
      input.scope_type,
      input.scope_key,
      model,
      normalizedText
    );
    const existing = await this.getEmbeddingByEntity(entityType, input.entity_id);
    const metadataJson = input.metadata_json ? JSON.parse(JSON.stringify(input.metadata_json)) : null;

    if (existing) {
      await this.database.executeUpdate(
        `
          UPDATE agent_cognition_embeddings
          SET
            scope_type = ?,
            scope_key = ?,
            content_hash = ?,
            source_text = ?,
            normalized_text = ?,
            embedding_model = ?,
            embedding_dimensions = ?,
            embedding_encoding = 'float',
            embedding_json = ?,
            metadata_json = ?,
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE entity_type = ? AND entity_id = ?
        `,
        [
          input.scope_type,
          input.scope_key,
          contentHash,
          input.source_text,
          normalizedText,
          model,
          vector.length,
          JSON.stringify(vector),
          metadataJson ? JSON.stringify(metadataJson) : null,
          entityType,
          input.entity_id
        ]
      );
    } else {
      await this.database.executeUpdate(
        `
          INSERT INTO agent_cognition_embeddings (
            entity_type,
            entity_id,
            scope_type,
            scope_key,
            content_hash,
            source_text,
            normalized_text,
            embedding_model,
            embedding_dimensions,
            embedding_encoding,
            embedding_json,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'float', ?, ?)
        `,
        [
          entityType,
          input.entity_id,
          input.scope_type,
          input.scope_key,
          contentHash,
          input.source_text,
          normalizedText,
          model,
          vector.length,
          JSON.stringify(vector),
          metadataJson ? JSON.stringify(metadataJson) : null
        ]
      );
    }

    const stored = await this.getEmbeddingByEntity(entityType, input.entity_id);
    if (!stored) {
      throw new Error('Embedding upsert succeeded but row could not be reloaded');
    }

    return stored;
  }

  private scoreCandidates(
    candidates: CognitionEmbeddingCandidate[],
    queryEmbedding: number[],
    includeEmbedding: boolean
  ): CognitionEmbeddingCandidate[] {
    return candidates
      .map(candidate => {
        const candidateEmbedding = candidate.embedding_json || [];
        const similarity = this.cosineSimilarity(queryEmbedding, candidateEmbedding);
        return {
          ...candidate,
          embedding_json: includeEmbedding ? candidate.embedding_json : undefined,
          similarity
        };
      })
      .sort((left, right) => (right.similarity || 0) - (left.similarity || 0));
  }

  private cosineSimilarity(left: number[], right: number[]): number {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
      return 0;
    }

    const dimensions = Math.min(left.length, right.length);
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;

    for (let index = 0; index < dimensions; index += 1) {
      const leftValue = Number(left[index]) || 0;
      const rightValue = Number(right[index]) || 0;
      dot += leftValue * rightValue;
      leftNorm += leftValue * leftValue;
      rightNorm += rightValue * rightValue;
    }

    if (leftNorm === 0 || rightNorm === 0) {
      return 0;
    }

    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  private extractEmbeddingVector(item?: OpenAIEmbeddingDataItem): number[] {
    const embedding = Array.isArray(item?.embedding) ? item.embedding : [];
    if (embedding.length === 0) {
      throw new Error('Embedding upstream returned no vector data');
    }

    if (!embedding.every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error('Embedding upstream returned non-numeric vector values');
    }

    return embedding;
  }

  private computeContentHash(
    entityType: CognitionEmbeddingEntityType,
    entityId: number,
    scopeType: CognitionEmbeddingScopeType,
    scopeKey: string,
    model: string,
    normalizedText: string
  ): string {
    return crypto
      .createHash('sha256')
      .update([
        entityType,
        String(entityId),
        scopeType,
        scopeKey,
        model,
        normalizedText
      ].join('\n'))
      .digest('hex');
  }

  private ensureEmbeddingService(): EmbeddingGenerator {
    if (!this.embeddingService || !this.embeddingService.isEnabled()) {
      throw new Error('Embedding service is not enabled');
    }

    return this.embeddingService;
  }

  private mapRecordRow(row: any): CognitionEmbeddingRecord {
    return {
      id: Number(row.id),
      entity_type: row.entity_type,
      entity_id: Number(row.entity_id),
      scope_type: row.scope_type,
      scope_key: row.scope_key,
      content_hash: row.content_hash,
      source_text: row.source_text,
      normalized_text: row.normalized_text,
      embedding_model: row.embedding_model,
      embedding_dimensions: Number(row.embedding_dimensions) || 0,
      embedding_encoding: row.embedding_encoding,
      embedding_json: this.parseJsonVector(row.embedding_json),
      metadata_json: this.parseJsonValue(row.metadata_json) ?? null,
      last_accessed_at: this.parseDate(row.last_accessed_at),
      created_at: this.parseDate(row.created_at) || new Date(),
      updated_at: this.parseDate(row.updated_at) || new Date()
    };
  }

  private mapCandidateRow(row: any): CognitionEmbeddingCandidate {
    const record = this.mapRecordRow(row);
    return {
      ...record,
      embedding_json: record.embedding_json
    };
  }

  private parseJsonVector(value: unknown): number[] {
    const parsed = this.parseJsonValue(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(item => Number(item))
      .filter(item => Number.isFinite(item));
  }

  private parseJsonValue(value: unknown): any {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (error) {
        this.moduleLogger.warn('Failed to parse JSON value from embedding store', {
          error: error instanceof Error ? error.message : String(error)
        });
        return undefined;
      }
    }

    return value;
  }

  private parseDate(value: unknown): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}

export default CognitionEmbeddingStore;
