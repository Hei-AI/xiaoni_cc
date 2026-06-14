import React from 'react';
import { Braces, Eye, PanelRightOpen, Waypoints } from 'lucide-react';
import { HttpPayloadAccordion } from '@/components/HttpPayloadAccordion';
import { TraceInspectorPanel } from '@/components/trace-canvas/TraceInspector';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { SectionPanel } from '@/components/console/SectionPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TraceWaterfallRow } from '@/types';
import { cn } from '@/lib/utils';

const requestHeaders = {
  'content-type': 'application/json',
  authorization: 'Bearer sk-live-***',
  'openai-beta': 'assistants=v2',
  'x-trace-id': 'trace_01jsv1m2provider',
};

const requestBody = JSON.stringify(
  {
    model: 'gpt-5-mini',
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: 'You are a queue triage assistant.',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '帮我总结今天的 provider trace 改动。',
          },
        ],
      },
    ],
    reasoning: {
      effort: 'medium',
    },
    metadata: {
      conversation_id: 'conversation-2048',
      run_id: 'run-8891',
    },
  },
  null,
  2,
);

const responseHeaders = {
  'content-type': 'application/json',
  'openai-processing-ms': '842',
  'x-request-id': 'req_preview_20260328',
};

const responseBody = JSON.stringify(
  {
    id: 'resp_preview_20260328',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: '当前 trace 改动主要集中在 provider_request 的 headers/body 折叠展示。',
          },
        ],
      },
    ],
    usage: {
      input_tokens: 1198,
      output_tokens: 188,
    },
  },
  null,
  2,
);

function makeGenerationRow(): TraceWaterfallRow {
  return {
    id: 'llm-1',
    parentId: 'turn-1',
    spanId: 'llm-1',
    depth: 2,
    pathTokens: ['Conversation Trace', 'model slice 1', 'openai / gpt-5-mini'],
    title: 'openai / gpt-5-mini',
    subtitle: 'openai / gpt-5-mini',
    summary: 'LLM generation span，保留原来的结构化 input/output 查看方式。',
    status: 'ok',
    kind: 'client',
    semanticRole: 'generation',
    startedAt: '2026-03-28T11:20:01.000Z',
    endedAt: '2026-03-28T11:20:02.102Z',
    durationMs: 1102,
    timelineOffsetMs: 120,
    timelineWidthRatio: 0.42,
    hasChildren: true,
    defaultExpanded: true,
    errorCountInSubtree: 0,
    badges: ['client', 'generation', 'gpt-5-mini'],
    meta: [
      { label: 'Status', value: 'ok' },
      { label: 'Duration', value: '1102ms' },
      { label: 'Tokens', value: '1198/188' },
      { label: 'Provider', value: '1 request(s)' },
    ],
    sourceRef: 'llm-call-preview-1',
    playgroundCapability: 'exact',
    providerRequestSpanId: 'provider-request:preview',
    trafficLogId: 'preview-traffic-1',
    llmCallId: 'llm-call-preview-1',
    inspector: {
      sections: [
        {
          id: 'input',
          label: 'Input',
          value: {
            canonical_request: JSON.parse(requestBody),
            prompt_template: 'queue_triage_v4',
          },
          emptyLabel: 'No input captured',
        },
        {
          id: 'output',
          label: 'Output',
          value: {
            processed_response: '当前 trace 改动主要集中在 provider_request 的 headers/body 折叠展示。',
            canonical_response: JSON.parse(responseBody),
          },
          emptyLabel: 'No output captured',
        },
        {
          id: 'evidence',
          label: 'Evidence',
          value: {
            llm_call_id: 'llm-call-preview-1',
            model_provider: 'openai',
            model_name: 'gpt-5-mini',
          },
          emptyLabel: 'No evidence captured',
        },
      ],
    },
  };
}

function makeProviderRequestRow(): TraceWaterfallRow {
  return {
    id: 'provider-request:preview',
    parentId: 'llm-1',
    spanId: 'provider-request:preview',
    depth: 3,
    pathTokens: ['Conversation Trace', 'model slice 1', 'openai / gpt-5-mini', 'POST api.openai.com'],
    title: 'POST api.openai.com',
    subtitle: 'responses / api.openai.com / /v1/responses',
    summary: 'Provider request span，Input 和 Output 各自拆成垂直折叠的 Headers / Body 两段。',
    status: 'ok',
    kind: 'client',
    semanticRole: 'provider_request',
    startedAt: '2026-03-28T11:20:01.210Z',
    endedAt: '2026-03-28T11:20:02.052Z',
    durationMs: 842,
    timelineOffsetMs: 180,
    timelineWidthRatio: 0.31,
    hasChildren: false,
    defaultExpanded: true,
    errorCountInSubtree: 0,
    badges: ['client', 'provider_request', 'POST'],
    meta: [
      { label: 'Status', value: 'ok' },
      { label: 'Duration', value: '842ms' },
      { label: 'HTTP', value: '200' },
      { label: 'Mode', value: 'openai/responses' },
    ],
    sourceRef: 'preview-traffic-1',
    playgroundCapability: 'unsupported',
    providerRequestSpanId: null,
    trafficLogId: 'preview-traffic-1',
    llmCallId: 'llm-call-preview-1',
    inspector: {
      sections: [
        {
          id: 'input',
          label: 'Input',
          value: {
            headers: requestHeaders,
            body: requestBody,
          },
          emptyLabel: 'No input captured',
        },
        {
          id: 'output',
          label: 'Output',
          value: {
            status_code: 200,
            headers: responseHeaders,
            body: responseBody,
            error_message: null,
          },
          emptyLabel: 'No output captured',
        },
        {
          id: 'evidence',
          label: 'Evidence',
          value: {
            traffic_log_id: 'preview-traffic-1',
            url: 'https://api.openai.com/v1/responses',
            request_id: 'req_preview_20260328',
          },
          emptyLabel: 'No evidence captured',
        },
      ],
    },
  };
}

