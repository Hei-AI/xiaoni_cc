import mysql from 'mysql2/promise';
import winston from 'winston';

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  charset: string;
  timezone: string;
}

interface ConversationData {
  id: string;
  user_id: number;
  user_message: string;
  ai_response: string;
  timestamp: Date;
  response_time: number;
  model_name?: string;
  raw_request?: string;
  raw_response?: string;
  message_id?: number;
  reply_to_message_id?: number;
  reply_to_text?: string;
  created_at: Date;
  updated_at: Date;
}

interface RequirementData {
  id: string;
  user_id: number;
  message: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: Date;
  updated_at: Date;
  claude_code_output?: string;
  completion_details?: string;
  error_message?: string;
  processing_start_time?: Date;
  processing_end_time?: Date;
}

interface SessionData {
  session_id: string;
  user_id: number;
  session_type: 'chat' | 'requirement' | 'mixed';
  current_service: string;
  status: 'active' | 'paused' | 'completed' | 'expired';
  created_at: Date;
  last_activity: Date;
  expires_at?: Date;
  conversation_context?: any;
  business_context?: any;
  message_count: number;
}

export class DatabaseManager {
  private pool: mysql.Pool | null = null;
  private config: DatabaseConfig;
  private logger: winston.Logger;

  constructor(config: DatabaseConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
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
        timezone: '+08:00',
        connectionLimit: 10,
        queueLimit: 0
      });

      this.logger.info('Database connection pool initialized (Admin Backend)', {
        connectionLimit: 10,
        queueLimit: 0
      });
    } catch (error) {
      this.logger.error('Error creating connection pool', { error });
      this.pool = null;
    }
  }

  private handleConnectionLost(): void {
    this.logger.warn('Connection lost, attempting to recreate pool...');
    if (this.pool) {
      try {
        this.pool.end();
      } catch (error) {
        this.logger.warn('Error closing old pool', { error });
      }
      this.pool = null;
    }
    // 立即重建连接池，不等待
    this.createConnectionPool();
  }

  public async testConnection(): Promise<boolean> {
    try {
      // 绕过连接池，直接创建连接进行测试
      const connection = await mysql.createConnection({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        charset: 'utf8mb4',
        timezone: '+08:00'
      });
      
      await connection.ping();
      await connection.end();
      this.logger.info('Database connection test successful (direct connection)');
      return true;
    } catch (error) {
      this.logger.error('Database connection test failed (direct connection)', { error });
      return false;
    }
  }

  public async executeQuery<T>(query: string, params: any[] = []): Promise<T[]> {
    try {
      // 临时使用直连方式，绕过连接池问题
      const connection = await mysql.createConnection({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        charset: 'utf8mb4',
        timezone: '+08:00'
      });
      
      try {
        const [rows] = await connection.execute(query, params);
        return Array.isArray(rows) ? rows.map((row: any) => {
          const processedRow = { ...row };
          Object.keys(processedRow).forEach(key => {
            if (processedRow[key] instanceof Date) {
              processedRow[key] = processedRow[key].toISOString();
            }
          });
          return processedRow;
        }) : [];
      } finally {
        await connection.end();
      }
    } catch (error) {
      this.logger.error('Database query failed', { query, params, error });
      throw error;
    }
  }

  public async executeUpdate(query: string, params: any[] = []): Promise<number> {
    try {
      if (!this.pool) {
        this.createConnectionPool();
      }
      // 直接使用连接池的execute方法，让连接池自动管理连接
      const [result] = await this.pool!.execute(query, params) as [mysql.ResultSetHeader, mysql.FieldPacket[]];
      return result.affectedRows;
    } catch (error) {
      this.logger.error('Database update failed', { query, params, error });
      throw error;
    }
  }

  public async executeInsert(query: string, params: any[] = []): Promise<{ insertId: number; affectedRows: number }> {
    try {
      if (!this.pool) {
        this.createConnectionPool();
      }
      // 直接使用连接池的execute方法，让连接池自动管理连接
      const [result] = await this.pool!.execute(query, params) as [mysql.ResultSetHeader, mysql.FieldPacket[]];
      return {
        insertId: result.insertId,
        affectedRows: result.affectedRows
      };
    } catch (error) {
      this.logger.error('Database insert failed', { query, params, error });
      throw error;
    }
  }

  // Conversation相关方法
  public async getConversations(options: {
    limit?: number;
    offset?: number;
    userId?: string;
    search?: string;
  } = {}): Promise<{ data: ConversationData[]; total: number }> {
    const { limit = 20, offset = 0, userId, search } = options;
    
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (userId) {
      whereClause += ' AND user_id = ?';
      params.push(parseInt(userId));
    }

    if (search) {
      whereClause += ' AND (user_message LIKE ? OR ai_response LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    // 正确的参数顺序：先是where条件参数，再是limit和offset
    
    try {
      // 获取总数
      const totalQuery = `SELECT COUNT(*) as total FROM conversations ${whereClause}`;
      const totalResult = await this.executeQuery<{ total: number }>(totalQuery, [...params]);
      const total = totalResult[0]?.total || 0;

      // 获取数据 - LIMIT/OFFSET不支持参数绑定，使用字符串插值（已验证为安全数值）
      const dataQuery = `
        SELECT id, user_id, user_message, ai_response, timestamp, response_time, 
               model_name, message_id, reply_to_message_id, reply_to_text, 
               created_at, updated_at
        FROM conversations 
        ${whereClause}
        ORDER BY timestamp DESC 
        LIMIT ${parseInt(limit.toString())} OFFSET ${parseInt(offset.toString())}
      `;
      
      // 只传递WHERE条件参数，LIMIT/OFFSET已嵌入查询
      const data = await this.executeQuery<ConversationData>(dataQuery, params);

      this.logger.info('Conversations query executed successfully', { 
        dataCount: data.length, 
        total, 
        limit, 
        offset,
        params: params // 只传递WHERE条件参数
      });

      return { data, total };
    } catch (error) {
      // 记录详细错误信息并重新抛出错误
      this.logger.error('Failed to query conversations table', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        whereClause,
        params: params, // 显示实际使用的参数
        limit,
        offset,
        queryType: 'conversations'
      });
      throw error; // 重新抛出错误，不允许静默处理
    }
  }

  public async getConversationById(id: string): Promise<ConversationData | null> {
    try {
      const query = `
        SELECT id, user_id, user_message, ai_response, timestamp, response_time, 
               model_name, message_id, reply_to_message_id, reply_to_text, 
               created_at, updated_at
        FROM conversations 
        WHERE id = ?
      `;
      const result = await this.executeQuery<ConversationData>(query, [id]);
      return result[0] || null;
    } catch (error) {
      this.logger.warn('Failed to get conversation by ID', { error, id });
      return null;
    }
  }

  // Requirements相关方法
  public async getRequirements(options: {
    limit?: number;
    offset?: number;
    status?: string;
  } = {}): Promise<{ data: RequirementData[]; total: number }> {
    const { limit = 20, offset = 0, status } = options;
    
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }


    try {
      // 获取总数
      const totalQuery = `SELECT COUNT(*) as total FROM requirements ${whereClause}`;
      const totalResult = await this.executeQuery<{ total: number }>(totalQuery, params);
      const total = totalResult[0]?.total || 0;

      // 获取数据 - LIMIT/OFFSET不支持参数绑定，使用字符串插值（已验证为安全数值）
      const dataQuery = `
        SELECT id, user_id, message, status, claude_code_output, completion_details, 
               error_message, processing_start_time, processing_end_time, 
               created_at, updated_at
        FROM requirements 
        ${whereClause}
        ORDER BY created_at DESC 
        LIMIT ${parseInt(limit.toString())} OFFSET ${parseInt(offset.toString())}
      `;
      
      const data = await this.executeQuery<RequirementData>(dataQuery, params);

      return { data, total };
    } catch (error) {
      this.logger.error('Failed to query requirements table', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        whereClause,
        params: params,
        limit,
        offset,
        queryType: 'requirements'
      });
      throw error; // 重新抛出错误，不允许静默处理
    }
  }

  // Sessions相关方法
  public async getSessions(options: {
    limit?: number;
    offset?: number;
    status?: string;
    userId?: string;
  } = {}): Promise<{ data: SessionData[]; total: number }> {
    const { limit = 20, offset = 0, status, userId } = options;
    
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (userId) {
      whereClause += ' AND user_id = ?';
      params.push(parseInt(userId));
    }


    try {
      // 获取总数
      const totalQuery = `SELECT COUNT(*) as total FROM conversation_sessions ${whereClause}`;
      const totalResult = await this.executeQuery<{ total: number }>(totalQuery, params);
      const total = totalResult[0]?.total || 0;

      // 获取数据 - LIMIT/OFFSET不支持参数绑定，使用字符串插值（已验证为安全数值）
      const dataQuery = `
        SELECT session_id, user_id, session_type, current_service, status, 
               created_at, last_activity, expires_at, message_count
        FROM conversation_sessions 
        ${whereClause}
        ORDER BY last_activity DESC 
        LIMIT ${parseInt(limit.toString())} OFFSET ${parseInt(offset.toString())}
      `;
      
      const data = await this.executeQuery<SessionData>(dataQuery, params);

      return { data, total };
    } catch (error) {
      this.logger.error('Failed to query conversation_sessions table', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        whereClause,
        params: params,
        limit,
        offset,
        queryType: 'sessions'
      });
      throw error; // 重新抛出错误，不允许静默处理
    }
  }

  // 系统统计方法
  public async getDashboardStats(): Promise<{
    totalMessages: number;
    activeGroups: number;
    aiResponses: number;
    systemHealth: string;
  }> {
    try {
      // 获取总对话数
      const messageResult = await this.executeQuery<{ count: number }>('SELECT COUNT(*) as count FROM conversations', []);
      const totalMessages = messageResult[0]?.count || 0;

      // 获取AI响应数（成功的对话）
      const aiResponseResult = await this.executeQuery<{ count: number }>(
        'SELECT COUNT(*) as count FROM conversations WHERE ai_response IS NOT NULL AND ai_response != ""', []
      );
      const aiResponses = aiResponseResult[0]?.count || 0;

      // 模拟活跃群组数（可以后续实现）
      const activeGroups = 15;

      // 根据数据库连接状态判断系统健康度
      const isHealthy = await this.testConnection();
      const systemHealth = isHealthy ? 'excellent' : 'warning';

      return {
        totalMessages,
        activeGroups,
        aiResponses,
        systemHealth
      };
    } catch (error) {
      this.logger.error('Failed to get dashboard stats', { error });
      return {
        totalMessages: 0,
        activeGroups: 0,
        aiResponses: 0,
        systemHealth: 'error'
      };
    }
  }

  // Prompt binding methods
  public async getAgentPromptById(id: string): Promise<any | null> {
    const query = 'SELECT * FROM agent_prompts WHERE id = ?';
    try {
      const results = await this.executeQuery<any>(query, [id]);
      if (results.length > 0) {
        const prompt = results[0];
        // Parse JSON fields
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
      this.logger.error('Failed to get agent prompt by id', { error, id });
      return null;
    }
  }

  public async updatePrivateChatPrompt(userId: number, promptId: string | null): Promise<boolean> {
    try {
      const query = `
        INSERT INTO private_chat_settings (
          user_id, agent_prompt_id, is_enabled, auto_reply_enabled, created_at, updated_at
        ) VALUES (?, ?, TRUE, TRUE, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          agent_prompt_id = VALUES(agent_prompt_id),
          updated_at = NOW()
      `;

      const affectedRows = await this.executeUpdate(query, [userId, promptId]);

      if (affectedRows > 0) {
        this.logger.info('Private chat prompt mapping updated', { userId, promptId });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to update private chat prompt', { error, userId, promptId });
      return false;
    }
  }

  public async updateGroupChatPrompt(groupId: number, promptId: string | null): Promise<boolean> {
    try {
      const query = `
        INSERT INTO group_chat_settings (
          group_id, agent_prompt_id, is_enabled, auto_reply_enabled, receive_events, created_at, updated_at
        ) VALUES (?, ?, TRUE, TRUE, TRUE, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          agent_prompt_id = VALUES(agent_prompt_id),
          updated_at = NOW()
      `;

      const affectedRows = await this.executeUpdate(query, [groupId, promptId]);

      if (affectedRows > 0) {
        this.logger.info('Group chat prompt mapping updated', { groupId, promptId });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to update group chat prompt', { error, groupId, promptId });
      return false;
    }
  }

  public async updateGroupChatSettings(groupId: number, updates: Record<string, any>): Promise<boolean> {
    try {
      const updateFields: string[] = [];
      const updateValues: any[] = [];

      // Build SET clause from updates object
      Object.entries(updates).forEach(([key, value]) => {
        updateFields.push(`${key} = ?`);
        updateValues.push(value);
      });

      if (updateFields.length === 0) {
        return false;
      }

      // Add updated_at
      updateFields.push('updated_at = NOW()');

      const query = `
        UPDATE group_chat_settings
        SET ${updateFields.join(', ')}
        WHERE group_id = ?
      `;

      updateValues.push(groupId);
      const affectedRows = await this.executeUpdate(query, updateValues);

      if (affectedRows > 0) {
        this.logger.info('Group chat settings updated', { groupId, updates });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to update group chat settings', { error, groupId, updates });
      return false;
    }
  }

  public async upsertPrivateChatSettings(userId: number, updates: Record<string, any>): Promise<boolean> {
    try {
      const fields = Object.keys(updates);
      if (fields.length === 0) {
        return false;
      }

      const columns = ['user_id', ...fields];
      const placeholders = ['?', ...fields.map(() => '?')];
      const params = [userId, ...fields.map(field => updates[field])];
      const updateAssignments = fields.map(field => `${field} = VALUES(${field})`);
      updateAssignments.push('updated_at = NOW()');

      const query = `
        INSERT INTO private_chat_settings (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
        ON DUPLICATE KEY UPDATE ${updateAssignments.join(', ')}
      `;

      const affectedRows = await this.executeUpdate(query, params);

      if (affectedRows > 0) {
        this.logger.info('Private chat settings upserted', { userId, updates });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to upsert private chat settings', { error, userId, updates });
      return false;
    }
  }

  public async getGroupChatSettingById(groupId: number): Promise<any | null> {
    try {
      const query = `
        SELECT group_id, group_name, is_enabled, auto_reply_enabled, welcome_message,
               admin_user_id, agent_prompt_id, last_activity, receive_events, created_at, updated_at,
               human_like_scan_interval_ms, human_like_min_interval_ms, human_like_max_interval_ms
        FROM group_chat_settings
        WHERE group_id = ?
      `;
      const results = await this.executeQuery<any>(query, [groupId]);
      return results[0] || null;
    } catch (error) {
      this.logger.error('Failed to get group chat settings', { error, groupId });
      return null;
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.logger.info('Database connection pool closed');
  }
}
