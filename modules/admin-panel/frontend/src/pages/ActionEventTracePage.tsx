import React from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pause, Play, RefreshCw, Waypoints } from 'lucide-react';
import { TraceInspectorPanel } from '@/components/trace-canvas/TraceInspector';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createCaseFromSpan, openBestPlaygroundCase } from '@/lib/playgroundApi';
import { buildTraceFlowViewModel } from '@/lib/trace-flow';
import { useXiaoniActionEventTrace } from '@/hooks/useXiaoniActionTrace';

export const ActionEventTracePage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(true);
  const [spanImportError, setSpanImportError] = React.useState<string | null>(null);
  const [importingSpanId, setImportingSpanId] = React.useState<string | null>(null);

  if (!eventId) {
    return <Navigate to="/xiaoni-action-stream" replace />;
  }

  const { data: trace, isLoading, error, refetch, isRefetching } = useXiaoniActionEventTrace(eventId, autoRefreshEnabled);
  const viewModel = React.useMemo(() => (trace ? buildTraceFlowViewModel(trace) : null), [trace]);
  const providerRows = React.useMemo(
    () => viewModel?.rows.filter((row) => row.semanticRole === 'provider_request') || [],
    [viewModel]
  );
  const [selectedSpanId, setSelectedSpanId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!viewModel) {
      return;
    }
    const requestedSpanId = searchParams.get('spanId');
    if (requestedSpanId && providerRows.some((row) => row.spanId === requestedSpanId)) {
      setSelectedSpanId(requestedSpanId);
      return;
    }
    if (trace?.action_event?.focus_span_id && providerRows.some((row) => row.spanId === trace.action_event?.focus_span_id)) {
      setSelectedSpanId(trace.action_event.focus_span_id);
      return;
    }
    setSelectedSpanId(providerRows[0]?.spanId || null);
  }, [providerRows, searchParams, trace, viewModel]);

  const selectedSpan = React.useMemo(
    () => providerRows.find((row) => row.spanId === selectedSpanId) || null,
    [providerRows, selectedSpanId]
  );

  const canImportSelectedSpan = Boolean(trace?.trace.trace_id && selectedSpan?.playgroundCapability === 'exact');

  const handleImportSpan = React.useCallback(async (spanId: string) => {
    if (!trace?.trace.trace_id) {
      return;
    }
    try {
      setImportingSpanId(spanId);
      setSpanImportError(null);
      const record = await createCaseFromSpan({ traceId: trace.trace.trace_id, spanId });
      navigate(`/playground?caseId=${record.id}`);
    } catch (fetchError) {
      if (trace.conversation_id) {
        try {
          const record = await openBestPlaygroundCase({
            conversationId: String(trace.conversation_id),
            traceId: trace.trace.trace_id,
          });
          navigate(`/playground?caseId=${record.id}`);
          return;
        } catch (fallbackError) {
          const primaryMessage = fetchError instanceof Error ? fetchError.message : '无法从当前 span 创建 Playground Case';
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : '会话级导入也失败了';
          setSpanImportError(`${primaryMessage}；已回退到会话级导入，但仍失败：${fallbackMessage}`);
          return;
        }
      }
      setSpanImportError(fetchError instanceof Error ? fetchError.message : '无法从当前 span 创建 Playground Case');
    } finally {
      setImportingSpanId(null);
    }
  }, [navigate, trace]);

  const handleImportSelectedSpan = React.useCallback(async () => {
    if (!selectedSpan) {
      return;
    }
    await handleImportSpan(selectedSpan.spanId);
  }, [handleImportSpan, selectedSpan]);

  const handleFocusProviderRequest = React.useCallback((spanId: string) => {
    setSelectedSpanId(spanId);
    setSpanImportError(null);
  }, []);

  const handleOpenTrafficDetail = React.useCallback((trafficLogId: string | number) => {
    navigate(`/traffic/${trafficLogId}`);
  }, [navigate]);

  const handleOpenTrafficList = React.useCallback((llmCallId: string) => {
    navigate(`/traffic?llm_call_id=${encodeURIComponent(llmCallId)}`);
  }, [navigate]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="LLM Request Debug"
        title={selectedSpan?.title || '实际 LLM 请求'}
        description="只展示 provider 侧真实 POST 请求、响应头、响应体和原始响应，用于排查模型请求内容。"
        icon={<Waypoints className="h-5 w-5" />}
        badge={selectedSpan ? <PageHeaderBadge>{selectedSpan.status}</PageHeaderBadge> : trace ? <PageHeaderBadge>{trace.trace.status}</PageHeaderBadge> : null}
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/xiaoni-action-stream')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回行动流
            </Button>
            <Button variant={autoRefreshEnabled ? 'default' : 'outline'} size="sm" onClick={() => setAutoRefreshEnabled((value) => !value)}>
              {autoRefreshEnabled ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              {autoRefreshEnabled ? '停止自动刷新' : '开启自动刷新'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportSelectedSpan}
              disabled={!canImportSelectedSpan || Boolean(importingSpanId)}
            >
              <Waypoints className="mr-2 h-4 w-4" />
              {importingSpanId ? '导入请求中...' : '当前请求到 Playground'}
            </Button>
          </>
        )}
      />

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader><CardTitle className="text-destructive">加载失败</CardTitle></CardHeader>
          <CardContent className="text-sm text-destructive">{error instanceof Error ? error.message : '获取 trace 失败'}</CardContent>
        </Card>
      ) : null}

      {spanImportError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader><CardTitle className="text-destructive">Span 导入失败</CardTitle></CardHeader>
          <CardContent className="text-sm text-destructive">{spanImportError}</CardContent>
        </Card>
      ) : null}

      {isLoading && !trace ? (
        <Card className="rounded-[22px]">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="mr-3 h-8 w-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">正在加载 raw trace...</span>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && !error && !trace ? (
        <Card className="rounded-[22px] border-dashed">
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            当前内部片段还没有可展示的 trace 数据。
          </CardContent>
        </Card>
      ) : null}

      {trace && viewModel ? (
        selectedSpan ? (
          <TraceInspectorPanel
            eventId={eventId}
            node={selectedSpan}
            metadataBadges={viewModel.metadataBadges}
            allowFloating={false}
            surfaceLabel="Actual Provider Request"
            onImportToPlayground={canImportSelectedSpan ? handleImportSelectedSpan : undefined}
            isImportingToPlayground={Boolean(importingSpanId)}
            onFocusProviderRequest={handleFocusProviderRequest}
            onOpenTrafficDetail={handleOpenTrafficDetail}
            onOpenTrafficList={handleOpenTrafficList}
            className="min-h-[calc(100vh-13rem)]"
          />
        ) : (
          <Card className="rounded-[22px] border-dashed">
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              当前事件没有可展示的实际 LLM provider request。
            </CardContent>
          </Card>
        )
      ) : null}
    </PageShell>
  );
};
