export type ChatType = 'direct' | 'group';

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
  ChatType?: ChatType | string;
  ConversationLabel?: string;
  GroupSubject?: string;
  SenderName?: string;
  SenderId?: string;
  Timestamp?: number;
  Provider?: string;
  Surface?: string;
  WasMentioned?: boolean;
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

export type ConversationTurn = {
  id: number;
  userId: number;
  groupId: number | null;
  userMessage: string;
  aiResponse: string | null;
};

export type AgentToolCall = {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  rawArguments: string;
};
