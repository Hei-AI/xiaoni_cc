import mysql from 'mysql2/promise';
import { 
  DatabaseConfig, ConversationData, RequirementData, AgentPromptData, LogLevel,
  GroupChatSettings, GroupChatStats, GroupChatActivity, GroupChatOverview,
  PrivateChatSettings, LLMCallTrace, SessionLLMAnalysis
} from '../types';
import { logger } from '../utils/logger';

export class DatabaseManager {
  private pool: mysql.Pool | null = null;
  private config: DatabaseConfig;
  private moduleLogger = logger.createModuleLogger('database');

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.createConnectionPool();
  }

  private createConnectionPool(): void {
    try {
      this.pool = mysql.createPool({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        charset: 'utf8mb4',
        timezone: this.config.timezone || '+08:00',
        
        // 连接池配置优化
        connectionLimit: 10,           // 最大连接数
        queueLimit: 20,               // 等待队列限制

        // 连接超时配置
        connectTimeout: 30000,        // 连接超时30秒

        // 连接保持活跃
        idleTimeout: 300000,          // 空闲超时5分钟
        maxIdle: 5,                   // 最大空闲连接数

        // 其他优化设置
        dateStrings: false,           // 返回原生Date对象
        supportBigNumbers: true,      // 支持大数字
        bigNumberStrings: false,      // 不将大数字转为字符串
        waitForConnections: true      // 等待可用连接
        
      });

      this.moduleLogger.info('Optimized database connection pool created successfully', {
        connectionLimit: 10,
        queueLimit: 20,
        idleTimeout: 300000
      });
    } catch (error) {
      this.moduleLogger.error('Error creating connection pool', { error });
      this.pool = null;
    }
  }

  public async testConnection(): Promise<boolean> {
    try {
      if (!this.pool) {
        this.createConnectionPool();
      }

      const connection = await this.pool!.getConnection();
      
      // 设置连接字符集为UTF8MB4，确保中文正确显示
      await connection.execute("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
      await connection.execute("SET character_set_client = utf8mb4");
      await connection.execute("SET character_set_connection = utf8mb4");
      await connection.execute("SET character_set_results = utf8mb4");
      
      const [rows] = await connection.execute('SELECT 1 as test, "测试中文UTF8编码" as utf8_test');
      connection.release();

      this.moduleLogger.info('Database connection test successful with UTF-8 support');
      return Array.isArray(rows) && rows.length > 0;
    } catch (error) {
      this.moduleLogger.error('Database connection test failed', { error });
      return false;
    }
  }

  /**
   * 确保连接使用正确的UTF-8字符集设置 (现在主要由连接池initSql处理)
   */
  private async ensureUtf8Connection(connection: mysql.PoolConnection): Promise<void> {
    // initSql已经处理了UTF-8设置，这里保留作为后备
    // 在连接池配置有问题时确保字符集正确
    try {
      // 只检查字符集，不重复设置
      const [rows] = await connection.execute("SELECT @@character_set_connection, @@character_set_results") as [any[], any];
      const charset = rows[0];
      
      if (charset['@@character_set_connection'] !== 'utf8mb4' || charset['@@character_set_results'] !== 'utf8mb4') {
        this.moduleLogger.debug('Connection charset not utf8mb4, setting manually');
        await connection.execute("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to verify/set UTF-8 character set on connection', { error });
    }
  }

  public async executeQuery<T = any>(
    query: string, 
    params: any[] = []
  ): Promise<T[]> {
    const startTime = Date.now();
    const queryId = Math.random().toString(36).substr(2, 8);
    let connection: any = null;
    
    this.moduleLogger.debug(`[${queryId}] Starting query execution`, {
      queryPreview: query.substring(0, 100),
      paramCount: params.length
    });
    
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      this.moduleLogger.debug(`[${queryId}] Getting connection from pool`);
      connection = await this.pool.getConnection();
      
      this.moduleLogger.debug(`[${queryId}] Connection acquired, setting UTF-8`);
      // 确保连接使用UTF-8字符集
      await this.ensureUtf8Connection(connection);
      
      this.moduleLogger.debug(`[${queryId}] Executing query with params`);
      const [rows] = await connection.execute(query, params);
      
      this.moduleLogger.debug(`[${queryId}] Query executed, releasing connection`);
      connection.release();
      connection = null;
      
      const executionTime = Date.now() - startTime;
      this.moduleLogger.debug(`[${queryId}] Query completed successfully`, {
        executionTime,
        rowCount: Array.isArray(rows) ? rows.length : 0
      });
      
      // 处理日期时间序列化
      if (Array.isArray(rows)) {
        return rows.map((row: any) => {
          const processedRow = { ...row };
          Object.keys(processedRow).forEach(key => {
            if (processedRow[key] instanceof Date) {
              processedRow[key] = processedRow[key].toISOString();
            }
          });
          return processedRow;
        });
      }

      return [];
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.moduleLogger.error(`[${queryId}] Database query execution failed`, {
        error: error instanceof Error ? {
          message: error.message,
          code: (error as any).code,
          sqlState: (error as any).sqlState,
          errno: (error as any).errno
        } : error,
        query: query.substring(0, 200),
        queryLength: query.length,
        paramCount: params.length,
        executionTime
      });
      
      // 确保连接被释放，即使查询失败或超时
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          this.moduleLogger.error(`[${queryId}] Failed to release connection`, { releaseError });
        }
      }
      
      throw error; // 重新抛出异常，不允许静默处理
    }
  }

  public async executeUpdate(
    query: string, 
    params: any[] = []
  ): Promise<number> {
    const updateId = Math.random().toString(36).substr(2, 8);
    let connection: mysql.PoolConnection | null = null;
    
    this.moduleLogger.debug(`[${updateId}] Starting update execution`, {
      queryPreview: query.substring(0, 100),
      paramCount: params.length
    });
    
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      connection = await this.pool.getConnection();
      this.moduleLogger.debug(`[${updateId}] Connection acquired, setting UTF-8`);
      
      // 确保连接使用UTF-8字符集
      await this.ensureUtf8Connection(connection);
      
      this.moduleLogger.debug(`[${updateId}] Executing update with params`);
      const [result] = await connection.execute(query, params);
      
      this.moduleLogger.debug(`[${updateId}] Update executed, releasing connection`);
      connection.release();
      connection = null;
      
      const affectedRows = (result as mysql.ResultSetHeader).affectedRows;
      this.moduleLogger.debug(`[${updateId}] Update completed successfully`, {
        affectedRows
      });
      
      return affectedRows;
    } catch (error) {
      this.moduleLogger.error(`[${updateId}] Update execution failed`, { 
        error,
        query: query.substring(0, 200),
        paramCount: params.length
      });
      
      // 确保连接被释放，即使更新失败
      if (connection) {
        try {
          connection.release();
          this.moduleLogger.debug(`[${updateId}] Connection released after error`);
        } catch (releaseError) {
          this.moduleLogger.error(`[${updateId}] Failed to release connection after error`, { releaseError });
        }
      }
      
      return 0;
    }
  }

  public async executeBatch(
    query: string, 
    paramsList: any[][]
  ): Promise<number> {
    const batchId = Math.random().toString(36).substr(2, 8);
    let connection: mysql.PoolConnection | null = null;
    
    this.moduleLogger.debug(`[${batchId}] Starting batch execution`, {
      queryPreview: query.substring(0, 100),
      batchSize: paramsList.length
    });
    
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      connection = await this.pool.getConnection();
      this.moduleLogger.debug(`[${batchId}] Connection acquired, setting UTF-8`);
      
      // 确保连接使用UTF-8字符集
      await this.ensureUtf8Connection(connection);
      
      this.moduleLogger.debug(`[${batchId}] Starting transaction`);
      await connection.beginTransaction();

      try {
        let totalAffected = 0;
        for (let i = 0; i < paramsList.length; i++) {
          const params = paramsList[i];
          const [result] = await connection.execute(query, params);
          totalAffected += (result as mysql.ResultSetHeader).affectedRows;
        }

        this.moduleLogger.debug(`[${batchId}] Committing transaction`);
        await connection.commit();
        
        this.moduleLogger.debug(`[${batchId}] Transaction completed, releasing connection`);
        connection.release();
        connection = null;
        
        this.moduleLogger.debug(`[${batchId}] Batch completed successfully`, {
          totalAffected,
          batchSize: paramsList.length
        });
        
        return totalAffected;
      } catch (transactionError) {
        this.moduleLogger.warn(`[${batchId}] Transaction failed, rolling back`);
        if (connection) { await connection.rollback(); }
        throw transactionError;
      }
    } catch (error) {
      this.moduleLogger.error(`[${batchId}] Batch execution failed`, { 
        error,
        query: query.substring(0, 200),
        batchSize: paramsList.length
      });
      
      // 确保连接被释放，即使批处理失败
      if (connection) {
        try {
          connection.release();
          this.moduleLogger.debug(`[${batchId}] Connection released after error`);
        } catch (releaseError) {
          this.moduleLogger.error(`[${batchId}] Failed to release connection after error`, { releaseError });
        }
      }
      
      return 0;
    }
  }

  // 对话相关方法
  public async getConversationById(conversationId: string): Promise<ConversationData | null> {
    const query = 'SELECT * FROM conversations WHERE id = ?';
    const results = await this.executeQuery<ConversationData>(query, [conversationId]);
    return results.length > 0 ? results[0] : null;
  }

  public async saveConversation(conversationData: ConversationData): Promise<boolean> {
    const query = `
      INSERT INTO conversations (
        id, trace_id, user_id, user_message, ai_response, timestamp, response_time, 
        model_name, raw_request, raw_response, message_id, reply_to_message_id, reply_to_text, 
        session_id, status, error_reason, group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        trace_id = VALUES(trace_id),
        ai_response = VALUES(ai_response),
        response_time = VALUES(response_time),
        raw_request = VALUES(raw_request),
        raw_response = VALUES(raw_response),
        message_id = VALUES(message_id),
        reply_to_message_id = VALUES(reply_to_message_id),
        reply_to_text = VALUES(reply_to_text),
        session_id = VALUES(session_id),
        status = VALUES(status),
        error_reason = VALUES(error_reason),
        group_id = VALUES(group_id),
        updated_at = CURRENT_TIMESTAMP
    `;

    try {
      const params = [
        conversationData.id,
        conversationData.trace_id || null,
        conversationData.user_id,
        conversationData.user_message,
        conversationData.ai_response || null,
        conversationData.timestamp,
        conversationData.response_time,
        conversationData.model_name || null,
        conversationData.raw_request || null,
        conversationData.raw_response || null,
        conversationData.message_id || null,
        conversationData.reply_to_message_id || null,
        conversationData.reply_to_text || null,
        conversationData.session_id || null,
        conversationData.status,
        conversationData.error_reason || null,
        conversationData.group_id || null
      ];

      const affectedRows = await this.executeUpdate(query, params);
      
      if (affectedRows > 0) {
        this.moduleLogger.info(`Conversation saved: ${conversationData.id}`, { 
          status: conversationData.status,
          hasError: !!conversationData.error_reason 
        });
        return true;
      }
      return false;
    } catch (error) {
      this.moduleLogger.error('Failed to save conversation', { error, id: conversationData.id });
      return false;
    }
  }

  // 新增：更新conversation状态的专用方法
  public async updateConversationStatus(
    conversationId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'filtered_receive_events' | 'filtered_disabled' | 'filtered_no_response',
    errorReason?: string,
    aiResponse?: string,
    responseTime?: number,
    modelName?: string,
    rawResponse?: string
  ): Promise<boolean> {
    const query = `
      UPDATE conversations 
      SET status = ?, error_reason = ?, ai_response = ?, response_time = ?, 
          model_name = ?, raw_response = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    try {
      const params = [
        status,
        errorReason || null,
        aiResponse || null,
        responseTime || 0,
        modelName || null,
        rawResponse || null,
        conversationId
      ];

      const affectedRows = await this.executeUpdate(query, params);
      
      if (affectedRows > 0) {
        this.moduleLogger.info(`Conversation status updated: ${conversationId}`, { 
          status, 
          hasError: !!errorReason,
          hasResponse: !!aiResponse 
        });
        return true;
      }
      
      this.moduleLogger.warn(`No conversation found to update: ${conversationId}`);
      return false;
    } catch (error) {
      this.moduleLogger.error('Failed to update conversation status', { 
        error, 
        conversationId, 
        status 
      });
      return false;
    }
  }

  public async getConversations(
    userId?: number, 
    limit: number = 50
  ): Promise<ConversationData[]> {
    let query: string;
    let params: any[];

    // 确保limit是有效的数字
    const validLimit = Math.max(1, Math.min(Math.floor(Number(limit)) || 50, 1000));

    if (userId) {
      query = 'SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?';
      params = [userId, validLimit];
    } else {
      query = 'SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ?';
      params = [validLimit];
    }

    return this.executeQuery<ConversationData>(query, params);
  }

  /**
   * 扩展的对话查询方法 - 支持分页、筛选和搜索
   */
  public async getConversationsPaginated(
    queryParams: import('../types').ConversationQueryParams
  ): Promise<{
    conversations: ConversationData[];
    totalCount: number;
    pagination: import('../types').ConversationPagination;
  }> {
    const {
      user_id,
      page = 1,
      limit = 50,
      start_date,
      end_date,
      search,
      model_name,
      sort_order = 'desc',
      include_raw = false
    } = queryParams;

    // 参数验证和处理
    const validPage = Math.max(1, Math.floor(Number(page)) || 1);
    const validLimit = Math.max(1, Math.min(Math.floor(Number(limit)) || 50, 1000));
    const offset = (validPage - 1) * validLimit;
    const sortDirection = sort_order === 'asc' ? 'ASC' : 'DESC';

    // 构建查询条件
    const conditions: string[] = [];
    const params: any[] = [];

    if (user_id) {
      conditions.push('user_id = ?');
      params.push(user_id);
    }

    if (start_date) {
      conditions.push('DATE(timestamp) >= ?');
      params.push(start_date);
    }

    if (end_date) {
      conditions.push('DATE(timestamp) <= ?');
      params.push(end_date);
    }

    if (model_name) {
      conditions.push('model_name = ?');
      params.push(model_name);
    }

    // 搜索条件
    let searchCondition = '';
    if (search && search.trim()) {
      // 使用LIKE进行简单搜索（可后续优化为全文搜索）
      searchCondition = '(user_message LIKE ? OR ai_response LIKE ?)';
      const searchTerm = `%${search.trim()}%`;
      params.push(searchTerm, searchTerm);
    }

    // 构建完整WHERE子句
    let whereClause = '';
    if (conditions.length > 0 || searchCondition) {
      const allConditions = [...conditions];
      if (searchCondition) {
        allConditions.push(searchCondition);
      }
      whereClause = 'WHERE ' + allConditions.join(' AND ');
    }

    // 选择字段（是否包含原始数据）
    const selectFields = include_raw 
      ? '*' 
      : 'id, user_id, user_message, ai_response, timestamp, response_time, model_name, message_id, reply_to_message_id, reply_to_text';

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM conversations ${whereClause}`;
    const countResult = await this.executeQuery<{ total: number }>(countQuery, [...params]);
    const totalCount = countResult[0]?.total || 0;

    // 查询数据 - LIMIT/OFFSET不支持参数绑定，使用字符串插值（已验证为安全数值）
    const dataQuery = `
      SELECT ${selectFields} 
      FROM conversations 
      ${whereClause}
      ORDER BY timestamp ${sortDirection}, id ${sortDirection}
      LIMIT ${parseInt(validLimit.toString())} OFFSET ${parseInt(offset.toString())}
    `;
    const conversations = await this.executeQuery<ConversationData>(dataQuery, params);

    // 构建分页信息
    const totalPages = Math.ceil(totalCount / validLimit);
    const pagination: import('../types').ConversationPagination = {
      current_page: validPage,
      total_pages: totalPages,
      per_page: validLimit,
      total_count: totalCount,
      has_next: validPage < totalPages,
      has_previous: validPage > 1
    };

    return {
      conversations,
      totalCount,
      pagination
    };
  }

  public async clearConversations(): Promise<number> {
    const query = 'DELETE FROM conversations';
    return this.executeUpdate(query);
  }

  /**
   * 根据trace_id获取相关的WebSocket日志和对话记录
   * 实现websocket_logs和conversations表的关联查询
   */
  public async getTraceDetails(traceId: string): Promise<{
    conversation: ConversationData | null;
    websocketLogs: any[];
    totalEvents: number;
  }> {
    try {
      // 获取对话记录
      const conversationQuery = 'SELECT * FROM conversations WHERE trace_id = ? LIMIT 1';
      const conversations = await this.executeQuery<ConversationData>(conversationQuery, [traceId]);
      const conversation = conversations.length > 0 ? conversations[0] : null;

      // 获取WebSocket日志
      const websocketQuery = `
        SELECT * FROM websocket_logs 
        WHERE trace_id = ? 
        ORDER BY timestamp ASC
      `;
      const websocketLogs = await this.executeQuery(websocketQuery, [traceId]);

      // 统计事件总数
      const totalEvents = websocketLogs.length;

      this.moduleLogger.debug('Retrieved trace details', {
        traceId,
        hasConversation: !!conversation,
        websocketEvents: totalEvents
      });

      return {
        conversation,
        websocketLogs,
        totalEvents
      };
    } catch (error) {
      this.moduleLogger.error('Failed to get trace details', { error, traceId });
      return {
        conversation: null,
        websocketLogs: [],
        totalEvents: 0
      };
    }
  }

  /**
   * 获取完整的调用链路分析
   * 包括WebSocket事件和AI处理流程的完整时间线
   */
  public async getFullTraceAnalysis(traceId: string): Promise<{
    timeline: Array<{
      timestamp: Date;
      type: 'websocket' | 'conversation' | 'llm_call';
      event: string;
      details: any;
      duration?: number;
    }>;
    summary: {
      totalDuration: number;
      websocketEvents: number;
      llmCalls: number;
      success: boolean;
    };
  }> {
    try {
      const traceDetails = await this.getTraceDetails(traceId);
      const timeline: Array<{
        timestamp: Date;
        type: 'websocket' | 'conversation' | 'llm_call';
        event: string;
        details: any;
        duration?: number;
      }> = [];

      // 添加WebSocket事件到时间线
      for (const wsLog of traceDetails.websocketLogs) {
        timeline.push({
          timestamp: new Date(wsLog.timestamp),
          type: 'websocket',
          event: `${wsLog.direction} ${wsLog.message_type}`,
          details: {
            status: wsLog.status,
            user_id: wsLog.user_id,
            group_id: wsLog.group_id,
            message_id: wsLog.message_id,
            processing_time_ms: wsLog.processing_time_ms,
            error_message: wsLog.error_message
          },
          duration: wsLog.processing_time_ms
        });
      }

      // 添加对话记录到时间线
      if (traceDetails.conversation) {
        const conv = traceDetails.conversation;
        timeline.push({
          timestamp: new Date(conv.timestamp),
          type: 'conversation',
          event: 'AI_RESPONSE',
          details: {
            status: conv.status,
            model_name: conv.model_name,
            response_time: conv.response_time,
            error_reason: conv.error_reason
          },
          duration: conv.response_time * 1000 // 转换为毫秒
        });
      }

      // 按时间排序
      timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // 计算总体统计
      const totalDuration = timeline.length > 1 
        ? timeline[timeline.length - 1].timestamp.getTime() - timeline[0].timestamp.getTime()
        : 0;

      const summary = {
        totalDuration,
        websocketEvents: traceDetails.websocketLogs.length,
        llmCalls: traceDetails.conversation ? 1 : 0,
        success: traceDetails.conversation?.status === 'completed'
      };

      return { timeline, summary };
    } catch (error) {
      this.moduleLogger.error('Failed to get full trace analysis', { error, traceId });
      return {
        timeline: [],
        summary: {
          totalDuration: 0,
          websocketEvents: 0,
          llmCalls: 0,
          success: false
        }
      };
    }
  }

  // 需求相关方法
  public async getRequirementById(requirementId: string): Promise<RequirementData | null> {
    const query = 'SELECT * FROM requirements WHERE id = ?';
    const results = await this.executeQuery<RequirementData>(query, [requirementId]);
    return results.length > 0 ? results[0] : null;
  }

  public async saveRequirement(requirementData: RequirementData): Promise<boolean> {
    const query = `
      INSERT INTO requirements (
        id, user_id, message, status, created_at, updated_at,
        claude_code_output, completion_details, error_message,
        processing_start_time, processing_end_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        updated_at = VALUES(updated_at),
        claude_code_output = VALUES(claude_code_output),
        completion_details = VALUES(completion_details),
        error_message = VALUES(error_message),
        processing_start_time = VALUES(processing_start_time),
        processing_end_time = VALUES(processing_end_time)
    `;

    try {
      const params = [
        requirementData.id,
        requirementData.user_id,
        requirementData.message,
        requirementData.status,
        requirementData.created_at,
        requirementData.updated_at,
        requirementData.claude_code_output || null,
        requirementData.completion_details || null,
        requirementData.error_message || null,
        requirementData.processing_start_time || null,
        requirementData.processing_end_time || null
      ];

      const affectedRows = await this.executeUpdate(query, params);
      
      if (affectedRows > 0) {
        this.moduleLogger.info(`Requirement saved: ${requirementData.id}`);
        return true;
      }
      return false;
    } catch (error) {
      this.moduleLogger.error('Failed to save requirement', { error, id: requirementData.id });
      return false;
    }
  }


  public async updateRequirementStatus(
    requirementId: string,
    status: string,
    updateFields: Record<string, any> = {}
  ): Promise<boolean> {
    const allowedFields = [
      'claude_code_output',
      'completion_details', 
      'error_message',
      'processing_start_time',
      'processing_end_time'
    ];

    const updateParts = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [status];

    Object.entries(updateFields).forEach(([field, value]) => {
      if (allowedFields.includes(field)) {
        updateParts.push(`${field} = ?`);
        params.push(value);
      }
    });

    const query = `UPDATE requirements SET ${updateParts.join(', ')} WHERE id = ?`;
    params.push(requirementId);

    const affectedRows = await this.executeUpdate(query, params);
    return affectedRows > 0;
  }

  // 系统日志相关方法
  public async logSystemEvent(
    level: LogLevel,
    module: string,
    message: string,
    extraData?: Record<string, any>
  ): Promise<void> {
    const query = `
      INSERT INTO system_logs (log_level, module_name, message, extra_data, timestamp)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    const params = [
      level.toUpperCase(),
      module,
      message,
      extraData ? JSON.stringify(extraData) : null
    ];

    await this.executeUpdate(query, params);
  }

  // 机器人状态相关方法
  public async updateBotStatus(
    botId: string,
    status: string,
    websocketConnected: boolean = false,
    httpServerRunning: boolean = false,
    errorMessage?: string
  ): Promise<boolean> {
    const query = `
      INSERT INTO bot_status (
        bot_id, status, websocket_connected, http_server_running,
        last_heartbeat, error_message, timestamp
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        websocket_connected = VALUES(websocket_connected),
        http_server_running = VALUES(http_server_running),
        last_heartbeat = VALUES(last_heartbeat),
        error_message = VALUES(error_message),
        timestamp = VALUES(timestamp)
    `;

    const params = [botId, status, websocketConnected, httpServerRunning, errorMessage || null];
    const affectedRows = await this.executeUpdate(query, params);
    return affectedRows > 0;
  }

  // 历史消息查询方法
  /**
   * 获取私聊历史消息（前N条）- 仅该用户与机器人的对话
   * @param userId QQ用户ID
   * @param limit 消息数量限制（默认20）
   * @returns 历史消息数组，按时间正序（最早的在前）
   */
  public async getPrivateMessageHistory(userId: number, limit: number = 20): Promise<ConversationData[]> {
    // 确保 limit 是整数，MySQL LIMIT 要求整数参数
    const safeLimit = Math.max(1, Math.floor(Number(limit)));
    
    const query = `SELECT * FROM conversations WHERE user_id = ? AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' OR raw_request IS NULL OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL) ORDER BY timestamp DESC LIMIT ${safeLimit}`;
    
    this.moduleLogger.debug('Executing private message history query', {
      userId,
      originalLimit: limit,
      safeLimit,
      query
    });
    
    const results = await this.executeQuery<ConversationData>(query, [userId]);
    
    this.moduleLogger.info('Retrieved private message history', {
      userId,
      count: results.length,
      limit
    });
    
    // 返回正序（最早的在前）
    return results.reverse();
  }

  /**
   * 获取群聊历史消息（前N条）- 该群所有成员的消息
   * @param groupId 群ID
   * @param limit 消息数量限制（默认20）
   * @returns 历史消息数组，按时间正序（最早的在前）
   */
  public async getGroupMessageHistory(groupId: number, limit: number = 20): Promise<ConversationData[]> {
    // 确保 limit 是整数，MySQL LIMIT 要求整数参数
    const safeLimit = Math.max(1, Math.floor(Number(limit)));
    
    const query = `
      SELECT c.*, 'group' as message_type FROM conversations c
      WHERE JSON_EXTRACT(c.raw_request, '$.group_id') = ?
        AND JSON_EXTRACT(c.raw_request, '$.message_type') = 'group'
      ORDER BY c.timestamp DESC 
      LIMIT ${safeLimit}
    `;
    
    this.moduleLogger.debug('Executing group message history query', {
      groupId,
      originalLimit: limit,
      safeLimit,
      query: query.replace(/\s+/g, ' ').trim()
    });
    
    const results = await this.executeQuery<ConversationData>(query, [groupId]);
    
    this.moduleLogger.info('Retrieved group message history', {
      groupId,
      count: results.length,
      limit
    });
    
    // 返回正序（最早的在前）
    return results.reverse();
  }

  /**
   * 获取消息上下文（智能检测私聊或群聊）
   * @param message 当前消息对象
   * @param limit 上下文消息数量
   * @returns 上下文消息数组
   */
  public async getMessageContext(message: any, limit: number = 20): Promise<ConversationData[]> {
    if (message.message_type === 'private') {
      return await this.getPrivateMessageHistory(message.user_id, limit);
    } else if (message.message_type === 'group' && message.group_id) {
      return await this.getGroupMessageHistory(message.group_id, limit);
    }
    
    return [];
  }

  // 统计相关方法
  public async getConversationStats(): Promise<Record<string, any>> {
    const query = `
      SELECT 
        COUNT(*) as total_conversations,
        COUNT(DISTINCT user_id) as unique_users,
        AVG(response_time) as avg_response_time,
        MIN(timestamp) as first_conversation,
        MAX(timestamp) as last_conversation
      FROM conversations
    `;

    const results = await this.executeQuery(query);
    return results.length > 0 ? results[0] : {};
  }

  public async getRequirementStats(): Promise<Record<string, any>[]> {
    const query = 'SELECT * FROM requirement_status_stats';
    return this.executeQuery(query);
  }

  // Agent Prompt 相关方法
  public async getAgentPrompt(agentType: string, promptName?: string): Promise<AgentPromptData | null> {
    let query: string;
    let params: any[];
    
    if (promptName) {
      query = 'SELECT * FROM agent_prompts WHERE agent_type = ? AND prompt_name = ? AND is_active = true ORDER BY version DESC LIMIT 1';
      params = [agentType, promptName];
    } else {
      query = 'SELECT * FROM agent_prompts WHERE agent_type = ? AND is_active = true ORDER BY version DESC LIMIT 1';
      params = [agentType];
    }

    try {
      const results = await this.executeQuery<AgentPromptData>(query, params);
      if (results.length > 0) {
        const prompt = results[0];
        // 解析JSON字段
        if (typeof prompt.system_instructions === 'string') {
          prompt.system_instructions = JSON.parse(prompt.system_instructions);
        }
        if (typeof prompt.context_variables === 'string') {
          prompt.context_variables = JSON.parse(prompt.context_variables);
        }
        if (typeof prompt.model_config === 'string') {
          prompt.model_config = JSON.parse(prompt.model_config);
        }
        return prompt;
      }
      return null;
    } catch (error) {
      this.moduleLogger.error('Failed to get agent prompt', { error, agentType, promptName });
      return null;
    }
  }

  public async saveAgentPrompt(promptData: AgentPromptData): Promise<boolean> {
    const query = `
      INSERT INTO agent_prompts (
        id, agent_type, prompt_name, system_instructions, user_prompt_template,
        context_variables, model_config, is_active, version, created_by,
        created_at, updated_at, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        system_instructions = VALUES(system_instructions),
        user_prompt_template = VALUES(user_prompt_template),
        context_variables = VALUES(context_variables),
        model_config = VALUES(model_config),
        is_active = VALUES(is_active),
        updated_at = VALUES(updated_at),
        description = VALUES(description)
    `;

    try {
      const params = [
        promptData.id,
        promptData.agent_type,
        promptData.prompt_name,
        JSON.stringify(promptData.system_instructions),
        promptData.user_prompt_template || null,
        JSON.stringify(promptData.context_variables || {}),
        JSON.stringify(promptData.model_config || {}),
        promptData.is_active,
        promptData.version,
        promptData.created_by,
        promptData.created_at,
        promptData.updated_at,
        promptData.description || null
      ];

      const affectedRows = await this.executeUpdate(query, params);
      
      if (affectedRows > 0) {
        this.moduleLogger.info(`Agent prompt saved: ${promptData.id}`);
        return true;
      }
      return false;
    } catch (error) {
      this.moduleLogger.error('Failed to save agent prompt', { error, id: promptData.id });
      return false;
    }
  }

  public async getAgentPrompts(agentType?: string): Promise<AgentPromptData[]> {
    let query: string;
    let params: any[];

    if (agentType) {
      query = 'SELECT * FROM agent_prompts WHERE agent_type = ? ORDER BY updated_at DESC';
      params = [agentType];
    } else {
      query = 'SELECT * FROM agent_prompts ORDER BY updated_at DESC';
      params = [];
    }

    try {
      const results = await this.executeQuery<AgentPromptData>(query, params);
      return results.map(prompt => {
        // 解析JSON字段
        if (typeof prompt.system_instructions === 'string') {
          prompt.system_instructions = JSON.parse(prompt.system_instructions);
        }
        if (typeof prompt.context_variables === 'string') {
          prompt.context_variables = JSON.parse(prompt.context_variables);
        }
        if (typeof prompt.model_config === 'string') {
          prompt.model_config = JSON.parse(prompt.model_config);
        }
        return prompt;
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get agent prompts', { error, agentType });
      return [];
    }
  }

  public async getAgentPromptById(id: string): Promise<AgentPromptData | null> {
    const query = 'SELECT * FROM agent_prompts WHERE id = ?';

    try {
      const results = await this.executeQuery<AgentPromptData>(query, [id]);
      if (results.length > 0) {
        const prompt = results[0];
        // 解析JSON字段
        if (typeof prompt.system_instructions === 'string') {
          prompt.system_instructions = JSON.parse(prompt.system_instructions);
        }
        if (typeof prompt.context_variables === 'string') {
          prompt.context_variables = JSON.parse(prompt.context_variables);
        }
        if (typeof prompt.model_config === 'string') {
          prompt.model_config = JSON.parse(prompt.model_config);
        }
        if (typeof prompt.advanced_config === 'string') {
          prompt.advanced_config = JSON.parse(prompt.advanced_config);
        }
        if (typeof prompt.allowed_token_ids === 'string') {
          prompt.allowed_token_ids = JSON.parse(prompt.allowed_token_ids);
        }
        return prompt;
      }
      return null;
    } catch (error) {
      this.moduleLogger.error('Failed to get agent prompt by id', { error, id });
      return null;
    }
  }

  public async deleteAgentPrompt(id: string): Promise<boolean> {
    const query = 'DELETE FROM agent_prompts WHERE id = ?';

    try {
      const affectedRows = await this.executeUpdate(query, [id]);
      if (affectedRows > 0) {
        this.moduleLogger.info(`Agent prompt deleted: ${id}`);
        return true;
      }
      return false;
    } catch (error) {
      this.moduleLogger.error('Failed to delete agent prompt', { error, id });
      return false;
    }
  }

  public async deactivateAgentPrompt(promptId: string): Promise<boolean> {
    const query = 'UPDATE agent_prompts SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
    const affectedRows = await this.executeUpdate(query, [promptId]);
    return affectedRows > 0;
  }

  // 数据清理方法
  public async cleanupOldData(daysToKeep: number = 30): Promise<Record<string, number>> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const connection = await this.pool.getConnection();
      const [results] = await connection.execute('CALL CleanOldData(?)', [daysToKeep]);
      connection.release();

      this.moduleLogger.info(`Cleaned up data older than ${daysToKeep} days`);
      return results as unknown as Record<string, number>;
    } catch (error) {
      this.moduleLogger.error('Data cleanup failed', { error });
      return {};
    }
  }

  // Session管理相关方法
  public async getSessions(userId?: number, limit: number = 50, status?: string): Promise<any[]> {
    // For now, always use the conversations fallback until session tables are properly set up
    this.moduleLogger.info('Using conversations fallback for sessions API', { userId, limit, status });
    return await this.getSessionsFromConversations(userId, limit, status);
  }

  public async getSessionById(sessionId: string): Promise<any | null> {
    // For now, always use the conversations fallback until session tables are properly set up
    this.moduleLogger.info('Using conversations fallback for session by ID', { sessionId });
    return await this.getSessionByIdFromConversations(sessionId);
  }

  private async getSessionByIdFromConversations(sessionId: string): Promise<any | null> {
    try {
      // Extract user_id and date from session_id format: session_{user_id}_{date}
      const sessionMatch = sessionId.match(/^session_(\d+)_(\d{4}-\d{2}-\d{2})$/);
      if (!sessionMatch) {
        this.moduleLogger.warn('Invalid session ID format', { sessionId });
        return null;
      }

      const userId = parseInt(sessionMatch[1]);
      const sessionDate = sessionMatch[2];

      const query = `
        SELECT 
          user_id,
          COUNT(*) as message_count,
          MIN(created_at) as created_at,
          MAX(created_at) as last_activity
        FROM conversations 
        WHERE user_id = ? AND DATE(created_at) = ?
        GROUP BY user_id
      `;
      
      const results = await this.executeQuery(query, [userId, sessionDate]);
      
      if (!results || results.length === 0) {
        return null;
      }

      const row = results[0];
      
      // Transform the result to match expected session format
      const session = {
        session_id: sessionId,
        user_id: row.user_id,
        session_type: 'chat' as const,
        status: 'active' as const,
        current_service: 'chat_service',
        service_transitions: [],
        message_count: row.message_count,
        created_at: row.created_at,
        last_activity: row.last_activity,
        reply_chain_length: 0
      };

      this.moduleLogger.info('Found session from conversations fallback', { sessionId, session });
      return session;
    } catch (error) {
      this.moduleLogger.error('Failed to get session by ID from conversations', { error, sessionId });
      return null;
    }
  }

  /**
   * Fallback method to create mock sessions from conversations table
   */
  private async getSessionsFromConversations(userId?: number, limit: number = 50, status?: string): Promise<any[]> {
    try {
      this.moduleLogger.info('Using conversations fallback for sessions', { userId, limit, status });
      
      let query = `
        SELECT 
          user_id,
          COUNT(*) as message_count,
          MIN(created_at) as created_at,
          MAX(created_at) as last_activity
        FROM conversations
      `;
      const params: any[] = [];
      const conditions: string[] = [];

      if (userId) {
        conditions.push('user_id = ?');
        params.push(userId);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' GROUP BY user_id ORDER BY MAX(created_at) DESC';

      this.moduleLogger.debug('Executing fallback query', { query, params });
      const results = await this.executeQuery(query, params);
      this.moduleLogger.info('Fallback query results', { count: results.length, results });
      
      const sessions = results.map(row => {
        const createdDate = new Date(row.created_at).toISOString().split('T')[0]; // YYYY-MM-DD format
        const session_id = `session_${row.user_id}_${createdDate}`;
        
        return {
          session_id,
          user_id: row.user_id,
          session_type: 'chat',
          status: status && status !== 'active' ? 'completed' : 'active', // Honor status filter
          current_service: 'chat_service',
          service_transitions: [],
          message_count: row.message_count,
          created_at: row.created_at,
          last_activity: row.last_activity
        };
      }).filter(session => {
        // Apply status filter if specified
        return !status || session.status === status;
      }).slice(0, limit); // Apply limit in JavaScript
      
      this.moduleLogger.info('Processed sessions', { finalCount: sessions.length });
      return sessions;
    } catch (error) {
      this.moduleLogger.error('Failed to get sessions from conversations', { error, userId, limit, status });
      return [];
    }
  }

  public async switchSessionService(sessionId: string, newService: string, reason?: string): Promise<boolean> {
    try {
      // 获取当前Session信息
      const currentSession = await this.getSessionById(sessionId);
      if (!currentSession) {
        return false;
      }

      // 更新服务切换历史
      let serviceTransitions = [];
      try {
        serviceTransitions = currentSession.service_transitions ? JSON.parse(currentSession.service_transitions) : [];
      } catch (e) {
        serviceTransitions = [];
      }

      serviceTransitions.push({
        from_service: currentSession.current_service,
        to_service: newService,
        timestamp: new Date().toISOString(),
        trigger: reason || 'USER_REQUEST',
        confidence: 0.95
      });

      // 更新Session
      const query = `
        UPDATE conversation_sessions 
        SET current_service = ?, 
            service_transitions = ?,
            last_activity = CURRENT_TIMESTAMP
        WHERE session_id = ?
      `;

      const affectedRows = await this.executeUpdate(query, [
        newService, 
        JSON.stringify(serviceTransitions),
        sessionId
      ]);

      return affectedRows > 0;
    } catch (error) {
      this.moduleLogger.error('Failed to switch session service', { error, sessionId, newService });
      return false;
    }
  }

  public async cleanupExpiredSessions(): Promise<number> {
    try {
      const query = `
        UPDATE conversation_sessions 
        SET status = 'expired', completed_at = CURRENT_TIMESTAMP
        WHERE status = 'active' 
          AND expires_at IS NOT NULL 
          AND expires_at < CURRENT_TIMESTAMP
      `;

      const affectedRows = await this.executeUpdate(query);
      
      if (affectedRows > 0) {
        this.moduleLogger.info(`Cleaned up ${affectedRows} expired sessions`);
      }

      return affectedRows;
    } catch (error) {
      this.moduleLogger.error('Failed to cleanup expired sessions', { error });
      return 0;
    }
  }

  public async createSession(sessionData: {
    session_id: string;
    user_id: number;
    session_type?: string;
    current_service?: string;
    expires_at?: Date;
    conversation_context?: any;
    business_context?: any;
  }): Promise<boolean> {
    try {
      const query = `
        INSERT INTO conversation_sessions 
        (session_id, user_id, session_type, current_service, expires_at, 
         conversation_context, business_context, created_at, last_activity)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      const params = [
        sessionData.session_id,
        sessionData.user_id,
        sessionData.session_type || 'chat',
        sessionData.current_service || 'chat_service',
        sessionData.expires_at || null,
        JSON.stringify(sessionData.conversation_context || {}),
        JSON.stringify(sessionData.business_context || {})
      ];

      const affectedRows = await this.executeUpdate(query, params);
      return affectedRows > 0;
    } catch (error) {
      this.moduleLogger.error('Failed to create session', { error, sessionData });
      return false;
    }
  }

  public async recordMessageChain(data: {
    message_id: string;
    reply_to_message_id?: string;
    user_id: number;
    session_id: string;
    depth?: number;
  }): Promise<boolean> {
    try {
      const query = `
        INSERT INTO message_reply_chain 
        (message_id, reply_to_message_id, user_id, session_id, depth)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          session_id = VALUES(session_id),
          depth = VALUES(depth)
      `;

      const params = [
        data.message_id,
        data.reply_to_message_id || null,
        data.user_id,
        data.session_id,
        data.depth || 0
      ];

      const affectedRows = await this.executeUpdate(query, params);
      return affectedRows > 0;
    } catch (error) {
      this.moduleLogger.error('Failed to record message chain', { error, data });
      return false;
    }
  }

  public async updateSessionActivity(sessionId: string, messageCount?: number): Promise<boolean> {
    try {
      let query = 'UPDATE conversation_sessions SET last_activity = CURRENT_TIMESTAMP';
      const params: any[] = [];

      if (messageCount !== undefined) {
        query += ', message_count = message_count + ?';
        params.push(messageCount);
      }

      query += ' WHERE session_id = ?';
      params.push(sessionId);

      const affectedRows = await this.executeUpdate(query, params);
      return affectedRows > 0;
    } catch (error) {
      this.moduleLogger.error('Failed to update session activity', { error, sessionId });
      return false;
    }
  }

  public async getSessionHistory(sessionId: string, limit: number = 20): Promise<any[]> {
    try {
      const query = `
        SELECT c.user_message, c.ai_response, c.created_at, c.message_id,
               mrc.depth, c.user_id, c.response_time, c.model_name
        FROM message_reply_chain mrc
        LEFT JOIN conversations c ON mrc.message_id = c.message_id
        WHERE mrc.session_id = ?
        ORDER BY mrc.depth ASC, c.created_at ASC
        LIMIT ?
      `;

      return await this.executeQuery(query, [sessionId, limit]);
    } catch (error) {
      this.moduleLogger.error('Failed to get session history', { error, sessionId });
      return [];
    }
  }

  // 修复getRequirements方法以支持status过滤
  public async getRequirements(userId?: number, limit: number = 50, status?: string): Promise<RequirementData[]> {
    try {
      let query = 'SELECT * FROM requirements';
      const params: any[] = [];
      const conditions: string[] = [];

      if (userId !== undefined) {
        conditions.push('user_id = ?');
        params.push(userId);
      }

      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ` ORDER BY created_at DESC LIMIT ${parseInt(limit.toString())}`;

      return await this.executeQuery<RequirementData>(query, params);
    } catch (error) {
      this.moduleLogger.error('Failed to get requirements', { error });
      return [];
    }
  }

  // Group Chat Management Methods
  
  /**
   * 获取群聊设置
   */
  public async getGroupChatSettings(groupId?: number): Promise<GroupChatSettings[]> {
    try {
      let query = 'SELECT * FROM group_chat_settings';
      const params: any[] = [];
      
      if (groupId) {
        query += ' WHERE group_id = ?';
        params.push(groupId);
      }
      
      query += ' ORDER BY created_at DESC';
      
      return await this.executeQuery<GroupChatSettings>(query, params);
    } catch (error) {
      this.moduleLogger.error('Failed to get group chat settings', { error, groupId });
      return [];
    }
  }
  
  /**
   * 获取单个群聊设置
   */
  public async getGroupChatSettingById(groupId: number): Promise<GroupChatSettings | null> {
    try {
      const results = await this.getGroupChatSettings(groupId);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      this.moduleLogger.error('Failed to get group chat setting by ID', { error, groupId });
      return null;
    }
  }

  /**
   * 获取单个私聊设置
   */
  public async getPrivateChatSettingById(userId: number): Promise<PrivateChatSettings | null> {
    try {
      const query = `
        SELECT user_id, username, is_enabled, auto_reply_enabled, welcome_message, user_notes,
               created_at, updated_at, last_activity
        FROM private_chat_settings 
        WHERE user_id = ?
      `;
      const results = await this.executeQuery(query, [userId]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      this.moduleLogger.error('Failed to get private chat setting by ID', { error, userId });
      return null;
    }
  }
  
  /**
   * 保存或更新群聊设置
   */
  public async saveGroupChatSettings(settings: GroupChatSettings): Promise<boolean> {
    try {
      const query = `
        INSERT INTO group_chat_settings (
          group_id, group_name, is_enabled, auto_reply_enabled, 
          welcome_message, admin_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          group_name = VALUES(group_name),
          is_enabled = VALUES(is_enabled),
          auto_reply_enabled = VALUES(auto_reply_enabled),
          welcome_message = VALUES(welcome_message),
          admin_user_id = VALUES(admin_user_id),
          updated_at = VALUES(updated_at)
      `;
      
      const params = [
        settings.group_id,
        settings.group_name || null,
        settings.is_enabled,
        settings.auto_reply_enabled,
        settings.welcome_message || null,
        settings.admin_user_id || null,
        settings.created_at || new Date(),
        new Date()
      ];
      
      const affectedRows = await this.executeUpdate(query, params);
      
      if (affectedRows > 0) {
        this.moduleLogger.info(`Group chat settings saved: ${settings.group_id}`);
        return true;
      }
      return false;
    } catch (error) {
      this.moduleLogger.error('Failed to save group chat settings', { error, settings });
      return false;
    }
  }
  
  /**
   * 更新群聊设置
   */
  public async updateGroupChatSettings(
    groupId: number, 
    updateData: Partial<GroupChatSettings>
  ): Promise<boolean> {
    try {
      const allowedFields = [
        'group_name', 'is_enabled', 'auto_reply_enabled', 
        'welcome_message', 'admin_user_id'
      ];
      
      const updateParts = ['updated_at = CURRENT_TIMESTAMP'];
      const params: any[] = [];
      
      Object.entries(updateData).forEach(([field, value]) => {
        if (allowedFields.includes(field) && value !== undefined) {
          updateParts.push(`${field} = ?`);
          params.push(value);
        }
      });
      
      if (updateParts.length === 1) {
        this.moduleLogger.warn('No valid fields to update', { groupId, updateData });
        return false;
      }
      
      const query = `UPDATE group_chat_settings SET ${updateParts.join(', ')} WHERE group_id = ?`;
      params.push(groupId);
      
      const affectedRows = await this.executeUpdate(query, params);
      
      if (affectedRows > 0) {
        this.moduleLogger.info(`Group chat settings updated: ${groupId}`, updateData);
      }
      
      return affectedRows > 0;
    } catch (error) {
      this.moduleLogger.error('Failed to update group chat settings', { error, groupId, updateData });
      return false;
    }
  }
  
  /**
   * 删除群聊设置
   */
  public async deleteGroupChatSettings(groupId: number): Promise<boolean> {
    try {
      const query = 'DELETE FROM group_chat_settings WHERE group_id = ?';
      const affectedRows = await this.executeUpdate(query, [groupId]);
      
      if (affectedRows > 0) {
        this.moduleLogger.info(`Group chat settings deleted: ${groupId}`);
      }
      
      return affectedRows > 0;
    } catch (error) {
      this.moduleLogger.error('Failed to delete group chat settings', { error, groupId });
      return false;
    }
  }
  
  /**
   * 批量操作群聊设置
   */
  public async bulkUpdateGroupChatSettings(
    groupIds: number[], 
    updateData: Partial<GroupChatSettings>
  ): Promise<{ successful: number; failed: number; results: Array<{ group_id: number; success: boolean; message?: string }> }> {
    const results: Array<{ group_id: number; success: boolean; message?: string }> = [];
    let successful = 0;
    let failed = 0;
    
    for (const groupId of groupIds) {
      try {
        const success = await this.updateGroupChatSettings(groupId, updateData);
        if (success) {
          successful++;
          results.push({ group_id: groupId, success: true });
        } else {
          failed++;
          results.push({ group_id: groupId, success: false, message: 'No rows affected' });
        }
      } catch (error) {
        failed++;
        results.push({
          group_id: groupId,
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    this.moduleLogger.info(`Bulk group settings update completed`, {
      total: groupIds.length,
      successful,
      failed
    });
    
    return { successful, failed, results };
  }
  
  /**
   * 获取群聊统计概览
   */
  public async getGroupChatOverview(): Promise<GroupChatOverview[]> {
    try {
      const query = 'SELECT * FROM group_chat_overview ORDER BY total_messages DESC, last_activity DESC';
      return await this.executeQuery<GroupChatOverview>(query);
    } catch (error) {
      this.moduleLogger.error('Failed to get group chat overview', { error });
      return [];
    }
  }
  
  /**
   * 获取群聊活动统计
   */
  public async getGroupChatStats(groupId?: number, days: number = 30): Promise<GroupChatStats[]> {
    try {
      let query = `
        SELECT * FROM group_chat_stats 
        WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      `;
      const params: any[] = [days];
      
      if (groupId) {
        query += ' AND group_id = ?';
        params.push(groupId);
      }
      
      query += ' ORDER BY date DESC, group_id ASC';
      
      return await this.executeQuery<GroupChatStats>(query, params);
    } catch (error) {
      this.moduleLogger.error('Failed to get group chat stats', { error, groupId });
      return [];
    }
  }
  
  /**
   * 更新群聊活跃度
   */
  public async updateGroupActivity(
    groupId: number, 
    messageCount: number = 1, 
    aiResponseCount: number = 0
  ): Promise<boolean> {
    try {
      // 直接使用SQL插入/更新群聊设置，避免依赖存储过程
      const query = `
        INSERT INTO group_chat_settings (group_id, is_enabled, updated_at) 
        VALUES (?, 1, NOW())
        ON DUPLICATE KEY UPDATE updated_at = NOW()
      `;
      await this.executeUpdate(query, [groupId]);
      
      this.moduleLogger.debug('Group activity updated', {
        groupId,
        messageCount,
        aiResponseCount
      });
      
      return true;
    } catch (error) {
      this.moduleLogger.error('Failed to update group activity', { 
        error, 
        groupId, 
        messageCount, 
        aiResponseCount 
      });
      return false;
    }
  }
  
  /**
   * 记录群聊活动
   */
  public async recordGroupActivity(activity: GroupChatActivity): Promise<boolean> {
    try {
      const query = `
        INSERT INTO group_chat_activity (group_id, user_id, message_type, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      const params = [
        activity.group_id,
        activity.user_id,
        activity.message_type,
        activity.content || null,
        activity.created_at || new Date()
      ];
      
      const affectedRows = await this.executeUpdate(query, params);
      return affectedRows > 0;
    } catch (error) {
      this.moduleLogger.error('Failed to record group activity', { error, activity });
      return false;
    }
  }
  
  /**
   * 获取群聊总体统计信息
   */
  public async getGroupChatGlobalStats(): Promise<{
    total_groups: number;
    enabled_groups: number;
    disabled_groups: number;
    total_messages_today: number;
    total_ai_responses_today: number;
    most_active_groups: Array<{
      group_id: number;
      group_name?: string;
      message_count: number;
      ai_responses: number;
    }>;
  }> {
    try {
      // 获取群聊基本统计
      const basicStatsQuery = `
        SELECT 
          COUNT(*) as total_groups,
          SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END) as enabled_groups,
          SUM(CASE WHEN is_enabled = 0 THEN 1 ELSE 0 END) as disabled_groups
        FROM group_chat_settings
      `;
      
      const basicStats = await this.executeQuery(basicStatsQuery);
      
      // 获取今日消息统计
      const todayStatsQuery = `
        SELECT 
          COALESCE(SUM(message_count), 0) as total_messages_today,
          COALESCE(SUM(ai_responses), 0) as total_ai_responses_today
        FROM group_chat_stats 
        WHERE date = CURDATE()
      `;
      
      const todayStats = await this.executeQuery(todayStatsQuery);
      
      // 获取最活跃的群聊 (最近7天)
      const activeGroupsQuery = `
        SELECT 
          gcs.group_id,
          gcs.group_name,
          COALESCE(SUM(gst.message_count), 0) as message_count,
          COALESCE(SUM(gst.ai_responses), 0) as ai_responses
        FROM group_chat_settings gcs
        LEFT JOIN group_chat_stats gst ON gcs.group_id = gst.group_id 
          AND gst.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        WHERE gcs.is_enabled = 1
        GROUP BY gcs.group_id, gcs.group_name
        HAVING message_count > 0
        ORDER BY message_count DESC, ai_responses DESC
        LIMIT 5
      `;
      
      const activeGroups = await this.executeQuery(activeGroupsQuery);
      
      return {
        total_groups: basicStats[0]?.total_groups || 0,
        enabled_groups: basicStats[0]?.enabled_groups || 0,
        disabled_groups: basicStats[0]?.disabled_groups || 0,
        total_messages_today: todayStats[0]?.total_messages_today || 0,
        total_ai_responses_today: todayStats[0]?.total_ai_responses_today || 0,
        most_active_groups: activeGroups.map((row: any) => ({
          group_id: row.group_id,
          group_name: row.group_name,
          message_count: row.message_count,
          ai_responses: row.ai_responses
        }))
      };
    } catch (error) {
      this.moduleLogger.error('Failed to get group chat global stats', { error });
      return {
        total_groups: 0,
        enabled_groups: 0,
        disabled_groups: 0,
        total_messages_today: 0,
        total_ai_responses_today: 0,
        most_active_groups: []
      };
    }
  }
  
  /**
   * 清理群聊历史数据
   */
  public async cleanupGroupChatData(daysToKeep: number = 30): Promise<{
    activity_logs_deleted: number;
    stats_deleted: number;
  }> {
    try {
      // 调用存储过程清理数据
      await this.executeUpdate('CALL CleanupGroupChatData(?)', [daysToKeep]);
      
      // 获取清理结果（简化实现）
      const activityResult = await this.executeQuery(
        'SELECT ROW_COUNT() as deleted_count'
      );
      
      this.moduleLogger.info(`Group chat data cleanup completed`, {
        daysToKeep,
        timestamp: new Date().toISOString()
      });
      
      return {
        activity_logs_deleted: activityResult[0]?.deleted_count || 0,
        stats_deleted: 0 // 存储过程会处理，这里简化返回
      };
    } catch (error) {
      this.moduleLogger.error('Failed to cleanup group chat data', { error, daysToKeep });
      return {
        activity_logs_deleted: 0,
        stats_deleted: 0
      };
    }
  }

  // =============================================================================
  // LLM Call Trace Methods
  // =============================================================================

  /**
   * Save LLM call trace to database
   */
  public async saveLLMCallTrace(trace: LLMCallTrace): Promise<void> {
    const query = `
      INSERT INTO llm_call_traces 
      (id, session_id, conversation_id, call_sequence, engine_type, model_name, 
       request, response, prompt_tokens, completion_tokens, total_tokens, 
       response_time, timestamp, success, error_message) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      trace.id,
      trace.session_id,
      trace.conversation_id || null,
      trace.call_sequence,
      trace.engine_type,
      trace.model_name || null,
      trace.request || null,
      trace.response || null,
      trace.prompt_tokens || 0,
      trace.completion_tokens || 0,
      trace.total_tokens || 0,
      trace.response_time,
      trace.timestamp,
      trace.success,
      trace.error_message || null
    ];

    await this.executeQuery(query, params);
    
    this.moduleLogger.debug('LLM call trace saved', {
      traceId: trace.id,
      sessionId: trace.session_id,
      engineType: trace.engine_type,
      success: trace.success
    });
  }

  /**
   * Get all LLM traces for a session
   */
  public async getSessionLLMTraces(sessionId: string): Promise<LLMCallTrace[]> {
    const query = `
      SELECT * FROM llm_call_traces 
      WHERE session_id = ? 
      ORDER BY call_sequence ASC, timestamp ASC
    `;
    
    const results = await this.executeQuery<LLMCallTrace>(query, [sessionId]);
    
    this.moduleLogger.debug('Retrieved session LLM traces', {
      sessionId,
      count: results.length
    });
    
    return results;
  }

  /**
   * Get LLM traces for a specific conversation
   */
  public async getConversationLLMTraces(conversationId: string): Promise<LLMCallTrace[]> {
    const query = `
      SELECT * FROM llm_call_traces 
      WHERE conversation_id = ? 
      ORDER BY call_sequence ASC, timestamp ASC
    `;
    
    return this.executeQuery<LLMCallTrace>(query, [conversationId]);
  }

  /**
   * Get next call sequence number for a session
   */
  public async getNextCallSequence(sessionId: string): Promise<number> {
    const query = `
      SELECT COALESCE(MAX(call_sequence), 0) + 1 as next_sequence 
      FROM llm_call_traces 
      WHERE session_id = ?
    `;
    
    const results = await this.executeQuery(query, [sessionId]);
    return results[0]?.next_sequence || 1;
  }

  /**
   * Analyze LLM usage for a session
   */
  public async analyzeSessionLLMCalls(sessionId: string): Promise<SessionLLMAnalysis> {
    const traces = await this.getSessionLLMTraces(sessionId);
    
    if (traces.length === 0) {
      return {
        session_id: sessionId,
        total_calls: 0,
        total_tokens: 0,
        total_cost_estimate: 0,
        average_response_time: 0,
        engine_breakdown: {},
        call_timeline: [],
        success_rate: 0
      };
    }

    const totalCalls = traces.length;
    const totalTokens = traces.reduce((sum, trace) => sum + (trace.total_tokens || 0), 0);
    const totalResponseTime = traces.reduce((sum, trace) => sum + trace.response_time, 0);
    const successfulCalls = traces.filter(trace => trace.success).length;
    
    // Engine breakdown
    const engineBreakdown: Record<string, number> = {};
    traces.forEach(trace => {
      engineBreakdown[trace.engine_type] = (engineBreakdown[trace.engine_type] || 0) + 1;
    });

    // Simple cost estimation (adjust rates as needed)
    // Gemini 1.5 Pro: ~$0.00125 per 1K input tokens, ~$0.005 per 1K output tokens
    const estimatedCost = totalTokens * 0.003; // Average estimate per 1K tokens

    return {
      session_id: sessionId,
      total_calls: totalCalls,
      total_tokens: totalTokens,
      total_cost_estimate: estimatedCost,
      average_response_time: totalCalls > 0 ? totalResponseTime / totalCalls : 0,
      engine_breakdown: engineBreakdown,
      call_timeline: traces,
      success_rate: totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 0
    };
  }

  /**
   * Clean up old LLM traces (older than specified days)
   */
  public async cleanupOldLLMTraces(daysOld: number = 30): Promise<number> {
    const query = `
      DELETE FROM llm_call_traces 
      WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    
    const result = await this.executeQuery(query, [daysOld]);
    const deletedCount = (result as any).affectedRows || 0;
    
    this.moduleLogger.info('Cleaned up old LLM traces', {
      daysOld,
      deletedCount
    });
    
    return deletedCount;
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.moduleLogger.info('Database connection pool closed');
    }
  }
}

// 单例模式
let databaseManager: DatabaseManager | null = null;

export function getDatabaseManager(config: DatabaseConfig): DatabaseManager {
  if (!databaseManager) {
    databaseManager = new DatabaseManager(config);
  }
  return databaseManager;
}

export default DatabaseManager;