/**
 * 流量重放服务
 * 执行流量重放，应用参数修改，记录结果
 */

import axios from 'axios';
import {
  createTrafficReplayHistory,
  ensureReplayHistorySchema,
  getTrafficLogById,
  listTrafficReplayHistory
} from '@qq-bot/persistence';
import { DatabaseManager } from './database';
import { ResponseComparator } from './response-comparator';

// ==================== 类型定义 ====================

interface ReplayRequest {
  originalLogId: number;
  modifications?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
    queryParams?: Record<string, string>;
  };
  timeout?: number;
  followRedirects?: boolean;
  validateSSL?: boolean;
}

interface ReplayResult {
  success: boolean;
  replayHistoryId: number;
  originalLog: TrafficLog;
  modifiedRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  replayResponse: {
    status: number;
    headers: Record<string, string>;
    body: string;
    duration: number;
    size: number;
  };
  comparison: {
    statusMatch: boolean;
    bodyDiff: any[];
    durationDiff: number;
    bodySizeDiff: number;
    headersDiff: any[];
    overallSimilarity: number;
  };
  error?: string;
}

interface TrafficLog {
  id: number;
  trace_id?: string;
  method: string;
  url: string;
  host: string;
  path: string;
  query_params?: any;
  request_headers: any;
  request_body?: string;
  request_content_type?: string;
  response_status?: number;
  response_headers?: any;
  response_body?: string;
  response_size?: number;
  duration_ms?: number;
}

interface BatchReplayResult {
  total: number;
  successful: number;
  failed: number;
  results: ReplayResult[];
  aggregateStats: {
    avgDurationDiff: number;
    statusMatchRate: number;
    bodyMatchRate: number;
    avgSimilarity: number;
  };
}

interface ReplayHistory {
  id: number;
  original_log_id: number;
  replayed_at: Date;
  replayed_by: string;
  modified_method?: string;
  modified_url?: string;
  modification_summary: any;
  replay_response_status?: number;
  replay_duration_ms?: number;
  diff_summary: any;
  status_code_match: boolean;
  response_body_match: boolean;
  duration_diff_ms?: number;
  success: boolean;
  template_id?: number;
}

// ==================== TrafficReplayService类 ====================

export class TrafficReplayService {
  private comparator: ResponseComparator;

  constructor(_db: DatabaseManager) {
    this.comparator = new ResponseComparator();
  }

