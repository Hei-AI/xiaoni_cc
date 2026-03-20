import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Clock,
  Download,
  Eye,
  Filter,
  Globe,
  Play,
  PlayCircle,
  RefreshCw,
  Search,
  Zap,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BatchReplayDialog } from '@/components/BatchReplayDialog';
import type { BatchReplayResult } from '@/types/traffic-replay';
import { formatTimestamp } from '@/lib/utils';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { FilterBar } from '@/components/console/FilterBar';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { EntityCard } from '@/components/console/EntityCard';
import { SelectionBar } from '@/components/console/SelectionBar';
import { StatusPill } from '@/components/console/StatusPill';

interface TrafficLog {
  id: number;
  request_id?: string;
  trace_id?: string;
  container_name?: string;
  service_name?: string;
  method: string;
  url: string;
  host: string;
  path?: string;
  response_status?: number;
  duration_ms?: number;
  timestamp: string;
  is_ai_request: boolean;
  api_type?: string;
  api_version?: string;
  client_ip?: string;
  user_agent?: string;
  request_size?: number;
  response_size?: number;
  error_message?: string;
  retry_count?: number;
  is_cached_response?: boolean;
  conversation_id?: string;
  user_id?: string;
  session_id?: string;
}

interface TrafficStats {
  overview: {
    total_requests: number;
    ai_requests: number;
    successful_requests: number;
    failed_requests: number;
    avg_response_time: number;
    min_response_time: number;
    max_response_time: number;
    total_request_bytes: number;
    total_response_bytes: number;
  };
  api_types: Array<{
    api_type: string;
    request_count: number;
    avg_duration: number;
    error_count: number;
  }>;
  hosts: Array<{
    host: string;
    request_count: number;
    avg_duration: number;
    error_count: number;
  }>;
  status_codes: Array<{
    status_group: string;
    count: number;
  }>;
  time_range: string;
}

