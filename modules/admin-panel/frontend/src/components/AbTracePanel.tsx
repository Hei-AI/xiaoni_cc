import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Microscope, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StructuredDataViewer } from '@/components/StructuredDataViewer';
import { useRunAbTraceDetail, useRunAbTraceSummaries } from '@/hooks/useAgentRuns';
import type { AbTraceArmSummaryDto, AbTraceDetailDto, AbTraceSummaryDto } from '@/types';

interface AbTracePanelProps {
  runId: string;
  autoRefreshEnabled: boolean;
}

function formatCount(value: number | undefined): string {
  return typeof value === 'number' ? String(value) : '0';
}

function formatBytes(value: number | undefined): string {
  if (!value) {
    return '0 B';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  return `${(value / 1024).toFixed(1)} KB`;
}

function statusVariant(status: string | null | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed' || status === 'created') {
    return 'default';
  }
  if (status === 'failed') {
    return 'destructive';
  }
  if (status === 'running' || status === 'partial') {
    return 'secondary';
  }
  return 'outline';
}

function ArmCard({ title, arm }: { title: string; arm?: AbTraceArmSummaryDto | null }) {
  return (
    <div className="rounded-lg border border-border bg-background/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant={statusVariant(arm?.status)}>{arm?.status || 'missing'}</Badge>
      </div>
      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
        <div>runner: <span className="font-mono text-foreground">{arm?.runnerName || '-'}</span></div>
        <div>model: <span className="font-mono text-foreground">{arm?.modelName || '-'}</span></div>
        <div>action: <span className="font-mono text-foreground">{arm?.finalAction?.kind || '-'}</span></div>
        {arm?.finalAction?.textPreview ? <div className="text-foreground">{arm.finalAction.textPreview}</div> : null}
        {arm?.finalAction?.rationalePreview ? <div>{arm.finalAction.rationalePreview}</div> : null}
        {arm?.failureCode ? <div className="text-destructive">failure: {arm.failureCode}</div> : null}
      </div>
    </div>
  );
}

