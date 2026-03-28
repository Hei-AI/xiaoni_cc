import React, { useEffect, useMemo, useState } from 'react';
import { Inbox, MailOpen, RefreshCw, Send, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { StructuredDataViewer } from '@/components/StructuredDataViewer';
import InboxMessageComposerSheet, { type InboxConversationContext } from '@/components/InboxMessageComposerSheet';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { EntityCard } from '@/components/console/EntityCard';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { StatusPill } from '@/components/console/StatusPill';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { formatReturnedValue } from '@/lib/contract-display';
import { formatTimestamp } from '@/lib/utils';

interface InboxStats {
  totalConversations: number;
  totalMessages: number;
  unreadConversations: number;
  unreadMessages: number;
  lastReceivedAt?: string | null;
  runtimeUnreadMessages: number;
}

interface ConversationSummary {
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

interface InboxMessageRecord {
  id: number;
  traceId: string;
  source: 'napcat' | 'simulator';
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
  inboundContext: Record<string, unknown>;
}

type ConversationFilter = 'all' | 'group' | 'direct';

const QueueManagementPage: React.FC = () => {
  const [stats, setStats] = useState<InboxStats | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessageRecord[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [includeRead, setIncludeRead] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const [search, setSearch] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerConversation, setComposerConversation] = useState<InboxConversationContext | null>(null);

  const toComposerConversation = (conversation: ConversationSummary): InboxConversationContext => ({
    sessionKey: conversation.sessionKey,
    chatType: conversation.chatType,
    peerId: conversation.peerId,
    peerName: conversation.peerName,
    accountId: conversation.accountId,
    latestSenderId: conversation.latestSenderId,
    latestSenderName: conversation.latestSenderName,
  });

  const fetchDashboard = async () => {
    try {
      setLoadError(null);
      const [statsResponse, conversationsResponse] = await Promise.all([
        fetch('/api/inbox/stats'),
        fetch('/api/inbox/conversations?limit=100'),
      ]);

      const [statsResult, conversationsResult] = await Promise.all([
        statsResponse.json(),
        conversationsResponse.json(),
      ]);

      if (!statsResponse.ok || !statsResult.success) {
        throw new Error(statsResult.error || 'Failed to load inbox stats');
      }

      if (!conversationsResponse.ok || !conversationsResult.success) {
        throw new Error(conversationsResult.error || 'Failed to load inbox conversations');
      }

      setStats(statsResult.data as InboxStats);
      setConversations(conversationsResult.data as ConversationSummary[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load queue management data');
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (sessionKey: string, nextIncludeRead = includeRead) => {
    const response = await fetch(
      `/api/inbox/conversations/${encodeURIComponent(sessionKey)}/messages?limit=100&include_read=${nextIncludeRead}`
    );
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to load conversation messages');
    }

    const nextMessages = result.data as InboxMessageRecord[];
    setMessages(nextMessages);
    setSelectedMessageId((current) => {
      if (nextMessages.length === 0) {
        return null;
      }
      if (current && nextMessages.some((message) => message.id === current)) {
        return current;
      }
      return nextMessages[0].id;
    });
  };

  const handleClaimUnread = async () => {
    if (!selectedSessionKey) {
      return;
    }

    await fetch('/api/inbox/messages/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_key: selectedSessionKey,
        limit: 100,
      }),
    });

    await fetchDashboard();
    await fetchMessages(selectedSessionKey, includeRead);
  };

  useEffect(() => {
    void fetchDashboard();
  }, []);

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void fetchDashboard();
      if (selectedSessionKey) {
        void fetchMessages(selectedSessionKey, includeRead).catch((error) => {
          setLoadError(error instanceof Error ? error.message : 'Failed to refresh messages');
        });
      }
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [autoRefresh, includeRead, selectedSessionKey]);

  useEffect(() => {
    if (selectedSessionKey) {
      void fetchMessages(selectedSessionKey, includeRead).catch((error) => {
        setLoadError(error instanceof Error ? error.message : 'Failed to load messages');
      });
    }
  }, [includeRead, selectedSessionKey]);

  const filteredConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return conversations.filter((conversation) => {
      if (conversationFilter !== 'all' && conversation.chatType !== conversationFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        conversation.peerId,
        conversation.peerName,
        conversation.sessionKey,
        conversation.latestBodyForAgent,
        conversation.latestSenderId,
        conversation.latestSenderName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [conversationFilter, conversations, search]);

  useEffect(() => {
    if (!filteredConversations.length) {
      setSelectedSessionKey(null);
      setMessages([]);
      setSelectedMessageId(null);
      setComposerOpen(false);
      setComposerConversation(null);
      return;
    }

    if (!selectedSessionKey || !filteredConversations.some((conversation) => conversation.sessionKey === selectedSessionKey)) {
      setSelectedSessionKey(filteredConversations[0].sessionKey);
    }
  }, [filteredConversations, selectedSessionKey]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.sessionKey === selectedSessionKey) || null,
    [conversations, selectedSessionKey]
  );

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) || null,
    [messages, selectedMessageId]
  );

  useEffect(() => {
    if (!composerConversation) {
      return;
    }

    const conversationStillExists = conversations.some((conversation) => conversation.sessionKey === composerConversation.sessionKey);
    if (!conversationStillExists) {
      setComposerOpen(false);
      setComposerConversation(null);
    }
  }, [composerConversation, conversations]);

  const openComposer = (conversation: ConversationSummary) => {
    setSelectedSessionKey(conversation.sessionKey);
    setComposerConversation(toComposerConversation(conversation));
    setComposerOpen(true);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin" />
        <span>加载队列对象中...</span>
      </div>
    );
  }

  if (loadError && !stats && conversations.length === 0) {
    return <ErrorState description={loadError} onRetry={() => void fetchDashboard()} />;
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Ops Queue"
        title="队列管理"
        description="从运维角度查看当前有哪些群聊和私聊对象，点击对象查看详情，点 POST 用结构化编辑器投递模拟消息。"
        icon={<Inbox className="h-5 w-5" />}
        actions={
          <>
            <div className="flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-2 text-sm">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <span className="text-muted-foreground">自动刷新</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void fetchDashboard()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新列表
            </Button>
          </>
        }
      />

      {stats ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="对象总数" value={stats.totalConversations} icon={<Users className="h-5 w-5" />} />
          <MetricCard label="消息总数" value={stats.totalMessages} icon={<Inbox className="h-5 w-5" />} />
          <MetricCard label="未读对象" value={stats.unreadConversations} icon={<MailOpen className="h-5 w-5" />} tone="warning" />
          <MetricCard label="最后入站" value={formatTimestamp(stats.lastReceivedAt || undefined)} icon={<RefreshCw className="h-5 w-5" />} />
        </div>
      ) : null}

      {loadError ? <ErrorState description={loadError} onRetry={() => void fetchDashboard()} /> : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <SectionPanel
          className="xl:col-span-5"
          title="对象列表"
          description="这里不是热度图，也不是 PPT。直接点对象查看详情，点 POST 打开右侧结构化消息编辑器。"
          icon={<Users className="h-4 w-4 text-primary" />}
        >
          <div className="mb-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button variant={conversationFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setConversationFilter('all')}>
                全部
              </Button>
              <Button variant={conversationFilter === 'group' ? 'default' : 'outline'} size="sm" onClick={() => setConversationFilter('group')}>
                群聊
              </Button>
              <Button variant={conversationFilter === 'direct' ? 'default' : 'outline'} size="sm" onClick={() => setConversationFilter('direct')}>
                私聊
              </Button>
            </div>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索群号、QQ、名称或最新消息"
            />
          </div>

          {filteredConversations.length === 0 ? (
            <EmptyState icon={<Inbox className="h-10 w-10" />} title="没有匹配对象" description="缩短关键词，或者先往 provider inbox 打一些模拟消息。" />
          ) : (
            <ScrollArea className="h-[44rem] pr-2">
              <div className="space-y-3">
                {filteredConversations.map((conversation) => {
                  const isSelected = selectedSessionKey === conversation.sessionKey;
                  const title = conversation.peerName
                    || (conversation.chatType === 'group' ? `群 ${conversation.peerId}` : `QQ ${conversation.peerId}`);

                  return (
                    <EntityCard
                      key={conversation.sessionKey}
                      className={isSelected ? 'border-primary/30 bg-primary/5' : undefined}
                      onClick={() => setSelectedSessionKey(conversation.sessionKey)}
                      title={title}
                      subtitle={conversation.sessionKey}
                      badges={
                        <>
                          <StatusPill tone={conversation.chatType === 'group' ? 'warning' : 'info'}>
                            {conversation.chatType === 'group' ? '群聊' : '私聊'}
                          </StatusPill>
                          <Badge variant="outline">未读 {conversation.unreadCount}</Badge>
                          <Badge variant="outline">累计 {conversation.totalMessages}</Badge>
                        </>
                      }
                      action={
                        <Button size="sm" onClick={() => openComposer(conversation)}>
                          POST
                        </Button>
                      }
                      meta={
                        <>
                          <span>最近发送者 {formatReturnedValue(conversation.latestSenderName || conversation.latestSenderId)}</span>
                          <span>最近入站 {formatTimestamp(conversation.lastReceivedAt || undefined)}</span>
                        </>
                      }
                    >
                      <div className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {conversation.latestBodyForAgent || '最近消息为空'}
                      </div>
                    </EntityCard>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </SectionPanel>

        <SectionPanel
          className="xl:col-span-7"
          title={selectedConversation ? `对象详情 · ${selectedConversation.sessionKey}` : '对象详情'}
          description="查看最近入站消息，并从右侧结构化编辑器对当前对象 POST 一条模拟消息。"
          icon={<Send className="h-4 w-4 text-primary" />}
          action={
            selectedConversation ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-2 text-sm">
                  <Switch checked={includeRead} onCheckedChange={setIncludeRead} />
                  <span className="text-muted-foreground">包含已读</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleClaimUnread} disabled={selectedConversation.unreadCount === 0}>
                  <MailOpen className="mr-2 h-4 w-4" />
                  领取未读
                </Button>
              </div>
            ) : null
          }
        >
          {!selectedConversation ? (
            <EmptyState icon={<Users className="h-10 w-10" />} title="先选一个对象" description="左侧选中一个群聊或私聊对象，这里就会出现最近消息和 POST 入口。" />
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={selectedConversation.chatType === 'group' ? 'warning' : 'info'}>
                        {selectedConversation.chatType === 'group' ? '群聊' : '私聊'}
                      </StatusPill>
                      <Badge variant="outline">Peer {selectedConversation.peerId}</Badge>
                      <Badge variant="outline">Account {selectedConversation.accountId}</Badge>
                    </div>
                    <div className="grid gap-2 text-sm text-muted-foreground">
                      <div>对象名称 {formatReturnedValue(selectedConversation.peerName)}</div>
                      <div>最近发送者 {formatReturnedValue(selectedConversation.latestSenderName || selectedConversation.latestSenderId)}</div>
                      <div>最近入站 {formatTimestamp(selectedConversation.lastReceivedAt || undefined)}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-background p-4 text-sm">
                    <div className="font-medium text-foreground">POST 入口</div>
                    <div className="mt-2 max-w-sm leading-6 text-muted-foreground">
                      打开右侧抽屉，用结构化表单编辑常用消息字段。页面会自动生成内部通用消息体，不需要手写 JSON。
                    </div>
                    <Button className="mt-4 w-full sm:w-auto" onClick={() => openComposer(selectedConversation)}>
                      <Send className="mr-2 h-4 w-4" />
                      POST 当前对象
                    </Button>
                  </div>
                </div>
              </div>

              {messages.length === 0 ? (
                <EmptyState
                  icon={<MailOpen className="h-10 w-10" />}
                  title="当前筛选下没有消息"
                  description={includeRead ? '该对象暂时没有任何入站消息。' : '该对象当前没有 unread 消息。'}
                />
              ) : (
                <ScrollArea className="h-[22rem] rounded-2xl border border-border p-4">
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <EntityCard
                        key={message.id}
                        className={selectedMessageId === message.id ? 'border-primary/30 bg-primary/5' : undefined}
                        title={message.bodyForAgent || '(空消息)'}
                        subtitle={`MessageSid ${message.messageSid}`}
                        badges={
                          <>
                            <StatusPill tone={message.isRead ? 'neutral' : 'warning'}>
                              {message.isRead ? '已读' : '未读'}
                            </StatusPill>
                            <Badge variant="outline">{message.source}</Badge>
                            {message.wasMentioned ? <Badge variant="outline">@bot</Badge> : null}
                          </>
                        }
                        action={
                          <Button variant="outline" size="sm" onClick={() => setSelectedMessageId(message.id)}>
                            查看
                          </Button>
                        }
                        meta={
                          <>
                            <span>发送者 {message.senderName || message.senderId}</span>
                            <span>入站 {formatTimestamp(message.receivedAt)}</span>
                            <span>Trace {message.traceId}</span>
                          </>
                        }
                      >
                        {message.replyToId ? (
                          <div className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                            引用 {formatReturnedValue(message.replyToSender)} · {formatReturnedValue(message.replyToBody || message.replyToId)}
                          </div>
                        ) : null}
                      </EntityCard>
                    ))}
                  </div>
                </ScrollArea>
              )}

              <StructuredDataViewer
                title="选中消息"
                value={selectedMessage}
                emptyLabel="选择上方消息后，这里会展示完整 inbox 记录与 inboundContext。"
                heightClassName="h-[20rem]"
              />
            </div>
          )}
        </SectionPanel>
      </div>

      <InboxMessageComposerSheet
        open={composerOpen}
        onOpenChange={setComposerOpen}
        selectedConversation={composerConversation}
        onMessageSent={async (conversation) => {
          await fetchDashboard();
          if (selectedSessionKey === conversation.sessionKey) {
            await fetchMessages(conversation.sessionKey, includeRead);
          }
        }}
      />
    </PageShell>
  );
};

export default QueueManagementPage;
