import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { SampleLibraryPanel } from '@/components/SampleLibraryPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { cn, formatTimestamp } from '@/lib/utils';
import {
  clonePlaygroundRun,
  createCaseFromConversation,
  createCaseFromTraffic,
  createPlaygroundRun,
  fetchPlaygroundCase,
  fetchPlaygroundLibrary,
  fetchPlaygroundRuns,
  updatePlaygroundCase,
} from '@/lib/playgroundApi';
import type {
  PlaygroundBaselineOutput,
  PlaygroundCase,
  PlaygroundPromptInput,
  PlaygroundPromptMode,
  PlaygroundProviderConfig,
  PlaygroundRun,
} from '@/types/playground';
import {
  Beaker,
  Database,
  ExternalLink,
  FileJson2,
  Move,
  Play,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';

type PromptSummary = {
  id: string;
  prompt_name: string;
  model_name?: string | null;
};

type OutputView = 'text' | 'tool' | 'raw';
type OutputTab = 'current' | 'compare';
type DesktopWindowId = 'params' | 'compare';

type FloatingWindowState = {
  open: boolean;
  x: number;
  y: number;
};

type ToolCallPreview = {
  name: string;
  status?: string;
  provider?: string;
  modelName?: string;
  arguments?: unknown;
  result?: unknown;
  raw?: unknown;
};

function parseJsonText<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function pickFirstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function findToolCallCandidate(value: unknown, depth = 0): ToolCallPreview | null {
  if (depth > 6 || value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findToolCallCandidate(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const functionCall = asRecord(record.functionCall);
  if (functionCall && typeof functionCall.name === 'string') {
    return {
      name: functionCall.name,
      arguments: parseMaybeJson(functionCall.args),
      result: pickFirstDefined(record.result, record.output, record.response, record.functionResponse),
      raw: record,
    };
  }

  if (Array.isArray(record.functionCalls) && record.functionCalls.length > 0) {
    const first = asRecord(record.functionCalls[0]);
    if (first && typeof first.name === 'string') {
      return {
        name: first.name,
        arguments: parseMaybeJson(first.args),
        result: pickFirstDefined(record.result, record.output, record.response),
        raw: record,
      };
    }
  }

  if (record.type === 'function_call' && typeof record.name === 'string') {
    return {
      name: record.name,
      status: typeof record.status === 'string' ? record.status : undefined,
      arguments: parseMaybeJson(record.arguments),
      result: pickFirstDefined(record.result, record.output, record.response),
      raw: record,
    };
  }

  if (typeof record.toolName === 'string') {
    return {
      name: record.toolName,
      status: typeof record.status === 'string' ? record.status : undefined,
      arguments: pickFirstDefined(record.arguments, record.args, record.input),
      result: pickFirstDefined(record.result, record.output, record.response),
      raw: record,
    };
  }

  const outputItems = Array.isArray(record.output) ? record.output : Array.isArray(record.items) ? record.items : null;
  if (outputItems) {
    for (const item of outputItems) {
      const nested = findToolCallCandidate(item, depth + 1);
      if (nested) return nested;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const nested = findToolCallCandidate(nestedValue, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function inferToolCall(run: PlaygroundRun | null): ToolCallPreview | null {
  if (!run?.outputSnapshot) {
    return null;
  }

  const candidates = [
    run.outputSnapshot.metadata,
    run.outputSnapshot.rawResponse,
    run.outputSnapshot.canonicalResponse,
    run.outputSnapshot.wireResponse,
    run.outputSnapshot.canonicalRequest,
    run.outputSnapshot.wireRequest,
  ];

  for (const candidate of candidates) {
    const preview = findToolCallCandidate(candidate);
    if (preview) {
      return {
        ...preview,
        status: preview.status || run.status,
        provider: preview.provider || run.outputSnapshot.provider || run.provider || undefined,
        modelName: preview.modelName || run.outputSnapshot.modelName || run.modelName || undefined,
      };
    }
  }

  return null;
}

function getRawProviderPayload(run: PlaygroundRun | null): unknown {
  if (!run?.outputSnapshot) {
    return null;
  }

  return pickFirstDefined(
    run.outputSnapshot.rawResponse,
    run.outputSnapshot.canonicalResponse,
    run.outputSnapshot.wireResponse,
    run.outputSnapshot.metadata,
    run.outputSnapshot.canonicalRequest,
    run.outputSnapshot.wireRequest
  );
}

function getPrimaryUserMessage(messages: PlaygroundPromptInput['messages']): string {
  return messages.find((message) => message.role === 'user')?.content || '';
}

function buildPromptPreview(
  promptMode: PlaygroundPromptMode,
  draftSystemInstruction: string,
  draftUserPromptTemplate: string,
  promptInput: PlaygroundPromptInput
): string {
  const parts = [
    `mode: ${promptMode}`,
    '',
    'system:',
    promptMode === 'draft' ? draftSystemInstruction || promptInput.systemInstruction : promptInput.systemInstruction,
    '',
    'messages:',
    ...promptInput.messages.map((message) => `[${message.role}] ${message.content}`),
  ];

  if (promptMode === 'draft' && draftUserPromptTemplate) {
    parts.push('', 'draft_template:', draftUserPromptTemplate);
  }

  return parts.join('\n');
}

function JsonBlock({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        'overflow-auto rounded-2xl border border-border/70 bg-muted/40 p-3 font-mono text-xs leading-6 text-foreground',
        className
      )}
    >
      {typeof value === 'string' ? value : stringifyJson(value)}
    </pre>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-2 text-xs leading-6 text-muted-foreground">{description}</div>
    </div>
  );
}

function FloatingPanel({
  title,
  badge,
  state,
  onClose,
  onPointerDown,
  children,
  className,
}: {
  title: string;
  badge?: string;
  state: FloatingWindowState;
  onClose: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'absolute z-20 hidden overflow-hidden rounded-[24px] border border-border bg-background/95 shadow-[0_30px_80px_-35px_rgba(15,23,42,0.45)] backdrop-blur lg:flex lg:flex-col',
        className
      )}
      style={{ left: state.x, top: state.y }}
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-border/80 bg-background/90 px-4 py-3"
        onPointerDown={onPointerDown}
      >
        <div className="flex items-center gap-2">
          <Move className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {badge ? <Badge variant="outline">{badge}</Badge> : null}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}

const DEFAULT_PROVIDER_CONFIG: PlaygroundProviderConfig = {
  provider: 'google-gemini-cli',
  generation: {
    temperature: 0.7,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 2048,
  },
  thinking: {
    includeThoughts: true,
    thinkingBudget: -1,
  },
  safety: [],
  tools: {},
  context: {},
  providerSpecific: {},
};

const DEFAULT_PROMPT_INPUT: PlaygroundPromptInput = {
  systemInstruction: '',
  messages: [{ role: 'user', content: '' }],
  contextVariables: {},
};

const DEFAULT_DESKTOP_WINDOWS: Record<DesktopWindowId, FloatingWindowState> = {
  params: { open: true, x: 840, y: 144 },
  compare: { open: false, x: 780, y: 520 },
};

export function PlaygroundPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [librarySearch, setLibrarySearch] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [promptMode, setPromptMode] = useState<PlaygroundPromptMode>('draft');
  const [promptId, setPromptId] = useState<string | null>(searchParams.get('promptId'));
  const [promptInput, setPromptInput] = useState<PlaygroundPromptInput>(DEFAULT_PROMPT_INPUT);
  const [providerConfig, setProviderConfig] = useState<PlaygroundProviderConfig>(DEFAULT_PROVIDER_CONFIG);
  const [draftSystemInstruction, setDraftSystemInstruction] = useState('');
  const [draftUserPromptTemplate, setDraftUserPromptTemplate] = useState('');
  const [contextVariablesText, setContextVariablesText] = useState(stringifyJson({}));
  const [providerSpecificText, setProviderSpecificText] = useState(stringifyJson({}));
  const [safetyText, setSafetyText] = useState(stringifyJson([]));
  const [outputTab, setOutputTab] = useState<OutputTab>('current');
  const [outputView, setOutputView] = useState<OutputView>('text');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [mobileParamsOpen, setMobileParamsOpen] = useState(false);
  const [mobileCompareOpen, setMobileCompareOpen] = useState(false);
  const [desktopWindows, setDesktopWindows] = useState(DEFAULT_DESKTOP_WINDOWS);
  const [comparePromptIds, setComparePromptIds] = useState<string[]>([]);
  const [expandedToolKey, setExpandedToolKey] = useState<string | null>(null);
  const [editorView, setEditorView] = useState<'prompt' | 'preview'>('prompt');
  const dragRef = useRef<{
    id: DesktopWindowId;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const bootstrappedRef = useRef(false);

  const { data: promptData } = useQuery({
    queryKey: ['prompts'],
    queryFn: async () => {
      const response = await fetch('/api/prompts');
      const payload = await response.json();
      if (!response.ok || payload.success !== true) {
        throw new Error(payload.message || payload.error || 'Failed to fetch prompts');
      }
      return payload.data as PromptSummary[];
    },
  });

  const libraryQuery = useQuery({
    queryKey: ['playground-library', librarySearch, promptId],
    queryFn: () => fetchPlaygroundLibrary(librarySearch, promptId),
  });

  const selectedCaseQuery = useQuery({
    queryKey: ['playground-case', selectedCaseId],
    queryFn: () => fetchPlaygroundCase(selectedCaseId!),
    enabled: Boolean(selectedCaseId),
  });

  const runsQuery = useQuery({
    queryKey: ['playground-runs', selectedCaseId],
    queryFn: () => fetchPlaygroundRuns(selectedCaseId!),
    enabled: Boolean(selectedCaseId),
  });

  const createFromTrafficMutation = useMutation({
    mutationFn: (trafficId: number) => createCaseFromTraffic(trafficId, promptId),
    onSuccess: (record) => {
      setSelectedCaseId(record.id);
      setLibraryOpen(false);
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
  });

  const createFromConversationMutation = useMutation({
    mutationFn: (conversationId: string) => createCaseFromConversation(conversationId, promptId),
    onSuccess: (record) => {
      setSelectedCaseId(record.id);
      setLibraryOpen(false);
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
  });

  const updateCaseMutation = useMutation({
    mutationFn: (payload: Partial<PlaygroundCase>) => updatePlaygroundCase(selectedCaseId!, payload),
    onSuccess: (record) => {
      queryClient.setQueryData(['playground-case', record.id], record);
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
  });

  const runMutation = useMutation({
    mutationFn: () =>
      createPlaygroundRun({
        caseId: selectedCaseId!,
        promptMode,
        promptId,
        providerConfig,
        promptInput,
        draftPrompt: {
          systemInstruction: draftSystemInstruction,
          userPromptTemplate: draftUserPromptTemplate,
          contextVariables: parseJsonText<Record<string, unknown>>(contextVariablesText, {}),
        },
      }),
    onSuccess: (run) => {
      setActiveRunId(run.id);
      setOutputTab('current');
      queryClient.invalidateQueries({ queryKey: ['playground-runs', selectedCaseId] });
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
  });

  const cloneRunMutation = useMutation({
    mutationFn: (runId: string) => clonePlaygroundRun(runId),
    onSuccess: (run) => {
      setSelectedCaseId(run.caseId);
      setActiveRunId(run.id);
      queryClient.invalidateQueries({ queryKey: ['playground-runs', run.caseId] });
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
  });

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragRef.current) {
        return;
      }

      const { id, startX, startY, originX, originY } = dragRef.current;
      setDesktopWindows((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          x: Math.max(16, originX + event.clientX - startX),
          y: Math.max(96, originY + event.clientY - startY),
        },
      }));
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
  }, []);

  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }

    const trafficId = searchParams.get('trafficId');
    const conversationId = searchParams.get('conversationId');
    if (trafficId) {
      bootstrappedRef.current = true;
      createFromTrafficMutation.mutate(Number(trafficId));
      return;
    }

    if (conversationId) {
      bootstrappedRef.current = true;
      createFromConversationMutation.mutate(conversationId);
    }
  }, [createFromConversationMutation, createFromTrafficMutation, searchParams]);

  useEffect(() => {
    const currentCase = selectedCaseQuery.data;
    if (!currentCase) {
      return;
    }

    setPromptMode(currentCase.promptModeDefault);
    setPromptId(currentCase.promptId || searchParams.get('promptId'));
    setPromptInput(currentCase.promptInput);
    setProviderConfig(currentCase.providerConfig || DEFAULT_PROVIDER_CONFIG);
    setDraftSystemInstruction(currentCase.promptInput.systemInstruction || '');
    setDraftUserPromptTemplate('');
    setContextVariablesText(stringifyJson(currentCase.promptInput.contextVariables || {}));
    setProviderSpecificText(stringifyJson(currentCase.providerConfig.providerSpecific || {}));
    setSafetyText(stringifyJson(currentCase.providerConfig.safety || []));
    const toolKeys = Object.keys(currentCase.providerConfig.tools || {});
    setExpandedToolKey(toolKeys[0] || null);
    setActiveRunId(null);
  }, [searchParams, selectedCaseQuery.data]);

  const runs = runsQuery.data || [];
  const currentRun = useMemo<PlaygroundRun | null>(() => {
    if (runs.length === 0) {
      return null;
    }
    return runs.find((run) => run.id === activeRunId) || runs[0];
  }, [activeRunId, runs]);

  const toolCall = useMemo(() => inferToolCall(currentRun), [currentRun]);
  const rawProviderPayload = useMemo(() => getRawProviderPayload(currentRun), [currentRun]);

  useEffect(() => {
    if (toolCall) {
      setOutputView('tool');
      return;
    }
    if (currentRun?.outputSnapshot?.responseText || currentRun?.outputSnapshot?.error) {
      setOutputView('text');
      return;
    }
    if (rawProviderPayload) {
      setOutputView('raw');
    }
  }, [currentRun, rawProviderPayload, toolCall]);

  const prompts = promptData || [];
  const comparePromptOptions = prompts.filter((prompt) => prompt.id !== promptId);
  const toolEntries = useMemo(() => {
    const tools = providerConfig.tools || {};
    return Object.entries(tools);
  }, [providerConfig.tools]);

  const currentPromptText =
    promptMode === 'draft' ? draftSystemInstruction : promptInput.systemInstruction;

  const handleDesktopWindowPointerDown = (id: DesktopWindowId) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = desktopWindows[id];
    dragRef.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
    };
  };

  const syncProviderTextFields = (next: PlaygroundProviderConfig) => {
    setProviderConfig(next);
    setProviderSpecificText(stringifyJson(next.providerSpecific || {}));
    setSafetyText(stringifyJson(next.safety || []));
    const keys = Object.keys(next.tools || {});
    setExpandedToolKey((prev) => (prev && keys.includes(prev) ? prev : keys[0] || null));
  };

  const handleSaveCase = () => {
    if (!selectedCaseId) {
      return;
    }

    updateCaseMutation.mutate({
      promptId,
      promptModeDefault: promptMode,
      promptInput: {
        ...promptInput,
        systemInstruction: promptMode === 'draft' ? draftSystemInstruction : promptInput.systemInstruction,
        contextVariables: parseJsonText<Record<string, unknown>>(contextVariablesText, {}),
      },
      providerConfig: {
        ...providerConfig,
        providerSpecific: parseJsonText<Record<string, unknown>>(providerSpecificText, {}),
        safety: parseJsonText<Array<Record<string, unknown>>>(safetyText, []),
      },
    });
  };

  const handleSetBaseline = (run: PlaygroundRun) => {
    if (!selectedCaseId || !run.outputSnapshot?.responseText) {
      return;
    }

    const baseline: PlaygroundBaselineOutput = {
      sourceKind: 'manual',
      responseText: run.outputSnapshot.responseText,
      thinking: run.outputSnapshot.thinking,
      provider: run.outputSnapshot.provider || run.provider || undefined,
      modelName: run.outputSnapshot.modelName || run.modelName || undefined,
      usage: run.outputSnapshot.usage,
      canonicalRequest: run.outputSnapshot.canonicalRequest,
      canonicalResponse: run.outputSnapshot.canonicalResponse,
      wireRequest: run.outputSnapshot.wireRequest,
      wireResponse: run.outputSnapshot.wireResponse,
      rawResponse: run.outputSnapshot.rawResponse,
      metadata: run.outputSnapshot.metadata,
    };

    updateCaseMutation.mutate({
      baselineOutput: baseline,
    });
  };

  const updateToolConfig = (toolKey: string, nextText: string) => {
    setProviderConfig((prev) => ({
      ...prev,
      tools: {
        ...(prev.tools || {}),
        [toolKey]: parseJsonText(nextText, (prev.tools || {})[toolKey] || {}),
      },
    }));
  };

  const setGenerationNumber = (key: string, value: number) => {
    setProviderConfig((prev) => ({
      ...prev,
      generation: {
        ...(prev.generation || {}),
        [key]: value,
      },
    }));
  };

  const primaryUserMessage = getPrimaryUserMessage(promptInput.messages);
  const outputText = currentRun?.outputSnapshot?.responseText || currentRun?.outputSnapshot?.error || '';
  const promptPreview = buildPromptPreview(promptMode, draftSystemInstruction, draftUserPromptTemplate, promptInput);

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Prompt Lab"
        icon={<Beaker className="h-4 w-4" />}
        title="Playground"
        badge={<PageHeaderBadge>Prompt editing first</PageHeaderBadge>}
        description="把 Playground 收成 Prompt 调试台：默认只保留长 Prompt 编辑和输出观察，其余能力通过浮窗或抽屉按需打开。"
        actions={
          <>
            <Button variant="outline" onClick={() => libraryQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={handleSaveCase} disabled={!selectedCaseId || updateCaseMutation.isPending}>
              <Save className="mr-2 h-4 w-4" />
              Save Case
            </Button>
          </>
        }
      />

      <div className="relative overflow-hidden rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,#fffdf8_0%,#f7f2ea_100%)] shadow-[0_24px_80px_-45px_rgba(15,23,42,0.4)]">
        <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Configuration / Playground</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-[1.9rem] font-semibold text-foreground">Prompt Playground</h2>
              <Badge variant="outline">Tool-aware output</Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
              <Database className="mr-2 h-4 w-4" />
              Library
            </Button>
            <Button variant="outline" size="sm" onClick={() => setInputOpen(true)}>
              <Wand2 className="mr-2 h-4 w-4" />
              User Input
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setMobileParamsOpen(true)}
            >
              <Settings2 className="mr-2 h-4 w-4" />
              Params
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden lg:inline-flex"
              onClick={() => setDesktopWindows((prev) => ({ ...prev, params: { ...prev.params, open: !prev.params.open } }))}
            >
              <Settings2 className="mr-2 h-4 w-4" />
              Params
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setMobileCompareOpen(true)}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Compare
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden lg:inline-flex"
              onClick={() => {
                setOutputTab('compare');
                setDesktopWindows((prev) => ({ ...prev, compare: { ...prev.compare, open: !prev.compare.open } }));
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Compare
            </Button>
            <Button onClick={() => runMutation.mutate()} disabled={!selectedCaseId || runMutation.isPending}>
              <Play className="mr-2 h-4 w-4" />
              {runMutation.isPending ? 'Running...' : 'Run'}
            </Button>
          </div>
        </div>

        <div className="grid min-h-[calc(100vh-18rem)] gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)] lg:px-6">
          <section className="grid min-h-0 gap-4 lg:grid-rows-[minmax(0,1fr)_320px]">
            <div className="min-h-0 overflow-hidden rounded-[24px] border border-border/70 bg-white/80 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)]">
              <div className="border-b border-border/70 bg-white/70 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-lg font-semibold text-foreground">
                        {selectedCaseQuery.data?.name || 'Prompt Workspace'}
                      </div>
                      {selectedCaseQuery.data?.caseMode ? <Badge variant="secondary">{selectedCaseQuery.data.caseMode}</Badge> : null}
                      <Badge variant="outline">Prompt editing is primary</Badge>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      默认只保留长 Prompt 编辑。输出、参数和对比都收敛到更轻的工作区路径。
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={promptMode} onValueChange={(value) => setPromptMode(value as PlaygroundPromptMode)}>
                      <SelectTrigger className="h-8 w-[132px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="saved">Saved Prompt</SelectItem>
                        <SelectItem value="draft">Draft Prompt</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={promptId || 'none'} onValueChange={(value) => setPromptId(value === 'none' ? null : value)}>
                      <SelectTrigger className="h-8 w-[220px]">
                        <SelectValue placeholder="选择 Prompt" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">不绑定 Prompt</SelectItem>
                        {prompts.map((prompt) => (
                          <SelectItem key={prompt.id} value={prompt.id}>
                            {prompt.prompt_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <div className="rounded-full border border-border/70 bg-background px-3 py-1.5">
                    Current Prompt: {promptId || 'draft only'}
                  </div>
                  <div className="rounded-full border border-border/70 bg-background px-3 py-1.5">
                    Source: {selectedCaseQuery.data?.source || 'manual'}
                  </div>
                  <div className="rounded-full border border-border/70 bg-background px-3 py-1.5">
                    Model: {String(providerConfig.context?.modelName || prompts.find((item) => item.id === promptId)?.model_name || providerConfig.provider)}
                  </div>
                </div>
              </div>

              <div className="border-b border-border/70 px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={editorView === 'prompt' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setEditorView('prompt')}
                    >
                      Prompt
                    </Button>
                    <Button
                      variant={editorView === 'preview' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setEditorView('preview')}
                    >
                      Rendered Preview
                    </Button>
                  </div>

                  <Badge variant="outline">Long text friendly / full width</Badge>
                </div>
              </div>

              <div className="h-[calc(100%-10.5rem)] min-h-[360px]">
                {editorView === 'prompt' ? (
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
                      <div className="text-sm font-semibold text-foreground">
                        {promptMode === 'draft' ? 'Draft Prompt Editor' : 'System Prompt Editor'}
                      </div>
                      {promptMode === 'draft' ? <Badge variant="secondary">Draft mode</Badge> : <Badge variant="outline">Saved mode</Badge>}
                    </div>
                    <Textarea
                      value={currentPromptText}
                      onChange={(event) => {
                        if (promptMode === 'draft') {
                          setDraftSystemInstruction(event.target.value);
                        } else {
                          setPromptInput((prev) => ({
                            ...prev,
                            systemInstruction: event.target.value,
                          }));
                        }
                      }}
                      className="h-full min-h-0 resize-none border-0 bg-transparent px-5 py-4 font-mono text-sm leading-7 shadow-none focus-visible:ring-0"
                    />
                  </div>
                ) : (
                  <div className="h-full px-5 py-4">
                    <JsonBlock value={promptPreview} className="h-full bg-background/90 text-xs" />
                  </div>
                )}
              </div>
            </div>

            <section className="min-h-0 overflow-hidden rounded-[24px] border border-border/70 bg-white/80 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)]">
              <div className="border-b border-border/70 bg-white/60 px-4 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOutputTab('current')}
                    className={cn(
                      'flex items-center gap-2 rounded-t-2xl border border-border/70 px-3 py-2 text-sm transition',
                      outputTab === 'current' ? 'bg-primary/10 text-foreground' : 'bg-background text-muted-foreground'
                    )}
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted text-[10px]">O</span>
                    Current Output
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutputTab('compare')}
                    className={cn(
                      'flex items-center gap-2 rounded-t-2xl border border-border/70 px-3 py-2 text-sm transition',
                      outputTab === 'compare' ? 'bg-primary/10 text-foreground' : 'bg-background text-muted-foreground'
                    )}
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted text-[10px]">C</span>
                    Compare Nodes
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto hidden lg:inline-flex"
                    onClick={() =>
                      setDesktopWindows((prev) => ({
                        ...prev,
                        compare: { ...prev.compare, open: true },
                      }))
                    }
                  >
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    Undock Compare
                  </Button>
                </div>
              </div>

              {outputTab === 'current' ? (
                <>
                  <div className="border-b border-border/70 bg-background/70 px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button variant={outputView === 'text' ? 'default' : 'outline'} size="sm" onClick={() => setOutputView('text')}>
                        Text Response
                      </Button>
                      <Button variant={outputView === 'tool' ? 'default' : 'outline'} size="sm" onClick={() => setOutputView('tool')}>
                        Tool Call
                      </Button>
                      <Button variant={outputView === 'raw' ? 'default' : 'outline'} size="sm" onClick={() => setOutputView('raw')}>
                        Raw Provider Response
                      </Button>
                    </div>
                  </div>

                  <div className="grid h-[calc(100%-7.5rem)] gap-3 p-4 lg:grid-cols-[1.05fr_0.95fr]">
                    {outputView === 'text' ? (
                      <>
                        <div className="overflow-hidden rounded-[18px] border border-border/70 bg-background">
                          <div className="border-b border-border/70 px-4 py-3">
                            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Text Response</div>
                          </div>
                          <div className="h-[calc(100%-3rem)] overflow-auto px-4 py-3">
                            {outputText ? (
                              <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">{outputText}</div>
                            ) : (
                              <EmptyState title="No text output yet" description="先运行当前 Prompt，或者切到 Tool Call / Raw Provider Response 看其他结果。" />
                            )}
                          </div>
                        </div>

                        <div className="overflow-hidden rounded-[18px] border border-border/70 bg-background">
                          <div className="border-b border-border/70 px-4 py-3">
                            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Run Summary</div>
                          </div>
                          <div className="space-y-3 p-4 text-sm">
                            <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status</div>
                              <div className="mt-2 font-medium text-foreground">{currentRun?.status || 'idle'}</div>
                            </div>
                            <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Executed At</div>
                              <div className="mt-2 font-medium text-foreground">
                                {currentRun ? formatTimestamp(currentRun.createdAt) : '-'}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Actions</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!currentRun}
                                  onClick={() => currentRun && cloneRunMutation.mutate(currentRun.id)}
                                >
                                  Clone Run
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!currentRun}
                                  onClick={() => currentRun && handleSetBaseline(currentRun)}
                                >
                                  Set Baseline
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : null}

                    {outputView === 'tool' ? (
                      <>
                        <div className="overflow-hidden rounded-[18px] border border-border/70 bg-background">
                          <div className="border-b border-border/70 px-4 py-3">
                            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Tool / Function Call</div>
                          </div>
                          <div className="h-[calc(100%-3rem)] overflow-auto p-4">
                            {toolCall ? (
                              <div className="space-y-3 text-sm">
                                <div className="grid grid-cols-[120px_1fr] gap-2">
                                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Tool</div>
                                  <div className="font-medium text-foreground">{toolCall.name}</div>
                                </div>
                                <div className="grid grid-cols-[120px_1fr] gap-2">
                                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Status</div>
                                  <div className="font-medium text-foreground">{toolCall.status || currentRun?.status || '-'}</div>
                                </div>
                                <div className="grid grid-cols-[120px_1fr] gap-2">
                                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Provider</div>
                                  <div className="font-medium text-foreground">
                                    {toolCall.provider || currentRun?.provider || '-'}
                                    {toolCall.modelName ? ` / ${toolCall.modelName}` : ''}
                                  </div>
                                </div>
                                <div>
                                  <div className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Arguments</div>
                                  <JsonBlock value={toolCall.arguments ?? {}} />
                                </div>
                              </div>
                            ) : (
                              <EmptyState title="No tool call inferred" description="如果当前 run 是纯文本输出，这里会为空。存在 function/tool 调用时，会优先展示结构化调用卡片。" />
                            )}
                          </div>
                        </div>

                        <div className="overflow-hidden rounded-[18px] border border-border/70 bg-background">
                          <div className="border-b border-border/70 px-4 py-3">
                            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Tool Result Summary</div>
                          </div>
                          <div className="h-[calc(100%-3rem)] overflow-auto p-4">
                            {toolCall ? (
                              <div className="space-y-3">
                                <JsonBlock value={toolCall.result ?? toolCall.raw ?? {}} />
                                {outputText ? (
                                  <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
                                    <div className="mb-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Assistant Interpretation</div>
                                    <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">{outputText}</div>
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <EmptyState title="No tool result yet" description="没有可归一的 tool result 时，会退回到 Raw Provider Response 查看原始结构。" />
                            )}
                          </div>
                        </div>
                      </>
                    ) : null}

                    {outputView === 'raw' ? (
                      <>
                        <div className="overflow-hidden rounded-[18px] border border-border/70 bg-background lg:col-span-2">
                          <div className="border-b border-border/70 px-4 py-3">
                            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Raw Provider Response</div>
                          </div>
                          <div className="h-[calc(100%-3rem)] overflow-auto p-4">
                            {rawProviderPayload ? (
                              <JsonBlock value={rawProviderPayload} className="h-full min-h-[220px]" />
                            ) : (
                              <EmptyState title="No raw payload available" description="当前 run 没有可展示的 provider 原始结果，先运行一次或者切回 Text Response / Tool Call。" />
                            )}
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="grid h-[calc(100%-3.5rem)] gap-3 p-4 lg:grid-cols-[0.92fr_1.08fr]">
                  <div className="overflow-hidden rounded-[18px] border border-border/70 bg-background">
                    <div className="border-b border-border/70 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Compare Nodes</div>
                    </div>
                    <div className="h-[calc(100%-3rem)] overflow-auto p-4">
                      <div className="mb-4 text-sm text-muted-foreground">
                        选择 1 到 3 个预存 Prompt，作为后续同 input 横向对比的候选节点。
                      </div>
                      <div className="space-y-2">
                        {comparePromptOptions.slice(0, 8).map((prompt) => {
                          const checked = comparePromptIds.includes(prompt.id);
                          return (
                            <label
                              key={prompt.id}
                              className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 transition',
                                checked ? 'border-primary/30 bg-primary/10' : 'border-border/70 bg-background'
                              )}
                            >
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-border"
                                checked={checked}
                                onChange={(event) => {
                                  setComparePromptIds((prev) => {
                                    if (event.target.checked) {
                                      return [...prev, prompt.id].slice(0, 3);
                                    }
                                    return prev.filter((item) => item !== prompt.id);
                                  });
                                }}
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{prompt.prompt_name}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {prompt.model_name || 'model auto'}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[18px] border border-border/70 bg-background">
                    <div className="border-b border-border/70 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Run History / Existing Signals</div>
                    </div>
                    <div className="h-[calc(100%-3rem)] overflow-auto p-4">
                      {runs.length > 0 ? (
                        <div className="space-y-3">
                          {runs.map((run) => (
                            <button
                              key={run.id}
                              type="button"
                              onClick={() => {
                                setActiveRunId(run.id);
                                setOutputTab('current');
                              }}
                              className={cn(
                                'w-full rounded-2xl border px-4 py-3 text-left transition',
                                currentRun?.id === run.id
                                  ? 'border-primary/30 bg-primary/10'
                                  : 'border-border/70 bg-background hover:border-primary/20'
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-foreground">{run.modelName || run.provider || 'Run'}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(run.createdAt)}</div>
                                </div>
                                <div className="flex gap-2">
                                  <Badge variant={run.status === 'completed' ? 'default' : 'destructive'}>{run.status}</Badge>
                                  {typeof run.comparisonSnapshot?.similarity === 'number' ? (
                                    <Badge variant="outline">{run.comparisonSnapshot.similarity}%</Badge>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <EmptyState title="No compare signals yet" description="当前还没有 run，可以先运行当前 Prompt，再决定要不要拖出 Compare Nodes 做横向比较。" />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </section>
        </div>

        <FloatingPanel
          title="Params & Tools"
          badge="Desktop floating"
          state={desktopWindows.params}
          onClose={() => setDesktopWindows((prev) => ({ ...prev, params: { ...prev.params, open: false } }))}
          onPointerDown={handleDesktopWindowPointerDown('params')}
          className={cn('h-[640px] w-[360px]', !desktopWindows.params.open && 'hidden')}
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Settings2 className="h-4 w-4 text-primary" />
                Common Params
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <span>Temperature</span>
                    <span>{String(providerConfig.generation.temperature ?? 0.7)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={Number(providerConfig.generation.temperature ?? 0.7)}
                    onChange={(event) => setGenerationNumber('temperature', Number(event.target.value))}
                    className="w-full accent-[hsl(var(--info))]"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <span>Top P</span>
                    <span>{String(providerConfig.generation.topP ?? 0.95)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={Number(providerConfig.generation.topP ?? 0.95)}
                    onChange={(event) => setGenerationNumber('topP', Number(event.target.value))}
                    className="w-full accent-[hsl(var(--info))]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Max Tokens</Label>
                    <Input
                      value={String(providerConfig.generation.maxOutputTokens ?? 2048)}
                      onChange={(event) => setGenerationNumber('maxOutputTokens', Number(event.target.value || 0))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Model Provider</Label>
                    <Select
                      value={providerConfig.provider}
                      onValueChange={(value) =>
                        syncProviderTextFields({
                          ...providerConfig,
                          provider: value as PlaygroundProviderConfig['provider'],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="google-gemini-cli">Google Gemini CLI</SelectItem>
                        <SelectItem value="google-legacy">Google Legacy API</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="codex">Codex</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Provider Specific</Label>
                  <Textarea
                    value={providerSpecificText}
                    onChange={(event) => {
                      setProviderSpecificText(event.target.value);
                      setProviderConfig((prev) => ({
                        ...prev,
                        providerSpecific: parseJsonText<Record<string, unknown>>(event.target.value, {}),
                      }));
                    }}
                    className="min-h-[96px] bg-background font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileJson2 className="h-4 w-4 text-primary" />
                Tools
              </div>

              {toolEntries.length > 0 ? (
                <div className="space-y-2">
                  {toolEntries.map(([toolKey, toolValue]) => {
                    const isExpanded = expandedToolKey === toolKey;
                    return (
                      <div key={toolKey} className="overflow-hidden rounded-2xl border border-border/70 bg-background">
                        <button
                          type="button"
                          className={cn(
                            'flex w-full items-center justify-between px-3 py-3 text-left text-sm font-medium transition',
                            isExpanded ? 'bg-primary/10' : 'bg-background hover:bg-muted/40'
                          )}
                          onClick={() => setExpandedToolKey((prev) => (prev === toolKey ? null : toolKey))}
                        >
                          <span>tool / {toolKey}</span>
                          <span className="text-xs text-muted-foreground">{isExpanded ? '展开编辑' : '点击展开'}</span>
                        </button>
                        {isExpanded ? (
                          <div className="border-t border-border/70 p-3">
                            <Textarea
                              value={stringifyJson(toolValue)}
                              onChange={(event) => updateToolConfig(toolKey, event.target.value)}
                              className="min-h-[140px] bg-background font-mono text-xs"
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title="No tools configured" description="当前 provider 配置里还没有 tools，后续可以在这里逐项编辑工具 JSON。" />
              )}
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="mb-3 text-sm font-semibold text-foreground">Auxiliary JSON</div>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Safety</Label>
                  <Textarea
                    value={safetyText}
                    onChange={(event) => {
                      setSafetyText(event.target.value);
                      setProviderConfig((prev) => ({
                        ...prev,
                        safety: parseJsonText<Array<Record<string, unknown>>>(event.target.value, []),
                      }));
                    }}
                    className="min-h-[84px] bg-background font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </FloatingPanel>

        <FloatingPanel
          title="Compare Nodes"
          badge="Undocked"
          state={desktopWindows.compare}
          onClose={() => setDesktopWindows((prev) => ({ ...prev, compare: { ...prev.compare, open: false } }))}
          onPointerDown={handleDesktopWindowPointerDown('compare')}
          className={cn('h-[360px] w-[320px]', !desktopWindows.compare.open && 'hidden')}
        >
          <div className="space-y-2">
            <div className="rounded-2xl border border-border/70 bg-muted/15 px-3 py-3 text-sm text-muted-foreground">
              这里是停靠在底部标签之外的 Compare Nodes 浮窗版本。默认仍然建议停靠使用，只有需要并排查看时再拖出。
            </div>
            {comparePromptOptions.slice(0, 6).map((prompt) => {
              const checked = comparePromptIds.includes(prompt.id);
              return (
                <label
                  key={prompt.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 transition',
                    checked ? 'border-primary/30 bg-primary/10' : 'border-border/70 bg-background'
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-border"
                    checked={checked}
                    onChange={(event) => {
                      setComparePromptIds((prev) => {
                        if (event.target.checked) {
                          return [...prev, prompt.id].slice(0, 3);
                        }
                        return prev.filter((item) => item !== prompt.id);
                      });
                    }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{prompt.prompt_name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{prompt.model_name || 'model auto'}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </FloatingPanel>
      </div>

      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent side="left" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Library</SheetTitle>
            <SheetDescription>Traffic 样本、已保存 Cases 和近期 Runs。</SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex-1 overflow-hidden">
            <SampleLibraryPanel
              library={libraryQuery.data}
              selectedCaseId={selectedCaseId}
              search={librarySearch}
              onSearchChange={setLibrarySearch}
              onCreateFromTraffic={(trafficId) => createFromTrafficMutation.mutate(trafficId)}
              onSelectCase={(caseId) => {
                setSelectedCaseId(caseId);
                setLibraryOpen(false);
              }}
              onCloneRun={(runId) => cloneRunMutation.mutate(runId)}
              isCreatingCase={createFromTrafficMutation.isPending}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={inputOpen} onOpenChange={setInputOpen}>
        <SheetContent side="right" className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>User Input</SheetTitle>
            <SheetDescription>默认不占主画布。这里只编辑消息输入和上下文变量。</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-2xl border border-border/70 bg-background p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-foreground">Primary User Input</div>
                <Badge variant="outline">{primaryUserMessage.length} chars</Badge>
              </div>

              <div className="space-y-3">
                {promptInput.messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className="rounded-2xl border border-border/70 bg-muted/15 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge variant={message.role === 'assistant' ? 'secondary' : 'outline'}>{message.role}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setPromptInput((prev) => ({
                            ...prev,
                            messages: prev.messages.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    <Textarea
                      value={message.content}
                      onChange={(event) =>
                        setPromptInput((prev) => ({
                          ...prev,
                          messages: prev.messages.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, content: event.target.value } : item
                          ),
                        }))
                      }
                      className="min-h-[120px] bg-background text-sm"
                    />
                  </div>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() =>
                  setPromptInput((prev) => ({
                    ...prev,
                    messages: [...prev.messages, { role: 'user', content: '' }],
                  }))
                }
              >
                Add Message
              </Button>
            </div>

            {promptMode === 'draft' ? (
              <div className="rounded-2xl border border-border/70 bg-background p-4">
                <div className="mb-3 text-sm font-semibold text-foreground">Draft User Template</div>
                <Textarea
                  value={draftUserPromptTemplate}
                  onChange={(event) => setDraftUserPromptTemplate(event.target.value)}
                  className="min-h-[140px] bg-background font-mono text-xs"
                />
              </div>
            ) : null}

            <div className="rounded-2xl border border-border/70 bg-background p-4">
              <div className="mb-3 text-sm font-semibold text-foreground">Context Variables</div>
              <Textarea
                value={contextVariablesText}
                onChange={(event) => {
                  setContextVariablesText(event.target.value);
                  setPromptInput((prev) => ({
                    ...prev,
                    contextVariables: parseJsonText<Record<string, unknown>>(event.target.value, {}),
                  }));
                }}
                className="min-h-[140px] bg-background font-mono text-xs"
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={mobileParamsOpen} onOpenChange={setMobileParamsOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Params & Tools</SheetTitle>
            <SheetDescription>移动端降级为抽屉，桌面端使用浮窗。</SheetDescription>
          </SheetHeader>
          <div className="mt-4 overflow-y-auto pr-1">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-background p-4">
                <div className="mb-3 text-sm font-semibold text-foreground">Common Params</div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Temperature</Label>
                    <Input
                      value={String(providerConfig.generation.temperature ?? 0.7)}
                      onChange={(event) => setGenerationNumber('temperature', Number(event.target.value || 0))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Top P</Label>
                    <Input
                      value={String(providerConfig.generation.topP ?? 0.95)}
                      onChange={(event) => setGenerationNumber('topP', Number(event.target.value || 0))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Tokens</Label>
                    <Input
                      value={String(providerConfig.generation.maxOutputTokens ?? 2048)}
                      onChange={(event) => setGenerationNumber('maxOutputTokens', Number(event.target.value || 0))}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background p-4">
                <div className="mb-3 text-sm font-semibold text-foreground">Tools</div>
                <div className="space-y-2">
                  {toolEntries.map(([toolKey, toolValue]) => {
                    const isExpanded = expandedToolKey === toolKey;
                    return (
                      <div key={toolKey} className="overflow-hidden rounded-2xl border border-border/70">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-medium"
                          onClick={() => setExpandedToolKey((prev) => (prev === toolKey ? null : toolKey))}
                        >
                          <span>tool / {toolKey}</span>
                          <span className="text-xs text-muted-foreground">{isExpanded ? '展开编辑' : '点击展开'}</span>
                        </button>
                        {isExpanded ? (
                          <div className="border-t border-border/70 p-3">
                            <Textarea
                              value={stringifyJson(toolValue)}
                              onChange={(event) => updateToolConfig(toolKey, event.target.value)}
                              className="min-h-[140px] bg-background font-mono text-xs"
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={mobileCompareOpen} onOpenChange={setMobileCompareOpen}>
        <SheetContent side="bottom" className="max-h-[85vh]">
          <SheetHeader>
            <SheetTitle>Compare Nodes</SheetTitle>
            <SheetDescription>移动端里作为底部抽屉查看和选择对比候选。</SheetDescription>
          </SheetHeader>
          <div className="mt-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              {comparePromptOptions.slice(0, 8).map((prompt) => {
                const checked = comparePromptIds.includes(prompt.id);
                return (
                  <label
                    key={prompt.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 transition',
                      checked ? 'border-primary/30 bg-primary/10' : 'border-border/70 bg-background'
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-border"
                      checked={checked}
                      onChange={(event) => {
                        setComparePromptIds((prev) => {
                          if (event.target.checked) {
                            return [...prev, prompt.id].slice(0, 3);
                          }
                          return prev.filter((item) => item !== prompt.id);
                        });
                      }}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{prompt.prompt_name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{prompt.model_name || 'model auto'}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
