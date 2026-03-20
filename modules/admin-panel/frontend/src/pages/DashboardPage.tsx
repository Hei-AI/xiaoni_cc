import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Bot,
  Clock,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { MetricCard } from '@/components/console/MetricCard';
import { FilterBar } from '@/components/console/FilterBar';
import { SectionPanel } from '@/components/console/SectionPanel';
import { EntityCard } from '@/components/console/EntityCard';
import { StatusPill } from '@/components/console/StatusPill';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { formatTimestamp } from '@/lib/utils';
import { useConversations, useDashboardStats, useTokenStats } from '../hooks/useDashboardData';

export const DashboardPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setCurrentPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const { data: dashboardStats, isLoading: statsLoading } = useDashboardStats();
  const { data: tokenStats, isLoading: tokenStatsLoading } = useTokenStats();

  const conversationsQuery = useConversations({
    limit: showAll ? 16 : 8,
    page: currentPage,
    search: debouncedSearchTerm || undefined,
    sortBy: 'timestamp',
    sortOrder: 'desc',
  });

  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    error: conversationsError,
  } = conversationsQuery;

  const conversations = conversationsData?.data || [];
  const totalConversations = conversationsData?.total || 0;

  const responseCurveData = useMemo(
    () =>
      [...conversations]
        .reverse()
        .slice(-8)
        .map((conversation, index) => ({
          index: index + 1,
          time: formatTimestamp(conversation.timestamp, { fallback: '--' }).slice(11, 16),
          latency: conversation.response_time || 0,
        })),
    [conversations]
  );

  const activityBreakdown = useMemo(
    () => [
      {
        name: 'Messages',
        value: dashboardStats?.totalMessages || 0,
      },
      {
        name: 'AI',
        value: dashboardStats?.aiResponses || 0,
      },
      {
        name: 'Groups',
        value: dashboardStats?.activeGroups || 0,
      },
      {
        name: 'Tokens',
        value: tokenStats?.activeTokens || 0,
      },
    ],
    [dashboardStats, tokenStats]
  );

  const healthTone =
    dashboardStats?.systemHealth === 'healthy'
      ? 'success'
      : dashboardStats?.systemHealth === 'warning'
        ? 'warning'
        : 'info';

  return (
    <PageShell>
      <PageHeader
        eyebrow="Exchange Ops"
        title="QQ Bot 指挥台"
        description="统一查看机器人流量、健康状态、AI 响应与最近事件。"
        icon={<TrendingUp className="h-5 w-5" />}
        badge={<PageHeaderBadge>{totalConversations.toLocaleString()} Records</PageHeaderBadge>}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => conversationsQuery.refetch()} disabled={conversationsLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${conversationsLoading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button size="sm" onClick={() => setShowAll((value) => !value)}>
              {showAll ? '收起' : '展开'}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="总消息流量"
          value={statsLoading ? <Loader2 className="h-7 w-7 animate-spin" /> : (dashboardStats?.totalMessages || 0).toLocaleString()}
          detail={`AI 响应 ${dashboardStats?.aiResponses || 0} 次`}
          icon={<MessageCircle className="h-5 w-5" />}
        />
        <MetricCard
          label="活跃群组"
          value={statsLoading ? <Loader2 className="h-7 w-7 animate-spin" /> : dashboardStats?.activeGroups || 0}
          detail={`运行时长 ${dashboardStats?.uptime || 'N/A'}`}
          icon={<Bot className="h-5 w-5" />}
          tone="success"
        />
        <MetricCard
          label="系统健康"
          value={
            statsLoading ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <StatusPill tone={healthTone}>{dashboardStats?.systemHealth || 'unknown'}</StatusPill>
            )
          }
          detail="实时状态和波动压缩显示"
          icon={<ShieldCheck className="h-5 w-5" />}
          tone="warning"
        />
        <MetricCard
          label="Token 状态"
          value={tokenStatsLoading ? <Loader2 className="h-7 w-7 animate-spin" /> : tokenStats?.activeTokens || 'N/A'}
          detail={`今日成本 ¥${tokenStats?.todayCost || '0.00'}`}
          icon={<Wallet className="h-5 w-5" />}
          tone="default"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <SectionPanel
          className="xl:col-span-8"
          title="响应波动"
          description="最近一批对话的响应时延。没有后端时序接口时，使用最新流量切片构建前端监控视图。"
          icon={<Activity className="h-4 w-4 text-primary" />}
          action={<StatusPill tone="info">Latency Monitor</StatusPill>}
        >
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={responseCurveData}>
                <defs>
                  <linearGradient id="dashboardLatency" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.55} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.10)" vertical={false} />
                <XAxis dataKey="time" stroke="rgba(148,163,184,0.6)" tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(148,163,184,0.6)" tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(255,255,255,0.98)',
                    border: '1px solid rgba(203,213,225,0.9)',
                    borderRadius: '12px',
                    boxShadow: '0 10px 30px -18px rgba(15,23,42,0.28)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  fill="url(#dashboardLatency)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionPanel>

        <SectionPanel
          className="xl:col-span-4"
          title="核心分布"
          description="把当前系统高价值指标压成一组柱状快照。"
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
        >
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activityBreakdown}>
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
                <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionPanel>
      </div>

      <SectionPanel
        title="最近对话流"
        description="桌面端保留高密度上下文，移动端收束成实体卡片。支持搜索和跳转到时间线。"
        icon={<Clock className="h-4 w-4 text-primary" />}
        action={<StatusPill tone="neutral">{totalConversations} 条记录</StatusPill>}
      >
        <div className="space-y-4">
          <FilterBar className="border-none bg-transparent shadow-none">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索对话内容、ID、用户"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="info">Page {currentPage}</StatusPill>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}>
                  上一页
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage((value) => value + 1)} disabled={conversations.length === 0}>
                  下一页
                </Button>
              </div>
            </div>
          </FilterBar>

          {conversationsError ? (
            <ErrorState description={conversationsError.message} onRetry={() => conversationsQuery.refetch()} />
          ) : conversationsLoading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: showAll ? 6 : 4 }).map((_, index) => (
                <div key={index} className="terminal-card h-40 animate-pulse rounded-xl bg-muted/60" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={<MessageCircle className="h-10 w-10" />}
              title={searchTerm ? '没有匹配的对话' : '暂无对话记录'}
              description={searchTerm ? '换个关键词再试，或者清空搜索框。' : '当用户开始和机器人交互时，这里会实时出现最新消息流。'}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {conversations.map((conversation) => (
                <EntityCard
                  key={conversation.id}
                  title={`用户 ${conversation.user_id}`}
                  subtitle={conversation.model_name || 'Unknown model'}
                  badges={
                    <>
                      <Badge variant="outline">{conversation.model_name || 'Model N/A'}</Badge>
                      <StatusPill tone={conversation.ai_response ? 'success' : 'warning'}>
                        {conversation.ai_response ? '响应完成' : '等待回复'}
                      </StatusPill>
                    </>
                  }
                  action={
                    <Link to={`/conversation/${conversation.id}/timeline`}>
                      <Button size="sm">
                        时间线
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  }
                  meta={
                    <>
                      <span>{formatTimestamp(conversation.timestamp)}</span>
                      <span>响应 {conversation.response_time}ms</span>
                    </>
                  }
                >
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">User</p>
                    <p className="mt-2 line-clamp-2 text-sm text-foreground">{conversation.user_message}</p>
                  </div>
                  <div className="rounded-lg border border-primary/15 bg-primary/5 p-3">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-primary">Bot</p>
                    <p className="mt-2 line-clamp-3 text-sm text-foreground">{conversation.ai_response || '暂无 AI 回复'}</p>
                  </div>
                </EntityCard>
              ))}
            </div>
          )}
        </div>
      </SectionPanel>
    </PageShell>
  );
};
