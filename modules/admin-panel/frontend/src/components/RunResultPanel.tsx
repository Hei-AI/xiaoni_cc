import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { formatTimestamp } from '@/lib/utils';
import type { PlaygroundRun } from '@/types/playground';
import { Copy, History, RotateCcw, Sparkles } from 'lucide-react';
import { RunComparisonPanel } from './RunComparisonPanel';

interface RunResultPanelProps {
  currentRun?: PlaygroundRun | null;
  runs: PlaygroundRun[];
  onCloneRun: (runId: string) => void;
  onSetBaseline: (run: PlaygroundRun) => void;
  onSelectRun: (runId: string) => void;
}

export function RunResultPanel({
  currentRun,
  runs,
  onCloneRun,
  onSetBaseline,
  onSelectRun,
}: RunResultPanelProps) {
  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-[0_20px_45px_-36px_rgba(15,23,42,0.35)]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Result Surface</CardTitle>
            {currentRun ? (
              <div className="flex gap-2">
                <Badge variant={currentRun.status === 'completed' ? 'default' : 'destructive'}>
                  {currentRun.status}
                </Badge>
                <Badge variant="outline">{currentRun.modelName || currentRun.provider || 'run'}</Badge>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentRun ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatTimestamp(currentRun.createdAt)}</span>
                <span>executed by {currentRun.executedBy}</span>
              </div>
              <div className="rounded-2xl border border-border/70 bg-white p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Response</div>
                <div className="whitespace-pre-wrap text-sm leading-7">
                  {currentRun.outputSnapshot?.responseText || currentRun.outputSnapshot?.error || 'No output'}
                </div>
              </div>
              {currentRun.outputSnapshot?.thinking ? (
                <div className="rounded-2xl border border-dashed border-primary/35 bg-primary/5 p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    Thinking
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {currentRun.outputSnapshot.thinking}
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-3">
                <Button variant="outline" onClick={() => onCloneRun(currentRun.id)}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Clone Run
                </Button>
                <Button variant="outline" onClick={() => onSetBaseline(currentRun)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Set Baseline
                </Button>
                <Button variant="ghost" onClick={() => navigator.clipboard.writeText(currentRun.outputSnapshot?.responseText || '')}>
                  复制输出
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              还没有 run。选择样本后点击右上角 Run。
            </div>
          )}
        </CardContent>
      </Card>

      {currentRun?.comparisonSnapshot?.hasBaseline ? (
        <RunComparisonPanel
          title="Baseline Comparison"
          leftTitle="Baseline"
          rightTitle="Current Run"
          leftValue={currentRun.comparisonSnapshot.baselineText}
          rightValue={currentRun.outputSnapshot?.responseText}
          similarity={currentRun.comparisonSnapshot.similarity}
          diffCount={currentRun.comparisonSnapshot.diffCount}
        />
      ) : null}

      {currentRun?.comparisonSnapshot?.previousRunText ? (
        <RunComparisonPanel
          title="Previous Run Comparison"
          leftTitle="Previous Run"
          rightTitle="Current Run"
          leftValue={currentRun.comparisonSnapshot.previousRunText}
          rightValue={currentRun.outputSnapshot?.responseText}
        />
      ) : null}

      <Card className="border-border/70 bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            Run History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-80 px-4 pb-4">
            <div className="space-y-2">
              {runs.map((run, index) => (
                <div key={run.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRun(run.id)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      currentRun?.id === run.id
                        ? 'border-primary bg-primary/8'
                        : 'border-border/70 hover:border-primary/30 hover:bg-primary/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{run.modelName || run.provider || 'Run'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(run.createdAt)}</div>
                      </div>
                      <div className="flex gap-2">
                        {typeof run.comparisonSnapshot?.similarity === 'number' ? (
                          <Badge variant="outline">{run.comparisonSnapshot.similarity}%</Badge>
                        ) : null}
                        <Badge variant={run.status === 'completed' ? 'default' : 'destructive'}>{run.status}</Badge>
                      </div>
                    </div>
                  </button>
                  {index < runs.length - 1 ? <Separator className="my-2" /> : null}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
