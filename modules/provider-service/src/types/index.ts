export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AIConfig {
  gemini_api_keys: string[];
  model_name: string;
  relationship_memory_model_name?: string;
  gemini_cli_access_token?: string;
  gemini_cli_refresh_token?: string;
  gemini_cli_project_id?: string;
  gemini_cli_expires_at?: string | number;
  gemini_cli_oauth_path?: string;
  gemini_cli_base_url?: string;
  gemini_cli_stream_path?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  embedding_enabled?: boolean;
  embedding_base_url?: string;
  embedding_model_id?: string;
  embedding_model_source?: string;
  embedding_timeout_ms?: number;
  embedding_normalize?: number;
  codex_access_token?: string;
  codex_refresh_token?: string;
  codex_expires_at?: string | number;
  codex_account_id?: string;
  codex_base_url?: string;
  codex_oauth_path?: string;
  codex_responses_path?: string;
  authorized_user_id: number;
  bot_qq_number: number;
}

export interface FunctionCallingConfig {
  mode?: 'AUTO' | 'ANY' | 'NONE';
}

export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}

export interface ThinkingConfig {
  thinkingBudget?: number;
  includeThoughts?: boolean;
  reasoningEffort?: string;
}

export interface SafetyConfig {
  category: string;
  threshold: string;
}

export interface UnifiedLLMConfig {
  id: string;
  name: string;
  description?: string;
  category: string;
  model: {
    name: string;
    provider: 'google' | 'google-gemini-cli' | 'google-legacy' | 'openai' | 'codex' | 'custom';
    allowedTokenIds?: number[];
    providerSpecific?: Record<string, any>;
    fallbackModels?: string[];
  };
  generation: GenerationConfig;
  thinking?: ThinkingConfig;
  safety: SafetyConfig[];
  tools: {
    functionCalling?: FunctionCallingConfig;
    [key: string]: any;
  };
  context: {
    systemInstruction?: string;
    variables?: Record<string, string>;
    [key: string]: any;
  };
  performance: {
    timeout?: number;
    [key: string]: any;
  };
  version: {
    version: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    updatedBy?: string;
    changelog?: string;
    isActive: boolean;
    parentVersion?: string;
  };
}

export type ChatType = 'direct' | 'group' | 'channel' | 'thread';

export interface InboundHistoryEntry {
  sender: string;
  body: string;
  timestamp?: number;
}

export interface InboundMentionedUser {
  userId: string;
  label?: string;
}

export interface InboundMediaAsset {
  mediaTag: string;
  placeholder: string;
  mediaType: 'image' | 'audio' | 'video' | 'file' | string;
  mimeType?: string;
  locator?: string;
  messageSid?: string;
  fileId?: string;
  fileName?: string;
  fileSize?: string;
}

export interface InboundContext {
  Body?: string;
  BodyForAgent?: string;
  InboundHistory?: InboundHistoryEntry[];
  RawBody?: string;
  CommandBody?: string;
  BodyForCommands?: string;
  From?: string;
  To?: string;
  SessionKey?: string;
  AccountId?: string;
  ParentSessionKey?: string;
  MessageSid?: string;
  ReplyToId?: string;
  ReplyToBody?: string;
  ReplyToSender?: string;
  ReplyToSenderId?: string;
  ReplyToSenderName?: string;
  ReplyToIsQuote?: boolean;
  ThreadStarterBody?: string;
  GroupSystemPrompt?: string;
  UntrustedContext?: string[];
  MediaPath?: string;
  MediaUrl?: string;
  MediaType?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
  MediaAssets?: InboundMediaAsset[];
  ChatType?: ChatType | string;
  ConversationLabel?: string;
  GroupSubject?: string;
  SenderName?: string;
  SenderId?: string;
  SenderUsername?: string;
  Timestamp?: number;
  Provider?: string;
  Surface?: string;
  WasMentioned?: boolean;
  MentionedUsers?: InboundMentionedUser[];
  CommandAuthorized?: boolean;
  MessageThreadId?: string | number;
  OriginatingChannel?: string;
  OriginatingTo?: string;
  NativeChannelId?: string;
}

export type FinalizedInboundContext = Omit<InboundContext, 'CommandAuthorized'> & {
  Body: string;
  BodyForAgent: string;
  BodyForCommands: string;
  CommandAuthorized: boolean;
};

export type InboxSource = 'napcat' | 'simulator';

export interface InboxMessageRecord {
  id: number;
  traceId: string;
  source: InboxSource;
  messageSid: string;
  dedupeKey: string;
  chatType: 'direct' | 'group';
  sessionKey: string;
  peerId: string;
  peerName?: string;
  senderId: string;
  senderName?: string;
  accountId: string;
  isRead: boolean;
  readAt?: string | null;
  receivedAt: string;
  messageTimestamp?: string | null;
  bodyForAgent: string;
  rawBody: string;
  commandBody: string;
  wasMentioned: boolean;
  replyToId?: string;
  replyToBody?: string;
  replyToSender?: string;
  rawPayload: Record<string, unknown>;
  inboundContext: FinalizedInboundContext;
}

export interface InboxConversationSummary {
  sessionKey: string;
  chatType: 'direct' | 'group';
  peerId: string;
  peerName?: string;
  accountId: string;
  unreadCount: number;
  totalMessages: number;
  lastReceivedAt?: string | null;
  latestBodyForAgent?: string;
  latestSenderId?: string;
  latestSenderName?: string;
}

export interface InboxStats {
  totalConversations: number;
  totalMessages: number;
  unreadConversations: number;
  unreadMessages: number;
  lastReceivedAt?: string | null;
  runtimeUnreadMessages: number;
}

export interface SemanticInboundMessage {
  traceId: string;
  source: string;
  messageId: number;
  messageSid: string;
  dedupeKey?: string;
  chatType: 'direct' | 'group';
  sessionKey: string;
  peerId: string;
  peerName?: string;
  senderId: string;
  senderName?: string;
  accountId: string;
  bodyForAgent: string;
  rawBody: string;
  commandBody: string;
  wasMentioned: boolean;
  receivedAt: string;
  messageTimestamp?: string | null;
  rawPayload: Record<string, unknown>;
  inboundContext: FinalizedInboundContext;
}