export function HttpTrafficMonitorPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    method: 'all',
    host: '',
    status: 'all',
    is_ai_request: 'all',
    api_type: '',
    container_name: '',
    search: '',
    start_time: '',
    end_time: '',
  });
  const [timeRange, setTimeRange] = useState('24h');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBatchReplayDialog, setShowBatchReplayDialog] = useState(false);

  const { data: trafficData, isLoading: trafficLoading, refetch: refetchTraffic } = useQuery({
    queryKey: ['traffic-logs', page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
        ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value !== 'all')),
      });

      const response = await fetch(`/api/traffic/logs?${params}`);
      if (!response.ok) throw new Error('Failed to fetch traffic logs');
      return response.json();
    },
    refetchInterval: 30000,
  });

  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['traffic-stats', timeRange],
    queryFn: async () => {
      const response = await fetch(`/api/traffic/stats?range=${timeRange}`);
      if (!response.ok) throw new Error('Failed to fetch traffic stats');
      return response.json();
    },
    refetchInterval: 60000,
  });

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleRefresh = () => {
    refetchTraffic();
    refetchStats();
  };

  const handleExport = async (format: 'csv' | 'json') => {
    const params = new URLSearchParams({
      format,
      range: timeRange,
      include_body: 'false',
    });

    const response = await fetch(`/api/traffic/export?${params}`);
    if (!response.ok) throw new Error('Failed to export data');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `http_traffic_${timeRange}_${new Date().toISOString().split('T')[0]}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(anchor);
  };

  const getStatusBadge = (status?: number) => {
    if (!status) return null;
    if (status >= 200 && status < 300) return <StatusPill tone="success">{status}</StatusPill>;
    if (status >= 400 && status < 500) return <StatusPill tone="warning">{status}</StatusPill>;
    if (status >= 500) return <StatusPill tone="danger">{status}</StatusPill>;
    return <StatusPill tone="neutral">{status}</StatusPill>;
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-sky-500/10 text-sky-700 border-sky-500/20',
      POST: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
      PUT: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
      DELETE: 'bg-rose-500/10 text-rose-700 border-rose-500/20',
      PATCH: 'bg-violet-500/10 text-violet-700 border-violet-500/20',
    };
    return colors[method] || 'bg-muted/60 text-foreground border-border';
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const stats: TrafficStats | undefined = statsData?.data;
  const logs: TrafficLog[] = trafficData?.data || [];
  const pagination = trafficData?.pagination;

  const handleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map((log) => log.id)));
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleQuickReplay = async (logId: number) => {
    const response = await fetch(`/api/traffic/replay/${logId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modifications: {} }),
    });

    if (!response.ok) throw new Error('快速重放失败');
    alert('重放成功！');
    refetchTraffic();
  };

  const handleBatchReplayComplete = (results: BatchReplayResult) => {
    setShowBatchReplayDialog(false);
    setSelectedIds(new Set());
    refetchTraffic();
    alert(`批量重放完成！成功: ${results.successful}, 失败: ${results.failed}`);
  };

  const selectedLogs = logs.filter((log) => selectedIds.has(log.id));
  const chartData = useMemo(() => (stats?.api_types || []).slice(0, 6).map((item) => ({ name: item.api_type || 'unknown', value: item.request_count })), [stats?.api_types]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Traffic Mirror"
        title="HTTP 流量监控"
        description="实时观察容器出站请求、AI API 分布和重放链路。视觉上采用交易终端的监控视图，移动端切为请求卡片流。"
        icon={<Activity className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={trafficLoading || statsLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${(trafficLoading || statsLoading) ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)}>
              <Filter className="mr-2 h-4 w-4" />
              筛选
            </Button>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[132px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">1小时</SelectItem>
                <SelectItem value="24h">24小时</SelectItem>
                <SelectItem value="7d">7天</SelectItem>
                <SelectItem value="30d">30天</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      {stats && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="总请求数" value={stats.overview.total_requests.toLocaleString()} icon={<Globe className="h-5 w-5" />} />
          <MetricCard label="AI 请求数" value={stats.overview.ai_requests.toLocaleString()} icon={<Zap className="h-5 w-5" />} tone="success" />
          <MetricCard label="平均响应时间" value={formatDuration(stats.overview.avg_response_time)} icon={<Clock className="h-5 w-5" />} tone="warning" />
          <MetricCard
            label="错误率"
            value={
              stats.overview.total_requests > 0
                ? `${((stats.overview.failed_requests / stats.overview.total_requests) * 100).toFixed(1)}%`
                : '0%'
            }
            icon={<AlertTriangle className="h-5 w-5" />}
            tone="danger"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <SectionPanel className="xl:col-span-7" title="API 分布" description="按 API 类型聚合当前时间窗的请求量。" icon={<Zap className="h-4 w-4 text-primary" />}>
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
                <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionPanel>

        <SectionPanel className="xl:col-span-5" title="AI API 类型分布" description="快速查看当前窗口里最主要的 AI 请求类型。" icon={<Globe className="h-4 w-4 text-primary" />}>
          <div className="space-y-3">
            {(stats?.api_types || []).slice(0, 6).map((api) => (
              <div key={api.api_type} className="flex items-center justify-between rounded-lg border border-border bg-muted/45 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{api.api_type}</div>
                  <div className="text-xs text-muted-foreground">
                    平均 {formatDuration(api.avg_duration)} · 错误 {api.error_count}
                  </div>
                </div>
                <Badge variant="outline">{api.request_count} 次</Badge>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>

      {showFilters && (
        <FilterBar>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-2 block text-sm font-medium">HTTP 方法</label>
              <Select value={filters.method} onValueChange={(value) => handleFilterChange('method', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择方法" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">状态码</label>
              <Select value={filters.status} onValueChange={(value) => handleFilterChange('status', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="200">200 成功</SelectItem>
                  <SelectItem value="400">400 请求错误</SelectItem>
                  <SelectItem value="401">401 未授权</SelectItem>
                  <SelectItem value="404">404 未找到</SelectItem>
                  <SelectItem value="500">500 服务器错误</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">AI 请求</label>
              <Select value={filters.is_ai_request} onValueChange={(value) => handleFilterChange('is_ai_request', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="true">仅 AI 请求</SelectItem>
                  <SelectItem value="false">非 AI 请求</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">容器名称</label>
              <Input placeholder="输入容器名称..." value={filters.container_name} onChange={(e) => handleFilterChange('container_name', e.target.value)} />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">搜索</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="搜索 URL 或内容..." value={filters.search} onChange={(e) => handleFilterChange('search', e.target.value)} className="pl-9" />
              </div>
            </div>
          </div>
        </FilterBar>
      )}

      {selectedIds.size > 0 && (
        <SelectionBar
          summary={<>已选择 {selectedIds.size} 条流量记录</>}
          actions={
            <>
              <Button size="sm" onClick={() => setShowBatchReplayDialog(true)}>
                <PlayCircle className="mr-2 h-4 w-4" />
                批量重放
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
                取消选择
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExport('csv')}>
                <Download className="mr-2 h-4 w-4" />
                导出 CSV
              </Button>
            </>
          }
        />
      )}

      <SectionPanel
        title="HTTP 流量记录"
        description="移动端展示为请求卡片，桌面端保留表格和批量勾选。"
        icon={<Activity className="h-4 w-4 text-primary" />}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport('csv')}>
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport('json')}>
              <Download className="mr-2 h-4 w-4" />
              JSON
            </Button>
          </div>
        }
      >
        {trafficLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="mr-2 h-6 w-6 animate-spin" />
            <span>加载中...</span>
          </div>
        ) : logs.length === 0 ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>暂无流量记录。请检查 HTTP 流量监控模块是否正确配置并有流量产生。</AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="space-y-4 md:hidden">
              {logs.map((log) => (
                <EntityCard
                  key={log.id}
                  title={log.url}
                  subtitle={formatTimestamp(log.timestamp)}
                  badges={
                    <>
                      <Checkbox checked={selectedIds.has(log.id)} onCheckedChange={() => handleToggleSelect(log.id)} />
                      <Badge className={`border ${getMethodColor(log.method)}`}>{log.method}</Badge>
                      {getStatusBadge(log.response_status)}
                    </>
                  }
                  meta={
                    <>
                      <span>{log.container_name || 'qqbot-core'}</span>
                      <span>{formatDuration(log.duration_ms)}</span>
                      <span>↑ {formatBytes(log.request_size)} / ↓ {formatBytes(log.response_size)}</span>
                    </>
                  }
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {Boolean(log.is_ai_request) && <Zap className="h-3 w-3 text-primary" />}
                    <span>{log.api_type || '普通请求'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleQuickReplay(log.id)}>
                      <Play className="mr-2 h-4 w-4" />
                      快速重放
                    </Button>
                    <Link to={`/traffic/${log.id}`}>
                      <Button variant="outline" size="sm" className="w-full">
                        <Eye className="mr-2 h-4 w-4" />
                        查看详情
                      </Button>
                    </Link>
                  </div>
                </EntityCard>
              ))}
            </div>

            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox checked={selectedIds.size > 0 && selectedIds.size === logs.length} onCheckedChange={handleSelectAll} />
                    </TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead>容器</TableHead>
                    <TableHead>方法</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>耗时</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>大小</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Checkbox checked={selectedIds.has(log.id)} onCheckedChange={() => handleToggleSelect(log.id)} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatTimestamp(log.timestamp)}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">{log.container_name || 'qqbot-core'}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`border ${getMethodColor(log.method)}`}>{log.method}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="flex items-center gap-2">
                          {Boolean(log.is_ai_request) && <Zap className="h-3 w-3 text-primary" />}
                          <span className="truncate" title={log.url}>
                            {log.url}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(log.response_status)}</TableCell>
                      <TableCell className="text-xs">{formatDuration(log.duration_ms)}</TableCell>
                      <TableCell>{log.api_type ? <Badge variant="outline">{log.api_type}</Badge> : <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-xs">
                        <div>
                          <div>↑ {formatBytes(log.request_size)}</div>
                          <div>↓ {formatBytes(log.response_size)}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => handleQuickReplay(log.id)} title="快速重放">
                            <Play className="h-4 w-4" />
                          </Button>
                          <Link to={`/traffic/${log.id}`}>
                            <Button variant="ghost" size="sm" title="查看详情">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {pagination && pagination.pages > 1 && (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  显示 {((page - 1) * 50) + 1} 到 {Math.min(page * 50, pagination.total)} 条，共 {pagination.total} 条记录
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                    上一页
                  </Button>
                  <StatusPill tone="info">
                    {page} / {pagination.pages}
                  </StatusPill>
                  <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= pagination.pages}>
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </SectionPanel>

      <BatchReplayDialog
        selectedLogs={selectedLogs}
        open={showBatchReplayDialog}
        onClose={() => setShowBatchReplayDialog(false)}
        onComplete={handleBatchReplayComplete}
      />
    </PageShell>
  );
}
