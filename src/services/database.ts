import mysql from 'mysql2/promise';
import { DatabaseConfig, ConversationData, RequirementData, LogLevel } from '../types';
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

    if (userId) {
      query = 'SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?';
      params = [userId, limit];
    } else {
      query = 'SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ?';
      params = [limit];
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

  public async getRequirements(
    userId?: number, 
    limit: number = 50
  ): Promise<RequirementData[]> {
    let query: string;
    let params: any[];

    if (userId) {
      query = 'SELECT * FROM requirements WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?';
      params = [userId, limit];
    } else {
      query = 'SELECT * FROM requirements ORDER BY updated_at DESC LIMIT ?';
      params = [limit];
    }

    return this.executeQuery<RequirementData>(query, params);
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