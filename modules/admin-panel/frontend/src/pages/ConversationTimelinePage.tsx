import React from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bug, Loader2, Pause, Play, RefreshCw, Waypoints } from 'lucide-react';
import { DebugPromptModal } from '@/components/DebugPromptModal';
import { TraceWaterfall } from '@/components/trace-canvas/TraceWaterfall';
import { TraceInspectorPanel, TraceInspectorSheet } from '@/components/trace-canvas/TraceInspector';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createCaseFromSpan } from '@/lib/playgroundApi';
import { buildTraceFlowViewModel } from '@/lib/trace-flow';
import { useConversationTrace } from '../hooks/useConversationTrace';

function useDesktopInspector() {
  const [isDesktop, setIsDesktop] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.matchMedia('(min-width: 1280px)').matches;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(min-width: 1280px)');
    const listener = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  return isDesktop;
}

export const ConversationTimelinePage: React.FC = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(true);
  const [isDebugModalOpen, setIsDebugModalOpen] = React.useState(false);
  const [isMobileInspectorOpen, setIsMobileInspectorOpen] = React.useState(false);
  const [spanImportError, setSpanImportError] = React.useState<string | null>(null);
  const [importingSpanId, setImportingSpanId] = React.useState<string | null>(null);
  const isDesktop = useDesktopInspector();

  if (!conversationId) {
    return <Navigate to="/dashboard" replace />;
  }

  const { data: trace, isLoading, error, refetch, isRefetching } = useConversationTrace(conversationId, autoRefreshEnabled);
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
      const record = await createCaseFromSpan({
        traceId: trace.trace.trace_id,
        spanId,
      });
      navigate(`/playground?caseId=${record.id}`);
    } catch (error) {
      setSpanImportError(error instanceof Error ? error.message : '无法从当前 span 创建 Playground Case');
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

  return (
    <PageShell>
      <PageHeader
        eyebrow="Trace Waterfall"
        title="Trace 详情"
        description="以 span 树、共享时间轴和详情面板回放一次真实执行过程。"
        icon={<Waypoints className="h-5 w-5" />}
        badge={trace ? <PageHeaderBadge>{trace.trace.status}</PageHeaderBadge> : null}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回
            </Button>
            <Button
              variant={autoRefreshEnabled ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoRefreshEnabled((value) => !value)}
            >
              {autoRefreshEnabled ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              {autoRefreshEnabled ? '停止自动刷新' : '开启自动刷新'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(`/playground?conversationId=${conversationId}`)}>
              <Waypoints className="mr-2 h-4 w-4" />
              导入到 Playground
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportSelectedSpan}
              disabled={!canImportSelectedSpan || Boolean(importingSpanId)}
            >
              <Waypoints className="mr-2 h-4 w-4" />
              {importingSpanId ? '导入当前 Span...' : '当前 Span 到 Playground'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsDebugModalOpen(true)}>
              <Bug className="mr-2 h-4 w-4" />
              调试 Prompt
            </Button>
          </>
        }
      />

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">加载失败</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-destructive">
            {error instanceof Error ? error.message : '获取 trace 失败'}
          </CardContent>
        </Card>
      ) : null}

      {spanImportError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Span 导入失败</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-destructive">
            {spanImportError}
          </CardContent>
        </Card>
      ) : null}

      {isLoading && !trace ? (
        <Card className="rounded-[22px]">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="mr-3 h-8 w-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">正在加载 trace waterfall...</span>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && !error && !trace ? (
        <Card className="rounded-[22px] border-dashed">
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            当前会话还没有可展示的 trace 数据。
          </CardContent>
        </Card>
      ) : null}

      {trace && viewModel ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            {viewModel.metrics.map((metric) => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                detail={metric.detail}
                tone={metric.tone}
              />
            ))}
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_420px]">
            <SectionPanel
              title="Span Waterfall"
              description="按 span 树、共享时间轴和路径层级阅读真实执行。"
              contentClassName="pt-3"
            >
              <TraceWaterfall
                viewModel={viewModel}
                selectedSpanId={selectedSpanId}
                onSelectSpan={handleSelectSpan}
                onImportSpan={handleImportSpan}
                importingSpanId={importingSpanId}
              />
            </SectionPanel>

            {isDesktop ? (
              <SectionPanel
                title="Inspector"
                description="点击任意 span 后，查看该步骤的输入、输出和证据。"
                className="xl:sticky xl:top-5 xl:flex xl:min-h-[calc(100vh-1.5rem)] xl:flex-col xl:self-start"
                contentClassName="flex min-h-0 flex-1 flex-col pt-3"
              >
                <TraceInspectorPanel
                  node={selectedSpan}
                  metadataBadges={viewModel.metadataBadges}
                  onImportToPlayground={canImportSelectedSpan ? handleImportSelectedSpan : undefined}
                  isImportingToPlayground={Boolean(importingSpanId)}
                  className="h-full min-h-0"
                />
              </SectionPanel>
            ) : null}
          </div>

          {!isDesktop ? (
            <TraceInspectorSheet
              open={isMobileInspectorOpen}
              onOpenChange={setIsMobileInspectorOpen}
              node={selectedSpan}
              metadataBadges={viewModel.metadataBadges}
              onImportToPlayground={canImportSelectedSpan ? handleImportSelectedSpan : undefined}
              isImportingToPlayground={Boolean(importingSpanId)}
            />
          ) : null}
        </>
      ) : null}

      <DebugPromptModal
        isOpen={isDebugModalOpen}
        onClose={() => setIsDebugModalOpen(false)}
        conversationId={conversationId}
      />
    </PageShell>
  );
};
