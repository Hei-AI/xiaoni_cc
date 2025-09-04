declare class QQBot {
    private database;
    private websocketClient;
    private httpServer;
    private aiService;
    private remoteClaudeService;
    private sessionManager;
    private moduleLogger;
    private groupReplyEnabled;
    private allowedGroups;
    private groupSettingsCache;
    constructor();
    start(): Promise<void>;
    private setupWebSocketEventHandlers;
    private handlePrivateMessage;
    private handleGroupMessage;
    private handleGroupManagementCommand;
    /**
     * 检查群聊是否启用（从数据库检查）
     */
    private isGroupEnabled;
    /**
     * 清理群聊设置缓存
     */
    private clearGroupSettingsCache;
    private handleRequirement;
    /**
     * 异步处理需求逻辑
     */
    private processRequirementAsync;
    /**
     * 格式化处理时间
     */
    private formatProcessingTime;
    private handleAIConversation;
    private handleNotice;
    private handleRequest;
    private handleMessageSent;
    private sendStartupNotification;
    private notifyConnectionStatus;
    stop(): Promise<void>;
}
export default QQBot;
//# sourceMappingURL=index.d.ts.map