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
    constructor();
    start(): Promise<void>;
    private setupWebSocketEventHandlers;
    private handlePrivateMessage;
    private handleGroupMessage;
    private handleGroupManagementCommand;
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