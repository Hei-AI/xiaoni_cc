export type ChatType = 'direct' | 'group';

export type InboundMentionedUser = {
  userId: string;
  label?: string;
};

export type InboundMediaAsset = {
  id?: string;
  mediaTag: string;
  placeholder: string;
  mediaType: 'image' | 'audio' | 'video' | 'file' | string;
  mimeType?: string;
  locator?: string;
  storageUri?: string;
  executorPath?: string;
  storagePath?: string;
  contentHash?: string;
  bytes?: number;
  messageSid?: string;
  fileId?: string;
  fileName?: string;
  fileSize?: string;
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
  MediaAssets?: InboundMediaAsset[];
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
  phoneNotification?: {
    app: 'qq' | string;
    notificationId: string;
    sessionKey: string;
    chatType: ChatType;
    peerId: string;
    peerName?: string | null;
    unreadDelta: number;
    directMentions: number;
    latestReceivedAt?: string | null;
    reason?: string | null;
  };
  imageTaskNotification?: {
    taskId: string;
    taskType: string;
    taskStatus: string;
    pictureId: string;
    picturePath: string;
    pictureMimeType?: string;
    pictureBytes?: number;
    targetDescription?: string | null;
    sourceTraceId?: string | null;
    sourceRunId?: string | null;
    createdAt: string;
  };
  consciousnessTick?: {
    identityKey: string;
    reason: string;
    createdAt: string;
  };
  presenceTick?: {
    identityKey: string;
    targetSessionKey?: string;
    targetGroupId?: number;
    targetPeerId?: string;
    targetPeerName?: string | null;
    targetChatType?: ChatType;
    targetAccountId?: string;
  };
  systemReminder?: {
    reminder: string;
    reason: string;
    sourceTraceId?: string | null;
    sourceRunId?: string | null;
    sourceLlmCallId?: string | null;
    sourceTurn?: number | null;
    createdAt: string;
  };
};

export type QueueMessageRecord = {
  id: string;
  traceId: string;
  batchId: string;
  status: string;
  attempts: number;
  maxAttempts?: number;
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

export type ConversationTranscriptSource =
  | 'inbound_batch'
  | 'sensory_event'
  | 'self_continuation'
  | 'presence_action'
  | 'delivery';

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
