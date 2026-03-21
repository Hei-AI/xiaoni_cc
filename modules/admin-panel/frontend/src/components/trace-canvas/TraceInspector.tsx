import { ChevronDown, Database, FileJson, FileSearch, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn, formatTimestamp } from '@/lib/utils';
import { TraceWaterfallRow, TraceWaterfallViewModel } from '@/types';

function JsonBlock({ value, emptyLabel = 'No data captured' }: { value: any; emptyLabel?: string }) {
  if (value === null || value === undefined || value === '') {
    return <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">{emptyLabel}</div>;
  }

  if (typeof value === 'string') {
    return <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100 whitespace-pre-wrap">{value}</pre>;
  }

  return (
    <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100 whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function statusTone(status: string) {
  switch (status) {
    case 'success':
      return 'border-[hsl(var(--success))]/35 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]';
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    default:
      return 'border-[hsl(var(--warning))]/35 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]';
  }
}

interface TraceInspectorPanelProps {
  node: TraceWaterfallRow | null;
  metadataBadges: string[];
  className?: string;
}

export function TraceInspectorPanel({ node, metadataBadges, className }: TraceInspectorPanelProps) {
  if (!node) {
    return (
        <Card className={cn('h-full min-h-[420px] rounded-[22px]', className)}>
        <CardContent className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
          选择任意 span 后，这里会显示该步骤的输入、输出、属性和原始证据。
        </CardContent>
      </Card>
    );
  }

  const overviewSection = node.inspector.sections.find((section) => section.id === 'overview');
  const inputSection = node.inspector.sections.find((section) => section.id === 'input');
  const outputSection = node.inspector.sections.find((section) => section.id === 'output');
  const evidenceSection = node.inspector.sections.find((section) => section.id === 'evidence');

  return (
    <Card className={cn('h-full min-h-[420px] rounded-[22px] bg-[linear-gradient(180deg,#fff,#faf8f5)]', className)}>
      <CardContent className="flex h-full flex-col p-5">
        <div className="inline-flex w-fit rounded-full border border-[hsl(var(--info))]/20 bg-[hsl(var(--info))]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--info))]">
          Selected Span
        </div>
        <h2 className="mt-3 text-[1.9rem] font-semibold leading-none text-foreground">{node.title}</h2>
        {node.subtitle ? <div className="mt-2 text-sm text-muted-foreground">{node.subtitle}</div> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <div className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', statusTone(node.status))}>
            {node.status}
          </div>
          {node.durationMs !== null ? <Badge variant="outline">{node.durationMs}ms</Badge> : null}
          {node.startedAt ? <Badge variant="outline">{formatTimestamp(node.startedAt)}</Badge> : null}
        </div>

        {metadataBadges.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {metadataBadges.map((item) => (
              <Badge key={item} variant="outline" className="border-border/80 bg-muted/40 text-[11px] font-normal">
                {item}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-5 rounded-2xl border border-border bg-background/80 p-4 text-sm leading-6 text-foreground/85">
          {node.summary}
        </div>

        <Tabs defaultValue="overview" className="mt-5 flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
          </TabsList>
          <ScrollArea className="mt-3 flex-1 pr-1">
            <TabsContent value="overview" className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                  What Happened
                </div>
                <div className="text-sm leading-6 text-foreground/90">
                  {typeof overviewSection?.value === 'string' ? overviewSection.value : node.summary}
                </div>
              </div>
              {node.meta.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {node.meta.map((item) => (
                    <div key={`${node.id}-${item.label}`} className="rounded-xl border border-border bg-background/85 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</div>
                      <div className="mt-2 text-sm font-medium text-foreground">{item.value}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="input">
              <JsonBlock value={inputSection?.value} emptyLabel={inputSection?.emptyLabel} />
            </TabsContent>
            <TabsContent value="output">
              <JsonBlock value={outputSection?.value} emptyLabel={outputSection?.emptyLabel} />
            </TabsContent>
            <TabsContent value="evidence">
              <JsonBlock value={evidenceSection?.value} emptyLabel={evidenceSection?.emptyLabel} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface TraceInspectorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: TraceWaterfallRow | null;
  metadataBadges: string[];
}

export function TraceInspectorSheet({ open, onOpenChange, node, metadataBadges }: TraceInspectorSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[78vh] rounded-t-[22px] px-0 pb-0">
        <SheetHeader className="px-5 pb-3 pt-5">
          <SheetTitle>{node?.title || 'Span 详情'}</SheetTitle>
          <SheetDescription>移动端在底部抽屉中查看所选 span 的输入、输出和证据。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">
          <TraceInspectorPanel node={node} metadataBadges={metadataBadges} className="h-full min-h-0 border-none shadow-none" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface TraceRawEvidenceProps {
  viewModel: TraceWaterfallViewModel;
}

export function TraceRawEvidence({ viewModel }: TraceRawEvidenceProps) {
  return (
    <Collapsible className="rounded-[22px] border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <div className="text-base font-semibold text-foreground">Raw Evidence</div>
          <div className="mt-1 text-sm text-muted-foreground">保留完整原始证据，但不放在主视觉阅读路径上。</div>
        </div>
        <CollapsibleTrigger className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
          展开原始证据
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="border-t border-border px-5 py-5">
        <div className="grid gap-4 lg:grid-cols-2">
          {viewModel.rawEvidenceSections.map((section) => (
            <div key={section.id} className="rounded-2xl border border-border bg-muted/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                {section.id.includes('http') ? <FileSearch className="h-4 w-4" /> : section.id.includes('llm') ? <FileJson className="h-4 w-4" /> : <Database className="h-4 w-4" />}
                {section.label}
              </div>
              <JsonBlock value={section.value} />
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