  /**
   * 重放单个请求
   */
  async replayRequest(config: ReplayRequest): Promise<ReplayResult> {
    try {
      await ensureReplayHistorySchema();
      console.log(`[TrafficReplay] Replaying request for log ID: ${config.originalLogId}`);

      // 1. 加载原始日志
      const originalLog = await this.loadOriginalLog(config.originalLogId);
      if (!originalLog) {
        throw new Error(`Original log not found: ${config.originalLogId}`);
      }

      // 2. 应用修改
      const modifiedRequest = this.buildModifiedRequest(originalLog, config.modifications);

      // 3. 发送HTTP请求
      const startTime = Date.now();
      let replayResponse;

      try {
        const axiosConfig: any = {
          method: modifiedRequest.method,
          url: modifiedRequest.url,
          headers: modifiedRequest.headers,
          timeout: config.timeout || 30000,
          maxRedirects: config.followRedirects ? 5 : 0,
          validateStatus: () => true  // Accept all status codes
        };

        // 只有非GET/HEAD请求才添加data
        if (modifiedRequest.method !== 'GET' && modifiedRequest.method !== 'HEAD' && modifiedRequest.body) {
          axiosConfig.data = modifiedRequest.body;
        }

        // SSL验证
        if (config.validateSSL === false) {
          axiosConfig.httpsAgent = new (require('https').Agent)({
            rejectUnauthorized: false
          });
        }

        const response = await axios(axiosConfig);

        const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const duration = Date.now() - startTime;

        replayResponse = {
          status: response.status,
          headers: this.convertHeaders(response.headers),
          body: responseBody,
          duration,
          size: Buffer.byteLength(responseBody, 'utf8')
        };

      } catch (error) {
        throw new Error(`Replay failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 4. 对比结果
      const comparison = this.comparator.compare(originalLog, replayResponse);

      // 5. 保存重放历史
      const historyId = await this.saveReplayHistory({
        originalLogId: config.originalLogId,
        modifiedRequest,
        replayResponse,
        comparison,
        modificationSummary: this.generateModificationSummary(originalLog, config.modifications)
      });

      console.log(`[TrafficReplay] Replay completed successfully, history ID: ${historyId}`);

      return {
        success: true,
        replayHistoryId: historyId,
        originalLog,
        modifiedRequest,
        replayResponse,
        comparison: {
          statusMatch: comparison.statusMatch,
          bodyDiff: comparison.bodyDiff,
          durationDiff: comparison.durationDiff,
          bodySizeDiff: comparison.bodySizeDiff,
          headersDiff: comparison.headersDiff,
          overallSimilarity: comparison.overallSimilarity
        }
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[TrafficReplay] Replay failed:', errorMsg);

      // 记录失败的重放
      await this.saveReplayHistory({
        originalLogId: config.originalLogId,
        modifiedRequest: {} as any,
        replayResponse: {} as any,
        comparison: {} as any,
        modificationSummary: {},
        success: false,
        errorMessage: errorMsg
      }).catch(err => {
        console.error('[TrafficReplay] Failed to save error history:', err);
      });

      throw error;
    }
  }

  /**
   * 批量重放
   */
  async batchReplay(
    logIds: number[],
    modifications?: any,
    concurrency: number = 5
  ): Promise<BatchReplayResult> {
    console.log(`[TrafficReplay] Batch replaying ${logIds.length} requests with concurrency ${concurrency}`);

    const results: ReplayResult[] = [];
    const errors: string[] = [];

    // 分批处理
    for (let i = 0; i < logIds.length; i += concurrency) {
      const batch = logIds.slice(i, i + concurrency);

      const batchResults = await Promise.allSettled(
        batch.map(logId =>
          this.replayRequest({
            originalLogId: logId,
            modifications
          })
        )
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          errors.push(result.reason.message || String(result.reason));
        }
      }
    }

    // 聚合统计
    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful + errors.length;

    const aggregateStats = {
      avgDurationDiff: results.length > 0
        ? results.reduce((sum, r) => sum + (r.comparison.durationDiff || 0), 0) / results.length
        : 0,
      statusMatchRate: results.length > 0
        ? results.filter(r => r.comparison.statusMatch).length / results.length
        : 0,
      bodyMatchRate: results.length > 0
        ? results.filter(r => r.comparison.bodyDiff.length === 0).length / results.length
        : 0,
      avgSimilarity: results.length > 0
        ? results.reduce((sum, r) => sum + (r.comparison.overallSimilarity || 0), 0) / results.length
        : 0
    };

    console.log(`[TrafficReplay] Batch replay completed:`, {
      total: logIds.length,
      successful,
      failed,
      aggregateStats
    });

    return {
      total: logIds.length,
      successful,
      failed,
      results,
      aggregateStats
    };
  }

  /**
   * 查询重放历史
   */
  async getReplayHistory(originalLogId: number): Promise<ReplayHistory[]> {
    try {
      const results = await listTrafficReplayHistory(originalLogId);

      return results.map(row => ({
        id: row.id,
        original_log_id: row.original_log_id,
        replayed_at: new Date(row.replayed_at),
        replayed_by: row.replayed_by,
        modified_method: row.modified_method,
        modified_url: row.modified_url,
        modification_summary: this.parseJson(row.modification_summary),
        replay_response_status: row.replay_response_status,
        replay_duration_ms: row.replay_duration_ms,
        diff_summary: this.parseJson(row.diff_summary),
        status_code_match: row.status_code_match,
        response_body_match: row.response_body_match,
        duration_diff_ms: row.duration_diff_ms,
        success: row.success,
        template_id: row.template_id
      }));

    } catch (error) {
      console.error('[TrafficReplay] Failed to get replay history:', error);
      throw error;
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 加载原始日志
   */
  private async loadOriginalLog(logId: number): Promise<TrafficLog | null> {
    const row = await getTrafficLogById(logId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      trace_id: row.trace_id,
      method: row.method,
      url: row.url,
      host: row.host,
      path: row.path,
      query_params: this.parseJson(row.query_params),
      request_headers: this.parseJson(row.request_headers),
      request_body: row.request_body,
      request_content_type: row.request_content_type,
      response_status: row.response_status,
      response_headers: this.parseJson(row.response_headers),
      response_body: row.response_body,
      response_size: row.response_size,
      duration_ms: row.duration_ms
    };
  }

  /**
   * 构建修改后的请求
   */
  private buildModifiedRequest(
    originalLog: TrafficLog,
    modifications?: any
  ): {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  } {
    // Method
    const method = modifications?.method || originalLog.method;

    // URL
    const url = this.buildModifiedUrl(originalLog, modifications);

    // Headers
    const originalHeaders = originalLog.request_headers || {};
    const headers = {
      ...originalHeaders,
      ...(modifications?.headers || {})
    };

    // 重放请求由 Axios 自动计算内容长度；复制原有 Content-Length 等长度相关头会导致
    // 实际 body 长度与声明不一致，进而让上游服务解析出错（常见表现是 JSON 提前截断）。
    for (const headerName of Object.keys(headers)) {
      const normalized = headerName.toLowerCase();
      if (normalized === 'content-length' || normalized === 'transfer-encoding') {
        delete headers[headerName];
      }
    }

    // Body
    const body = modifications?.body !== undefined
      ? modifications.body
      : (originalLog.request_body || '');

    return { method, url, headers, body };
  }

  /**
   * 构建修改后的URL
   */
  private buildModifiedUrl(originalLog: TrafficLog, modifications?: any): string {
    if (modifications?.url) {
      return modifications.url;
    }

    let url = originalLog.url;

    // 如果有queryParams修改，重建URL
    if (modifications?.queryParams) {
      try {
        const urlObj = new URL(url);

        // 合并原始参数和新参数
        const originalParams = originalLog.query_params || {};
        const modifiedParams = modifications.queryParams;

        const allParams = { ...originalParams, ...modifiedParams };

        // 重建查询字符串
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(allParams)) {
          searchParams.append(key, String(value));
        }

        urlObj.search = searchParams.toString();
        url = urlObj.toString();

      } catch (error) {
        console.warn('[TrafficReplay] Failed to modify URL query params:', error);
      }
    }

    return url;
  }

  /**
   * 保存重放历史
   */
  private async saveReplayHistory(params: {
    originalLogId: number;
    modifiedRequest: any;
    replayResponse: any;
    comparison: any;
    modificationSummary: any;
    success?: boolean;
    errorMessage?: string;
  }): Promise<number> {
    try {
      const row = await createTrafficReplayHistory({
        original_log_id: params.originalLogId,
        replayed_by: 'admin',
        modified_method: params.modifiedRequest.method || null,
        modified_url: params.modifiedRequest.url || null,
        modified_headers: params.modifiedRequest.headers || {},
        modified_body: params.modifiedRequest.body || null,
        modification_summary: params.modificationSummary,
        replay_request_headers: params.modifiedRequest.headers || {},
        replay_request_body: params.modifiedRequest.body || null,
        replay_response_status: params.replayResponse.status || null,
        replay_duration_ms: params.replayResponse.duration || null,
        replay_response_headers: params.replayResponse.headers || {},
        replay_response_body: params.replayResponse.body || null,
        replay_response_size: params.replayResponse.size || null,
        diff_summary: this.comparator.generateDiffSummary(params.comparison) || {},
        status_code_match: params.comparison.statusMatch || false,
        response_body_match: params.comparison.bodyMatch || false,
        duration_diff_ms: params.comparison.durationDiff || null,
        body_size_diff: params.comparison.bodySizeDiff || null,
        success: params.success !== false,
        error_message: params.errorMessage || null
      });

      return Number(row.id) || 0;

    } catch (error) {
      console.error('[TrafficReplay] Failed to save replay history:', error);
      throw error;
    }
  }

  /**
   * 生成修改汇总
   */
  private generateModificationSummary(
    originalLog: TrafficLog,
    modifications?: any
  ): any {
    const fieldsModified: string[] = [];

    if (modifications?.method && modifications.method !== originalLog.method) {
      fieldsModified.push('method');
    }

    if (modifications?.url && modifications.url !== originalLog.url) {
      fieldsModified.push('url');
    }

    if (modifications?.headers) {
      const originalHeaders = originalLog.request_headers || {};
      for (const [key, value] of Object.entries(modifications.headers)) {
        if (originalHeaders[key] !== value) {
          fieldsModified.push(`headers.${key}`);
        }
      }
    }

    if (modifications?.body && modifications.body !== originalLog.request_body) {
      fieldsModified.push('body');
    }

    if (modifications?.queryParams) {
      fieldsModified.push('queryParams');
    }

    return {
      fieldsModified,
      modificationCount: fieldsModified.length
    };
  }

  /**
   * 转换Headers对象
   */
  private convertHeaders(headers: any): Record<string, string> {
    const result: Record<string, string> = {};

    if (headers && typeof headers.raw === 'function') {
      const raw = headers.raw();
      for (const [key, values] of Object.entries(raw)) {
        if (Array.isArray(values)) {
          result[key] = values.join(', ');
        } else {
          result[key] = String(values);
        }
      }
    }

    return result;
  }

  /**
   * 解析JSON字段
   */
  private parseJson(value: any): any {
    if (!value) {
      return null;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    return value;
  }
}
