import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Alert, AlertDescription } from '../components/ui/alert';
import { StructuredDataViewer } from '../components/StructuredDataViewer';
import {
  ArrowLeft,
  Copy,
  Download,
  Clock,
  Globe,
  Server,
  MessageSquare,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Zap,
  RefreshCw,
  Play
} from 'lucide-react';
import { TrafficReplayEditor } from '../components/TrafficReplayEditor';
import { ReplayResultComparison } from '../components/ReplayResultComparison';
import { ReplayHistoryList } from '../components/ReplayHistoryList';
import type { ReplayModifications, ReplayResult, ReplayHistory } from '../types/traffic-replay';
import { formatReturnedValue } from '@/lib/contract-display';
import { formatDateOnly, formatTimestamp } from '../lib/utils';

interface TrafficLogDetail {
  id: number;
  request_id?: string;
  trace_id?: string;
  container_name?: string;
  service_name?: string;
  method: string;
  url: string;
  host: string;
  path?: string;
  query_params?: Record<string, any>;
  request_headers?: Record<string, string>;
  request_body?: string;
  request_content_type?: string;
  request_size?: number;
  response_status?: number;
  response_headers?: Record<string, string>;
  response_body?: string;
  response_content_type?: string;
  response_size?: number;
  duration_ms?: number;
  dns_lookup_ms?: number;
  tcp_connect_ms?: number;
  tls_handshake_ms?: number;
  server_processing_ms?: number;
  request_timestamp?: string;
  response_timestamp?: string;
  timestamp: string;
  is_ai_request: boolean;
  api_type?: string;
  api_version?: string;
  client_ip?: string;
  user_agent?: string;
  referer?: string;
  error_message?: string;
  error_code?: string;
  retry_count?: number;
  is_cached_response?: boolean;
  is_truncated?: boolean;
  is_binary_data?: boolean;
  original_encoding?: string;
  conversation_id?: string;
  user_id?: string;
  session_id?: string;
}

