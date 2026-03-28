import React from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Pause, Play, RefreshCw, Waypoints } from 'lucide-react';
import { TraceWaterfall } from '@/components/trace-canvas/TraceWaterfall';
import { TraceInspectorPanel, TraceInspectorSheet } from '@/components/trace-canvas/TraceInspector';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResizableSplit } from '@/components/ui/resizable-split';
import { createCaseFromSpan, buildPlaygroundRecoveryUrl, openBestPlaygroundCase } from '@/lib/playgroundApi';
import { buildTraceFlowViewModel } from '@/lib/trace-flow';
import { useRunTrace } from '@/hooks/useAgentRuns';

export const RunTracePage: React.FC = () => {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(true);
  const [isMobileInspectorOpen, setIsMobileInspectorOpen] = React.useState(false);
  const [spanImportError, setSpanImportError] = React.useState<string | null>(null);
  const [importingSpanId, setImportingSpanId] = React.useState<string | null>(null);
  const [isDesktop, setIsDesktop] = React.useState<boolean>(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1280));

  if (!runId) {
    return <Navigate to="/conversations" replace />;
  }

  const { data: trace, isLoading, error, refetch, isRefetching } = useRunTrace(runId, autoRefreshEnabled);
  const viewModel = React.useMemo(() => (trace ? buildTraceFlowViewModel(trace) : null), [trace]);
  const [selectedSpanId, setSelectedSpanId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!viewModel) {
      return;
    }
    const requestedSpanId = searchParams.get('spanId');
    if (requestedSpanId && viewModel.rows.some((row) => row.spanId === requestedSpanId)) {
      setSelectedSpanId(requestedSpanId);
      return;
    }
    if (viewModel.selectedSpanId) {
      setSelectedSpanId(viewModel.selectedSpanId);
    }
  }, [searchParams, viewModel]);

  const selectedSpan = React.useMemo(
    () => viewModel?.rows.find((row) => row.spanId === selectedSpanId) || null,
    [selectedSpanId, viewModel]
  );
  const openConversationPlaygroundMutation = useMutation({
    mutationFn: async (payload: { conversationId: string; traceId?: string | null }) => openBestPlaygroundCase(payload),
    onSuccess: (record) => {
      navigate(`/playground?caseId=${record.id}`);
    },
    onError: (error, payload) => {
      const message = error instanceof Error
        ? error.message
        : `无法为会话 ${payload.conversationId} 打开 Playground`;
      navigate(buildPlaygroundRecoveryUrl(message));
    },
  });

  React.useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1280);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSelectSpan = React.useCallback((spanId: string) => {
    setSelectedSpanId(spanId);
    setSpanImportError(null);
    if (!isDesktop) {
      setIsMobileInspectorOpen(true);
    }
  }, [isDesktop]);

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
    handleSelectSpan(spanId);
  }, [handleSelectSpan]);

  const handleOpenTrafficDetail = React.useCallback((trafficLogId: string | number) => {
    navigate(`/traffic/${trafficLogId}`);
  }, [navigate]);

  const handleOpenTrafficList = React.useCallback((llmCallId: string) => {
    navigate(`/traffic?llm_call_id=${encodeURIComponent(llmCallId)}`);
  }, [navigate]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Trace Detail"
        title="Trace 详情"
        description="span tree 和共享时间轴在这里展开，作为 run 的真实执行证据。"
        icon={<Waypoints className="h-5 w-5" />}
        badge={trace ? <PageHeaderBadge>{trace.trace.status}</PageHeaderBadge> : null}
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/conversations')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回对话流
            </Button>
            <Button variant={autoRefreshEnabled ? 'default' : 'outline'} size="sm" onClick={() => setAutoRefreshEnabled((value) => !value)}>
              {autoRefreshEnabled ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              {autoRefreshEnabled ? '停止自动刷新' : '开启自动刷新'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            {trace?.conversation_id ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openConversationPlaygroundMutation.mutate({
                  conversationId: String(trace.conversation_id),
                  traceId: trace.trace.trace_id
                })}
                disabled={openConversationPlaygroundMutation.isPending}
              >
                <Waypoints className="mr-2 h-4 w-4" />
                {openConversationPlaygroundMutation.isPending ? '导入会话中...' : '打开可用 Playground 样本'}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportSelectedSpan}
              disabled={!canImportSelectedSpan || Boolean(importingSpanId)}
            >
              <Waypoints className="mr-2 h-4 w-4" />
              {importingSpanId ? '导入当前 Span...' : '当前 Span 到 Playground'}
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
            <span className="text-sm text-muted-foreground">正在加载 run trace...</span>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && !error && !trace ? (
        <Card className="rounded-[22px] border-dashed">
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            当前 run 还没有可展示的 trace 数据。
          </CardContent>
        </Card>
      ) : null}

      {trace && viewModel ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            {viewModel.metrics.map((metric) => (
              <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone} />
            ))}
          </div>

          {isDesktop ? (
            <ResizableSplit
              direction="horizontal"
              defaultSize={70}
              minFirstSize={640}
              minSecondSize={340}
              className="min-h-[calc(100vh-19rem)] gap-2"
              firstClassName="min-w-0"
              secondClassName="min-w-0"
              first={(
                <SectionPanel
                  title="Span Waterfall"
                  description="按 span 树、共享时间轴和路径层级阅读真实执行。"
                  className="flex h-full min-h-[calc(100vh-19rem)] flex-col"
                  contentClassName="flex min-h-0 flex-1 flex-col pt-3"
                >
                  <TraceWaterfall
                    viewModel={viewModel}
                    selectedSpanId={selectedSpanId}
                    onSelectSpan={handleSelectSpan}
                    onImportSpan={handleImportSpan}
                    importingSpanId={importingSpanId}
                  />
                </SectionPanel>
              )}
              second={(
                <SectionPanel
                  title="Inspector"
                  description="固定右侧详情区，不再漂浮遮挡主瀑布图。"
                  className="flex h-full min-h-[calc(100vh-19rem)] flex-col"
                  contentClassName="flex min-h-0 flex-1 flex-col pt-3"
                >
                  <TraceInspectorPanel
                    node={selectedSpan}
                    metadataBadges={viewModel.metadataBadges}
                    onImportToPlayground={canImportSelectedSpan ? handleImportSelectedSpan : undefined}
                    isImportingToPlayground={Boolean(importingSpanId)}
                    onFocusProviderRequest={handleFocusProviderRequest}
                    onOpenTrafficDetail={handleOpenTrafficDetail}
                    onOpenTrafficList={handleOpenTrafficList}
                    className="h-full min-h-0"
                  />
                </SectionPanel>
              )}
            />
          ) : (
            <SectionPanel title="Span Waterfall" description="按 span 树、共享时间轴和路径层级阅读真实执行。" contentClassName="pt-3">
              <TraceWaterfall
                viewModel={viewModel}
                selectedSpanId={selectedSpanId}
                onSelectSpan={handleSelectSpan}
                onImportSpan={handleImportSpan}
                importingSpanId={importingSpanId}
              />
            </SectionPanel>
          )}

          {!isDesktop ? (
            <TraceInspectorSheet
              open={isMobileInspectorOpen}
              onOpenChange={setIsMobileInspectorOpen}
              node={selectedSpan}
              metadataBadges={viewModel.metadataBadges}
              onImportToPlayground={canImportSelectedSpan ? handleImportSelectedSpan : undefined}
              isImportingToPlayground={Boolean(importingSpanId)}
              onFocusProviderRequest={handleFocusProviderRequest}
              onOpenTrafficDetail={handleOpenTrafficDetail}
              onOpenTrafficList={handleOpenTrafficList}
            />
          ) : null}
        </>
      ) : null}
    </PageShell>
  );
};
