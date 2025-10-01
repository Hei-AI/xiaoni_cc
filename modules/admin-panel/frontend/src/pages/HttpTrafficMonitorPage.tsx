import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Checkbox } from '../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Activity,
  Search,
  RefreshCw,
  Download,
  Filter,
  Eye,
  Clock,
  Globe,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Zap,
  Play,
  PlayCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { BatchReplayDialog } from '../components/BatchReplayDialog';
import type { BatchReplayResult } from '../types/traffic-replay';

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
    end_time: ''
  });
  const [timeRange, setTimeRange] = useState('24h');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBatchReplayDialog, setShowBatchReplayDialog] = useState(false);

  // 获取流量记录
  const { data: trafficData, isLoading: trafficLoading, refetch: refetchTraffic } = useQuery({
    queryKey: ['traffic-logs', page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
        ...Object.fromEntries(
          Object.entries(filters).filter(([_, value]) => value !== '' && value !== 'all')
        )
      });

      const response = await fetch(`/api/traffic/logs?${params}`);
      if (!response.ok) throw new Error('Failed to fetch traffic logs');
      return response.json();
    },
    refetchInterval: 30000, // 30秒自动刷新
  });

  // 获取统计数据
  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['traffic-stats', timeRange],
    queryFn: async () => {
      const response = await fetch(`/api/traffic/stats?range=${timeRange}`);
      if (!response.ok) throw new Error('Failed to fetch traffic stats');
      return response.json();
    },
    refetchInterval: 60000, // 60秒自动刷新
  });

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1); // 重置到第一页
  };

  const handleRefresh = () => {
    refetchTraffic();
    refetchStats();
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const params = new URLSearchParams({
        format,
        range: timeRange,
        include_body: 'false'
      });

      const response = await fetch(`/api/traffic/export?${params}`);
      if (!response.ok) throw new Error('Failed to export data');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `http_traffic_${timeRange}_${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const getStatusBadge = (status?: number) => {
    if (!status) return null;

    if (status >= 200 && status < 300) {
      return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />{status}</Badge>;
    } else if (status >= 300 && status < 400) {
      return <Badge variant="secondary">{status}</Badge>;
    } else if (status >= 400 && status < 500) {
      return <Badge variant="destructive" className="bg-orange-100 text-orange-800"><AlertTriangle className="w-3 h-3 mr-1" />{status}</Badge>;
    } else if (status >= 500) {
      return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />{status}</Badge>;
    }
    return <Badge variant="outline">{status}</Badge>;
  };

  const getMethodColor = (method: string) => {
    const colors = {
      GET: 'bg-blue-100 text-blue-800',
      POST: 'bg-green-100 text-green-800',
      PUT: 'bg-yellow-100 text-yellow-800',
      DELETE: 'bg-red-100 text-red-800',
      PATCH: 'bg-purple-100 text-purple-800'
    };
    return colors[method as keyof typeof colors] || 'bg-gray-100 text-gray-800';
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

  // 选择处理函数
  const handleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map(log => log.id)));
    }
  };

  const handleToggleSelect = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  // 快速重放单个请求
  const handleQuickReplay = async (logId: number) => {
    try {
      const response = await fetch(`/api/traffic/replay/${logId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifications: {} })
      });

      if (!response.ok) throw new Error('快速重放失败');

      // 可选：显示成功提示
      alert('重放成功！');
      refetchTraffic();
    } catch (error) {
      alert(error instanceof Error ? error.message : '重放失败');
    }
  };

  // 批量重放完成处理
  const handleBatchReplayComplete = (results: BatchReplayResult) => {
    setShowBatchReplayDialog(false);
    setSelectedIds(new Set());
    refetchTraffic();
    alert(`批量重放完成！成功: ${results.successful}, 失败: ${results.failed}`);
  };

  const selectedLogs = logs.filter(log => selectedIds.has(log.id));

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">HTTP流量监控</h1>
            <p className="text-muted-foreground">实时监控容器HTTP出站流量，分析API调用模式</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={trafficLoading || statsLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${(trafficLoading || statsLoading) ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-2" />
            筛选
          </Button>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">1小时</SelectItem>
              <SelectItem value="24h">24小时</SelectItem>
              <SelectItem value="7d">7天</SelectItem>
              <SelectItem value="30d">30天</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">总请求数</p>
                  <p className="text-2xl font-bold">{stats.overview.total_requests?.toLocaleString() || 0}</p>
                </div>
                <Globe className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">AI请求数</p>
                  <p className="text-2xl font-bold text-purple-600">{stats.overview.ai_requests?.toLocaleString() || 0}</p>
                </div>
                <Zap className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">平均响应时间</p>
                  <p className="text-2xl font-bold">{formatDuration(stats.overview.avg_response_time)}</p>
                </div>
                <Clock className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">错误率</p>
                  <p className="text-2xl font-bold text-red-600">
                    {stats.overview.total_requests > 0
                      ? `${((stats.overview.failed_requests / stats.overview.total_requests) * 100).toFixed(1)}%`
                      : '0%'
                    }
                  </p>
                </div>
                <AlertTriangle className="h-8 w-8 text-red-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* API类型统计 */}
      {stats?.api_types && stats.api_types.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              AI API类型分布
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {stats.api_types.map((api) => (
                <div key={api.api_type} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="secondary" className="capitalize">{api.api_type}</Badge>
                    <span className="text-sm text-muted-foreground">{api.request_count}次</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    平均 {formatDuration(api.avg_duration)} • {api.error_count} 错误
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 筛选器 */}
      {showFilters && (
        <Card>
          <CardHeader>
            <CardTitle>筛选条件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">HTTP方法</label>
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
                <label className="text-sm font-medium mb-1 block">状态码</label>
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
                <label className="text-sm font-medium mb-1 block">AI请求</label>
                <Select value={filters.is_ai_request} onValueChange={(value) => handleFilterChange('is_ai_request', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="true">仅AI请求</SelectItem>
                    <SelectItem value="false">非AI请求</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">容器名称</label>
                <Input
                  placeholder="输入容器名称..."
                  value={filters.container_name}
                  onChange={(e) => handleFilterChange('container_name', e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">搜索</label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="搜索URL或内容..."
                    value={filters.search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 流量记录表格 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              HTTP流量记录
              {selectedIds.size > 0 && (
                <Badge variant="secondary">
                  已选择 {selectedIds.size} 条
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setShowBatchReplayDialog(true)}
                  >
                    <PlayCircle className="h-4 w-4 mr-2" />
                    批量重放
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    取消选择
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => handleExport('csv')}>
                <Download className="h-4 w-4 mr-2" />
                导出CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExport('json')}>
                <Download className="h-4 w-4 mr-2" />
                导出JSON
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {trafficLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" />
              <span>加载中...</span>
            </div>
          ) : logs.length === 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                暂无流量记录。请检查HTTP流量监控模块是否正确配置并有流量产生。
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedIds.size > 0 && selectedIds.size === logs.length}
                        onCheckedChange={handleSelectAll}
                      />
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
                        <Checkbox
                          checked={selectedIds.has(log.id)}
                          onCheckedChange={() => handleToggleSelect(log.id)}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString('zh-CN')}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-xs">
                          {log.container_name || 'qqbot-core'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getMethodColor(log.method)}>{log.method}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="flex items-center gap-2">
                          {Boolean(log.is_ai_request) && <Zap className="h-3 w-3 text-purple-500" />}
                          <span className="truncate" title={log.url}>{log.url}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(log.response_status)}</TableCell>
                      <TableCell className="text-xs">
                        {formatDuration(log.duration_ms)}
                      </TableCell>
                      <TableCell>
                        {log.api_type ? (
                          <Badge variant="secondary" className="capitalize">{log.api_type}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>
                          <div>↑ {formatBytes(log.request_size)}</div>
                          <div>↓ {formatBytes(log.response_size)}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleQuickReplay(log.id)}
                            title="快速重放"
                          >
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

              {/* 分页 */}
              {pagination && pagination.pages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    显示 {((page - 1) * 50) + 1} 到 {Math.min(page * 50, pagination.total)} 条，共 {pagination.total} 条记录
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page - 1)}
                      disabled={page <= 1}
                    >
                      上一页
                    </Button>
                    <span className="text-sm">
                      {page} / {pagination.pages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page + 1)}
                      disabled={page >= pagination.pages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 批量重放对话框 */}
      <BatchReplayDialog
        selectedLogs={selectedLogs}
        open={showBatchReplayDialog}
        onClose={() => setShowBatchReplayDialog(false)}
        onComplete={handleBatchReplayComplete}
      />
    </div>
  );
}