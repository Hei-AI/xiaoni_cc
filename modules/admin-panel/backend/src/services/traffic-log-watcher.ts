/**
 * HTTP流量日志文件监听服务
 * 使用chokidar监听JSONL日志文件变化，增量导入到MySQL
 * 支持日志文件轮转（按天）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as chokidar from 'chokidar';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

const MYSQL_INT_UNSIGNED_MAX = Math.pow(2, 32) - 1;

// ==================== 类型定义 ====================

interface WatcherConfig {
  logDir: string;              // 日志目录
  filePattern: string;         // glob模式
  batchSize: number;           // 批量插入大小
}

interface FileState {
  filePath: string;
  fileInode: bigint;
  lastPosition: bigint;
  lastSize: bigint;
  recordsImported: number;
}

interface TrafficLogRecord {
  request_id: string;
  trace_id?: string;
  conversation_id?: string;
  user_id?: string;
  session_id?: string;
  agent_turn?: number | null;
  llm_call_id?: string;
  tool_call_id?: string;
  container_name?: string;
  service_name?: string;
  method: string;
  url: string;
  host: string;
  path: string;
  query_params?: any;
  request_headers: any;
  request_body?: string;
  request_content_type?: string;
  request_size?: number;
  response_status?: number;
  response_headers?: any;
  response_body?: string;
  response_content_type?: string;
  response_size?: number;
  duration_ms?: number | null;
  request_timestamp: string;
  response_timestamp?: string;
  is_ai_request?: boolean;
  api_type?: string;
  api_version?: string;
  client_ip?: string;
  user_agent?: string;
  error_message?: string;
}

interface ApiClassification {
  is_ai_request: boolean;
  api_type?: string;
}

// ==================== TrafficLogWatcher类 ====================

export class TrafficLogWatcher {
  private db: DatabaseManager;
  private logger: winston.Logger;
  private config: WatcherConfig;
  private watcher: chokidar.FSWatcher | null = null;
  private fileStates: Map<string, FileState> = new Map();
  private isRunning: boolean = false;
  private processingLocks: Set<string> = new Set(); // 防止并发处理同一文件

  constructor(
    db: DatabaseManager,
    logger: winston.Logger,
    config: Partial<WatcherConfig> = {}
  ) {
    this.db = db;
    this.logger = logger;
    this.config = {
      logDir: config.logDir || '/app/logs/traffic',
      filePattern: config.filePattern || 'traffic-*.jsonl',
      batchSize: config.batchSize || 100
    };
  }

  /**
   * 启动监听服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('[TrafficLogWatcher] Service already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('[TrafficLogWatcher] Starting service...', {
      logDir: this.config.logDir,
      filePattern: this.config.filePattern
    });

    try {
      // 确保日志目录存在
      if (!fs.existsSync(this.config.logDir)) {
        this.logger.error('[TrafficLogWatcher] Log directory does not exist:', this.config.logDir);
        return;
      }

      // 使用chokidar监听日志文件
      // 注意：监听目录而不是glob模式，因为Docker volume可能不支持glob
      const watchPath = this.config.logDir;

      this.logger.info(`[TrafficLogWatcher] Watching directory: ${watchPath}`);

      this.watcher = chokidar.watch(watchPath, {
        persistent: true,
        ignoreInitial: false,    // 处理现有文件
        usePolling: true,         // 兼容Docker volumes
        interval: 1000           // 轮询间隔1秒
      });

      // 监听文件添加事件（包括初始扫描）
      this.watcher.on('add', (filePath: string) => {
        // 只处理匹配的JSONL文件
        if (!filePath.endsWith('.jsonl') || !path.basename(filePath).startsWith('traffic-')) {
          return;
        }
        this.logger.info(`[TrafficLogWatcher] File detected: ${path.basename(filePath)}`);
        this.processFileDebounced(filePath);
      });

      // 监听文件变化事件
      this.watcher.on('change', (filePath: string) => {
        // 只处理匹配的JSONL文件
        if (!filePath.endsWith('.jsonl') || !path.basename(filePath).startsWith('traffic-')) {
          return;
        }
        this.logger.info(`[TrafficLogWatcher] File changed: ${path.basename(filePath)}`);
        this.processFileDebounced(filePath);
      });

      // 监听错误事件
      this.watcher.on('error', (error: unknown) => {
        this.logger.error('[TrafficLogWatcher] Watcher error:', error);
      });

      // 监听就绪事件
      this.watcher.on('ready', () => {
        this.logger.info('[TrafficLogWatcher] Initial scan complete, watching for changes');
      });

      this.logger.info('[TrafficLogWatcher] Service started successfully');
    } catch (error) {
      this.logger.error('[TrafficLogWatcher] Failed to start service:', error);
      throw error;
    }
  }

  /**
   * 停止监听服务
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('[TrafficLogWatcher] Stopping service...');
    this.isRunning = false;

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.logger.info('[TrafficLogWatcher] Service stopped');
  }

  /**
   * 防抖处理文件（避免短时间内重复处理）
   */
  private processFileDebounced(filePath: string): void {
    // 检查是否正在处理
    if (this.processingLocks.has(filePath)) {
      return;
    }

    this.processingLocks.add(filePath);

    this.processFile(filePath)
      .catch(err => {
        this.logger.error(`[TrafficLogWatcher] Failed to process file ${path.basename(filePath)}:`, err);
      })
      .finally(() => {
        // 延迟释放锁，避免立即重复处理
        setTimeout(() => {
          this.processingLocks.delete(filePath);
        }, 1000);
      });
  }

  /**
   * 处理文件 - 增量读取新数据
   */
  private async processFile(filePath: string): Promise<void> {
    try {
      // 加载文件状态
      let state = await this.loadFileState(filePath);

      // 检查文件是否有变化
      const stats = fs.statSync(filePath);
      const currentSize = BigInt(stats.size);
      const currentInode = BigInt(stats.ino);

      // 文件大小没变化，跳过
      if (currentSize === state.lastSize && state.lastPosition >= currentSize) {
        this.logger.debug(`[TrafficLogWatcher] No new data in ${path.basename(filePath)}`);
        return;
      }

      // 文件inode变化（文件被替换），从头开始读
      if (state.fileInode !== BigInt(0) && currentInode !== state.fileInode) {
        this.logger.info(`[TrafficLogWatcher] File inode changed, resetting: ${path.basename(filePath)}`);
        state.lastPosition = BigInt(0);
      }

      // 从last_position开始读取
      const stream = fs.createReadStream(filePath, {
        start: Number(state.lastPosition),
        encoding: 'utf8'
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      let buffer: TrafficLogRecord[] = [];
      let currentPosition = Number(state.lastPosition);
      let lineNumber = 0;
      let recordsImported = 0;

      for await (const line of rl) {
        lineNumber++;

        // 跳过空行和文件头
        if (!line.trim() || line.includes('log_file_header')) {
          currentPosition += Buffer.byteLength(line, 'utf8') + 1;
          continue;
        }

        try {
          const record = JSON.parse(line);
          const transformedRecord = this.transformRecord(record);
          buffer.push(transformedRecord);

          // 批量插入
          if (buffer.length >= this.config.batchSize) {
            await this.insertBatch(buffer);
            recordsImported += buffer.length;
            buffer = [];
          }

          currentPosition += Buffer.byteLength(line, 'utf8') + 1;
        } catch (error) {
          this.logger.error(`[TrafficLogWatcher] Parse error at line ${lineNumber}:`, error);
          currentPosition += Buffer.byteLength(line, 'utf8') + 1;
        }
      }

      // 插入剩余数据
      if (buffer.length > 0) {
        await this.insertBatch(buffer);
        recordsImported += buffer.length;
      }

      // 更新文件状态
      state.fileInode = currentInode;
      state.lastSize = currentSize;
      state.lastPosition = BigInt(currentPosition);
      state.recordsImported += recordsImported;
      await this.saveFileState(state);

      if (recordsImported > 0) {
        this.logger.info(`[TrafficLogWatcher] Imported ${recordsImported} records from ${path.basename(filePath)}`);
      }

    } catch (error) {
      this.logger.error(`[TrafficLogWatcher] Failed to process file ${path.basename(filePath)}:`, error);
      throw error;
    }
  }

  /**
   * 加载文件状态
   */
  private async loadFileState(filePath: string): Promise<FileState> {
    // 先从内存缓存查找
    if (this.fileStates.has(filePath)) {
      return this.fileStates.get(filePath)!;
    }

    try {
      const results = await this.db.executeQuery<any>(
        'SELECT * FROM log_import_state WHERE file_path = ?',
        [filePath]
      );

      if (results.length > 0) {
        const row = results[0];
        const state: FileState = {
          filePath: row.file_path,
          fileInode: BigInt(row.file_inode || 0),
          lastPosition: BigInt(row.last_position || 0),
          lastSize: BigInt(row.file_size || 0),
          recordsImported: row.records_imported || 0
        };
        this.fileStates.set(filePath, state);
        return state;
      }

      // 创建新状态
      const newState: FileState = {
        filePath,
        fileInode: BigInt(0),
        lastPosition: BigInt(0),
        lastSize: BigInt(0),
        recordsImported: 0
      };

      await this.db.executeUpdate(
        `INSERT INTO log_import_state (file_path, file_inode, file_size, last_position, status, import_started_at)
         VALUES (?, 0, 0, 0, 'active', NOW())`,
        [filePath]
      );

      this.fileStates.set(filePath, newState);
      return newState;

    } catch (error) {
      this.logger.error('[TrafficLogWatcher] Failed to load file state:', error);
      throw error;
    }
  }

  /**
   * 保存文件状态
   */
  private async saveFileState(state: FileState): Promise<void> {
    try {
      await this.db.executeUpdate(
        `UPDATE log_import_state
         SET file_inode = ?, file_size = ?, last_position = ?,
             records_imported = ?, last_import_time = NOW()
         WHERE file_path = ?`,
        [
          state.fileInode.toString(),
          state.lastSize.toString(),
          state.lastPosition.toString(),
          state.recordsImported,
          state.filePath
        ]
      );

      // 更新内存缓存
      this.fileStates.set(state.filePath, state);

    } catch (error) {
      this.logger.error('[TrafficLogWatcher] Failed to save file state:', error);
      throw error;
    }
  }

  /**
   * 批量插入数据库
   */
  private async insertBatch(records: TrafficLogRecord[]): Promise<void> {
    const acceptedRecords = records.filter((record) => this.shouldPersistRecord(record));
    if (acceptedRecords.length === 0) {
      return;
    }

    try {
      // 生成占位符：(?,?,?,...), (?,?,?,...), ...
      const placeholders = acceptedRecords.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');

      const sql = `
        INSERT INTO http_traffic_logs (
          trace_id, conversation_id, user_id, session_id, agent_turn, llm_call_id, tool_call_id,
          container_name, service_name, request_id,
          method, url, host, path, query_params,
          request_headers, request_body, request_content_type, request_size,
          response_status, response_headers, response_body, response_content_type, response_size,
          duration_ms, request_timestamp, response_timestamp,
          is_ai_request, api_type, api_version,
          client_ip, user_agent, error_message
        ) VALUES ${placeholders}
      `;

      // 扁平化参数数组
      const params: any[] = [];
      for (const record of acceptedRecords) {
        params.push(
          record.trace_id || null,
          record.conversation_id || null,
          record.user_id || null,
          record.session_id || null,
          record.agent_turn ?? null,
          record.llm_call_id || null,
          record.tool_call_id || null,
          record.container_name || 'provider-service',
          record.service_name || null,
          record.request_id,
          record.method,
          record.url,
          record.host,
          record.path,
          record.query_params ? JSON.stringify(record.query_params) : null,
          JSON.stringify(record.request_headers),
          record.request_body || null,
          record.request_content_type || null,
          record.request_size || 0,
          record.response_status || null,
          record.response_headers ? JSON.stringify(record.response_headers) : null,
          record.response_body || null,
          record.response_content_type || null,
          record.response_size || 0,
          record.duration_ms ?? null,
          this.convertToMySQLDatetime(record.request_timestamp),
          record.response_timestamp ? this.convertToMySQLDatetime(record.response_timestamp) : null,
          record.is_ai_request || false,
          record.api_type || null,
          record.api_version || null,
          record.client_ip || null,
          record.user_agent || null,
          record.error_message || null
        );
      }

      await this.db.executeUpdate(sql, params);

    } catch (error) {
      this.logger.error('[TrafficLogWatcher] Batch insert failed:', error);
      if (acceptedRecords.length === 1) {
        throw error;
      }
      await this.insertIndividually(acceptedRecords, error);
    }
  }

  private async insertIndividually(records: TrafficLogRecord[], batchError: unknown): Promise<void> {
    this.logger.warn('[TrafficLogWatcher] Falling back to per-record insert after batch failure', {
      recordCount: records.length,
      error: batchError instanceof Error ? batchError.message : String(batchError)
    });

    let inserted = 0;
    for (const record of records) {
      try {
        await this.insertBatch([record]);
        inserted += 1;
      } catch (recordError) {
        this.logger.error('[TrafficLogWatcher] Skipping invalid traffic record', {
          requestId: record.request_id,
          traceId: record.trace_id,
          url: record.url,
          error: recordError instanceof Error ? recordError.message : String(recordError)
        });
      }
    }

    this.logger.info('[TrafficLogWatcher] Per-record fallback finished', {
      inserted,
      skipped: records.length - inserted
    });
  }

  /**
   * 转换JSONL记录为数据库格式
   */
  private transformRecord(record: any): TrafficLogRecord {
    let host = '';
    let path = '';
    let queryParams = null;

    try {
      const url = new URL(record.url || '');
      host = url.hostname;
      path = url.pathname;
      if (url.search) {
        queryParams = Object.fromEntries(url.searchParams);
      }
    } catch {
      host = record.host || '';
      path = record.path || '/';
    }

    const normalizedApi = this.normalizeApiClassification(
      host,
      path,
      Boolean(record.is_ai_request),
      record.api_type || null
    );

    return {
      trace_id: record.trace_id || record.traceId,
      conversation_id: record.conversation_id || record.conversationId || null,
      user_id: record.user_id || record.userId || null,
      session_id: record.session_id || record.sessionId || null,
      agent_turn: this.normalizeInteger(record.agent_turn ?? record.agentTurn),
      llm_call_id: record.llm_call_id || record.llmCallId || null,
      tool_call_id: record.tool_call_id || record.toolCallId || null,
      container_name: record.container_name || record.containerName || 'provider-service',
      service_name: record.service_name || record.serviceName,
      request_id: record.request_id || record.requestId || record.id || this.generateRequestId(),
      method: record.method || 'GET',
      url: record.url || '',
      host,
      path,
      query_params: queryParams,
      request_headers: record.request_headers || {},
      request_body: record.request_body,
      request_content_type: record.request_content_type,
      request_size: record.request_size,
      response_status: record.response_status,
      response_headers: record.response_headers,
      response_body: record.response_body,
      response_content_type: record.response_content_type,
      response_size: record.response_size,
      duration_ms: this.normalizeDuration(record.duration_ms),
      request_timestamp: record.request_timestamp || new Date().toISOString(),
      response_timestamp: record.response_timestamp,
      is_ai_request: normalizedApi.is_ai_request,
      api_type: normalizedApi.api_type,
      api_version: record.api_version,
      client_ip: record.client_ip,
      user_agent: record.user_agent,
      error_message: record.error_message
    };
  }

  private normalizeApiClassification(
    host: string,
    path: string,
    isAiRequest: boolean,
    apiType: string | null
  ): ApiClassification {
    const normalizedHost = host.toLowerCase();
    const normalizedPath = path.toLowerCase();

    if (normalizedHost === 'chatgpt.com' && normalizedPath.startsWith('/backend-api/codex/')) {
      return {
        is_ai_request: true,
        api_type: 'codex'
      };
    }

    if (isAiRequest) {
      return {
        is_ai_request: true,
        api_type: apiType || 'other'
      };
    }

    return {
      is_ai_request: false,
      api_type: apiType || undefined
    };
  }

  private shouldPersistRecord(record: TrafficLogRecord): boolean {
    if (record.is_ai_request) {
      return true;
    }

    if (record.trace_id || record.conversation_id || record.session_id || record.llm_call_id || record.tool_call_id) {
      return true;
    }

    const normalizedPath = (record.path || '').toLowerCase();
    const normalizedUrl = (record.url || '').toLowerCase();
    const normalizedContentType = (record.request_content_type || '').toLowerCase();

    const isStaticAsset =
      normalizedPath.endsWith('.js') ||
      normalizedPath.endsWith('.css') ||
      normalizedPath.endsWith('.map') ||
      normalizedPath.endsWith('.png') ||
      normalizedPath.endsWith('.jpg') ||
      normalizedPath.endsWith('.jpeg') ||
      normalizedPath.endsWith('.svg') ||
      normalizedPath.endsWith('.ico') ||
      normalizedPath.endsWith('.woff') ||
      normalizedPath.endsWith('.woff2');

    if (isStaticAsset || normalizedPath.includes('/logs') || normalizedUrl.includes('/logs')) {
      return false;
    }

    const isRelevantInternalRequest =
      normalizedPath.startsWith('/api/internal/llm/debug') ||
      normalizedPath.startsWith('/api/simple-queue/') ||
      normalizedPath.startsWith('/api/simulate/') ||
      normalizedPath.startsWith('/api/test/simulate-message') ||
      normalizedPath.startsWith('/api/internal/send_private') ||
      normalizedPath.startsWith('/api/internal/send_group') ||
      normalizedPath.startsWith('/api/traffic/replay') ||
      normalizedPath.startsWith('/playground/');

    const isStructuredApiRequest =
      normalizedContentType.includes('application/json') ||
      normalizedContentType.includes('application/x-www-form-urlencoded');

    return isRelevantInternalRequest && isStructuredApiRequest;
  }

  /**
   * 生成请求ID
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 转换ISO 8601时间戳为MySQL DATETIME格式
   */
  private convertToMySQLDatetime(isoTimestamp: string): string {
    try {
      const date = new Date(isoTimestamp);
      if (isNaN(date.getTime())) {
        // 无效时间戳，使用当前时间
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
      }
      // 转换为 'YYYY-MM-DD HH:MM:SS' 格式
      return date.toISOString().slice(0, 19).replace('T', ' ');
    } catch {
      return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
  }

  /**
   * 规范化耗时字段，避免插入负数或超出MySQL取值范围
   */
  private normalizeDuration(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    let numericValue: number;

    if (typeof value === 'number') {
      numericValue = value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      numericValue = Number(trimmed);
    } else {
      return null;
    }

    if (!Number.isFinite(numericValue)) {
      this.logger.debug('[TrafficLogWatcher] Ignoring non-numeric duration_ms value:', value);
      return null;
    }

    if (numericValue < 0) {
      this.logger.debug(`[TrafficLogWatcher] duration_ms value ${numericValue} < 0, clamping to 0`);
      return 0;
    }

    if (numericValue > MYSQL_INT_UNSIGNED_MAX) {
      this.logger.debug(
        `[TrafficLogWatcher] duration_ms value ${numericValue} exceeds MySQL limit, clamping to ${MYSQL_INT_UNSIGNED_MAX}`
      );
      return MYSQL_INT_UNSIGNED_MAX;
    }

    return Math.round(numericValue);
  }

  private normalizeInteger(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const numericValue = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(numericValue)) {
      return null;
    }

    return Math.trunc(numericValue);
  }
}

// ==================== 默认配置 ====================

export const DEFAULT_WATCHER_CONFIG = {
  logDir: '/app/logs/traffic',
  filePattern: 'traffic-*.jsonl',
  batchSize: 100
};
