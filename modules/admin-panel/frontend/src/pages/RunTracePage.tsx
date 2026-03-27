import React from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pause, Play, RefreshCw, Waypoints } from 'lucide-react';
import { TraceWaterfall } from '@/components/trace-canvas/TraceWaterfall';
import { TraceInspectorPanel, TraceInspectorSheet } from '@/components/trace-canvas/TraceInspector';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FloatingWorkspacePanel, type FloatingWorkspacePanelState, type FloatingWorkspaceResizeMode } from '@/components/ui/floating-workspace-panel';
import { createCaseFromSpan } from '@/lib/playgroundApi';
import { buildTraceFlowViewModel } from '@/lib/trace-flow';
import { useRunTrace } from '@/hooks/useAgentRuns';

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

export const RunTracePage: React.FC = () => {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(true);
  const [isMobileInspectorOpen, setIsMobileInspectorOpen] = React.useState(false);
  const [spanImportError, setSpanImportError] = React.useState<string | null>(null);
  const [importingSpanId, setImportingSpanId] = React.useState<string | null>(null);
  const [inspectorPanel, setInspectorPanel] = React.useState<FloatingWorkspacePanelState>({
    collapsed: false,
    x: 980,
    y: 24,
    width: 420,
    height: 720,
  });
  const workspaceRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{
    mode: FloatingWorkspaceResizeMode;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);
  const isDesktop = useDesktopInspector();

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

  const clampPanel = React.useCallback((panel: FloatingWorkspacePanelState) => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    const boundsWidth = rect?.width ?? (typeof window === 'undefined' ? 1600 : window.innerWidth);
    const boundsHeight = rect?.height ?? (typeof window === 'undefined' ? 900 : window.innerHeight);
    const width = Math.min(Math.max(panel.width, 320), Math.max(320, boundsWidth - 32));
    const height = Math.min(Math.max(panel.height, 320), Math.max(320, boundsHeight - 32));
    const x = Math.min(Math.max(panel.x, 16), Math.max(16, boundsWidth - width - 16));
    const y = Math.min(Math.max(panel.y, 16), Math.max(16, boundsHeight - height - 16));
    return { ...panel, width, height, x, y };
  }, []);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragRef.current;
      if (!dragState) {
        return;
      }
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      setInspectorPanel((current) => {
        let next = current;
        if (dragState.mode === 'move') {
          next = { ...current, x: dragState.originX + deltaX, y: dragState.originY + deltaY };
        } else if (dragState.mode === 'right') {
          next = { ...current, width: dragState.originWidth + deltaX };
        } else if (dragState.mode === 'bottom') {
          next = { ...current, height: dragState.originHeight + deltaY };
        } else {
          next = { ...current, width: dragState.originWidth + deltaX, height: dragState.originHeight + deltaY };
        }
        return clampPanel(next);
      });
    };

    const handlePointerUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [clampPanel]);

  React.useEffect(() => {
    if (!isDesktop) {
      return;
    }
    setInspectorPanel((current) => clampPanel(current));
  }, [clampPanel, isDesktop]);

  const handlePanelPointerDown = (mode: FloatingWorkspaceResizeMode) => (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      originX: inspectorPanel.x,
      originY: inspectorPanel.y,
      originWidth: inspectorPanel.width,
      originHeight: inspectorPanel.height,
    };
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Run Trace"
        title="Run Trace 详情"
        description="span tree 和共享时间轴只作为深度证据层，不再承担主页面职责。"
        icon={<Waypoints className="h-5 w-5" />}
        badge={trace ? <PageHeaderBadge>{trace.trace.status}</PageHeaderBadge> : null}
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/conversations')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回工作台
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
              <Button variant="outline" size="sm" onClick={() => navigate(`/playground?conversationId=${trace.conversation_id}`)}>
                <Waypoints className="mr-2 h-4 w-4" />
                Run 到 Playground
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
            <div ref={workspaceRef} className="relative min-h-[calc(100vh-19rem)]">
              <SectionPanel
                title="Span Waterfall"
                description="按 span 树、共享时间轴和路径层级阅读真实执行。"
                className="flex min-h-[calc(100vh-19rem)] flex-col"
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

              {!inspectorPanel.collapsed ? (
                <FloatingWorkspacePanel
                  title="Inspector"
                  x={inspectorPanel.x}
                  y={inspectorPanel.y}
                  width={inspectorPanel.width}
                  height={inspectorPanel.height}
                  onClose={() => setInspectorPanel((current) => ({ ...current, collapsed: true }))}
                  onDragPointerDown={handlePanelPointerDown('move')}
                  onResizePointerDown={(mode) => handlePanelPointerDown(mode)}
                  bodyClassName="p-0"
                >
                  <SectionPanel
                    title="Inspector"
                    description="点击任意 span 后，查看该步骤的输入、输出和证据。"
                    className="flex h-full min-h-0 flex-col border-0 shadow-none"
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
                </FloatingWorkspacePanel>
              ) : null}
            </div>
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
            />
          ) : null}
        </>
      ) : null}
    </PageShell>
  );
};
