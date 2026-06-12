import React from 'react';
import { createPortal } from 'react-dom';
import { HttpPayloadAccordion } from '@/components/HttpPayloadAccordion';
import { StructuredDataViewer } from '@/components/StructuredDataViewer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { summarizeProviderRequestInputBody } from '@/lib/trace-provider-request-summary';
import { cn, formatTimestamp } from '@/lib/utils';
import { TraceInspectorSection, TraceWaterfallRow } from '@/types';

type InspectorTab = TraceInspectorSection['id'];

const FLOATING_WIDTH = 560;
const FLOATING_HEIGHT = 760;
const FLOATING_MARGIN = 16;

function statusTone(status: string) {
  switch (status) {
    case 'ok':
      return 'border-[hsl(var(--success))]/35 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]';
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    default:
      return 'border-[hsl(var(--warning))]/35 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]';
  }
}

function getFloatingBounds() {
  const width = Math.min(FLOATING_WIDTH, Math.max(360, window.innerWidth - FLOATING_MARGIN * 2));
  const height = Math.min(FLOATING_HEIGHT, Math.max(480, window.innerHeight - FLOATING_MARGIN * 2));
  return {
    width,
    height,
    maxX: Math.max(FLOATING_MARGIN, window.innerWidth - width - FLOATING_MARGIN),
    maxY: Math.max(FLOATING_MARGIN, window.innerHeight - height - FLOATING_MARGIN),
  };
}

function clampFloatingPosition(position: { x: number; y: number }) {
  const bounds = getFloatingBounds();
  return {
    x: Math.min(Math.max(position.x, FLOATING_MARGIN), bounds.maxX),
    y: Math.min(Math.max(position.y, FLOATING_MARGIN), bounds.maxY),
  };
}

function getSection(node: TraceWaterfallRow, sectionId: InspectorTab) {
  return node.inspector.sections.find((section) => section.id === sectionId) || null;
}

function readHttpPayload(value: unknown): { headers: unknown; body: unknown } {
  if (!value || typeof value !== 'object') {
    return {
      headers: null,
      body: null,
    };
  }

  const payload = value as Record<string, unknown>;
  return {
    headers: payload.headers ?? null,
    body: payload.body ?? null,
  };
}

function readHttpPayloadMeta(value: unknown): {
  rawBody: unknown;
  bodySource: string | null;
} {
  if (!value || typeof value !== 'object') {
    return {
      rawBody: null,
      bodySource: null,
    };
  }

  const payload = value as Record<string, unknown>;
  return {
    rawBody: payload.raw_body ?? null,
    bodySource: typeof payload.body_source === 'string' ? payload.body_source : null,
  };
}

function toRawPayloadText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function isProviderRequestNode(node: TraceWaterfallRow | null): node is TraceWaterfallRow {
  return Boolean(node && node.semanticRole === 'provider_request');
}

function ProviderRequestInputSummaryNotice({ body }: { body: unknown }) {
  const summary = React.useMemo(() => summarizeProviderRequestInputBody(body), [body]);
  if (!summary) {
    return null;
  }

  const reminderFound = summary.lastSystemReminderIndex !== null && summary.lastSystemReminderText;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-700/80 bg-slate-950/70 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Input Items</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">{summary.inputCount}</div>
        </div>
        <div className="rounded-lg border border-slate-700/80 bg-slate-950/70 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Tail Item</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">input[{summary.lastItemIndex}]</div>
          <div className="mt-1 text-[11px] text-slate-400">{summary.lastItemLabel}</div>
        </div>
      </div>
      {reminderFound ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
            Last system_reminder input[{summary.lastSystemReminderIndex}]
          </div>
          <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-emerald-50">{summary.lastSystemReminderText}</div>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-50">
          No prompt-facing system_reminder found in body.input.
        </div>
      )}
      {!reminderFound || summary.lastSystemReminderIndex !== summary.lastItemIndex ? (
        <div className="rounded-lg border border-slate-700/80 bg-slate-950/70 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Last Item Text</div>
          <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-200">{summary.lastItemText || '(no text content)'}</div>
        </div>
      ) : null}
    </div>
  );
}

interface TraceInspectorSurfaceProps {
  node: TraceWaterfallRow | null;
  metadataBadges: string[];
  activeTab: InspectorTab;
  onActiveTabChange: (tab: InspectorTab) => void;
  surfaceLabel?: string;
  allowFloating: boolean;
  detached: boolean;
  onImportToPlayground?: () => void;
  isImportingToPlayground?: boolean;
  onFocusProviderRequest?: (spanId: string) => void;
  onOpenTrafficDetail?: (trafficLogId: string | number) => void;
  onOpenTrafficList?: (llmCallId: string) => void;
  onToggleDetached?: () => void;
  onDragStart?: (event: React.MouseEvent<HTMLDivElement>) => void;
  className?: string;
}