const mockRows = [
  {
    id: 'trace-root',
    title: 'Conversation Trace',
    subtitle: 'trace-root',
    badge: 'trace_root',
  },
  {
    id: 'turn-1',
    title: 'model slice 1',
    subtitle: 'model request slice',
    badge: 'model_slice',
  },
  {
    id: 'llm-1',
    title: 'openai / gpt-5-mini',
    subtitle: 'generation',
    badge: 'generation',
  },
  {
    id: 'provider-request:preview',
    title: 'POST api.openai.com',
    subtitle: 'provider_request',
    badge: 'provider_request',
  },
];

export function ProviderRequestDesignPreviewPage() {
  const generationRow = React.useMemo(() => makeGenerationRow(), []);
  const providerRequestRow = React.useMemo(() => makeProviderRequestRow(), []);
  const [selectedMockId, setSelectedMockId] = React.useState<'llm-1' | 'provider-request:preview'>('provider-request:preview');

  const selectedNode = selectedMockId === 'provider-request:preview' ? providerRequestRow : generationRow;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Design Preview"
        title="Provider Request 高保真预览"
        description="用 mock trace 数据预览 provider_request 的最终展示方式，方便先看样式和交互。"
        icon={<Eye className="h-5 w-5" />}
        badge={<PageHeaderBadge>mock</PageHeaderBadge>}
      />

      <div className="grid gap-4 xl:grid-cols-[0.86fr_1.14fr]">
        <SectionPanel
          title="Trace Preview"
          description="左侧保留 trace 的上下文层级，右侧直接渲染最终 inspector。"
          className="flex min-h-[42rem] flex-col"
          contentClassName="flex min-h-0 flex-1 flex-col pt-3"
        >
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
            <Card className="rounded-[22px] border-border/70 bg-[linear-gradient(180deg,#fffdf8,#f9f5ed)]">
              <CardContent className="space-y-3 p-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--info))]/25 bg-[hsl(var(--info))]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--info))]">
                  <Waypoints className="h-3.5 w-3.5" />
                  Mock Waterfall
                </div>
                {mockRows.map((row) => {
                  const isSelected = row.id === selectedMockId;
                  const isInteractive = row.id === 'llm-1' || row.id === 'provider-request:preview';
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        if (isInteractive) {
                          setSelectedMockId(row.id as 'llm-1' | 'provider-request:preview');
                        }
                      }}
                      className={cn(
                        'flex w-full items-start justify-between rounded-2xl border px-4 py-3 text-left transition-colors',
                        isSelected
                          ? 'border-[hsl(var(--info))]/35 bg-[hsl(var(--info))]/10 shadow-sm'
                          : 'border-border/70 bg-background/85',
                        !isInteractive && 'cursor-default opacity-70',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{row.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{row.subtitle}</div>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {row.badge}
                      </Badge>
                    </button>
                  );
                })}
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 py-3 text-xs leading-6 text-muted-foreground">
                  点 `generation` 和 `provider_request` 两个节点，可以对比普通 span 和新折叠式 HTTP span 的差异。
                </div>
              </CardContent>
            </Card>

            <TraceInspectorPanel
              node={selectedNode}
              metadataBadges={[
                'trace_id: trace_preview_20260328',
                'status: ok',
                'data_quality: complete',
              ]}
              allowFloating={false}
              className="h-full min-h-0"
            />
          </div>
        </SectionPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionPanel
          title="Input Preview"
          description="独立看 Input 的折叠展开层级。"
          className="min-h-[34rem]"
          contentClassName="pt-3"
        >
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <PanelRightOpen className="h-4 w-4" />
            默认展开 Body，Headers 收起。
          </div>
          <HttpPayloadAccordion
            headers={requestHeaders}
            body={requestBody}
            headersEmptyLabel="无请求头"
            bodyEmptyLabel="无请求体"
            bodyHeightClassName="h-[22rem]"
            headersHeightClassName="h-[16rem]"
          />
        </SectionPanel>

        <SectionPanel
          title="Output Preview"
          description="Output 保持相同结构，Body 一样按 JSON 格式化。"
          className="min-h-[34rem]"
          contentClassName="pt-3"
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
              HTTP 200
            </Badge>
            <Badge variant="outline">responses</Badge>
            <Badge variant="outline">842ms</Badge>
          </div>
          <HttpPayloadAccordion
            headers={responseHeaders}
            body={responseBody}
            headersEmptyLabel="无响应头"
            bodyEmptyLabel="无响应体"
            bodyHeightClassName="h-[22rem]"
            headersHeightClassName="h-[16rem]"
          />
        </SectionPanel>
      </div>

      <Card className="rounded-[22px] border-border/70 bg-[linear-gradient(135deg,#fff7ed,#fff,#f5f9ff)]">
        <CardContent className="flex flex-col gap-3 p-5 text-sm text-foreground/85 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <Braces className="mt-0.5 h-4 w-4 text-[hsl(var(--info))]" />
            <div>
              预览页入口建议先用 `/design/provider-request-preview`。确认样式后，同一套组件已经可以直接回填到真实 trace 和 traffic detail。
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => setSelectedMockId('provider-request:preview')}>
            聚焦 Provider Request
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  );
}