export function HttpTrafficDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showReplayEditor, setShowReplayEditor] = useState(false);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string>('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['traffic-detail', id],
    queryFn: async () => {
      if (!id) throw new Error('Missing traffic log ID');

      const response = await fetch(`/api/traffic/logs/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Traffic log not found');
        }
        throw new Error('Failed to fetch traffic log details');
      }
      return response.json();
    },
    enabled: !!id,
  });

  // 获取重放历史
  const { data: replayHistoryData, refetch: refetchHistory } = useQuery({
    queryKey: ['replay-history', id],
    queryFn: async () => {
      if (!id) return { data: [] };

      const response = await fetch(`/api/traffic/replay/history/${id}`);
      if (!response.ok) return { data: [] };

      return response.json();
    },
    enabled: !!id,
  });

  const replayHistory: ReplayHistory[] = replayHistoryData?.data || [];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // 执行重放
  const handleReplay = async (modifications: ReplayModifications) => {
    if (!id) return;

    setIsReplaying(true);
    setReplayError('');

    try {
      const response = await fetch(`/api/traffic/replay/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ modifications }),
      });

      if (!response.ok) {
        throw new Error('重放请求失败');
      }

      const result = await response.json();

      if (result.success) {
        setReplayResult(result.data);
        // 刷新重放历史
        refetchHistory();
      } else {
        throw new Error(result.error || '重放失败');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '重放失败';
      setReplayError(errorMsg);
      throw err;
    } finally {
      setIsReplaying(false);
    }
  };

  const handleDownloadRaw = () => {
    if (!log) return;

    const content = {
      id: log.id,
      timestamp: log.timestamp,
      request: {
        method: log.method,
        url: log.url,
        headers: log.request_headers,
        body: log.request_body
      },
      response: {
        status: log.response_status,
        headers: log.response_headers,
        body: log.response_body
      },
      metadata: {
        duration_ms: log.duration_ms,
        is_ai_request: log.is_ai_request,
        api_type: log.api_type,
        trace_id: log.trace_id
      }
    };

    const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `traffic_log_${log.id}_${formatDateOnly(new Date(), { fallback: 'export' })}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const getStatusBadge = (status?: number) => {
    if (!status) return null;

    if (status >= 200 && status < 300) {
      return <Badge variant="default"><CheckCircle className="w-3 h-3 mr-1" />{status}</Badge>;
    } else if (status >= 300 && status < 400) {
      return <Badge variant="secondary">{status}</Badge>;
    } else if (status >= 400 && status < 500) {
      return <Badge variant="destructive" className="bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]"><AlertTriangle className="w-3 h-3 mr-1" />{status}</Badge>;
    } else if (status >= 500) {
      return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />{status}</Badge>;
    }
    return <Badge variant="outline">{status}</Badge>;
  };

  const getMethodColor = (method: string) => {
    const colors = {
      GET: 'border border-sky-500/20 bg-sky-500/10 text-sky-700',
      POST: 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
      PUT: 'border border-amber-500/20 bg-amber-500/10 text-amber-700',
      DELETE: 'border border-rose-500/20 bg-rose-500/10 text-rose-700',
      PATCH: 'border border-violet-500/20 bg-violet-500/10 text-violet-700'
    };
    return colors[method as keyof typeof colors] || 'border border-border bg-muted/60 text-foreground';
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <RefreshCw className="h-6 w-6 animate-spin mr-2" />
        <span>加载流量记录详情...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {error instanceof Error ? error.message : '加载失败'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const log: TrafficLogDetail = data?.data;

  if (!log) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            流量记录不存在
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const metadataSnapshot = {
    request: {
      request_id: log.request_id || null,
      trace_id: log.trace_id || null,
      method: log.method,
      url: log.url,
      host: log.host,
      path: log.path || null,
      query_params: log.query_params || {},
      content_type: log.request_content_type || null,
      size: log.request_size || null,
      timestamp: log.request_timestamp || log.timestamp,
    },
    response: {
      status: log.response_status || null,
      content_type: log.response_content_type || null,
      size: log.response_size || null,
      timestamp: log.response_timestamp || null,
      is_truncated: Boolean(log.is_truncated),
      is_binary_data: Boolean(log.is_binary_data),
      error_message: log.error_message || null,
      error_code: log.error_code || null,
    },
    runtime: {
      container_name: log.container_name || null,
      service_name: log.service_name || null,
      api_type: log.api_type || null,
      api_version: log.api_version || null,
      retry_count: log.retry_count || 0,
      is_cached_response: Boolean(log.is_cached_response),
      original_encoding: log.original_encoding || null,
      client_ip: log.client_ip || null,
      user_agent: log.user_agent || null,
      referer: log.referer || null,
      conversation_id: log.conversation_id || null,
      user_id: log.user_id || null,
      session_id: log.session_id || null,
    },
    timing: {
      duration_ms: log.duration_ms || null,
      dns_lookup_ms: log.dns_lookup_ms || null,
      tcp_connect_ms: log.tcp_connect_ms || null,
      tls_handshake_ms: log.tls_handshake_ms || null,
      server_processing_ms: log.server_processing_ms || null,
    },
  };

  return (
    <div className="space-y-6">
      {/* 页面标题和操作 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回
          </Button>
          <div>
            <h1 className="text-2xl font-bold">HTTP流量详情</h1>
            <p className="text-muted-foreground">记录ID: {log.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {log.is_ai_request ? (
            <Button variant="outline" size="sm" onClick={() => navigate(`/playground?trafficId=${log.id}`)}>
              <Zap className="h-4 w-4 mr-2" />
              在 Playground 中打开
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadRaw}>
            <Download className="h-4 w-4 mr-2" />
            下载原始数据
          </Button>
        </div>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">请求方法</p>
                <Badge className={getMethodColor(log.method)}>{log.method}</Badge>
              </div>
              <Globe className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">响应状态</p>
                <div className="mt-1">{getStatusBadge(log.response_status)}</div>
              </div>
              <Server className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">响应时间</p>
                <p className="text-2xl font-bold">{formatDuration(log.duration_ms)}</p>
              </div>
              <Clock className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">API类型</p>
                <div className="mt-1">
                  {log.is_ai_request ? (
                    <div className="flex items-center gap-1">
                      <Zap className="h-4 w-4 text-purple-500" />
                      <Badge variant="secondary" className="capitalize">
                        {formatReturnedValue(log.api_type)}
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">非 AI 请求</span>
                  )}
                </div>
              </div>
              <MessageSquare className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 详细信息标签页 */}
      <Card>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <CardHeader>
            <div className="overflow-x-auto">
              <TabsList className="grid w-full min-w-[760px] grid-cols-7">
                <TabsTrigger value="overview">概览</TabsTrigger>
                <TabsTrigger value="request">请求</TabsTrigger>
                <TabsTrigger value="response">响应</TabsTrigger>
                <TabsTrigger value="headers">请求头</TabsTrigger>
                <TabsTrigger value="response-headers">响应头</TabsTrigger>
                <TabsTrigger value="metadata">元数据</TabsTrigger>
                <TabsTrigger value="replay">
                  重放 {replayHistory.length > 0 && `(${replayHistory.length})`}
                </TabsTrigger>
              </TabsList>
            </div>
          </CardHeader>

          <CardContent>
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3">基本信息</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">请求时间:</span>
                      <span>{formatTimestamp(log.timestamp)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">目标主机:</span>
                      <span className="font-mono">{log.host}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">请求路径:</span>
                      <span className="font-mono truncate max-w-48" title={log.path}>{log.path}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">容器名称:</span>
                      <span>{formatReturnedValue(log.container_name)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">服务名称:</span>
                      <span>{formatReturnedValue(log.service_name)}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">性能指标</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">总耗时:</span>
                      <span>{formatDuration(log.duration_ms)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">DNS查询:</span>
                      <span>{formatDuration(log.dns_lookup_ms)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">TCP连接:</span>
                      <span>{formatDuration(log.tcp_connect_ms)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">TLS握手:</span>
                      <span>{formatDuration(log.tls_handshake_ms)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">服务器处理:</span>
                      <span>{formatDuration(log.server_processing_ms)}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">数据大小</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">请求大小:</span>
                      <span>{formatBytes(log.request_size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">响应大小:</span>
                      <span>{formatBytes(log.response_size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">是否缓存:</span>
                      <span>{log.is_cached_response ? '是' : '否'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">重试次数:</span>
                      <span>{log.retry_count || 0}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">追踪信息</h3>
                  <div className="space-y-2 text-sm">
                    {log.trace_id && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Trace ID:</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{log.trace_id.slice(0, 16)}...</span>
                          <Button variant="ghost" size="sm" onClick={() => handleCopy(log.trace_id!)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {log.request_id && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Request ID:</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{log.request_id.slice(0, 16)}...</span>
                          <Button variant="ghost" size="sm" onClick={() => handleCopy(log.request_id!)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {log.conversation_id && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">对话ID:</span>
                        <span className="font-mono">{log.conversation_id}</span>
                      </div>
                    )}
                    {log.user_id && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">用户ID:</span>
                        <span>{log.user_id}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="request" className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">请求详情</h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Content-Type: {formatReturnedValue(log.request_content_type)}</span>
                  <span>|</span>
                  <span>大小: {formatBytes(log.request_size)}</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">请求URL</label>
                  <Button variant="ghost" size="sm" onClick={() => handleCopy(log.url)}>
                    <Copy className="h-3 w-3 mr-1" />
                    复制
                  </Button>
                </div>
                <div className="p-3 bg-muted rounded-md font-mono text-sm break-all">
                  {log.url}
                </div>
              </div>

              {log.query_params && Object.keys(log.query_params).length > 0 && (
                <StructuredDataViewer
                  title="Query Params"
                  value={log.query_params}
                  heightClassName="h-56"
                />
              )}

              {log.request_body && (
                <StructuredDataViewer
                  title="Request Body"
                  value={log.request_body}
                  emptyLabel="无请求体"
                  heightClassName="h-[26rem]"
                />
              )}
            </TabsContent>

            <TabsContent value="response" className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">响应详情</h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Content-Type: {formatReturnedValue(log.response_content_type)}</span>
                  <span>|</span>
                  <span>大小: {formatBytes(log.response_size)}</span>
                </div>
              </div>

              <div className="flex items-center gap-4 mb-4">
                <div>状态码: {getStatusBadge(log.response_status)}</div>
                <div className="text-sm text-muted-foreground">
                  响应时间: {formatTimestamp(log.response_timestamp || log.timestamp)}
                </div>
              </div>

              {log.error_message && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>错误信息:</strong> {log.error_message}
                    {log.error_code && <span className="ml-2">({log.error_code})</span>}
                  </AlertDescription>
                </Alert>
              )}

              {log.response_body && (
                <StructuredDataViewer
                  title="Response Body"
                  value={log.response_body}
                  emptyLabel="无响应体"
                  heightClassName="h-[26rem]"
                  notice={Boolean(log.is_truncated) ? '响应体过大，当前内容为截断后的展示结果。' : undefined}
                />
              )}
            </TabsContent>

            <TabsContent value="headers" className="space-y-4">
              <h3 className="font-semibold">请求头</h3>
              {log.request_headers && Object.keys(log.request_headers).length > 0 ? (
                <StructuredDataViewer
                  title="Request Headers"
                  value={log.request_headers}
                  heightClassName="h-[28rem]"
                />
              ) : (
                <p className="text-muted-foreground">无请求头信息</p>
              )}
            </TabsContent>

            <TabsContent value="response-headers" className="space-y-4">
              <h3 className="font-semibold">响应头</h3>
              {log.response_headers && Object.keys(log.response_headers).length > 0 ? (
                <StructuredDataViewer
                  title="Response Headers"
                  value={log.response_headers}
                  heightClassName="h-[28rem]"
                />
              ) : (
                <p className="text-muted-foreground">无响应头信息</p>
              )}
            </TabsContent>

            <TabsContent value="metadata" className="space-y-4">
              <h3 className="font-semibold">元数据信息</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-3">客户端信息</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">客户端IP:</span>
                      <span className="font-mono">{formatReturnedValue(log.client_ip)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">User-Agent:</span>
                      <span className="max-w-48 truncate" title={log.user_agent}>
                        {formatReturnedValue(log.user_agent)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Referer:</span>
                      <span className="max-w-48 truncate" title={log.referer}>
                        {formatReturnedValue(log.referer)}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-3">技术信息</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">是否二进制数据:</span>
                      <span>{log.is_binary_data ? '是' : '否'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">原始编码:</span>
                      <span>{formatReturnedValue(log.original_encoding)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">API版本:</span>
                      <span>{formatReturnedValue(log.api_version)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <StructuredDataViewer
                title="Metadata Snapshot"
                value={metadataSnapshot}
                heightClassName="h-[26rem]"
              />
            </TabsContent>

            {/* 重放 Tab */}
            <TabsContent value="replay" className="space-y-4">
              {!showReplayEditor ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">流量重放</h3>
                    <Button onClick={() => setShowReplayEditor(true)}>
                      <Play className="h-4 w-4 mr-2" />
                      开始重放
                    </Button>
                  </div>

                  {replayHistory.length > 0 ? (
                    <ReplayHistoryList history={replayHistory} />
                  ) : (
                    <Alert>
                      <AlertDescription>
                        暂无重放记录，点击"开始重放"按钮进行流量重放测试
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold">流量重放</h3>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowReplayEditor(false);
                        setReplayResult(null);
                        setReplayError('');
                      }}
                    >
                      返回历史
                    </Button>
                  </div>

                  <TrafficReplayEditor
                    originalLog={log}
                    onReplay={handleReplay}
                    isReplaying={isReplaying}
                    error={replayError}
                  />

                  {replayResult && (
                    <ReplayResultComparison
                      original={{
                        status: log.response_status || 0,
                        headers: log.response_headers || {},
                        body: log.response_body || '',
                        duration: log.duration_ms || 0,
                        size: log.response_size || 0,
                      }}
                      replayed={replayResult.replayResponse}
                      comparison={replayResult.comparison}
                    />
                  )}
                </div>
              )}
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );
}