function TraceInspectorSurface({
  node,
  metadataBadges,
  activeTab,
  onActiveTabChange,
  surfaceLabel = 'Selected Span',
  allowFloating,
  detached,
  onImportToPlayground,
  isImportingToPlayground,
  onFocusProviderRequest,
  onOpenTrafficDetail,
  onOpenTrafficList,
  onToggleDetached,
  onDragStart,
  className,
}: TraceInspectorSurfaceProps) {
  const activeSection = node ? getSection(node, activeTab) : null;
  const inputSection = node ? getSection(node, 'input') : null;
  const outputSection = node ? getSection(node, 'output') : null;
  const evidenceSection = node ? getSection(node, 'evidence') : null;

  if (!node) {
    return (
      <Card className={cn('h-full min-h-[420px] rounded-[22px]', className)}>
        <CardContent className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
          选择任意 span 后，这里会显示该步骤的输入、输出和 evidence。
        </CardContent>
      </Card>
    );
  }

  const resolvedInputValue = inputSection?.value;
  const resolvedOutputValue = outputSection?.value;
  const resolvedEvidenceValue = evidenceSection?.value;
  const inputPayload = readHttpPayload(resolvedInputValue);
  const inputPayloadMeta = readHttpPayloadMeta(resolvedInputValue);
  const outputPayload = readHttpPayload(resolvedOutputValue);
  const outputPayloadMeta = readHttpPayloadMeta(resolvedOutputValue);
  const outputRawBody = outputPayloadMeta.rawBody
    ? outputPayloadMeta.rawBody
    : isProviderRequestNode(node)
      ? toRawPayloadText(outputPayload.body)
      : null;

  return (
    <Card className={cn('h-full min-h-[420px] rounded-[22px] bg-[linear-gradient(180deg,#fff,#faf8f5)]', className)}>
      <CardContent className="flex h-full min-h-0 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="inline-flex w-fit rounded-full border border-[hsl(var(--info))]/20 bg-[hsl(var(--info))]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--info))]">
            {detached ? 'Detached Inspector' : surfaceLabel}
          </div>
          <div className="flex items-center gap-2">
            {node.providerRequestSpanId && onFocusProviderRequest ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onFocusProviderRequest(node.providerRequestSpanId!)}>
                定位真实请求
              </Button>
            ) : null}
            {node.trafficLogId !== null && node.trafficLogId !== undefined && onOpenTrafficDetail ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenTrafficDetail(node.trafficLogId!)}>
                流量详情
              </Button>
            ) : null}
            {node.llmCallId && onOpenTrafficList ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenTrafficList(node.llmCallId!)}>
                同 llm_call_id 流量
              </Button>
            ) : null}
            {node.playgroundCapability === 'exact' && onImportToPlayground ? (
              <Button type="button" variant="outline" size="sm" onClick={onImportToPlayground} disabled={isImportingToPlayground}>
                {isImportingToPlayground ? '导入中...' : '在 Playground 复测'}
              </Button>
            ) : null}
            {allowFloating && onToggleDetached ? (
              <Button type="button" variant="outline" size="sm" onClick={onToggleDetached}>
                {detached ? '收回右侧' : '拖成浮窗'}
              </Button>
            ) : null}
          </div>
        </div>

        {detached ? (
          <div
            role="presentation"
            onMouseDown={onDragStart}
            className="mt-3 rounded-xl border border-dashed border-border bg-background/80 px-3 py-2 text-xs text-muted-foreground cursor-move select-none"
          >
            拖拽这里移动 Inspector 浮窗。
          </div>
        ) : null}

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

        {node.meta.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {node.meta.map((item) => (
              <div key={`${node.id}-${item.label}`} className="rounded-xl border border-border bg-background/85 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</div>
                <div className="mt-2 text-sm font-medium text-foreground">{item.value}</div>
              </div>
            ))}
          </div>
        ) : null}

        <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as InspectorTab)} className="mt-5 flex min-h-0 flex-1 flex-col">
          <TabsList className="w-full justify-start gap-5 overflow-x-auto">
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
          </TabsList>
          <TabsContent value="input" className="mt-3 flex-1">
            {isProviderRequestNode(node) ? (
              <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                <HttpPayloadAccordion
                  key={`${node.id}-input`}
                  headers={inputPayload.headers}
                  body={inputPayload.body}
                  headersTitle="Request Headers"
                  bodyTitle="Request Body"
                  headersEmptyLabel="无请求头"
                  bodyEmptyLabel="无请求体"
                  bodyHeightClassName="h-[24rem] xl:h-[min(54vh,30rem)]"
                  headersHeightClassName="h-[18rem] xl:h-[min(38vh,22rem)]"
                  defaultHeadersOpen
                />
                <ProviderRequestInputSummaryNotice body={inputPayload.body} />
                {inputPayloadMeta.rawBody ? (
                  <StructuredDataViewer
                    title="Raw Request"
                    value={inputPayloadMeta.rawBody}
                    emptyLabel="无原始请求体"
                    heightClassName="h-[20rem] xl:h-[min(42vh,24rem)]"
                    rawText
                  />
                ) : null}
                <HttpPayloadAccordion
                  key={`${node.id}-input-response`}
                  headers={outputPayload.headers}
                  body={outputPayload.body}
                  headersTitle="Response Headers"
                  bodyTitle="Response Body"
                  headersEmptyLabel="无响应头"
                  bodyEmptyLabel="无响应体"
                  bodyHeightClassName="h-[20rem] xl:h-[min(42vh,24rem)]"
                  headersHeightClassName="h-[16rem] xl:h-[min(34vh,20rem)]"
                  defaultHeadersOpen
                  bodyNotice={outputPayloadMeta.bodySource === 'sse_complete'
                    ? '当前 Body 展示的是 SSE 最终完成态 JSON；增量事件与完整原始响应见下方 Raw Response。'
                    : undefined}
                />
                {outputRawBody ? (
                  <StructuredDataViewer
                    title="Raw Response"
                    value={outputRawBody}
                    emptyLabel="无原始响应体"
                    heightClassName="h-[20rem] xl:h-[min(42vh,24rem)]"
                    rawText
                  />
                ) : null}
              </div>
            ) : (
              <StructuredDataViewer
                title="Input"
                value={resolvedInputValue}
                emptyLabel={inputSection?.emptyLabel}
                heightClassName="h-[28rem] xl:h-[min(60vh,36rem)]"
              />
            )}
          </TabsContent>
          <TabsContent value="output" className="mt-3 flex-1">
            {isProviderRequestNode(node) ? (
              <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                <HttpPayloadAccordion
                  key={`${node.id}-output`}
                  headers={outputPayload.headers}
                  body={outputPayload.body}
                  headersTitle="Response Headers"
                  bodyTitle="Response Body"
                  headersEmptyLabel="无响应头"
                  bodyEmptyLabel="无响应体"
                  bodyHeightClassName="h-[24rem] xl:h-[min(54vh,30rem)]"
                  headersHeightClassName="h-[18rem] xl:h-[min(38vh,22rem)]"
                  defaultHeadersOpen
                  bodyNotice={outputPayloadMeta.bodySource === 'sse_complete'
                    ? '当前 Body 展示的是 SSE 最终完成态 JSON；增量事件与完整流见下方原始输出。'
                    : undefined}
                />
                {outputRawBody ? (
                  <StructuredDataViewer
                    title="Raw Output"
                    value={outputRawBody}
                    emptyLabel="无原始响应体"
                    heightClassName="h-[20rem] xl:h-[min(42vh,24rem)]"
                    rawText
                  />
                ) : null}
              </div>
            ) : (
              <StructuredDataViewer
                title="Output"
                value={resolvedOutputValue}
                emptyLabel={outputSection?.emptyLabel}
                heightClassName="h-[28rem] xl:h-[min(60vh,36rem)]"
              />
            )}
          </TabsContent>
          <TabsContent value="evidence" className="mt-3 flex-1">
            <StructuredDataViewer
              title="Evidence"
              value={activeTab === 'evidence' ? resolvedEvidenceValue : activeSection?.value}
              emptyLabel={activeSection?.emptyLabel}
              heightClassName="h-[28rem] xl:h-[min(60vh,36rem)]"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface TraceInspectorPanelProps {
  node: TraceWaterfallRow | null;
  metadataBadges: string[];
  className?: string;
  allowFloating?: boolean;
  surfaceLabel?: string;
  onImportToPlayground?: () => void;
  isImportingToPlayground?: boolean;
  onFocusProviderRequest?: (spanId: string) => void;
  onOpenTrafficDetail?: (trafficLogId: string | number) => void;
  onOpenTrafficList?: (llmCallId: string) => void;
}

