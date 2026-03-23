import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatTimestamp } from '@/lib/utils';
import type { PlaygroundCase, PlaygroundLibraryPayload, PlaygroundRun } from '@/types/playground';
import { Bolt, Clock3, Database, PlayCircle, Search, Sparkles } from 'lucide-react';

interface SampleLibraryPanelProps {
  library?: PlaygroundLibraryPayload;
  selectedCaseId?: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onCreateFromTraffic: (trafficId: number) => void;
  onSelectCase: (caseId: string) => void;
  onCloneRun: (runId: string) => void;
  isCreatingCase?: boolean;
}

function CaseCard({
  item,
  selected,
  onSelect,
}: {
  item: PlaygroundCase;
  selected: boolean;
  onSelect: () => void;
}) {
  const sourceLabel = item.tags.includes('span') ? 'span' : item.source;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-3 text-left transition ${
        selected
          ? 'border-primary bg-primary/8 shadow-[0_8px_24px_-20px_rgba(14,165,233,0.65)]'
          : 'border-border/70 bg-white hover:border-primary/30 hover:bg-primary/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="line-clamp-1 text-sm font-semibold text-foreground">{item.name}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline">{item.caseMode}</Badge>
            <Badge variant="secondary">{sourceLabel}</Badge>
            {item.promptId ? <Badge variant="outline">saved prompt</Badge> : null}
          </div>
        </div>
        {item.isFavorite ? <Sparkles className="h-4 w-4 text-primary" /> : null}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {item.traceContext.traceId ? `trace ${String(item.traceContext.traceId).slice(0, 12)}...` : 'no trace'}
      </div>
    </button>
  );
}

function RunCard({ run, onClone }: { run: PlaygroundRun; onClone: () => void }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{run.modelName || run.provider || 'Run'}</div>
          <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(run.createdAt)}</div>
        </div>
        <Badge variant={run.status === 'completed' ? 'default' : 'destructive'}>{run.status}</Badge>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {run.comparisonSnapshot?.hasBaseline
            ? `baseline ${run.comparisonSnapshot.similarity ?? 0}%`
            : 'no baseline'}
        </div>
        <Button size="sm" variant="outline" onClick={onClone}>
          <PlayCircle className="mr-2 h-3.5 w-3.5" />
          Clone
        </Button>
      </div>
    </div>
  );
}

export function SampleLibraryPanel({
  library,
  selectedCaseId,
  search,
  onSearchChange,
  onCreateFromTraffic,
  onSelectCase,
  onCloneRun,
  isCreatingCase,
}: SampleLibraryPanelProps) {
  return (
    <Card className="border-border/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-[0_22px_50px_-36px_rgba(15,23,42,0.4)]">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-primary" />
            Sample Library
          </CardTitle>
          <Badge variant="outline">Traffic first</Badge>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索样本、Case、备注"
            className="pl-9"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100vh-18rem)] px-4 pb-4">
          <div className="space-y-5">
            <section>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Bolt className="h-3.5 w-3.5" />
                Traffic Samples
              </div>
              <div className="space-y-2">
                {library?.trafficSamples.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-border/70 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="line-clamp-1 text-sm font-semibold text-foreground">
                          {item.api_type || 'ai'} · {item.host}
                        </div>
                        <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.path}</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge variant="outline">{item.method}</Badge>
                          {item.response_status ? <Badge variant="secondary">{item.response_status}</Badge> : null}
                          {item.duration_ms ? <Badge variant="outline">{item.duration_ms} ms</Badge> : null}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => onCreateFromTraffic(item.id)}
                        disabled={isCreatingCase}
                      >
                        打开
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                Saved Cases
              </div>
              <div className="space-y-2">
                {library?.savedCases.map((item) => (
                  <CaseCard
                    key={item.id}
                    item={item}
                    selected={selectedCaseId === item.id}
                    onSelect={() => onSelectCase(item.id)}
                  />
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Recent Runs
              </div>
              <div className="space-y-2">
                {library?.recentRuns.map((run) => (
                  <RunCard key={run.id} run={run} onClone={() => onCloneRun(run.id)} />
                ))}
              </div>
            </section>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
