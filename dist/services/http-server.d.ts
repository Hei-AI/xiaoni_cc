import { Express } from 'express';
import { HttpServerConfig } from '../types';
import { DatabaseManager } from './database';
import WebSocketClient from './websocket-client';
export interface HttpServerDependencies {
    database: DatabaseManager;
    websocketClient: WebSocketClient;
}
export declare class HttpServer {
    private app;
    private config;
    private server;
    private moduleLogger;
    private database;
    private websocketClient;
    private sessionApiHandlers;
    private tokenManager;
    constructor(config: HttpServerConfig, dependencies: HttpServerDependencies);
    private setupMiddleware;
    private setupRoutes;
    private handleHealth;
    private handleSendPrivateMessage;
    private handleSendGroupMessage;
    private handleSendReplyMessage;
    private handleSendAtMessage;
    private handleGetStatus;
    private handleGetConnectionStatus;
    private handleGetConversations;
    private handleGetConversation;
    private handleClearConversations;
    private handleGetRequirements;
    private handleGetRequirement;
    private handleStandardizedRequirement;
    private handleGetAgentPrompts;
    private handleGetAgentPromptsByType;
    private handleCreateAgentPrompt;
    private handleUpdateAgentPrompt;
    private handleDeactivateAgentPrompt;
    private handleGetMultiAgentSessions;
    private handleGetMultiAgentSession;
    private handleError;
    start(): Promise<void>;
    stop(): Promise<void>;
    getApp(): Express;
    /**
     * 获取所有Token信息
     */
    private handleGetTokens;
    /**
     * 获取Token统计信息
     */
    private handleGetTokenStats;
    /**
     * 获取单个Token详细信息
     */
    private handleGetToken;
    /**
     * 运行单个Token健康检查
     */
    private handleRunTokenHealthCheck;
    /**
     * 运行所有Token健康检查
     */
    private handleRunAllTokensHealthCheck;
    /**
     * 激活Token
     */
    private handleActivateToken;
    /**
     * 停用Token
     */
    private handleDeactivateToken;
    /**
     * 清除Token黑名单
     */
    private handleClearTokenBlacklist;
    /**
     * 获取Token使用日志
     */
    private handleGetTokenLogs;
}
export default HttpServer;
//# sourceMappingURL=http-server.d.ts.map