export function TraceInspectorPanel({
  node,
  metadataBadges,
  className,
  allowFloating = true,
  surfaceLabel,
  onImportToPlayground,
  isImportingToPlayground = false,
  onFocusProviderRequest,
  onOpenTrafficDetail,
  onOpenTrafficList,
}: TraceInspectorPanelProps) {
  const [activeTab, setActiveTab] = React.useState<InspectorTab>('input');
  const [detached, setDetached] = React.useState(false);
  const [dragOffset, setDragOffset] = React.useState<{ x: number; y: number } | null>(null);
  const [floatingPosition, setFloatingPosition] = React.useState({ x: FLOATING_MARGIN, y: FLOATING_MARGIN });

  React.useEffect(() => {
    if (!allowFloating) {
      setDetached(false);
    }
  }, [allowFloating]);

  React.useEffect(() => {
    if (!detached) {
      return undefined;
    }

    const bounds = getFloatingBounds();
    setFloatingPosition({
      x: bounds.maxX,
      y: FLOATING_MARGIN + 8,
    });

    const handleResize = () => {
      setFloatingPosition((current) => clampFloatingPosition(current));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [detached]);

  React.useEffect(() => {
    if (!dragOffset) {
      return undefined;
    }

    const handleMouseMove = (event: MouseEvent) => {
      setFloatingPosition(
        clampFloatingPosition({
          x: event.clientX - dragOffset.x,
          y: event.clientY - dragOffset.y,
        })
      );
    };

    const handleMouseUp = () => setDragOffset(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragOffset]);

  const handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button')) {
      return;
    }

    const floatingCard = event.currentTarget.closest('[data-floating-inspector]');
    const currentTarget = (floatingCard instanceof HTMLElement ? floatingCard : event.currentTarget).getBoundingClientRect();
    setDragOffset({
      x: event.clientX - currentTarget.left,
      y: event.clientY - currentTarget.top,
    });
  };

  const floatingBounds = typeof window === 'undefined' ? null : getFloatingBounds();
  const floatingStyle = floatingBounds
    ? {
        left: floatingPosition.x,
        top: floatingPosition.y,
        width: `${floatingBounds.width}px`,
        height: `${floatingBounds.height}px`,
      }
    : undefined;

  return (
    <>
      {detached ? (
        <Card className={cn('h-full min-h-[420px] rounded-[22px] border-dashed bg-muted/20', className)}>
          <CardContent className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="max-w-xs text-sm leading-6 text-muted-foreground">
              Inspector 已拖成浮窗，继续在左侧点 span 即可同步查看。
            </div>
            <Button type="button" variant="outline" onClick={() => setDetached(false)}>
              收回右侧
            </Button>
          </CardContent>
        </Card>
      ) : (
        <TraceInspectorSurface
          node={node}
          metadataBadges={metadataBadges}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          surfaceLabel={surfaceLabel}
          allowFloating={allowFloating}
          detached={false}
          onImportToPlayground={onImportToPlayground}
          isImportingToPlayground={isImportingToPlayground}
          onFocusProviderRequest={onFocusProviderRequest}
          onOpenTrafficDetail={onOpenTrafficDetail}
          onOpenTrafficList={onOpenTrafficList}
          onToggleDetached={allowFloating ? () => setDetached(true) : undefined}
          className={className}
        />
      )}

      {detached && typeof document !== 'undefined' && floatingStyle
        ? createPortal(
            <div data-floating-inspector="true" className="fixed z-[80]" style={floatingStyle}>
              <TraceInspectorSurface
                node={node}
                metadataBadges={metadataBadges}
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                surfaceLabel={surfaceLabel}
                allowFloating={allowFloating}
                detached
                onImportToPlayground={onImportToPlayground}
                isImportingToPlayground={isImportingToPlayground}
                onFocusProviderRequest={onFocusProviderRequest}
                onOpenTrafficDetail={onOpenTrafficDetail}
                onOpenTrafficList={onOpenTrafficList}
                onToggleDetached={() => setDetached(false)}
                onDragStart={handleDragStart}
                className="h-full shadow-2xl ring-1 ring-border/70"
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}

interface TraceInspectorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: TraceWaterfallRow | null;
  metadataBadges: string[];
  onImportToPlayground?: () => void;
  isImportingToPlayground?: boolean;
  onFocusProviderRequest?: (spanId: string) => void;
  onOpenTrafficDetail?: (trafficLogId: string | number) => void;
  onOpenTrafficList?: (llmCallId: string) => void;
}

export function TraceInspectorSheet({
  open,
  onOpenChange,
  node,
  metadataBadges,
  onImportToPlayground,
  isImportingToPlayground = false,
  onFocusProviderRequest,
  onOpenTrafficDetail,
  onOpenTrafficList,
}: TraceInspectorSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[78vh] rounded-t-[22px] px-0 pb-0">
        <SheetHeader className="px-5 pb-3 pt-5">
          <SheetTitle>{node?.title || 'Span 详情'}</SheetTitle>
          <SheetDescription>移动端在底部抽屉中查看所选 span 的输入、输出和证据。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">
          <TraceInspectorPanel
            node={node}
            metadataBadges={metadataBadges}
            allowFloating={false}
            onImportToPlayground={onImportToPlayground}
            isImportingToPlayground={isImportingToPlayground}
            onFocusProviderRequest={onFocusProviderRequest}
            onOpenTrafficDetail={onOpenTrafficDetail}
            onOpenTrafficList={onOpenTrafficList}
            className="h-full min-h-0 border-none shadow-none"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
