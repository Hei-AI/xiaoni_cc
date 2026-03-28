import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Calendar,
  Clock,
  Download,
  Eye,
  Globe,
  Play,
  PlayCircle,
  RefreshCw,
  Search,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BatchReplayDialog } from '@/components/BatchReplayDialog';
import type { BatchReplayResult } from '@/types/traffic-replay';
import { formatReturnedValue } from '@/lib/contract-display';
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
  llm_call_id?: string;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const llmCallIdParam = searchParams.get('llm_call_id') || '';
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    method: 'all',
    host: '',
    status: 'all',
    is_ai_request: 'true',
    api_type: '',
    container_name: '',
    search: '',
    start_time: '',
    end_time: '',
    llm_call_id: llmCallIdParam,
  });
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBatchReplayDialog, setShowBatchReplayDialog] = useState(false);

  useEffect(() => {
    const nextLlmCallId = searchParams.get('llm_call_id') || '';
    setFilters((prev) => {
      if (prev.llm_call_id === nextLlmCallId) {
        return prev;
      }
      return { ...prev, llm_call_id: nextLlmCallId };
    });
    setPage(1);
  }, [searchParams]);

  const {
    data: trafficData,
    error: trafficError,
    isError: isTrafficError,
    isLoading: trafficLoading,
    refetch: refetchTraffic,
  } = useQuery({
    queryKey: ['traffic-logs', page, filters, timeRange],
    queryFn: async () => {
      const normalizedFilters = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== '' && value !== 'all'),
      );
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
        range: timeRange,
        ...normalizedFilters,
      });

      const response = await fetch(`/api/traffic/logs?${params}`);
      if (!response.ok) {
        let message = 'Failed to fetch traffic logs';
        try {
          const payload = await response.json();
          if (typeof payload?.message === 'string' && payload.message.trim()) {
            message = payload.message;
          } else if (typeof payload?.error === 'string' && payload.error.trim()) {
            message = payload.error;
          }
        } catch {
          // Keep the fallback message when the response body is not JSON.
        }
        throw new Error(message);
      }
      return response.json();
    },
    refetchInterval: 30000,
  });

  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['traffic-stats', timeRange, filters.start_time, filters.end_time],
    queryFn: async () => {
      const params = new URLSearchParams({ range: timeRange });
      if (timeRange === 'custom') {
        if (filters.start_time) {
          params.set('start_time', new Date(filters.start_time).toISOString());
        }
        if (filters.end_time) {
          params.set('end_time', new Date(filters.end_time).toISOString());
        }
      }
      const response = await fetch(`/api/traffic/stats?${params}`);
      if (!response.ok) throw new Error('Failed to fetch traffic stats');
      return response.json();
    },
    refetchInterval: 60000,
  });

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);

    if (key === 'llm_call_id') {
      const nextParams = new URLSearchParams(searchParams);
      if (value.trim()) {
        nextParams.set('llm_call_id', value.trim());
      } else {
        nextParams.delete('llm_call_id');
      }
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleTimeRangeChange = (value: string) => {
    setTimeRange(value);
    setPage(1);
    if (value !== 'custom') {
      setFilters((prev) => ({ ...prev, start_time: '', end_time: '' }));
    }
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
    if (timeRange === 'custom') {
      if (filters.start_time) {
        params.set('start_time', new Date(filters.start_time).toISOString());
      }
      if (filters.end_time) {
        params.set('end_time', new Date(filters.end_time).toISOString());
      }
    }

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
  const trafficErrorMessage = trafficError instanceof Error ? trafficError.message : '流量记录加载失败，请稍后重试。';

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

  return (
    <PageShell>
      <PageHeader
        eyebrow="Traffic Mirror"
        title="HTTP 流量监控"
        description="实时观察容器出站请求和重放链路。视觉上采用交易终端的监控视图，移动端切为请求卡片流。"
        icon={<Activity className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={trafficLoading || statsLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${(trafficLoading || statsLoading) ? 'animate-spin' : ''}`} />
              刷新
            </Button>
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

      <FilterBar>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-7">
          <div>
            <label className="mb-2 block text-sm font-medium">时间范围</label>
            <Select value={timeRange} onValueChange={handleTimeRangeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">1小时</SelectItem>
                <SelectItem value="24h">24小时</SelectItem>
                <SelectItem value="7d">7天</SelectItem>
                <SelectItem value="30d">30天</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
                <SelectItem value="true">仅 AI 请求</SelectItem>
                <SelectItem value="all">全部</SelectItem>
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

          <div>
            <label className="mb-2 block text-sm font-medium">llm_call_id</label>
            <Input
              placeholder="精确筛选 llm_call_id..."
              value={filters.llm_call_id}
              onChange={(e) => handleFilterChange('llm_call_id', e.target.value)}
            />
          </div>
        </div>

        {timeRange === 'custom' && (
          <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="datetime-local"
                  step="1"
                  value={filters.start_time}
                  onChange={(e) => handleFilterChange('start_time', e.target.value)}
                  className="w-full xl:w-56"
                />
              </div>
              <span className="text-sm text-muted-foreground">至</span>
              <Input
                type="datetime-local"
                step="1"
                value={filters.end_time}
                onChange={(e) => handleFilterChange('end_time', e.target.value)}
                className="w-full xl:w-56"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTimeRange('24h');
                setFilters({
                  method: 'all',
                  host: '',
                  status: 'all',
                  is_ai_request: 'true',
                  api_type: '',
                  container_name: '',
                  search: '',
                  start_time: '',
                  end_time: '',
                  llm_call_id: '',
                });
                setSearchParams(new URLSearchParams(), { replace: true });
                setPage(1);
              }}
            >
              清除筛选
            </Button>
          </div>
        )}

        {timeRange !== 'custom' ? (
          <div className="mt-4 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilters({
                  method: 'all',
                  host: '',
                  status: 'all',
                  is_ai_request: 'true',
                  api_type: '',
                  container_name: '',
                  search: '',
                  start_time: '',
                  end_time: '',
                  llm_call_id: '',
                });
                setSearchParams(new URLSearchParams(), { replace: true });
                setPage(1);
              }}
            >
              清除筛选
            </Button>
          </div>
        ) : null}
      </FilterBar>

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
        ) : isTrafficError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{trafficErrorMessage}</AlertDescription>
          </Alert>
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
                      <span>{formatReturnedValue(log.container_name)}</span>
                      <span>{formatDuration(log.duration_ms)}</span>
                      <span>↑ {formatBytes(log.request_size)} / ↓ {formatBytes(log.response_size)}</span>
                    </>
                  }
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {Boolean(log.is_ai_request) && <Zap className="h-3 w-3 text-primary" />}
                    <span>{log.is_ai_request ? formatReturnedValue(log.api_type) : '非 AI 请求'}</span>
                  </div>
                  <div className={`grid gap-2 ${log.is_ai_request ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <Button variant="outline" size="sm" onClick={() => handleQuickReplay(log.id)}>
                      <Play className="mr-2 h-4 w-4" />
                      快速重放
                    </Button>
                    {log.is_ai_request ? (
                      <Link to={`/playground?trafficId=${log.id}`}>
                        <Button variant="outline" size="sm" className="w-full">
                          <Zap className="mr-2 h-4 w-4" />
                          Playground
                        </Button>
                      </Link>
                    ) : null}
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
                        <Badge variant="outline">{formatReturnedValue(log.container_name)}</Badge>
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
                          {log.is_ai_request ? (
                            <Link to={`/playground?trafficId=${log.id}`}>
                              <Button variant="ghost" size="sm" title="在 Playground 中打开">
                                <Zap className="h-4 w-4" />
                              </Button>
                            </Link>
                          ) : null}
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
