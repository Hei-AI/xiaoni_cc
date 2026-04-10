export type ChatType = 'direct' | 'group';

export type InboundMentionedUser = {
  userId: string;
  label?: string;
};

export type FinalizedInboundContext = {
  Body: string;
  BodyForAgent: string;
  BodyForCommands: string;
  RawBody?: string;
  CommandBody?: string;
  From?: string;
  To?: string;
  SessionKey?: string;
  AccountId?: string;
  MessageSid?: string;
  ReplyToId?: string;
  ReplyToBody?: string;
  ReplyToSender?: string;
  ReplyToSenderId?: string;
  ReplyToSenderName?: string;
  ReplyToIsQuote?: boolean;
  ChatType?: ChatType | string;
  ConversationLabel?: string;
  GroupSubject?: string;
  SenderName?: string;
  SenderId?: string;
  Timestamp?: number;
  Provider?: string;
  Surface?: string;
  WasMentioned?: boolean;
  MentionedUsers?: InboundMentionedUser[];
  OriginatingChannel?: string;
  OriginatingTo?: string;
  NativeChannelId?: string;
  CommandAuthorized: boolean;
};

export type QueueBatchMessage = {
  queueMessageId: number;
  traceId: string;
  source: string;
  messageId: number;
  messageSid: string;
  chatType: ChatType;
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
};

export type QueueMessagePayload = {
  traceId: string;
  runId: string;
  batchId: string;
  source: string;
  chatType: ChatType;
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
  messages: QueueBatchMessage[];
};

export type QueueMessageRecord = {
  id: string;
  traceId: string;
  batchId: string;
  status: string;
  attempts: number;
  createdAt: string;
  processingStartedAt?: string | null;
  completedAt?: string | null;
  conversationId?: number | null;
  errorMessage?: string | null;
  queueMessageIds: number[];
  payload: QueueMessagePayload;
};

export type ConversationTranscriptRole = 'user' | 'assistant';

export type ConversationTranscriptPhase = 'commentary' | 'final_answer';

export type ConversationTranscriptSource = 'inbound_batch' | 'delivery' | 'legacy_user_message' | 'legacy_ai_response';

export type ConversationTranscriptItem = {
  id: number | null;
  conversationId: number;
  sessionKey: string | null;
  role: ConversationTranscriptRole;
  phase: ConversationTranscriptPhase | null;
  content: string;
  groupIndex: number;
  itemIndex: number;
  source: ConversationTranscriptSource;
  deliveryMessageId: number | null;
  runId: string | null;
  traceId: string | null;
};

export type ConversationTurn = {
  id: number;
  userId: number;
  groupId: number | null;
  batchId: number | null;
  sessionKey: string | null;
  userMessage: string;
  aiResponse: string | null;
  items: ConversationTranscriptItem[];
  rawResponse?: Record<string, unknown>;
};

export type AgentToolCall = {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  rawArguments: string;
};
