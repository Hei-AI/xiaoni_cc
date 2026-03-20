import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle,
  Clock,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import QueueSimulationPanel, { QueueSimulationOption } from '@/components/QueueSimulationPanel';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { EntityCard } from '@/components/console/EntityCard';
import { EmptyState } from '@/components/console/EmptyState';
import { StatusPill } from '@/components/console/StatusPill';

interface QueueInfo {
  name: string;
  type: 'private' | 'group';
  userId?: number;
  groupId?: number;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  lastJobAt?: string;
  stats?: {
    avgProcessingTime: number;
    throughput: number;
    errorRate: number;
  };
}

interface UnconsumedMessage {
  id: string;
  traceId: string;
  type: string;
  data: unknown;
  timestamp: string;
  priority: number;
  attempts: number;
  delay: number;
  queueName: string;
  state: 'waiting' | 'active' | 'delayed';
}

interface QueueStats {
  totalQueues: number;
  totalMessages: number;
  totalUnconsumed: number;
  lastUpdated: string;
}

const PRIVATE_OPTIONS_LIMIT = 200;
const GROUP_OPTIONS_LIMIT = 200;

const fetchPrivateChatOptions = async (): Promise<QueueSimulationOption[]> => {
  const response = await fetch(`/api/private-chats?page=1&limit=${PRIVATE_OPTIONS_LIMIT}`);
  if (!response.ok) {
    throw new Error('Failed to fetch private chat options');
  }

  const payload = await response.json();
  const users: Array<{ user_id: number; nickname?: string }> = payload?.data ?? [];

  return users.map((user) => ({
    value: user.user_id,
    label: user.nickname ? `${user.nickname} (${user.user_id})` : `用户 ${user.user_id}`,
  }));
};

const fetchGroupChatOptions = async (): Promise<QueueSimulationOption[]> => {
  const response = await fetch(`/api/group-chats?page=1&limit=${GROUP_OPTIONS_LIMIT}`);
  if (!response.ok) {
    throw new Error('Failed to fetch group chat options');
  }

  const payload = await response.json();
  const groups: Array<{ group_id: number; group_name?: string }> = payload?.data ?? [];

  return groups.map((group) => ({
    value: group.group_id,
    label: group.group_name ? `${group.group_name} (${group.group_id})` : `群组 ${group.group_id}`,
  }));
};

