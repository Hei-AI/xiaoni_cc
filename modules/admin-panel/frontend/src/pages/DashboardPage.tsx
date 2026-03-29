import React, { useMemo } from 'react';
import {
  Activity,
  Bot,
  Clock,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
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
import { PageShell } from '@/components/console/PageShell';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { formatReturnedValue } from '@/lib/contract-display';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { StatusPill } from '@/components/console/StatusPill';
import { formatTimestamp } from '@/lib/utils';
import { useConversations, useDashboardStats } from '../hooks/useDashboardData';

export const DashboardPage: React.FC = () => {
  const {
    data: dashboardStats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    refetch: refetchDashboardStats,
  } = useDashboardStats();
  const conversationsQuery = useConversations({
    limit: 8,
    sortBy: 'timestamp',
    sortOrder: 'desc',
  });

  const {
    data: conversationsData,
    isFetching: conversationsFetching,
    refetch: refetchConversations,
  } = conversationsQuery;

  const conversations = conversationsData?.data || [];
  const totalConversations = conversationsData?.total || 0;
  const isRefreshing = statsFetching || conversationsFetching;

  const handleRefresh = () => {
    void refetchDashboardStats();
    void refetchConversations();
  };

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
    ],
    [dashboardStats]
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
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            刷新
          </Button>
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
          detail={`运行时长 ${formatReturnedValue(dashboardStats?.uptime)}`}
          icon={<Bot className="h-5 w-5" />}
          tone="success"
        />
        <MetricCard
          label="系统健康"
          value={
            statsLoading ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <StatusPill tone={healthTone}>{formatReturnedValue(dashboardStats?.systemHealth)}</StatusPill>
            )
          }
          detail="实时状态和波动压缩显示"
          icon={<ShieldCheck className="h-5 w-5" />}
          tone="warning"
        />
        <MetricCard
          label="今日调用"
          value={statsLoading ? <Loader2 className="h-7 w-7 animate-spin" /> : (dashboardStats?.aiResponses || 0).toLocaleString()}
          detail={`最近 ${totalConversations.toLocaleString()} 条对话已纳入看板`}
          icon={<Clock className="h-5 w-5" />}
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
    </PageShell>
  );
};
