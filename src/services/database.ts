import mysql from 'mysql2/promise';
import { DatabaseConfig, ConversationData, RequirementData, AgentPromptData, LogLevel } from '../types';
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
        charset: this.config.charset || 'utf8mb4',
        timezone: this.config.timezone || '+08:00',
        connectionLimit: 10,
        queueLimit: 0
      });

      this.moduleLogger.info('Database connection pool created successfully');
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
      const [rows] = await connection.execute('SELECT 1 as test');
      connection.release();

      this.moduleLogger.info('Database connection test successful');
      return Array.isArray(rows) && rows.length > 0;
    } catch (error) {
      this.moduleLogger.error('Database connection test failed', { error });
      return false;
    }
  }

  public async executeQuery<T = any>(
    query: string, 
    params: any[] = []
  ): Promise<T[]> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const [rows] = await this.pool.execute(query, params);
      
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
      this.moduleLogger.error('Query execution failed', { error, query });
      return [];
    }
  }

  public async executeUpdate(
    query: string, 
    params: any[] = []
  ): Promise<number> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const [result] = await this.pool.execute(query, params);
      const affectedRows = (result as mysql.ResultSetHeader).affectedRows;
      return affectedRows;
    } catch (error) {
      this.moduleLogger.error('Update execution failed', { error, query });
      return 0;
    }
  }

  public async executeBatch(
    query: string, 
    paramsList: any[][]
  ): Promise<number> {
    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        let totalAffected = 0;
        for (const params of paramsList) {
          const [result] = await connection.execute(query, params);
          totalAffected += (result as mysql.ResultSetHeader).affectedRows;
        }

        await connection.commit();
        connection.release();
        return totalAffected;
      } catch (error) {
        await connection.rollback();
        connection.release();
        throw error;
      }
    } catch (error) {
      this.moduleLogger.error('Batch execution failed', { error, query });
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
        id, user_id, user_message, ai_response, timestamp, response_time, 
        model_name, raw_request, raw_response, message_id, reply_to_message_id, reply_to_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        ai_response = VALUES(ai_response),
        response_time = VALUES(response_time),
        raw_request = VALUES(raw_request),
        raw_response = VALUES(raw_response),
        message_id = VALUES(message_id),
        reply_to_message_id = VALUES(reply_to_message_id),
        reply_to_text = VALUES(reply_to_text),
        updated_at = CURRENT_TIMESTAMP
    `;

    try {
      const params = [
        conversationData.id,
        conversationData.user_id,
        conversationData.user_message,
        conversationData.ai_response,
        conversationData.timestamp,
        conversationData.response_time,
        conversationData.model_name,
        conversationData.raw_request || null,
        conversationData.raw_response || null,
        conversationData.message_id || null,
        conversationData.reply_to_message_id || null,
        conversationData.reply_to_text || null
      ];

      const affectedRows = await this.executeUpdate(query, params);
      
      if (affectedRows > 0) {
        this.moduleLogger.info(`Conversation saved: ${conversationData.id}`);
        return true;
      }
      return false;
    } catch (error) {
      this.moduleLogger.error('Failed to save conversation', { error, id: conversationData.id });
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
      query = `SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT ${validLimit}`;
      params = [userId];
    } else {
      query = `SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ${validLimit}`;
      params = [];
    }

    return this.executeQuery<ConversationData>(query, params);
  }

  public async clearConversations(): Promise<number> {
    const query = 'DELETE FROM conversations';
    return this.executeUpdate(query);
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
    try {
      let query = `
        SELECT s.*, COUNT(mrc.id) as reply_chain_length
        FROM conversation_sessions s
        LEFT JOIN message_reply_chain mrc ON s.session_id = mrc.session_id
      `;
      const params: any[] = [];
      const conditions: string[] = [];

      if (userId) {
        conditions.push('s.user_id = ?');
        params.push(userId);
      }

      if (status) {
        conditions.push('s.status = ?');
        params.push(status);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' GROUP BY s.session_id ORDER BY s.last_activity DESC LIMIT ?';
      params.push(limit);

      return await this.executeQuery(query, params);
    } catch (error) {
      this.moduleLogger.error('Failed to get sessions', { error, userId, limit, status });
      return [];
    }
  }

  public async getSessionById(sessionId: string): Promise<any | null> {
    try {
      const query = `
        SELECT s.*, COUNT(mrc.id) as reply_chain_length
        FROM conversation_sessions s
        LEFT JOIN message_reply_chain mrc ON s.session_id = mrc.session_id
        WHERE s.session_id = ?
        GROUP BY s.session_id
      `;

      const results = await this.executeQuery(query, [sessionId]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      this.moduleLogger.error('Failed to get session by id', { error, sessionId });
      return null;
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

      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      return await this.executeQuery<RequirementData>(query, params);
    } catch (error) {
      this.moduleLogger.error('Failed to get requirements', { error });
      return [];
    }
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