function MemoryColumn({ title, items }: { title: string; items: AbTraceDetailDto['retrievedMemory']['observations'] }) {
  return (
    <div className="rounded-lg border border-border bg-background/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant="outline">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">暂无检索结果</div>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 4).map((item) => (
            <div key={item.id} className="rounded-md bg-muted/50 p-2 text-xs">
              <div className="line-clamp-3 text-foreground">{item.content}</div>
              <div className="mt-1 font-mono text-muted-foreground">score {item.score ?? '-'} · {item.id}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IsolationStatus({ summary, detail }: { summary: AbTraceSummaryDto; detail?: AbTraceDetailDto }) {
  const isolation = detail?.eval?.isolationCheck as {
    passed?: boolean;
    productionSideEffects?: string[];
    forbiddenSymbolsObserved?: string[];
    notes?: string | null;
  } | undefined;
  const passed = isolation?.passed ?? summary.isolationCheck?.passed;
  return (
    <div className="rounded-lg border border-border bg-background/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {passed === true ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : passed === false ? <XCircle className="h-4 w-4 text-destructive" /> : <AlertCircle className="h-4 w-4 text-muted-foreground" />}
          Isolation Check
        </div>
        <Badge variant={passed === false ? 'destructive' : passed === true ? 'default' : 'outline'}>
          {passed === true ? 'passed' : passed === false ? 'failed' : 'unknown'}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div>production side effects: {formatCount(isolation?.productionSideEffects?.length ?? summary.isolationCheck?.productionSideEffectCount)}</div>
        <div>forbidden symbols: {formatCount(isolation?.forbiddenSymbolsObserved?.length ?? summary.isolationCheck?.forbiddenSymbolCount)}</div>
      </div>
      {isolation?.notes ? <div className="mt-2 text-xs text-muted-foreground">{isolation.notes}</div> : null}
    </div>
  );
}

function DetailBody({ summary, detail }: { summary: AbTraceSummaryDto; detail?: AbTraceDetailDto }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <ArmCard title="Control Arm" arm={summary.controlArm} />
        <ArmCard title="Treatment Arm" arm={summary.treatmentArm} />
        <IsolationStatus summary={summary} detail={detail} />
      </div>

      {detail ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <MemoryColumn title="Observations" items={detail.retrievedMemory.observations} />
            <MemoryColumn title="Reflections" items={detail.retrievedMemory.reflections} />
            <MemoryColumn title="Plans" items={detail.retrievedMemory.plans} />
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <StructuredDataViewer value={detail.scene} title="Frozen Snapshot Scene" heightClassName="h-80" />
            <StructuredDataViewer value={detail.initialImpulse} title="Treatment Pass1 Initial Impulse" heightClassName="h-80" emptyLabel="暂无 pass1 产物" />
            <StructuredDataViewer value={detail.memoryTensionSummary} title="Memory Tension Summary" heightClassName="h-80" emptyLabel="暂无 memory tension" />
            <StructuredDataViewer value={detail.finalCandidateAction} title="Treatment Pass2 Final Candidate" heightClassName="h-80" emptyLabel="暂无 pass2 产物" />
            <StructuredDataViewer value={detail.eval} title="Eval Label And Dimensions" heightClassName="h-80" emptyLabel="暂无 eval 结果" />
            <StructuredDataViewer
              value={{
                providerEventIds: detail.providerEventIds,
                queueMessageIds: detail.queueMessageIds,
                payloadSizeMarkers: summary.payloadSizeMarkers
              }}
              title="Trace Refs And Payload Markers"
              heightClassName="h-80"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AbTracePanel({ runId, autoRefreshEnabled }: AbTracePanelProps) {
  const summariesQuery = useRunAbTraceSummaries(runId, autoRefreshEnabled);
  const summaries = summariesQuery.data || [];
  const [selectedSnapshotId, setSelectedSnapshotId] = React.useState<string | null>(null);
  const activeSummary = summaries.find((item) => item.snapshotId === selectedSnapshotId) || summaries[0] || null;
  const detailQuery = useRunAbTraceDetail(runId, activeSummary?.snapshotId || null);

  React.useEffect(() => {
    if (!selectedSnapshotId && summaries[0]?.snapshotId) {
      setSelectedSnapshotId(summaries[0].snapshotId);
    }
  }, [selectedSnapshotId, summaries]);

  return (
    <Card className="rounded-xl">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Microscope className="h-4 w-4" />
            A/B Experiment Trace
          </CardTitle>
          <div className="mt-1 text-sm text-muted-foreground">按 frozen snapshot 展示 control、treatment、memory 和 eval。</div>
        </div>
        {summariesQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {summariesQuery.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {summariesQuery.error instanceof Error ? summariesQuery.error.message : '加载 A/B trace 失败'}
          </div>
        ) : null}

        {summariesQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载 A/B trace...
          </div>
        ) : null}

        {!summariesQuery.isLoading && !summariesQuery.error && summaries.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            当前 run 没有关联的 A/B snapshot。
          </div>
        ) : null}

        {summaries.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2">
              {summaries.map((summary) => (
                <Button
                  key={summary.snapshotId}
                  variant={summary.snapshotId === activeSummary?.snapshotId ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedSnapshotId(summary.snapshotId)}
                  className="font-mono"
                >
                  {summary.snapshotId}
                </Button>
              ))}
            </div>

            {activeSummary ? (
              <div className="space-y-4">
                <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border bg-muted/40 p-3">scene: {activeSummary.scene.unreadMessageCount} unread / {activeSummary.scene.recentContextCount} context</div>
                  <div className="rounded-lg border border-border bg-muted/40 p-3">eval: {activeSummary.evalLabel || '-'}</div>
                  <div className="rounded-lg border border-border bg-muted/40 p-3">memory payload: {formatBytes(activeSummary.payloadSizeMarkers.retrievedMemoryBytes)}</div>
                  <div className="rounded-lg border border-border bg-muted/40 p-3">final payload: {formatBytes(activeSummary.payloadSizeMarkers.finalCandidateBytes)}</div>
                </div>

                {detailQuery.error ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {detailQuery.error instanceof Error ? detailQuery.error.message : '加载 A/B trace detail 失败'}
                  </div>
                ) : null}
                {detailQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在加载 snapshot detail...
                  </div>
                ) : (
                  <DetailBody summary={activeSummary} detail={detailQuery.data} />
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
