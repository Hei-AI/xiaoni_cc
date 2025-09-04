export interface OB11Segment {
    type: string;
    data: Record<string, any>;
}
export interface QQMessage {
    time: number;
    post_type: 'message' | 'message_sent';
    message_type: 'private' | 'group';
    sub_type: string;
    message_id: number;
    user_id: number;
    message: string | OB11Segment[];
    raw_message: string;
    font: number;
    sender: FriendSender | GroupSender;
    group_id?: number;
    self_id: number;
    target_id?: number;
    temp_source?: number;
}
export interface FriendSender {
    user_id: number;
    nickname: string;
    sex: 'male' | 'female' | 'unknown';
    age?: number;
    group_id?: number;
}
export interface GroupSender {
    user_id: number;
    nickname: string;
    sex: 'male' | 'female' | 'unknown';
    card?: string;
    role: 'owner' | 'admin' | 'member';
    title?: string;
    level?: string;
}
export interface QQNotice {
    time: number;
    post_type: 'notice';
    self_id: number;
    notice_type: string;
    sub_type?: string;
    group_id?: number;
    user_id?: number;
    operator_id?: number;
    message_id?: number;
    duration?: number;
    file?: {
        id: string;
        name: string;
        size: number;
        busid: number;
    };
    card_new?: string;
    card_old?: string;
    likes?: Array<{
        emoji_id: string;
        count: number;
    }>;
}
export interface QQRequest {
    time: number;
    post_type: 'request';
    self_id: number;
    request_type: 'friend' | 'group';
    sub_type?: string;
    user_id: number;
    comment: string;
    flag: string;
    group_id?: number;
}
export interface WebSocketEvent {
    time: number;
    post_type: 'message' | 'notice' | 'request' | 'message_sent' | 'meta_event';
    self_id: number;
}
export interface QQMetaEvent extends WebSocketEvent {
    post_type: 'meta_event';
    meta_event_type: 'heartbeat' | 'lifecycle';
    sub_type?: string;
    status?: {
        online?: boolean;
        good: boolean;
    };
    interval?: number;
}
export interface ConversationData {
    id: string;
    user_id: number;
    user_message: string;
    ai_response: string;
    timestamp: Date;
    response_time: number;
    model_name: string;
    raw_request?: string;
    raw_response?: string;
    message_id?: number;
    reply_to_message_id?: number;
    reply_to_text?: string;
    session_id?: string;
    created_at: Date;
    updated_at: Date;
}
export interface RequirementData {
    id: string;
    user_id: number;
    message: string;
    user_message: string;
    status: 'received' | 'analyzing' | 'processing' | 'completed' | 'failed' | 'cancelled';
    created_at: Date;
    updated_at: Date;
    claude_code_output?: string;
    completion_details?: string;
    error_message?: string;
    processing_start_time?: Date;
    processing_end_time?: Date;
    session_id?: string;
}
export interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    charset?: string;
    timezone?: string;
}
export interface WebSocketConfig {
    host: string;
    port: number;
    access_token: string;
    uri: string;
}
export interface HttpServerConfig {
    host: string;
    port: number;
}
export interface AIConfig {
    gemini_api_keys: string[];
    model_name: string;
    authorized_user_id: number;
    bot_qq_number: number;
}
export interface AppConfig {
    database: DatabaseConfig;
    websocket: WebSocketConfig;
    http_server: HttpServerConfig;
    ai: AIConfig;
    logging: {
        level: string;
        file_prefix: string;
    };
}
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    module: string;
    message: string;
    extra?: Record<string, any>;
}
export interface AgentPromptData {
    id: string;
    agent_type: 'chat_bot' | 'intent_analyzer' | 'requirement_processor' | 'custom';
    prompt_name: string;
    system_instructions: string[];
    user_prompt_template?: string;
    context_variables?: Record<string, string>;
    model_config?: {
        temperature?: number;
        topK?: number;
        topP?: number;
        maxOutputTokens?: number;
    };
    is_active: boolean;
    version: number;
    created_by: string;
    created_at: Date;
    updated_at: Date;
    description?: string;
}
export interface ApiTokenData {
    id: number;
    token: string;
    project_name: string;
    project_id: string;
    is_active: boolean;
    is_healthy: boolean;
    daily_limit: number;
    daily_used: number;
    total_used: number;
    last_reset_date: Date;
    last_used?: Date;
    last_health_check?: Date;
    error_count: number;
    last_error?: string;
    last_error_time?: Date;
    priority: number;
    weight: number;
    blacklisted_until?: Date;
    blacklist_reason?: string;
    created_at: Date;
    updated_at: Date;
}
export interface TokenLogData {
    id: number;
    token_id: number;
    action: 'use' | 'success' | 'error' | 'health_check';
    result?: 'success' | 'error' | 'timeout' | 'quota_exceeded';
    error_message?: string;
    response_time_ms?: number;
    gemini_usage?: Record<string, any>;
    created_at: Date;
}
export interface TokenHealthConfig {
    id: number;
    check_interval_minutes: number;
    max_error_count: number;
    blacklist_duration_minutes: number;
    health_check_timeout_ms: number;
    daily_reset_hour: number;
    enabled: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface TokenStats {
    total: number;
    active: number;
    healthy: number;
    blacklisted: number;
    over_daily_limit: number;
    tokens: Array<{
        id: number;
        project_name: string;
        project_id: string;
        is_healthy: boolean;
        daily_used: number;
        daily_limit: number;
        error_count: number;
        last_used?: string;
        blacklisted_until?: string;
    }>;
}
export interface SessionApiResponse {
    session_id: string;
    user_id: number;
    session_type: 'chat' | 'requirement' | 'mixed';
    status: 'active' | 'completed' | 'expired';
    current_service: string;
    service_transitions: Array<{
        from_service: string;
        to_service: string;
        timestamp: Date;
        trigger: string;
        confidence: number;
    }>;
    message_count: number;
    created_at: Date;
    last_activity: Date;
}
export interface SessionsListResponse {
    success: boolean;
    data: SessionApiResponse[];
    total?: number;
}
export interface TokenListResponse {
    success: boolean;
    data: Array<{
        id: number;
        project_name: string;
        project_id: string;
        is_active: boolean;
        is_healthy: boolean;
        daily_limit: number;
        daily_used: number;
        error_count: number;
        priority: number;
        weight: number;
        last_used?: string;
        last_health_check?: string;
        blacklisted_until?: string;
        blacklist_reason?: string;
        created_at: string;
    }>;
    total: number;
}
export interface TokenStatsResponse {
    success: boolean;
    data: {
        total: number;
        active: number;
        healthy: number;
        blacklisted: number;
        over_daily_limit: number;
        available: number;
        usage_rate: number;
        daily_summary: {
            total_requests: number;
            successful_requests: number;
            failed_requests: number;
            error_rate: number;
        };
    };
}
export interface TokenHealthCheckResponse {
    success: boolean;
    message: string;
    data?: {
        checked_tokens: number;
        healthy_tokens: number;
        unhealthy_tokens: number;
        duration_ms: number;
    };
}
export interface TokenResetResponse {
    success: boolean;
    message: string;
    data?: {
        token_id: number;
        previous_status: string;
        new_status: string;
    };
}
export interface TokenUsageHistoryResponse {
    success: boolean;
    data: {
        logs: Array<{
            id: number;
            token_id: number;
            project_name: string;
            action: string;
            result?: string;
            error_message?: string;
            response_time_ms?: number;
            created_at: string;
        }>;
        total: number;
        limit: number;
        offset: number;
        date_range?: {
            start_date: string;
            end_date: string;
        };
        summary?: {
            total_requests: number;
            successful_requests: number;
            failed_requests: number;
            average_response_time: number;
        };
    };
}
export interface GroupChatSettings {
    id?: number;
    group_id: number;
    group_name?: string;
    is_enabled: boolean;
    auto_reply_enabled: boolean;
    welcome_message?: string;
    admin_user_id?: number;
    created_at: Date;
    updated_at: Date;
    last_activity?: Date;
}
export interface GroupChatStats {
    id?: number;
    group_id: number;
    date: string;
    message_count: number;
    active_users: number;
    ai_responses: number;
    created_at: Date;
    updated_at: Date;
}
export interface GroupChatActivity {
    id?: number;
    group_id: number;
    user_id: number;
    message_type: 'user_message' | 'ai_response' | 'notice' | 'join' | 'leave';
    content?: string;
    created_at: Date;
}
export interface GroupChatOverview {
    group_id: number;
    group_name?: string;
    is_enabled: boolean;
    auto_reply_enabled: boolean;
    last_activity?: Date;
    created_at: Date;
    total_messages: number;
    total_ai_responses: number;
    avg_active_users: number;
    days_since_last_activity?: number;
}
export interface GroupListResponse {
    success: boolean;
    data: Array<{
        group_id: number;
        group_name?: string;
        is_enabled: boolean;
        auto_reply_enabled: boolean;
        member_count?: number;
        last_activity?: string;
        total_messages: number;
        total_ai_responses: number;
        created_at: string;
    }>;
    total: number;
}
export interface GroupDetailResponse {
    success: boolean;
    data: {
        group_id: number;
        group_name?: string;
        is_enabled: boolean;
        auto_reply_enabled: boolean;
        welcome_message?: string;
        admin_user_id?: number;
        last_activity?: string;
        created_at: string;
        updated_at: string;
        stats: {
            total_messages: number;
            total_ai_responses: number;
            avg_active_users: number;
            recent_activity: Array<{
                date: string;
                message_count: number;
                ai_responses: number;
                active_users: number;
            }>;
        };
    };
}
export interface GroupStatsResponse {
    success: boolean;
    data: {
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
    };
}
export interface GroupBulkOperationRequest {
    group_ids: number[];
    action: 'enable' | 'disable' | 'delete';
    settings?: Partial<GroupChatSettings>;
}
export interface GroupBulkOperationResponse {
    success: boolean;
    data: {
        processed: number;
        successful: number;
        failed: number;
        results: Array<{
            group_id: number;
            success: boolean;
            message?: string;
        }>;
    };
    message: string;
}
export interface ConversationQueryParams {
    user_id?: number;
    limit?: number;
    page?: number;
    start_date?: string;
    end_date?: string;
    search?: string;
    model_name?: string;
    sort_order?: 'desc' | 'asc';
    include_raw?: boolean;
}
export interface ConversationPagination {
    current_page: number;
    total_pages: number;
    per_page: number;
    total_count: number;
    has_next: boolean;
    has_previous: boolean;
}
export interface ConversationFilters {
    user_id?: number;
    date_range?: {
        start_date: string;
        end_date: string;
    };
    search?: string;
    model_name?: string;
    sort_order?: 'desc' | 'asc';
}
export interface ConversationListResponse {
    success: boolean;
    data: {
        conversations: ConversationData[];
        pagination: ConversationPagination;
        filters?: ConversationFilters;
    };
    message?: string;
}
export interface ConversationErrorResponse {
    success: false;
    error: string;
    message: string;
    code?: string;
}
export interface ConversationSearchResult extends ConversationData {
    match_score?: number;
    match_field?: 'user_message' | 'ai_response' | 'both';
}
export interface ConversationWindow {
    id?: number;
    user_id: number;
    window_name: string;
    window_size: number;
    window_type: 'fixed' | 'sliding' | 'semantic';
    context_retention_strategy: 'simple' | 'summary' | 'keyword';
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface WindowMessage {
    id?: number;
    window_id: number;
    conversation_id: string;
    user_id: number;
    sequence_number: number;
    message_role: 'user' | 'assistant' | 'system';
    message_content: string;
    token_count: number;
    importance_score: number;
    is_pinned: boolean;
    created_at: Date;
}
export interface WindowManagementParams {
    window_id: number;
    conversation_id: string;
    user_id: number;
    message_role: 'user' | 'assistant' | 'system';
    message_content: string;
    token_count?: number;
}
export interface UserProfile {
    id?: number;
    user_id: number;
    nickname?: string;
    preferred_language: string;
    interaction_style: 'formal' | 'casual' | 'technical' | 'friendly';
    response_length_preference: 'brief' | 'detailed' | 'adaptive';
    topic_preferences?: Record<string, number>;
    communication_patterns?: Record<string, any>;
    skill_level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
    last_interaction?: Date;
    interaction_count: number;
    created_at: Date;
    updated_at: Date;
}
export interface UserContext {
    id?: number;
    user_id: number;
    context_key: string;
    context_value: string;
    context_type: 'preference' | 'memory' | 'state' | 'history';
    priority: number;
    expires_at?: Date;
    is_persistent: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface UserProfileSummary {
    user_id: number;
    nickname?: string;
    interaction_style: 'formal' | 'casual' | 'technical' | 'friendly';
    skill_level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
    interaction_count: number;
    last_interaction?: Date;
    context_count: number;
    window_count: number;
    avg_message_importance?: number;
}
export interface PromptTemplate {
    id: string;
    template_name: string;
    category: 'system' | 'conversation' | 'analysis' | 'generation' | 'custom';
    template_content: string;
    variables?: Record<string, any>;
    usage_instructions?: string;
    version: string;
    is_active: boolean;
    is_default: boolean;
    author: string;
    tags?: string;
    created_at: Date;
    updated_at: Date;
}
export interface PromptConfig {
    id?: number;
    config_name: string;
    prompt_template_id: string;
    user_id?: number;
    group_id?: number;
    config_scope: 'global' | 'user' | 'group' | 'session';
    config_parameters: Record<string, any>;
    priority: number;
    is_enabled: boolean;
    effective_from?: Date;
    effective_until?: Date;
    created_at: Date;
    updated_at: Date;
}
export interface PromptUsageStats {
    template_id: string;
    template_name: string;
    category: string;
    usage_count: number;
    unique_users: number;
    avg_processing_time?: number;
    last_used?: Date;
}
export interface PromptRenderContext {
    user_profile?: UserProfile;
    user_context?: UserContext[];
    conversation_history?: WindowMessage[];
    custom_variables?: Record<string, any>;
}
export interface MessageChain {
    id?: number;
    chain_id: string;
    user_id: number;
    session_id?: string;
    message_id: string;
    parent_message_id?: string;
    chain_depth: number;
    chain_position: number;
    processing_steps?: Record<string, any>;
    timing_info?: Record<string, any>;
    context_used?: Record<string, any>;
    prompt_template_used?: string;
    model_params?: Record<string, any>;
    created_at: Date;
}
export interface DebugLog {
    id?: number;
    trace_id: string;
    debug_level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    component: string;
    operation: string;
    debug_data?: Record<string, any>;
    execution_time_ms?: number;
    memory_usage_mb?: number;
    error_details?: string;
    stack_trace?: string;
    created_at: Date;
}
export interface ProcessingContext {
    trace_id: string;
    chain_id: string;
    user_profile?: UserProfile;
    active_window?: ConversationWindow;
    applied_prompts: PromptConfig[];
    debug_info: DebugLog[];
}
export interface WindowManagementResponse {
    success: boolean;
    data?: {
        window: ConversationWindow;
        message_count: number;
        messages?: WindowMessage[];
    };
    message?: string;
    error?: string;
}
export interface UserProfileResponse {
    success: boolean;
    data?: {
        profile: UserProfile;
        context: UserContext[];
        active_windows: ConversationWindow[];
        summary: UserProfileSummary;
    };
    message?: string;
    error?: string;
}
export interface PromptManagementResponse {
    success: boolean;
    data?: {
        templates: PromptTemplate[];
        configs: PromptConfig[];
        usage_stats: PromptUsageStats[];
    };
    total?: number;
    message?: string;
    error?: string;
}
export interface DebugTraceResponse {
    success: boolean;
    data?: {
        message_chains: MessageChain[];
        debug_logs: DebugLog[];
        processing_summary: {
            total_chains: number;
            avg_processing_time: number;
            error_rate: number;
        };
    };
    message?: string;
    error?: string;
}
export interface WindowQueryParams {
    user_id?: number;
    window_type?: 'fixed' | 'sliding' | 'semantic';
    is_active?: boolean;
    limit?: number;
}
export interface ContextQueryParams {
    user_id: number;
    context_type?: 'preference' | 'memory' | 'state' | 'history';
    include_expired?: boolean;
    priority_min?: number;
}
export interface PromptQueryParams {
    category?: 'system' | 'conversation' | 'analysis' | 'generation' | 'custom';
    is_active?: boolean;
    config_scope?: 'global' | 'user' | 'group' | 'session';
    user_id?: number;
    group_id?: number;
}
export interface TraceQueryParams {
    user_id?: number;
    chain_id?: string;
    session_id?: string;
    date_range?: {
        start_date: string;
        end_date: string;
    };
    debug_level?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    component?: string;
}
export interface ConversationContextBuilder {
    user_profile: UserProfile;
    active_window: ConversationWindow;
    recent_messages: WindowMessage[];
    user_context: UserContext[];
    prompt_template: PromptTemplate;
    build(): string;
}
export interface PromptRenderer {
    template: PromptTemplate;
    context: PromptRenderContext;
    render(): string;
    validate(): boolean;
}
export interface WindowManager {
    getActiveWindow(user_id: number, window_name?: string): Promise<ConversationWindow | null>;
    addMessage(params: WindowManagementParams): Promise<boolean>;
    getWindowMessages(window_id: number, limit?: number): Promise<WindowMessage[]>;
    updateWindowConfig(window_id: number, updates: Partial<ConversationWindow>): Promise<boolean>;
}
export interface ProfileManager {
    getProfile(user_id: number): Promise<UserProfile | null>;
    updateProfile(user_id: number, updates: Partial<UserProfile>): Promise<boolean>;
    getContext(params: ContextQueryParams): Promise<UserContext[]>;
    setContext(user_id: number, key: string, value: string, options?: Partial<UserContext>): Promise<boolean>;
    cleanupExpiredContext(): Promise<number>;
}
export interface PromptManager {
    getTemplate(template_id: string): Promise<PromptTemplate | null>;
    getActiveConfigs(params: PromptQueryParams): Promise<PromptConfig[]>;
    renderPrompt(template_id: string, context: PromptRenderContext): Promise<string>;
    createTemplate(template: PromptTemplate): Promise<boolean>;
    updateConfig(config_id: number, updates: Partial<PromptConfig>): Promise<boolean>;
}
export interface DebugTracer {
    startTrace(trace_id: string, user_id: number): ProcessingContext;
    addStep(context: ProcessingContext, step: string, data?: any): void;
    recordTiming(context: ProcessingContext, operation: string, duration_ms: number): void;
    logError(context: ProcessingContext, error: Error, component: string): void;
    finishTrace(context: ProcessingContext): Promise<boolean>;
}
//# sourceMappingURL=index.d.ts.map