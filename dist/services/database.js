"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = void 0;
exports.getDatabaseManager = getDatabaseManager;
const promise_1 = __importDefault(require("mysql2/promise"));
const logger_1 = require("../utils/logger");
class DatabaseManager {
    constructor(config) {
        this.pool = null;
        this.moduleLogger = logger_1.logger.createModuleLogger('database');
        this.config = config;
        this.createConnectionPool();
    }
    createConnectionPool() {
        try {
            this.pool = promise_1.default.createPool({
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
        }
        catch (error) {
            this.moduleLogger.error('Error creating connection pool', { error });
            this.pool = null;
        }
    }
    async testConnection() {
        try {
            if (!this.pool) {
                this.createConnectionPool();
            }
            const connection = await this.pool.getConnection();
            const [rows] = await connection.execute('SELECT 1 as test');
            connection.release();
            this.moduleLogger.info('Database connection test successful');
            return Array.isArray(rows) && rows.length > 0;
        }
        catch (error) {
            this.moduleLogger.error('Database connection test failed', { error });
            return false;
        }
    }
    async executeQuery(query, params = []) {
        try {
            if (!this.pool) {
                throw new Error('Database pool not initialized');
            }
            const [rows] = await this.pool.execute(query, params);
            // 处理日期时间序列化
            if (Array.isArray(rows)) {
                return rows.map((row) => {
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
        }
        catch (error) {
            this.moduleLogger.error('Query execution failed', { error, query });
            return [];
        }
    }
    async executeUpdate(query, params = []) {
        try {
            if (!this.pool) {
                throw new Error('Database pool not initialized');
            }
            const [result] = await this.pool.execute(query, params);
            const affectedRows = result.affectedRows;
            return affectedRows;
        }
        catch (error) {
            this.moduleLogger.error('Update execution failed', { error, query });
            return 0;
        }
    }
    async executeBatch(query, paramsList) {
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
                    totalAffected += result.affectedRows;
                }
                await connection.commit();
                connection.release();
                return totalAffected;
            }
            catch (error) {
                await connection.rollback();
                connection.release();
                throw error;
            }
        }
        catch (error) {
            this.moduleLogger.error('Batch execution failed', { error, query });
            return 0;
        }
    }
    // 对话相关方法
    async getConversationById(conversationId) {
        const query = 'SELECT * FROM conversations WHERE id = ?';
        const results = await this.executeQuery(query, [conversationId]);
        return results.length > 0 ? results[0] : null;
    }
    async saveConversation(conversationData) {
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to save conversation', { error, id: conversationData.id });
            return false;
        }
    }
    async getConversations(userId, limit = 50) {
        let query;
        let params;
        // 确保limit是有效的数字
        const validLimit = Math.max(1, Math.min(Math.floor(Number(limit)) || 50, 1000));
        if (userId) {
            query = `SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT ${validLimit}`;
            params = [userId];
        }
        else {
            query = `SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ${validLimit}`;
            params = [];
        }
        return this.executeQuery(query, params);
    }
    async clearConversations() {
        const query = 'DELETE FROM conversations';
        return this.executeUpdate(query);
    }
    // 需求相关方法
    async getRequirementById(requirementId) {
        const query = 'SELECT * FROM requirements WHERE id = ?';
        const results = await this.executeQuery(query, [requirementId]);
        return results.length > 0 ? results[0] : null;
    }
    async saveRequirement(requirementData) {
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to save requirement', { error, id: requirementData.id });
            return false;
        }
    }
    async updateRequirementStatus(requirementId, status, updateFields = {}) {
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
    async logSystemEvent(level, module, message, extraData) {
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
    async updateBotStatus(botId, status, websocketConnected = false, httpServerRunning = false, errorMessage) {
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
    async getConversationStats() {
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
    async getRequirementStats() {
        const query = 'SELECT * FROM requirement_status_stats';
        return this.executeQuery(query);
    }
    // Agent Prompt 相关方法
    async getAgentPrompt(agentType, promptName) {
        let query;
        let params;
        if (promptName) {
            query = 'SELECT * FROM agent_prompts WHERE agent_type = ? AND prompt_name = ? AND is_active = true ORDER BY version DESC LIMIT 1';
            params = [agentType, promptName];
        }
        else {
            query = 'SELECT * FROM agent_prompts WHERE agent_type = ? AND is_active = true ORDER BY version DESC LIMIT 1';
            params = [agentType];
        }
        try {
            const results = await this.executeQuery(query, params);
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to get agent prompt', { error, agentType, promptName });
            return null;
        }
    }
    async saveAgentPrompt(promptData) {
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to save agent prompt', { error, id: promptData.id });
            return false;
        }
    }
    async getAgentPrompts(agentType) {
        let query;
        let params;
        if (agentType) {
            query = 'SELECT * FROM agent_prompts WHERE agent_type = ? ORDER BY updated_at DESC';
            params = [agentType];
        }
        else {
            query = 'SELECT * FROM agent_prompts ORDER BY updated_at DESC';
            params = [];
        }
        try {
            const results = await this.executeQuery(query, params);
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to get agent prompts', { error, agentType });
            return [];
        }
    }
    async deactivateAgentPrompt(promptId) {
        const query = 'UPDATE agent_prompts SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        const affectedRows = await this.executeUpdate(query, [promptId]);
        return affectedRows > 0;
    }
    // 数据清理方法
    async cleanupOldData(daysToKeep = 30) {
        try {
            if (!this.pool) {
                throw new Error('Database pool not initialized');
            }
            const connection = await this.pool.getConnection();
            const [results] = await connection.execute('CALL CleanOldData(?)', [daysToKeep]);
            connection.release();
            this.moduleLogger.info(`Cleaned up data older than ${daysToKeep} days`);
            return results;
        }
        catch (error) {
            this.moduleLogger.error('Data cleanup failed', { error });
            return {};
        }
    }
    // Session管理相关方法
    async getSessions(userId, limit = 50, status) {
        try {
            let query = `
        SELECT s.*, COUNT(mrc.id) as reply_chain_length
        FROM conversation_sessions s
        LEFT JOIN message_reply_chain mrc ON s.session_id = mrc.session_id
      `;
            const params = [];
            const conditions = [];
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to get sessions', { error, userId, limit, status });
            return [];
        }
    }
    async getSessionById(sessionId) {
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to get session by id', { error, sessionId });
            return null;
        }
    }
    async switchSessionService(sessionId, newService, reason) {
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
            }
            catch (e) {
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to switch session service', { error, sessionId, newService });
            return false;
        }
    }
    async cleanupExpiredSessions() {
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to cleanup expired sessions', { error });
            return 0;
        }
    }
    async createSession(sessionData) {
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to create session', { error, sessionData });
            return false;
        }
    }
    async recordMessageChain(data) {
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to record message chain', { error, data });
            return false;
        }
    }
    async updateSessionActivity(sessionId, messageCount) {
        try {
            let query = 'UPDATE conversation_sessions SET last_activity = CURRENT_TIMESTAMP';
            const params = [];
            if (messageCount !== undefined) {
                query += ', message_count = message_count + ?';
                params.push(messageCount);
            }
            query += ' WHERE session_id = ?';
            params.push(sessionId);
            const affectedRows = await this.executeUpdate(query, params);
            return affectedRows > 0;
        }
        catch (error) {
            this.moduleLogger.error('Failed to update session activity', { error, sessionId });
            return false;
        }
    }
    async getSessionHistory(sessionId, limit = 20) {
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
        }
        catch (error) {
            this.moduleLogger.error('Failed to get session history', { error, sessionId });
            return [];
        }
    }
    // 修复getRequirements方法以支持status过滤
    async getRequirements(userId, limit = 50, status) {
        try {
            let query = 'SELECT * FROM requirements';
            const params = [];
            const conditions = [];
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
            return await this.executeQuery(query, params);
        }
        catch (error) {
            this.moduleLogger.error('Failed to get requirements', { error });
            return [];
        }
    }
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.moduleLogger.info('Database connection pool closed');
        }
    }
}
exports.DatabaseManager = DatabaseManager;
// 单例模式
let databaseManager = null;
function getDatabaseManager(config) {
    if (!databaseManager) {
        databaseManager = new DatabaseManager(config);
    }
    return databaseManager;
}
exports.default = DatabaseManager;
//# sourceMappingURL=database.js.map