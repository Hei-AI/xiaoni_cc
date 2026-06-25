import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Clock, Gauge, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { EmptyState } from '@/components/console/EmptyState';
import { useState } from 'react';
import { formatTimestamp } from '@/lib/utils';

interface QuotaWindow {
  utilization: number | null;
  remaining: number | null;
  status: string | null;
  resetEpoch: number | null;
  resetAt: string | null;
}

interface QuotaSnapshot {
  provider: string;
  capturedAt: string | null;
  modelName: string | null;
  status: string | null;
  resetAt: string | null;
  fallbackPercentage: number | null;
  overageStatus: string | null;
  overageDisabledReason: string | null;
  organizationId: string | null;
  windows: {
    fiveHour: QuotaWindow;
    weekly: QuotaWindow;
  };
}

interface TimelinePoint {
  timestamp: string | null;
  util5h: number | null;
  util7d: number | null;
  status5h: string | null;
  status7d: string | null;
}

interface TimelineResult {
  provider: string;
  generatedAt: string;
  window: { startTime: string; endTime: string };
  limit: number;
  truncated: boolean;
  points: TimelinePoint[];
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || typeof value === 'undefined') {
    return '—';
  }
  return `${(value * 100).toFixed(1)}%`;
}

function statusTone(status: string | null | undefined): 'default' | 'success' | 'warning' | 'danger' {
  if (status === 'rejected') {
    return 'danger';
  }
  if (status === 'allowed_warning') {
    return 'warning';
  }
  if (status === 'allowed') {
    return 'success';
  }
  return 'default';
}

function relativeFromNow(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) {
    return '—';
  }
  const diffMs = Date.now() - target;
  const absMin = Math.round(Math.abs(diffMs) / 60000);
  if (absMin < 1) {
    return diffMs >= 0 ? '刚刚' : '即将';
  }
  const hours = Math.floor(absMin / 60);
  const mins = absMin % 60;
  const span = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return diffMs >= 0 ? `${span} 前` : `${span} 后`;
}

function QuotaWindowCard({ label, win }: { label: string; win: QuotaWindow | undefined }) {
  const utilization = win?.utilization ?? null;
  const remaining = win?.remaining ?? null;
  const pct = utilization === null ? 0 : Math.round(utilization * 100);
  return (
    <MetricCard
      label={label}
      value={(
        <span>
          剩余 <span className="text-[hsl(var(--success))]">{formatPercent(remaining)}</span>
        </span>
      )}
      tone={statusTone(win?.status)}
      icon={<Gauge className="h-5 w-5" />}
      detail={(
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span>已用 {formatPercent(utilization)}</span>
            <span className="text-muted-foreground">{win?.status ?? '—'}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            重置 {relativeFromNow(win?.resetAt)}（{formatTimestamp(win?.resetAt ?? undefined)}）
          </div>
        </div>
      )}
    />
  );
}

export function CcAccountUsagePage() {
  const [range, setRange] = useState('7d');

  const {
    data: quotaResp,
    isLoading: quotaLoading,
    isError: quotaError,
    refetch: refetchQuota,
  } = useQuery({
    queryKey: ['cc-usage-quota'],
    queryFn: async () => {
      const response = await fetch('/api/cc-usage/quota');
      if (!response.ok) {
        throw new Error(`quota request failed: ${response.status}`);
      }
      return (await response.json()) as { success: boolean; data: QuotaSnapshot | null };
    },
    refetchInterval: 60000,
  });

  const {
    data: timelineResp,
    isLoading: timelineLoading,
    refetch: refetchTimeline,
  } = useQuery({
    queryKey: ['cc-usage-timeline', range],
    queryFn: async () => {
      const response = await fetch(`/api/cc-usage/timeline?range=${encodeURIComponent(range)}`);
      if (!response.ok) {
        throw new Error(`timeline request failed: ${response.status}`);
      }
      return (await response.json()) as { success: boolean; data: TimelineResult };
    },
    refetchInterval: 60000,
  });

  const snapshot = quotaResp?.data ?? null;
  const points = timelineResp?.data?.points ?? [];
  const chartData = points
    .filter((p) => p.timestamp)
    .map((p) => ({
      timestamp: p.timestamp as string,
      label: formatTimestamp(p.timestamp as string),
      util5h: p.util5h === null ? null : Math.round(p.util5h * 1000) / 1000,
      util7d: p.util7d === null ? null : Math.round(p.util7d * 1000) / 1000,
    }));

  const refreshing = quotaLoading || timelineLoading;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Observability"
        title="CC 账号额度"
        icon={<Gauge className="h-5 w-5" />}
        description="Claude Code 订阅账号的 5 小时 / 周窗口额度。数据是 Anthropic 在每次订阅请求响应头里回的真实额度，截至最后一次 LLM 调用。"
        actions={(
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchQuota();
              refetchTimeline();
            }}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        )}
      />

      {snapshot?.capturedAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>
            额度采集于 {formatTimestamp(snapshot.capturedAt)}（{relativeFromNow(snapshot.capturedAt)}）
            {snapshot.modelName ? ` · ${snapshot.modelName}` : ''}
            {snapshot.organizationId ? ` · org ${snapshot.organizationId}` : ''}
          </span>
        </div>
      )}

      {quotaError ? (
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" />}
          title="额度加载失败"
          description="读取 CC 订阅额度快照时出错，稍后重试。"
        />
      ) : !snapshot ? (
        <EmptyState
          icon={<Gauge className="h-8 w-8" />}
          title="暂无额度数据"
          description="还没有捕获到带 unified ratelimit 头的订阅请求。等小腻主 loop 走一次订阅端点后即可显示。"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <QuotaWindowCard label="5 小时窗口" win={snapshot.windows?.fiveHour} />
          <QuotaWindowCard label="周窗口（7d）" win={snapshot.windows?.weekly} />
        </div>
      )}

      <SectionPanel
        title="额度随时间"
        description="utilization 0–100%，看什么时候逼近上限"
        icon={<Gauge className="h-4 w-4" />}
        action={(
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">近 24h</SelectItem>
              <SelectItem value="7d">近 7 天</SelectItem>
              <SelectItem value="30d">近 30 天</SelectItem>
            </SelectContent>
          </Select>
        )}
      >
        {chartData.length === 0 ? (
          <EmptyState
            icon={<Gauge className="h-8 w-8" />}
            title="该区间暂无数据"
            description="换个时间范围，或等订阅请求积累后再看。"
          />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={32} />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                  tick={{ fontSize: 11 }}
                  width={44}
                />
                <Tooltip
                  formatter={(value, name) => [
                    formatPercent(typeof value === 'number' ? value : null),
                    String(name),
                  ]}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend />
                <Line type="monotone" dataKey="util5h" name="5h" stroke="#0284c7" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="util7d" name="7d" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionPanel>
    </PageShell>
  );
}

export default CcAccountUsagePage;
