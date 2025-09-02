"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpServer = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
const session_api_handlers_1 = require("./session-api-handlers");
const token_manager_1 = require("../utils/token-manager");
class HttpServer {
    constructor(config, dependencies) {
        this.server = null;
        this.moduleLogger = logger_1.logger.createModuleLogger('http-server');
        this.tokenManager = (0, token_manager_1.getTokenManager)();
        this.config = config;
        this.database = dependencies.database;
        this.websocketClient = dependencies.websocketClient;
        this.sessionApiHandlers = new session_api_handlers_1.SessionApiHandlers(this.database);
        this.app = (0, express_1.default)();
        this.setupMiddleware();
        this.setupRoutes();
    }
    setupMiddleware() {
        this.app.use((0, helmet_1.default)());
        this.app.use((0, cors_1.default)());
        this.app.use(express_1.default.json({ limit: '10mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
        // 请求日志中间件
        this.app.use((req, res, next) => {
            this.moduleLogger.debug('HTTP Request', {
                method: req.method,
                url: req.url,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            next();
        });
    }
    setupRoutes() {
        // 静态文件服务
        this.app.use('/static', express_1.default.static(path_1.default.join(__dirname, '../../public')));
        // Dashboard页面路由
        this.app.get('/', (req, res) => {
            res.redirect('/dashboard');
        });
        this.app.get('/dashboard', (req, res) => {
            res.sendFile(path_1.default.join(__dirname, '../../public/dashboard.html'));
        });
        // 健康检查
        this.app.get('/health', this.handleHealth.bind(this));
        // OneBot API 路由
        this.app.post('/api/send_private', this.handleSendPrivateMessage.bind(this));
        this.app.post('/api/send_group', this.handleSendGroupMessage.bind(this));
        this.app.post('/api/send_reply', this.handleSendReplyMessage.bind(this));
        this.app.post('/api/send_at', this.handleSendAtMessage.bind(this));
        // 系统状态 API
        this.app.get('/api/status', this.handleGetStatus.bind(this));
        this.app.get('/api/connection', this.handleGetConnectionStatus.bind(this));
        // 对话历史 API
        this.app.get('/api/conversations', this.handleGetConversations.bind(this));
        this.app.get('/api/conversations/:id', this.handleGetConversation.bind(this));
        this.app.delete('/api/conversations', this.handleClearConversations.bind(this));
        // 需求管理 API
        this.app.get('/api/requirements', this.handleGetRequirements.bind(this));
        this.app.get('/api/requirements/:id', this.handleGetRequirement.bind(this));
        this.app.post('/api/requirements/standardized', this.handleStandardizedRequirement.bind(this));
        // Agent Prompts管理 API
        this.app.get('/api/agent_prompts', this.handleGetAgentPrompts.bind(this));
        this.app.get('/api/agent_prompts/:agent_type', this.handleGetAgentPromptsByType.bind(this));
        this.app.post('/api/agent_prompts', this.handleCreateAgentPrompt.bind(this));
        this.app.put('/api/agent_prompts/:id', this.handleUpdateAgentPrompt.bind(this));
        this.app.delete('/api/agent_prompts/:id', this.handleDeactivateAgentPrompt.bind(this));
        // Session管理 API
        this.app.get('/api/sessions', this.sessionApiHandlers.handleGetSessions.bind(this.sessionApiHandlers));
        this.app.get('/api/sessions/:id', this.sessionApiHandlers.handleGetSession.bind(this.sessionApiHandlers));
        this.app.post('/api/sessions/:id/switch', this.sessionApiHandlers.handleSwitchSessionService.bind(this.sessionApiHandlers));
        this.app.delete('/api/sessions/cleanup', this.sessionApiHandlers.handleCleanupSessions.bind(this.sessionApiHandlers));
        // Token管理 API
        this.app.get('/api/tokens', this.handleGetTokens.bind(this));
        this.app.get('/api/tokens/stats', this.handleGetTokenStats.bind(this));
        this.app.get('/api/tokens/:id', this.handleGetToken.bind(this));
        this.app.post('/api/tokens/:id/health-check', this.handleRunTokenHealthCheck.bind(this));
        this.app.post('/api/tokens/health-check', this.handleRunAllTokensHealthCheck.bind(this));
        this.app.post('/api/tokens/:id/activate', this.handleActivateToken.bind(this));
        this.app.post('/api/tokens/:id/deactivate', this.handleDeactivateToken.bind(this));
        this.app.delete('/api/tokens/blacklist', this.handleClearTokenBlacklist.bind(this));
        this.app.get('/api/tokens/:id/logs', this.handleGetTokenLogs.bind(this));
        // 多Agent会话 API (占位符)
        this.app.get('/api/multi_agent_sessions', this.handleGetMultiAgentSessions.bind(this));
        this.app.get('/api/multi_agent_sessions/:id', this.handleGetMultiAgentSession.bind(this));
        // 错误处理中间件
        this.app.use(this.handleError.bind(this));
    }
    // 健康检查
    async handleHealth(req, res) {
        const status = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            websocket_connected: this.websocketClient.isConnected(),
            database_connected: await this.database.testConnection()
        };
        res.json(status);
    }
    // 发送私聊消息
    async handleSendPrivateMessage(req, res) {
        try {
            const { user_id, message } = req.body;
            if (!user_id || !message) {
                res.status(400).json({ error: 'Missing required parameters: user_id, message' });
                return;
            }
            await this.websocketClient.sendPrivateMessage(user_id, message);
            res.json({ success: true, message: 'Message sent successfully' });
        }
        catch (error) {
            this.moduleLogger.error('Failed to send private message', { error });
            res.status(500).json({ error: 'Failed to send message' });
        }
    }
    // 发送群聊消息
    async handleSendGroupMessage(req, res) {
        try {
            const { group_id, message } = req.body;
            if (!group_id || !message) {
                res.status(400).json({ error: 'Missing required parameters: group_id, message' });
                return;
            }
            await this.websocketClient.sendGroupMessage(group_id, message);
            res.json({ success: true, message: 'Message sent successfully' });
        }
        catch (error) {
            this.moduleLogger.error('Failed to send group message', { error });
            res.status(500).json({ error: 'Failed to send message' });
        }
    }
    // 发送回复消息
    async handleSendReplyMessage(req, res) {
        try {
            const { message_id, message } = req.body;
            if (!message_id || !message) {
                res.status(400).json({ error: 'Missing required parameters: message_id, message' });
                return;
            }
            await this.websocketClient.sendReplyMessage(message_id, message);
            res.json({ success: true, message: 'Reply sent successfully' });
        }
        catch (error) {
            this.moduleLogger.error('Failed to send reply message', { error });
            res.status(500).json({ error: 'Failed to send reply' });
        }
    }
    // 发送@消息
    async handleSendAtMessage(req, res) {
        try {
            const { group_id, user_id, message } = req.body;
            if (!group_id || !user_id || !message) {
                res.status(400).json({ error: 'Missing required parameters: group_id, user_id, message' });
                return;
            }
            await this.websocketClient.sendAtMessage(group_id, user_id, message);
            res.json({ success: true, message: 'At message sent successfully' });
        }
        catch (error) {
            this.moduleLogger.error('Failed to send at message', { error });
            res.status(500).json({ error: 'Failed to send at message' });
        }
    }
    // 获取系统状态
    async handleGetStatus(req, res) {
        try {
            const connectionInfo = this.websocketClient.getConnectionInfo();
            const dbConnected = await this.database.testConnection();
            const memUsage = process.memoryUsage();
            const status = {
                success: true,
                data: {
                    websocket: connectionInfo,
                    database: { connected: dbConnected },
                    system_info: {
                        uptime: process.uptime(),
                        memory_usage: memUsage.rss,
                        heap_used: memUsage.heapUsed,
                        heap_total: memUsage.heapTotal,
                        cpu_usage: Math.round(process.cpuUsage().user / 1000), // 简化CPU使用率计算
                        node_version: process.version,
                        platform: process.platform,
                        arch: process.arch
                    },
                    timestamp: new Date().toISOString()
                }
            };
            res.json(status);
        }
        catch (error) {
            this.moduleLogger.error('Failed to get status', { error });
            res.status(500).json({
                success: false,
                error: 'Failed to get status',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    // 获取连接状态
    async handleGetConnectionStatus(req, res) {
        try {
            const connectionInfo = this.websocketClient.getConnectionInfo();
            res.json(connectionInfo);
        }
        catch (error) {
            this.moduleLogger.error('Failed to get connection status', { error });
            res.status(500).json({ error: 'Failed to get connection status' });
        }
    }
    // 获取对话历史
    async handleGetConversations(req, res) {
        try {
            const userId = req.query.user_id ? parseInt(req.query.user_id) : undefined;
            const limit = req.query.limit ? parseInt(req.query.limit) : 50;
            const conversations = await this.database.getConversations(userId, limit);
            res.json({
                success: true,
                data: conversations,
                total: conversations.length
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to get conversations', { error });
            res.status(500).json({
                success: false,
                error: 'Failed to get conversations',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    // 获取单个对话
    async handleGetConversation(req, res) {
        try {
            const { id } = req.params;
            const conversation = await this.database.getConversationById(id);
            if (!conversation) {
                res.status(404).json({ error: 'Conversation not found' });
                return;
            }
            res.json(conversation);
        }
        catch (error) {
            this.moduleLogger.error('Failed to get conversation', { error });
            res.status(500).json({ error: 'Failed to get conversation' });
        }
    }
    // 清空对话历史
    async handleClearConversations(req, res) {
        try {
            const deletedCount = await this.database.clearConversations();
            res.json({ success: true, deleted_count: deletedCount });
        }
        catch (error) {
            this.moduleLogger.error('Failed to clear conversations', { error });
            res.status(500).json({ error: 'Failed to clear conversations' });
        }
    }
    // 获取需求列表
    async handleGetRequirements(req, res) {
        try {
            const userId = req.query.user_id ? parseInt(req.query.user_id) : undefined;
            // const status = req.query.status as string;
            const limit = req.query.limit ? parseInt(req.query.limit) : 50;
            const requirements = await this.database.getRequirements(userId, limit);
            res.json({
                success: true,
                data: requirements,
                total: requirements.length
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to get requirements', { error });
            res.status(500).json({
                success: false,
                error: 'Failed to get requirements',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    // 获取单个需求
    async handleGetRequirement(req, res) {
        try {
            const { id } = req.params;
            const requirement = await this.database.getRequirementById(id);
            if (!requirement) {
                res.status(404).json({ error: 'Requirement not found' });
                return;
            }
            res.json(requirement);
        }
        catch (error) {
            this.moduleLogger.error('Failed to get requirement', { error });
            res.status(500).json({ error: 'Failed to get requirement' });
        }
    }
    // 标准化需求处理 (占位符)
    async handleStandardizedRequirement(req, res) {
        try {
            const { user_id, message } = req.body;
            if (!user_id || !message) {
                res.status(400).json({ error: 'Missing required parameters: user_id, message' });
                return;
            }
            // TODO: 实现标准化需求处理逻辑
            res.json({
                success: true,
                message: 'Standardized requirement processing not implemented yet',
                requirement_id: 'placeholder-' + Date.now()
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to process standardized requirement', { error });
            res.status(500).json({ error: 'Failed to process standardized requirement' });
        }
    }
    // Agent Prompts管理处理器
    async handleGetAgentPrompts(req, res) {
        try {
            const agentType = req.query.agent_type;
            const prompts = await this.database.getAgentPrompts(agentType);
            res.json({
                prompts,
                total: prompts.length,
                agentType: agentType || 'all'
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to get agent prompts', { error });
            res.status(500).json({
                error: 'Failed to get agent prompts',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleGetAgentPromptsByType(req, res) {
        try {
            const agentType = req.params.agent_type;
            const promptName = req.query.prompt_name;
            if (promptName) {
                const prompt = await this.database.getAgentPrompt(agentType, promptName);
                if (prompt) {
                    res.json({ prompt });
                }
                else {
                    res.status(404).json({ error: 'Agent prompt not found' });
                }
            }
            else {
                const prompts = await this.database.getAgentPrompts(agentType);
                res.json({
                    prompts,
                    total: prompts.length,
                    agentType
                });
            }
        }
        catch (error) {
            this.moduleLogger.error('Failed to get agent prompts by type', { error });
            res.status(500).json({
                error: 'Failed to get agent prompts by type',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleCreateAgentPrompt(req, res) {
        try {
            const promptData = req.body;
            // 验证必需字段
            if (!promptData.agent_type || !promptData.prompt_name || !promptData.system_instructions) {
                res.status(400).json({ error: 'Missing required fields: agent_type, prompt_name, system_instructions' });
                return;
            }
            // 添加默认值
            const { v4: uuidv4 } = require('uuid');
            const newPrompt = {
                id: uuidv4(),
                ...promptData,
                is_active: promptData.is_active !== undefined ? promptData.is_active : true,
                version: promptData.version || 1,
                created_by: promptData.created_by || 'user',
                created_at: new Date(),
                updated_at: new Date()
            };
            const success = await this.database.saveAgentPrompt(newPrompt);
            if (success) {
                res.json({ success: true, message: 'Agent prompt created successfully', id: newPrompt.id });
            }
            else {
                res.status(500).json({ error: 'Failed to create agent prompt' });
            }
        }
        catch (error) {
            this.moduleLogger.error('Failed to create agent prompt', { error });
            res.status(500).json({
                error: 'Failed to create agent prompt',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleUpdateAgentPrompt(req, res) {
        try {
            const promptId = req.params.id;
            const updateData = req.body;
            updateData.id = promptId;
            updateData.updated_at = new Date();
            const success = await this.database.saveAgentPrompt(updateData);
            if (success) {
                res.json({ success: true, message: 'Agent prompt updated successfully' });
            }
            else {
                res.status(500).json({ error: 'Failed to update agent prompt' });
            }
        }
        catch (error) {
            this.moduleLogger.error('Failed to update agent prompt', { error });
            res.status(500).json({
                error: 'Failed to update agent prompt',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleDeactivateAgentPrompt(req, res) {
        try {
            const promptId = req.params.id;
            const success = await this.database.deactivateAgentPrompt(promptId);
            if (success) {
                res.json({ success: true, message: 'Agent prompt deactivated successfully' });
            }
            else {
                res.status(500).json({ error: 'Failed to deactivate agent prompt' });
            }
        }
        catch (error) {
            this.moduleLogger.error('Failed to deactivate agent prompt', { error });
            res.status(500).json({
                error: 'Failed to deactivate agent prompt',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    // 多Agent会话列表 (占位符)
    async handleGetMultiAgentSessions(req, res) {
        try {
            // TODO: 实现多Agent会话管理
            res.json({
                sessions: [],
                total: 0,
                message: 'Multi-agent sessions not implemented yet'
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to get multi-agent sessions', { error });
            res.status(500).json({ error: 'Failed to get multi-agent sessions' });
        }
    }
    // 单个多Agent会话 (占位符)
    async handleGetMultiAgentSession(req, res) {
        try {
            const { id } = req.params;
            // TODO: 实现多Agent会话详情
            res.json({
                session_id: id,
                message: 'Multi-agent session details not implemented yet'
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to get multi-agent session', { error });
            res.status(500).json({ error: 'Failed to get multi-agent session' });
        }
    }
    // 错误处理中间件
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handleError(error, req, res, __next) {
        this.moduleLogger.error('HTTP Server Error', {
            error: error.message,
            stack: error.stack,
            method: req.method,
            url: req.url
        });
        res.status(500).json({
            error: 'Internal Server Error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
    }
    async start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.config.port, this.config.host, () => {
                    this.moduleLogger.info(`HTTP server started on ${this.config.host}:${this.config.port}`);
                    resolve();
                });
                this.server.on('error', (error) => {
                    this.moduleLogger.error('HTTP server error', { error });
                    reject(error);
                });
            }
            catch (error) {
                this.moduleLogger.error('Failed to start HTTP server', { error });
                reject(error);
            }
        });
    }
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.moduleLogger.info('HTTP server stopped');
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
    getApp() {
        return this.app;
    }
    // Token管理API处理方法
    /**
     * 获取所有Token信息
     */
    async handleGetTokens(req, res) {
        try {
            const stats = await this.tokenManager.getStats();
            res.json({
                success: true,
                data: stats
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to get tokens', { error });
            res.status(500).json({ error: 'Failed to retrieve token information' });
        }
    }
    /**
     * 获取Token统计信息
     */
    async handleGetTokenStats(req, res) {
        try {
            const stats = await this.tokenManager.getStats();
            const summary = {
                total: stats.total,
                active: stats.active,
                healthy: stats.healthy,
                blacklisted: stats.blacklisted,
                over_daily_limit: stats.over_daily_limit
            };
            res.json({
                success: true,
                data: summary
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to get token stats', { error });
            res.status(500).json({ error: 'Failed to retrieve token statistics' });
        }
    }
    /**
     * 获取单个Token详细信息
     */
    async handleGetToken(req, res) {
        try {
            const tokenId = parseInt(req.params.id);
            if (isNaN(tokenId)) {
                res.status(400).json({ error: 'Invalid token ID' });
                return;
            }
            const tokenData = await this.database.executeQuery('SELECT * FROM api_tokens WHERE id = ?', [tokenId]);
            if (tokenData.length === 0) {
                res.status(404).json({ error: 'Token not found' });
                return;
            }
            // 隐藏真实token值，只显示前8位
            const token = tokenData[0];
            token.token = token.token.substring(0, 8) + '...';
            res.json({
                success: true,
                data: token
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to get token', { error, tokenId: req.params.id });
            res.status(500).json({ error: 'Failed to retrieve token information' });
        }
    }
    /**
     * 运行单个Token健康检查
     */
    async handleRunTokenHealthCheck(req, res) {
        try {
            const tokenId = parseInt(req.params.id);
            if (isNaN(tokenId)) {
                res.status(400).json({ error: 'Invalid token ID' });
                return;
            }
            // 获取token数据
            const tokenData = await this.database.executeQuery('SELECT * FROM api_tokens WHERE id = ? AND is_active = TRUE', [tokenId]);
            if (tokenData.length === 0) {
                res.status(404).json({ error: 'Token not found or inactive' });
                return;
            }
            // 运行健康检查 (这里简化实现，实际应该调用TokenManager的方法)
            await this.tokenManager.runHealthCheck();
            res.json({
                success: true,
                message: 'Health check initiated for token'
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to run token health check', { error, tokenId: req.params.id });
            res.status(500).json({ error: 'Failed to run health check' });
        }
    }
    /**
     * 运行所有Token健康检查
     */
    async handleRunAllTokensHealthCheck(req, res) {
        try {
            await this.tokenManager.runHealthCheck();
            res.json({
                success: true,
                message: 'Health check initiated for all tokens'
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to run all tokens health check', { error });
            res.status(500).json({ error: 'Failed to run health check' });
        }
    }
    /**
     * 激活Token
     */
    async handleActivateToken(req, res) {
        try {
            const tokenId = parseInt(req.params.id);
            if (isNaN(tokenId)) {
                res.status(400).json({ error: 'Invalid token ID' });
                return;
            }
            const result = await this.database.executeUpdate('UPDATE api_tokens SET is_active = TRUE, updated_at = NOW() WHERE id = ?', [tokenId]);
            if (result === 0) {
                res.status(404).json({ error: 'Token not found' });
                return;
            }
            res.json({
                success: true,
                message: 'Token activated successfully'
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to activate token', { error, tokenId: req.params.id });
            res.status(500).json({ error: 'Failed to activate token' });
        }
    }
    /**
     * 停用Token
     */
    async handleDeactivateToken(req, res) {
        try {
            const tokenId = parseInt(req.params.id);
            if (isNaN(tokenId)) {
                res.status(400).json({ error: 'Invalid token ID' });
                return;
            }
            const result = await this.database.executeUpdate('UPDATE api_tokens SET is_active = FALSE, updated_at = NOW() WHERE id = ?', [tokenId]);
            if (result === 0) {
                res.status(404).json({ error: 'Token not found' });
                return;
            }
            res.json({
                success: true,
                message: 'Token deactivated successfully'
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to deactivate token', { error, tokenId: req.params.id });
            res.status(500).json({ error: 'Failed to deactivate token' });
        }
    }
    /**
     * 清除Token黑名单
     */
    async handleClearTokenBlacklist(req, res) {
        try {
            const clearedCount = await this.tokenManager.clearBlacklist();
            res.json({
                success: true,
                message: `Cleared ${clearedCount} tokens from blacklist`
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to clear token blacklist', { error });
            res.status(500).json({ error: 'Failed to clear blacklist' });
        }
    }
    /**
     * 获取Token使用日志
     */
    async handleGetTokenLogs(req, res) {
        try {
            const tokenId = parseInt(req.params.id);
            if (isNaN(tokenId)) {
                res.status(400).json({ error: 'Invalid token ID' });
                return;
            }
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;
            const logs = await this.database.executeQuery(`
        SELECT 
          l.*,
          t.project_name,
          t.project_id
        FROM api_token_logs l
        JOIN api_tokens t ON l.token_id = t.id
        WHERE l.token_id = ?
        ORDER BY l.created_at DESC
        LIMIT ? OFFSET ?
      `, [tokenId, limit, offset]);
            const total = await this.database.executeQuery('SELECT COUNT(*) as count FROM api_token_logs WHERE token_id = ?', [tokenId]);
            res.json({
                success: true,
                data: {
                    logs,
                    total: total[0]?.count || 0,
                    limit,
                    offset
                }
            });
        }
        catch (error) {
            this.moduleLogger.error('Failed to get token logs', { error, tokenId: req.params.id });
            res.status(500).json({ error: 'Failed to retrieve token logs' });
        }
    }
}
exports.HttpServer = HttpServer;
exports.default = HttpServer;
//# sourceMappingURL=http-server.js.map