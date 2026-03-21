import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bug, Loader2, Pause, Play, RefreshCw, Workflow } from 'lucide-react';
import { DebugPromptModal } from '@/components/DebugPromptModal';
import { TraceCanvas } from '@/components/trace-canvas/TraceCanvas';
import { TraceInspectorPanel, TraceInspectorSheet, TraceRawEvidence } from '@/components/trace-canvas/TraceInspector';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(true);
  const [isDebugModalOpen, setIsDebugModalOpen] = React.useState(false);
  const [isMobileInspectorOpen, setIsMobileInspectorOpen] = React.useState(false);
  const isDesktop = useDesktopInspector();

  if (!conversationId) {
    return <Navigate to="/dashboard" replace />;
  }

  const { data: trace, isLoading, error, refetch, isRefetching } = useConversationTrace(conversationId, autoRefreshEnabled);
  const viewModel = React.useMemo(() => (trace ? buildTraceFlowViewModel(trace) : null), [trace]);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (viewModel?.selectedNodeId) {
      setSelectedNodeId(viewModel.selectedNodeId);
    }
  }, [viewModel]);

  const selectedNode = React.useMemo(
    () => viewModel?.nodes.find((node) => node.id === selectedNodeId) || null,
    [selectedNodeId, viewModel]
  );

  const handleSelectNode = React.useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    if (!isDesktop) {
      setIsMobileInspectorOpen(true);
    }
  }, [isDesktop]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Trace Canvas"
        title="对话时间线"
        description="用有向卡片和节点详情回放一次真实执行过程，让排障阅读路径和依赖关系同时清晰。"
        icon={<Workflow className="h-5 w-5" />}
        badge={trace ? <PageHeaderBadge>{trace.delivery.status}</PageHeaderBadge> : null}
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
              <Workflow className="mr-2 h-4 w-4" />
              导入到 Playground
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

      {isLoading && !trace ? (
        <Card className="rounded-[22px]">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="mr-3 h-8 w-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">正在加载 trace canvas...</span>
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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_420px]">
            <SectionPanel
              title="Trace Canvas"
              description="Dify 风格的执行画布。卡片可拖动，连线有方向，拖动位置仅本次查看有效。"
              contentClassName="pt-3"
            >
              <TraceCanvas viewModel={viewModel} selectedNodeId={selectedNodeId} onSelectNode={handleSelectNode} />
            </SectionPanel>

            {isDesktop ? (
              <SectionPanel
                title="Inspector"
                description="点击任意节点后，查看该步骤的输入、输出和证据。"
                contentClassName="pt-3"
              >
                <TraceInspectorPanel node={selectedNode} metadataBadges={viewModel.metadataBadges} />
              </SectionPanel>
            ) : null}
          </div>

          <TraceRawEvidence viewModel={viewModel} />

          {!isDesktop ? (
            <TraceInspectorSheet
              open={isMobileInspectorOpen}
              onOpenChange={setIsMobileInspectorOpen}
              node={selectedNode}
              metadataBadges={viewModel.metadataBadges}
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
