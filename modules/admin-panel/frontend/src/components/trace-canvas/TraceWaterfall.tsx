import React from 'react';
import { ChevronDown, ChevronRight, Search, Shrink, UnfoldVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, formatTimestamp } from '@/lib/utils';
import { TraceWaterfallRow, TraceWaterfallViewModel } from '@/types';

interface TraceWaterfallProps {
  viewModel: TraceWaterfallViewModel;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
}

function statusTone(status: TraceWaterfallRow['status']) {
  switch (status) {
    case 'ok':
      return 'border-[hsl(var(--success))]/35 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]';
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    default:
      return 'border-[hsl(var(--warning))]/35 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]';
  }
}

function kindColor(kind: TraceWaterfallRow['kind']) {
  switch (kind) {
    case 'client':
      return '#2f80ed';
    case 'server':
      return '#0ea5a4';
    case 'producer':
      return '#15803d';
    case 'consumer':
      return '#6d28d9';
    default:
      return '#c98516';
  }
}

function buildVisibleRows(
  rows: TraceWaterfallRow[],
  expanded: Set<string>,
  search: string
) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const normalizedSearch = search.trim().toLowerCase();
  const matchedIds = new Set<string>();

  if (normalizedSearch) {
    rows.forEach((row) => {
      const haystack = [
        row.title,
        row.subtitle,
        row.summary,
        row.semanticRole,
        ...row.badges,
        ...row.pathTokens,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (haystack.includes(normalizedSearch)) {
        let cursor: TraceWaterfallRow | undefined = row;
        while (cursor) {
          matchedIds.add(cursor.id);
          cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
        }
      }
    });
  }

  return rows.filter((row) => {
    if (normalizedSearch && !matchedIds.has(row.id)) {
      return false;
    }

    let cursor = row.parentId ? byId.get(row.parentId) : undefined;
    while (cursor) {
      if (!expanded.has(cursor.id) && !(normalizedSearch && matchedIds.has(cursor.id))) {
        return false;
      }
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }

    return true;
  });
}

export function TraceWaterfall({ viewModel, selectedSpanId, onSelectSpan }: TraceWaterfallProps) {
  const [search, setSearch] = React.useState('');
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(viewModel.rows.filter((row) => row.defaultExpanded).map((row) => row.id))
  );

  React.useEffect(() => {
    setExpanded(new Set(viewModel.rows.filter((row) => row.defaultExpanded).map((row) => row.id)));
  }, [viewModel.rows]);

  const rowsById = React.useMemo(
    () => new Map(viewModel.rows.map((row) => [row.id, row])),
    [viewModel.rows]
  );

  const visibleRows = React.useMemo(
    () => buildVisibleRows(viewModel.rows, expanded, search),
    [expanded, search, viewModel.rows]
  );

  const selectedRow = selectedSpanId ? rowsById.get(selectedSpanId) || null : null;
  const topLevelRows = React.useMemo(
    () => viewModel.rows.filter((row) => row.depth === 1),
    [viewModel.rows]
  );

  const toggleRow = React.useCallback((rowId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  return (
    <div className="rounded-[22px] border border-border bg-[linear-gradient(180deg,#fff,#fbfaf8)]">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-lg font-semibold text-foreground">Trace Waterfall</div>
            <div className="mt-1 text-sm text-muted-foreground">
              以 span 树和共享时间轴回放一次完整执行，不再依赖拖拽画布。
            </div>
            {selectedRow ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {selectedRow.pathTokens.map((token, index) => (
                  <span key={`${selectedRow.id}-${token}-${index}`} className="rounded-full border border-border bg-background px-2 py-1">
                    {token}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索 span、role、model、tool..."
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(new Set(viewModel.rows.filter((row) => row.hasChildren).map((row) => row.id)))}
            >
              <UnfoldVertical className="mr-2 h-4 w-4" />
              全展开
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(new Set(viewModel.rows.filter((row) => row.depth < 1).map((row) => row.id)))}
            >
              <Shrink className="mr-2 h-4 w-4" />
              收起分支
            </Button>
          </div>
        </div>
      </div>

      <div className="border-b border-border px-5 py-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Trace Overview</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {topLevelRows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelectSpan(row.id)}
              className={cn(
                'rounded-2xl border p-3 text-left transition hover:border-primary/40 hover:bg-primary/5',
                selectedSpanId === row.id ? 'border-primary bg-primary/5' : 'border-border bg-background/70'
              )}
            >
              <div className="text-sm font-semibold text-foreground">{row.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{row.summary}</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    marginLeft: `${(row.timelineOffsetMs / viewModel.traceDurationMs) * 100}%`,
                    width: `${row.timelineWidthRatio * 100}%`,
                    backgroundColor: kindColor(row.kind),
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="h-[780px]">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_240px] gap-4 border-b border-border bg-background/95 px-5 py-3 backdrop-blur">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Span Tree</div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Timeline</div>
        </div>

        <div className="divide-y divide-border">
          {visibleRows.map((row) => {
            const isSelected = row.id === selectedSpanId;
            const canToggle = row.hasChildren;
            const expandedState = expanded.has(row.id);
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSpan(row.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectSpan(row.id);
                  }
                }}
                className={cn(
                  'grid w-full grid-cols-[minmax(0,1fr)_240px] gap-4 px-5 py-4 text-left transition hover:bg-muted/20',
                  isSelected && 'bg-primary/5'
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <div className="flex items-start" style={{ paddingLeft: `${row.depth * 18}px` }}>
                      {canToggle ? (
                        <button
                          type="button"
                          className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleRow(row.id);
                          }}
                        >
                          {expandedState ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      ) : (
                        <div className="mt-2 h-2 w-2 rounded-full bg-border" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-foreground">{row.title}</div>
                        <div className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]', statusTone(row.status))}>
                          {row.status}
                        </div>
                        <Badge variant="outline" className="border-border/80 bg-background text-[10px] font-normal">
                          {row.semanticRole}
                        </Badge>
                        {row.errorCountInSubtree > 0 ? (
                          <Badge variant="outline" className="border-destructive/30 bg-destructive/5 text-[10px] font-normal text-destructive">
                            subtree error {row.errorCountInSubtree}
                          </Badge>
                        ) : null}
                      </div>

                      {row.subtitle ? <div className="mt-1 truncate text-xs text-muted-foreground">{row.subtitle}</div> : null}
                      <div className="mt-2 line-clamp-2 text-sm text-foreground/85">{row.summary}</div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {row.meta.map((item) => (
                          <Badge key={`${row.id}-${item.label}`} variant="outline" className="border-border/80 bg-muted/30 text-[10px] font-normal">
                            {item.label}: {item.value}
                          </Badge>
                        ))}
                        {row.badges.map((badge) => (
                          <Badge key={`${row.id}-${badge}`} variant="outline" className="border-border/80 bg-background text-[10px] font-normal">
                            {badge}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col justify-center">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{row.startedAt ? formatTimestamp(row.startedAt, { fallback: 'n/a' }) : 'n/a'}</span>
                    <span>{row.durationMs !== null ? `${row.durationMs}ms` : 'n/a'}</span>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', row.status === 'error' && 'ring-2 ring-destructive/30')}
                      style={{
                        marginLeft: `${(row.timelineOffsetMs / viewModel.traceDurationMs) * 100}%`,
                        width: `${Math.min(row.timelineWidthRatio * 100, 100)}%`,
                        backgroundColor: kindColor(row.kind),
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