const QueueManagementPage: React.FC = () => {
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [unconsumedMessages, setUnconsumedMessages] = useState<UnconsumedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchQueues = async () => {
    try {
      const response = await fetch('/api/queue-monitor/queues');
      const result = await response.json();

      if (result.success) {
        setQueues(result.data);
        setStats(result.stats);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchUnconsumedMessages = async (queueName: string) => {
    const response = await fetch(`/api/queue-monitor/queues/${queueName}/unconsumed?limit=100`);
    const result = await response.json();

    if (result.success) {
      setUnconsumedMessages(result.data);
    }
  };

  const handleQueueAction = async (queueName: string, action: 'pause' | 'resume' | 'clear') => {
    let url = `/api/queue-monitor/queues/${queueName}`;
    let method = 'PATCH';
    let body: string | null = null;

    if (action === 'clear') {
      method = 'DELETE';
    } else {
      url += '/pause';
      body = JSON.stringify({ paused: action === 'pause' });
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    const result = await response.json();
    if (result.success) {
      await fetchQueues();
      if (selectedQueue === queueName) {
        await fetchUnconsumedMessages(queueName);
      }
    }
  };

  useEffect(() => {
    fetchQueues();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const interval = window.setInterval(() => {
      fetchQueues();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [autoRefresh]);

  useEffect(() => {
    if (selectedQueue) {
      fetchUnconsumedMessages(selectedQueue);
    }
  }, [selectedQueue]);

  const selectedQueueData = queues.find((queue) => queue.name === selectedQueue) || null;

  const { data: privateChatOptions = [] } = useQuery({
    queryKey: ['queue-simulation-private-options'],
    queryFn: fetchPrivateChatOptions,
    staleTime: 5 * 60 * 1000,
  });

  const { data: groupChatOptions = [] } = useQuery({
    queryKey: ['queue-simulation-group-options'],
    queryFn: fetchGroupChatOptions,
    staleTime: 5 * 60 * 1000,
  });

  const availableUserOptions = useMemo(() => {
    if (!selectedQueueData?.userId) return privateChatOptions;
    const exists = privateChatOptions.some((option) => option.value === selectedQueueData.userId);
    return exists
      ? privateChatOptions
      : [{ value: selectedQueueData.userId, label: `用户 ${selectedQueueData.userId}` }, ...privateChatOptions];
  }, [privateChatOptions, selectedQueueData?.userId]);

  const availableGroupOptions = useMemo(() => {
    if (!selectedQueueData?.groupId) return groupChatOptions;
    const exists = groupChatOptions.some((option) => option.value === selectedQueueData.groupId);
    return exists
      ? groupChatOptions
      : [{ value: selectedQueueData.groupId, label: `群组 ${selectedQueueData.groupId}` }, ...groupChatOptions];
  }, [groupChatOptions, selectedQueueData?.groupId]);

  const handleSimulationCompleted = async () => {
    await fetchQueues();
    if (selectedQueue) {
      await fetchUnconsumedMessages(selectedQueue);
    }
  };

  const formatTime = (timestamp: string) => new Date(timestamp).toLocaleString('zh-CN');
  const formatProcessingTime = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
  const getQueueStatusText = (queue: QueueInfo) => {
    if (queue.paused) return '暂停';
    if (queue.failed > 0) return '有失败';
    if (queue.active > 0) return '处理中';
    if (queue.waiting > 0) return '等待中';
    return '空闲';
  };
  const getQueueTone = (queue: QueueInfo) => {
    if (queue.paused) return 'neutral';
    if (queue.failed > 0) return 'danger';
    if (queue.active > 0) return 'success';
    if (queue.waiting > 0) return 'warning';
    return 'info';
  };

  const chartData = queues.slice(0, 8).map((queue) => ({
    name: queue.type === 'private' ? `U${queue.userId}` : `G${queue.groupId}`,
    waiting: queue.waiting,
    active: queue.active,
    failed: queue.failed,
  }));

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin" />
        <span className="ml-2">加载队列信息...</span>
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Queue Radar"
        title="队列管理"
        description="把运行时消息队列压成可操作的监控工作台，手机端也能完成队列查看、暂停、清空和消息模拟。"
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <>
            <div className="flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-2 text-sm">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <span className="text-muted-foreground">自动刷新</span>
            </div>
            <Button variant="outline" size="sm" onClick={fetchQueues}>
              <RefreshCw className="mr-2 h-4 w-4" />
              手动刷新
            </Button>
          </>
        }
      />

      {stats && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="总队列数" value={stats.totalQueues} icon={<BarChart3 className="h-5 w-5" />} />
          <MetricCard label="总消息数" value={stats.totalMessages} icon={<MessageSquare className="h-5 w-5" />} />
          <MetricCard label="未消费消息" value={stats.totalUnconsumed} icon={<Clock className="h-5 w-5" />} tone="warning" />
          <MetricCard label="最后更新" value={formatTime(stats.lastUpdated)} icon={<Activity className="h-5 w-5" />} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <SectionPanel
          className="xl:col-span-4"
          title="队列列表"
          description="按队列选中后可在右侧查看消息和统计。"
          icon={<Users className="h-4 w-4 text-primary" />}
        >
          <div className="space-y-3">
            {queues.map((queue) => (
              <EntityCard
                key={queue.name}
                className={selectedQueue === queue.name ? 'border-primary/30 bg-primary/5' : undefined}
                title={queue.type === 'private' ? `用户 ${queue.userId}` : `群组 ${queue.groupId}`}
                subtitle={queue.name}
                badges={
                  <>
                    <StatusPill tone={getQueueTone(queue)}>{getQueueStatusText(queue)}</StatusPill>
                    <Badge variant="outline">等待 {queue.waiting}</Badge>
                  </>
                }
                action={
                  <Button variant="outline" size="sm" onClick={() => setSelectedQueue(queue.name)}>
                    选中
                  </Button>
                }
                meta={
                  <>
                    <span>处理中 {queue.active}</span>
                    <span>完成 {queue.completed}</span>
                    <span>失败 {queue.failed}</span>
                  </>
                }
              >
                <Progress
                  value={queue.waiting + queue.completed > 0 ? (queue.completed / (queue.completed + queue.waiting)) * 100 : 0}
                  className="h-2"
                />
                {queue.stats && (
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <span>{formatProcessingTime(queue.stats.avgProcessingTime)}</span>
                    <span>{queue.stats.throughput}/h</span>
                    <span>{(queue.stats.errorRate * 100).toFixed(1)}%</span>
                  </div>
                )}
              </EntityCard>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel
          className="xl:col-span-8"
          title="队列热度"
          description="选取前几条队列绘制等待/处理中/失败的实时截面。"
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
                <Bar dataKey="waiting" fill="hsl(var(--chart-4))" radius={[8, 8, 0, 0]} />
                <Bar dataKey="active" fill="hsl(var(--chart-1))" radius={[8, 8, 0, 0]} />
                <Bar dataKey="failed" fill="hsl(var(--chart-5))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionPanel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <SectionPanel
          className="xl:col-span-7"
          title={selectedQueue ? `队列详情 · ${selectedQueue}` : '队列详情'}
          description="查看未消费消息、性能统计并执行暂停/恢复/清空。"
          icon={<MessageSquare className="h-4 w-4 text-primary" />}
          action={
            selectedQueueData ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQueueAction(selectedQueueData.name, selectedQueueData.paused ? 'resume' : 'pause')}
                >
                  {selectedQueueData.paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                  {selectedQueueData.paused ? '恢复' : '暂停'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQueueAction(selectedQueueData.name, 'clear')}
                  disabled={selectedQueueData.waiting === 0 && selectedQueueData.active === 0}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  清空
                </Button>
              </div>
            ) : null
          }
        >
          {!selectedQueue ? (
            <EmptyState icon={<Users className="h-10 w-10" />} title="选择一个队列查看详情" description="左侧选中后，这里会显示未消费消息和性能统计。" />
          ) : (
            <Tabs defaultValue="messages">
              <TabsList className="mb-4 w-full justify-start overflow-x-auto hide-scrollbar">
                <TabsTrigger value="messages">未消费消息</TabsTrigger>
                <TabsTrigger value="stats">性能统计</TabsTrigger>
              </TabsList>

              <TabsContent value="messages">
                {unconsumedMessages.length > 0 ? (
                  <>
                    <div className="space-y-3 md:hidden">
                      {unconsumedMessages.map((message) => (
                        <EntityCard
                          key={message.id}
                          title={message.id}
                          subtitle={message.type}
                          badges={
                            <>
                              <StatusPill tone={message.state === 'active' ? 'success' : message.state === 'delayed' ? 'warning' : 'info'}>
                                {message.state}
                              </StatusPill>
                              <Badge variant="outline">P{message.priority}</Badge>
                            </>
                          }
                          meta={
                            <>
                              <span>{formatTime(message.timestamp)}</span>
                              <span>重试 {message.attempts}</span>
                              <span>{message.traceId}</span>
                            </>
                          }
                        />
                      ))}
                    </div>
                    <div className="hidden md:block">
                      <ScrollArea className="h-96">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>消息ID</TableHead>
                              <TableHead>状态</TableHead>
                              <TableHead>类型</TableHead>
                              <TableHead>优先级</TableHead>
                              <TableHead>重试次数</TableHead>
                              <TableHead>时间</TableHead>
                              <TableHead>TraceID</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unconsumedMessages.map((message) => (
                              <TableRow key={message.id}>
                                <TableCell className="font-mono text-sm">{message.id}</TableCell>
                                <TableCell>
                                  <StatusPill tone={message.state === 'active' ? 'success' : message.state === 'delayed' ? 'warning' : 'info'}>
                                    {message.state}
                                  </StatusPill>
                                </TableCell>
                                <TableCell>{message.type}</TableCell>
                                <TableCell>
                                  <Badge variant="outline">{message.priority}</Badge>
                                </TableCell>
                                <TableCell>{message.attempts}</TableCell>
                                <TableCell className="text-sm">{formatTime(message.timestamp)}</TableCell>
                                <TableCell className="font-mono text-xs">{message.traceId}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </div>
                  </>
                ) : (
                  <EmptyState icon={<CheckCircle className="h-10 w-10" />} title="没有未消费消息" description="当前队列干净，未发现等待或延迟中的消息。" />
                )}
              </TabsContent>

              <TabsContent value="stats">
                {selectedQueueData?.stats ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <MetricCard label="平均处理时间" value={formatProcessingTime(selectedQueueData.stats.avgProcessingTime)} />
                    <MetricCard label="小时吞吐量" value={selectedQueueData.stats.throughput} />
                    <MetricCard
                      label="错误率"
                      value={`${(selectedQueueData.stats.errorRate * 100).toFixed(1)}%`}
                      tone={selectedQueueData.stats.errorRate > 0.1 ? 'danger' : 'success'}
                    />
                  </div>
                ) : (
                  <EmptyState icon={<AlertCircle className="h-10 w-10" />} title="暂无统计数据" description="当前队列还没有积累足够的性能采样。" />
                )}
              </TabsContent>
            </Tabs>
          )}
        </SectionPanel>

        <SectionPanel
          className="xl:col-span-5"
          title="消息模拟器"
          description="模拟私聊或群聊消息，选中左侧队列后自动填充目标字段。"
          icon={<Play className="h-4 w-4 text-primary" />}
        >
          <QueueSimulationPanel
            selectedQueue={
              selectedQueueData
                ? {
                    name: selectedQueueData.name,
                    type: selectedQueueData.type,
                    userId: selectedQueueData.userId,
                    groupId: selectedQueueData.groupId,
                  }
                : null
            }
            availableUsers={availableUserOptions}
            availableGroups={availableGroupOptions}
            onMessageSent={handleSimulationCompleted}
          />
        </SectionPanel>
      </div>
    </PageShell>
  );
};

export default QueueManagementPage;
