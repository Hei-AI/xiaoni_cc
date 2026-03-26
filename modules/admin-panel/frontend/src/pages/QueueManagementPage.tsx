import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Inbox, MailOpen, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import QueueSimulationPanel from '@/components/QueueSimulationPanel';
import { StructuredDataViewer } from '@/components/StructuredDataViewer';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { EntityCard } from '@/components/console/EntityCard';
import { EmptyState } from '@/components/console/EmptyState';
import { StatusPill } from '@/components/console/StatusPill';
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

const QueueManagementPage: React.FC = () => {
  const [stats, setStats] = useState<InboxStats | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessageRecord[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [includeRead, setIncludeRead] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = async () => {
    try {
      const [statsResponse, conversationsResponse] = await Promise.all([
        fetch('/api/inbox/stats'),
        fetch('/api/inbox/conversations?limit=100'),
      ]);

      const [statsResult, conversationsResult] = await Promise.all([
        statsResponse.json(),
        conversationsResponse.json(),
      ]);

      if (statsResult.success) {
        setStats(statsResult.data);
      }

      if (conversationsResult.success) {
        setConversations(conversationsResult.data);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (sessionKey: string, nextIncludeRead = includeRead) => {
    const response = await fetch(
      `/api/inbox/conversations/${encodeURIComponent(sessionKey)}/messages?limit=100&include_read=${nextIncludeRead}`
    );
    const result = await response.json();

    if (result.success) {
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
    }
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
        void fetchMessages(selectedSessionKey, includeRead);
      }
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [autoRefresh, includeRead, selectedSessionKey]);

  useEffect(() => {
    if (selectedSessionKey) {
      void fetchMessages(selectedSessionKey, includeRead);
    }
  }, [includeRead, selectedSessionKey]);

  useEffect(() => {
    if (!selectedSessionKey && conversations.length > 0) {
      setSelectedSessionKey(conversations[0].sessionKey);
    }
  }, [conversations, selectedSessionKey]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.sessionKey === selectedSessionKey) || null,
    [conversations, selectedSessionKey]
  );

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) || null,
    [messages, selectedMessageId]
  );

  const chartData = conversations.slice(0, 8).map((conversation) => ({
    name: conversation.chatType === 'group' ? `G${conversation.peerId}` : `U${conversation.peerId}`,
    unread: conversation.unreadCount,
    total: conversation.totalMessages,
  }));

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin" />
        <span>加载 Inbox 中...</span>
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Inbox"
        title="消息收件箱"
        description="NapCat 入站消息会先落到统一 inbox，再按 unread/read 管理。这里看会话、看消息、领取未读和提交内部消息体。"
        icon={<Inbox className="h-5 w-5" />}
        actions={
          <>
            <div className="flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-2 text-sm">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <span className="text-muted-foreground">自动刷新</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void fetchDashboard()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              手动刷新
            </Button>
          </>
        }
      />

      {stats ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="会话数" value={stats.totalConversations} icon={<Users className="h-5 w-5" />} />
          <MetricCard label="总消息数" value={stats.totalMessages} icon={<MessageSquare className="h-5 w-5" />} />
          <MetricCard label="未读会话" value={stats.unreadConversations} icon={<MailOpen className="h-5 w-5" />} tone="warning" />
          <MetricCard label="未读消息" value={stats.unreadMessages} icon={<Inbox className="h-5 w-5" />} tone="warning" />
          <MetricCard
            label="最后入站"
            value={formatTimestamp(stats.lastReceivedAt || undefined)}
            icon={<Activity className="h-5 w-5" />}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <SectionPanel
          className="xl:col-span-4"
          title="会话列表"
          description="按 SessionKey 汇总，区分私聊和群聊，并展示 unread 负载。"
          icon={<Users className="h-4 w-4 text-primary" />}
        >
          {conversations.length === 0 ? (
            <EmptyState icon={<Inbox className="h-10 w-10" />} title="Inbox 还没有消息" description="NapCat 或模拟器写入后，这里会按会话聚合展示。" />
          ) : (
            <div className="space-y-3">
              {conversations.map((conversation) => (
                <EntityCard
                  key={conversation.sessionKey}
                  className={selectedSessionKey === conversation.sessionKey ? 'border-primary/30 bg-primary/5' : undefined}
                  title={conversation.peerName || (conversation.chatType === 'group' ? `群 ${conversation.peerId}` : `QQ ${conversation.peerId}`)}
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
                    <Button variant="outline" size="sm" onClick={() => setSelectedSessionKey(conversation.sessionKey)}>
                      选中
                    </Button>
                  }
                  meta={
                    <>
                      <span>最近发送者 {conversation.latestSenderName || conversation.latestSenderId || '-'}</span>
                      <span>最近入站 {formatTimestamp(conversation.lastReceivedAt || undefined)}</span>
                    </>
                  }
                >
                  <div className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {conversation.latestBodyForAgent || '最近消息为空'}
                  </div>
                </EntityCard>
              ))}
            </div>
          )}
        </SectionPanel>

        <SectionPanel
          className="xl:col-span-8"
          title="收件箱热度"
          description="查看前几个会话的 unread 与累计消息分布。"
          icon={<Activity className="h-4 w-4 text-primary" />}
        >
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid stroke="rgba(148,163,184,0.10)" vertical={false} />
                <XAxis dataKey="name" stroke="rgba(148,163,184,0.6)" tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(148,163,184,0.6)" tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(255,255,255,0.98)',
                    border: '1px solid rgba(203,213,225,0.9)',
                    borderRadius: '12px',
                    boxShadow: '0 10px 30px -18px rgba(15,23,42,0.28)',
                  }}
                />
                <Bar dataKey="unread" fill="hsl(var(--chart-4))" radius={[8, 8, 0, 0]} />
                <Bar dataKey="total" fill="hsl(var(--chart-1))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionPanel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <SectionPanel
          className="xl:col-span-7"
          title={selectedConversation ? `会话详情 · ${selectedConversation.sessionKey}` : '会话详情'}
          description="查看该会话的 unread 或完整消息列表，并检查单条消息的内部消息体。"
          icon={<MessageSquare className="h-4 w-4 text-primary" />}
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
            <EmptyState icon={<Users className="h-10 w-10" />} title="选择一个会话查看详情" description="左侧选中后，这里会显示消息列表和内部消息体。" />
          ) : (
            <div className="space-y-4">
              {messages.length === 0 ? (
                <EmptyState
                  icon={<MailOpen className="h-10 w-10" />}
                  title="当前筛选下没有消息"
                  description={includeRead ? '该会话暂时没有任何入站消息。' : '该会话当前没有 unread 消息。'}
                />
              ) : (
                <ScrollArea className="h-[26rem] rounded-2xl border border-border p-4">
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
                            引用 {message.replyToSender || '-'} · {message.replyToBody || message.replyToId}
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
                heightClassName="h-[24rem]"
              />
            </div>
          )}
        </SectionPanel>

        <SectionPanel
          className="xl:col-span-5"
          title="模拟写入"
          description="使用内部消息体 JSON 直接写入 provider inbox。"
          icon={<Inbox className="h-4 w-4 text-primary" />}
        >
          <QueueSimulationPanel
            selectedConversation={
              selectedConversation
                ? {
                    sessionKey: selectedConversation.sessionKey,
                    chatType: selectedConversation.chatType,
                    peerId: selectedConversation.peerId,
                    peerName: selectedConversation.peerName,
                    accountId: selectedConversation.accountId,
                    latestSenderId: selectedConversation.latestSenderId,
                    latestSenderName: selectedConversation.latestSenderName,
                  }
                : null
            }
            onMessageSent={async () => {
              await fetchDashboard();
              if (selectedSessionKey) {
                await fetchMessages(selectedSessionKey, includeRead);
              }
            }}
          />
        </SectionPanel>
      </div>
    </PageShell>
  );
};

export default QueueManagementPage;
