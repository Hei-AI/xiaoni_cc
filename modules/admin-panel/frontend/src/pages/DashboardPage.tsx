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

  const maxLatency = useMemo(
    () => Math.max(...responseCurveData.map((item) => item.latency), 1),
    [responseCurveData]
  );

  const maxActivityValue = useMemo(
    () => Math.max(...activityBreakdown.map((item) => item.value), 1),
    [activityBreakdown]
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
          <div className="grid gap-3">
            {responseCurveData.length > 0 ? (
              responseCurveData.map((point) => (
                <div key={`${point.index}-${point.time}`} className="rounded-lg border border-border/70 bg-background/70 px-3 py-3">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{point.time}</span>
                    <span className="font-mono text-muted-foreground">{point.latency} ms</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[hsl(var(--chart-1))] transition-all"
                      style={{ width: `${Math.max((point.latency / maxLatency) * 100, point.latency > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                暂无响应时延数据
              </div>
            )}
          </div>
        </SectionPanel>

        <SectionPanel
          className="xl:col-span-4"
          title="核心分布"
          description="把当前系统高价值指标压成一组柱状快照。"
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
        >
          <div className="grid gap-4">
            {activityBreakdown.map((item) => (
              <div key={item.name} className="rounded-lg border border-border/70 bg-background/70 px-3 py-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{item.name}</span>
                  <span className="font-mono text-muted-foreground">{item.value.toLocaleString()}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-[hsl(var(--chart-2))] transition-all"
                    style={{ width: `${Math.max((item.value / maxActivityValue) * 100, item.value > 0 ? 8 : 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </PageShell>
  );
};
