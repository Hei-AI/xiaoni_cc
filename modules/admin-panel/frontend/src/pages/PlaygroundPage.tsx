import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { SampleLibraryPanel } from '@/components/SampleLibraryPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
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
  Database,
  FileJson2,
  Move,
  Play,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  AlertCircle,
  Wand2,
  X,
} from 'lucide-react';

type PromptSummary = {
  id: string;
  prompt_name: string;
  model_name?: string | null;
};

type OutputView = 'text' | 'tool' | 'raw';
type DesktopWindowMode = 'docked' | 'floating';
type DesktopWindowId = 'params' | 'compare';

type DesktopWindowState = {
  mode: DesktopWindowMode;
  collapsed: boolean;
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

type ToolEditorEntry = {
  key: string;
  label: string;
  value: unknown;
  onChange: (nextText: string) => void;
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

function getToolDefinitionName(value: unknown, index: number): string {
  const record = asRecord(value);
  const functionRecord = asRecord(record?.function);

  const candidates = [
    functionRecord?.name,
    record?.name,
    record?.toolName,
    record?.id,
  ];

  const name = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  return typeof name === 'string' ? name : `#${index + 1}`;
}

function getToolEditorKeys(tools: Record<string, unknown> | undefined): string[] {
  return Object.entries(tools || {}).flatMap(([toolKey, toolValue]) => {
    if (toolKey === 'definitions' && Array.isArray(toolValue)) {
      return toolValue.map((_, index) => `definitions:${index}`);
    }

    return [toolKey];
  });
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
  x,
  y,
  onClose,
  onPointerDown,
  children,
  className,
}: {
  title: string;
  x: number;
  y: number;
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
      style={{ left: x, top: y }}
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-border/80 bg-background/90 px-4 py-3"
        onPointerDown={onPointerDown}
      >
        <div className="flex items-center gap-2">
          <Move className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-sm font-semibold text-foreground">{title}</div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}

function DockedPanel({
  title,
  onClose,
  onPopOut,
  onPointerDown,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  onPopOut: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'absolute inset-y-3 right-0 z-20 hidden overflow-hidden rounded-l-[28px] border border-border/80 border-r-0 bg-background/98 shadow-[-18px_0_48px_-32px_rgba(15,23,42,0.18)] backdrop-blur lg:flex lg:flex-col',
        className
      )}
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-border/80 bg-background px-4 py-3"
        onPointerDown={onPointerDown}
      >
        <div className="flex items-center gap-2">
          <Move className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-sm font-semibold text-foreground">{title}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onPopOut}>
            Pop out
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}

function DockHandle({
  title,
  onClick,
  className,
}: {
  title: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'absolute right-0 z-10 hidden h-24 w-8 items-center justify-center rounded-l-xl border border-border/80 border-r-0 bg-[#fbf7f0]/98 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 shadow-[-12px_0_24px_-24px_rgba(15,23,42,0.45)] backdrop-blur transition hover:bg-primary/10 hover:text-foreground lg:flex',
        className
      )}
      style={{ writingMode: 'vertical-rl' }}
    >
      {title}
    </button>
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

const DESKTOP_WINDOW_MAX_WIDTH: Record<DesktopWindowId, number> = {
  params: 340,
  compare: 300,
};

const DEFAULT_DESKTOP_WINDOWS: Record<DesktopWindowId, DesktopWindowState> = {
  params: { mode: 'docked', collapsed: true, x: 840, y: 144 },
  compare: { mode: 'docked', collapsed: true, x: 900, y: 220 },
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
  const [outputView, setOutputView] = useState<OutputView>('text');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryActionError, setLibraryActionError] = useState<string | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [mobileParamsOpen, setMobileParamsOpen] = useState(false);
  const [mobileCompareOpen, setMobileCompareOpen] = useState(false);
  const [desktopWindows, setDesktopWindows] = useState(DEFAULT_DESKTOP_WINDOWS);
  const [comparePromptIds, setComparePromptIds] = useState<string[]>([]);
  const [expandedToolKey, setExpandedToolKey] = useState<string | null>(null);
  const [editorView, setEditorView] = useState<'prompt' | 'preview'>('prompt');
  const [editorEmptyStateDismissed, setEditorEmptyStateDismissed] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
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
    onMutate: () => {
      setLibraryActionError(null);
    },
    onSuccess: (record) => {
      setSelectedCaseId(record.id);
      setLibraryOpen(false);
      setLibraryActionError(null);
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
    onError: (error) => {
      setLibraryActionError(error instanceof Error ? error.message : '无法从该 traffic sample 创建 Playground Case');
    },
  });

  const createFromConversationMutation = useMutation({
    mutationFn: (conversationId: string) => createCaseFromConversation(conversationId, promptId),
    onMutate: () => {
      setLibraryActionError(null);
    },
    onSuccess: (record) => {
      setSelectedCaseId(record.id);
      setLibraryOpen(false);
      setLibraryActionError(null);
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
    onError: (error) => {
      setLibraryActionError(error instanceof Error ? error.message : '无法从该 conversation 创建 Playground Case');
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
      queryClient.invalidateQueries({ queryKey: ['playground-runs', selectedCaseId] });
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
  });

  const cloneRunMutation = useMutation({
    mutationFn: (runId: string) => clonePlaygroundRun(runId),
    onMutate: () => {
      setLibraryActionError(null);
    },
    onSuccess: (run) => {
      setSelectedCaseId(run.caseId);
      setActiveRunId(run.id);
      setLibraryActionError(null);
      queryClient.invalidateQueries({ queryKey: ['playground-runs', run.caseId] });
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
    onError: (error) => {
      setLibraryActionError(error instanceof Error ? error.message : '无法克隆该 Playground Run');
    },
  });

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

    const caseId = searchParams.get('caseId');
    const trafficId = searchParams.get('trafficId');
    const conversationId = searchParams.get('conversationId');
    if (caseId) {
      bootstrappedRef.current = true;
      setSelectedCaseId(caseId);
      return;
    }

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
    const toolKeys = getToolEditorKeys(currentCase.providerConfig.tools);
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
  const baselineSnapshot = selectedCaseQuery.data?.baselineSnapshot || null;
  const currentExecutionMode = currentRun?.executionMode
    || (selectedCaseQuery.data?.source === 'span' ? 'exact_replay' : null);

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
  const getDesktopWindowWidth = (id: DesktopWindowId) =>
    Math.min(DESKTOP_WINDOW_MAX_WIDTH[id], Math.max(id === 'params' ? 280 : 260, viewportWidth - 104));
  const activeDockedWindowId = useMemo(
    () =>
      (Object.entries(desktopWindows).find(([, windowState]) => windowState.mode === 'docked' && !windowState.collapsed)?.[0] ??
        null) as DesktopWindowId | null,
    [desktopWindows]
  );
  const dockedPanelOffset = activeDockedWindowId ? getDesktopWindowWidth(activeDockedWindowId) + 12 : 0;

  const currentPromptText =
    promptMode === 'draft' ? draftSystemInstruction : promptInput.systemInstruction;
  const showEditorEmptyState = editorView === 'prompt' && !selectedCaseId && !currentPromptText.trim() && !editorEmptyStateDismissed;
  const libraryErrorMessage =
    libraryActionError || (libraryQuery.error instanceof Error ? libraryQuery.error.message : null);

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

  const openDockedWindow = (id: DesktopWindowId) => {
    setDesktopWindows((prev) => ({
      params:
        id === 'params'
          ? { ...prev.params, mode: 'docked', collapsed: false }
          : prev.params.mode === 'docked'
            ? { ...prev.params, collapsed: true }
            : prev.params,
      compare:
        id === 'compare'
          ? { ...prev.compare, mode: 'docked', collapsed: false }
          : prev.compare.mode === 'docked'
            ? { ...prev.compare, collapsed: true }
            : prev.compare,
    }));
  };

  const collapseWindow = (id: DesktopWindowId) => {
    setDesktopWindows((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        mode: 'docked',
        collapsed: true,
      },
    }));
  };

  const toggleDockedWindow = (id: DesktopWindowId) => {
    const current = desktopWindows[id];
    if (current.mode === 'docked' && !current.collapsed) {
      collapseWindow(id);
      return;
    }

    openDockedWindow(id);
  };

  const popOutWindow = (id: DesktopWindowId) => {
    setDesktopWindows((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        mode: 'floating',
        collapsed: false,
      },
    }));
  };

  const startDockedWindowDrag = (id: DesktopWindowId) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const width = getDesktopWindowWidth(id);
    const x = Math.max(24, window.innerWidth - width - 72);
    const y = id === 'params' ? 140 : 220;
    dragRef.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      originX: x,
      originY: y,
    };
    setDesktopWindows((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        mode: 'floating',
        collapsed: false,
        x,
        y,
      },
    }));
  };

  const syncProviderTextFields = (next: PlaygroundProviderConfig) => {
    setProviderConfig(next);
    setProviderSpecificText(stringifyJson(next.providerSpecific || {}));
    setSafetyText(stringifyJson(next.safety || []));
    const keys = getToolEditorKeys(next.tools);
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

  const updateToolDefinition = (definitionIndex: number, nextText: string) => {
    setProviderConfig((prev) => {
      const tools = prev.tools || {};
      const definitions = Array.isArray(tools.definitions) ? tools.definitions : [];
      const nextDefinitions = definitions.map((definition, index) =>
        index === definitionIndex ? parseJsonText(nextText, definition) : definition
      );

      return {
        ...prev,
        tools: {
          ...tools,
          definitions: nextDefinitions,
        },
      };
    });
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
  const toolEditorEntries = useMemo<ToolEditorEntry[]>(() => {
    const tools = providerConfig.tools || {};

    return Object.entries(tools).flatMap(([toolKey, toolValue]) => {
      if (toolKey === 'definitions' && Array.isArray(toolValue)) {
        return toolValue.map((definition, index) => ({
          key: `definitions:${index}`,
          label: `tool / definitions / ${getToolDefinitionName(definition, index)}`,
          value: definition,
          onChange: (nextText: string) => updateToolDefinition(index, nextText),
        }));
      }

      return [{
        key: toolKey,
        label: `tool / ${toolKey}`,
        value: toolValue,
        onChange: (nextText: string) => updateToolConfig(toolKey, nextText),
      }];
    });
  }, [providerConfig.tools]);

  useEffect(() => {
    if (selectedCaseId || currentPromptText.trim()) {
      setEditorEmptyStateDismissed(false);
    }
  }, [currentPromptText, selectedCaseId]);

  const paramsPanelContent = (
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

        {toolEditorEntries.length > 0 ? (
          <div className="space-y-2">
            {toolEditorEntries.map((entry) => {
              const isExpanded = expandedToolKey === entry.key;
              return (
                <div key={entry.key} className="overflow-hidden rounded-2xl border border-border/70 bg-background">
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-3 text-left text-sm font-medium transition',
                      isExpanded ? 'bg-primary/10' : 'bg-background hover:bg-muted/40'
                    )}
                    onClick={() => setExpandedToolKey((prev) => (prev === entry.key ? null : entry.key))}
                  >
                    <span>{entry.label}</span>
                    <span className="text-xs text-muted-foreground">{isExpanded ? '展开编辑' : '点击展开'}</span>
                  </button>
                  {isExpanded ? (
                    <div className="border-t border-border/70 p-3">
                      <Textarea
                        value={stringifyJson(entry.value)}
                        onChange={(event) => entry.onChange(event.target.value)}
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
  );
  const comparePanelContent = (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-muted/15 px-4 py-3 text-sm text-muted-foreground">
        选择 1 到 3 个预存 Prompt，作为后续同 input 横向对比的候选节点。
      </div>
      <div className="rounded-2xl border border-border/70 bg-background p-3">
        <div className="mb-3 flex items-center justify-between text-sm font-semibold text-foreground">
          <span>Prompt Candidates</span>
          <Badge variant="outline">{comparePromptIds.length} / 3</Badge>
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
                  <div className="mt-1 text-xs text-muted-foreground">{prompt.model_name || 'model auto'}</div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
      <div className="rounded-2xl border border-border/70 bg-background p-3">
        <div className="mb-3 text-sm font-semibold text-foreground">Run History</div>
        {runs.length > 0 ? (
          <div className="space-y-3">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setActiveRunId(run.id)}
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
          <EmptyState title="No compare signals yet" description="先运行当前 Prompt，再决定要不要展开 Compare Nodes 做横向比较。" />
        )}
      </div>
    </div>
  );

  return (
    <PageShell>
      <div className="relative overflow-hidden rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,#fffdf8_0%,#f7f2ea_100%)] shadow-[0_24px_80px_-45px_rgba(15,23,42,0.4)]">
        <div className="border-b border-border/70 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[1.5rem] font-semibold text-foreground">Prompt Workspace</h2>
                {selectedCaseQuery.data?.caseMode ? <Badge variant="secondary">{selectedCaseQuery.data.caseMode}</Badge> : null}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                编辑当前 Prompt，并观察本次运行输出。
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => libraryQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleSaveCase} disabled={!selectedCaseId || updateCaseMutation.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save Case
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
                <Database className="mr-2 h-4 w-4" />
                Library
              </Button>
              <Button variant="outline" size="sm" onClick={() => setInputOpen(true)}>
                <Wand2 className="mr-2 h-4 w-4" />
                User Input
              </Button>
              <Button
                variant={desktopWindows.params.mode === 'docked' && !desktopWindows.params.collapsed ? 'default' : 'outline'}
                size="sm"
                className="lg:hidden"
                onClick={() => setMobileParamsOpen(true)}
              >
                <Settings2 className="mr-2 h-4 w-4" />
                Params
              </Button>
              <Button
                variant={desktopWindows.params.mode !== 'docked' || !desktopWindows.params.collapsed ? 'default' : 'outline'}
                size="sm"
                className="hidden lg:inline-flex"
                onClick={() => toggleDockedWindow('params')}
              >
                <Settings2 className="mr-2 h-4 w-4" />
                Params
              </Button>
              <Button
                variant={desktopWindows.compare.mode === 'docked' && !desktopWindows.compare.collapsed ? 'default' : 'outline'}
                size="sm"
                className="lg:hidden"
                onClick={() => setMobileCompareOpen(true)}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Compare
              </Button>
              <Button
                variant={desktopWindows.compare.mode !== 'docked' || !desktopWindows.compare.collapsed ? 'default' : 'outline'}
                size="sm"
                className="hidden lg:inline-flex"
                onClick={() => toggleDockedWindow('compare')}
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

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Select value={promptMode} onValueChange={(value) => setPromptMode(value as PlaygroundPromptMode)}>
              <SelectTrigger className="h-9 w-[min(100%,180px)] bg-background sm:w-[clamp(150px,14vw,196px)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="saved">Saved Prompt</SelectItem>
                <SelectItem value="draft">Draft Prompt</SelectItem>
              </SelectContent>
            </Select>

            <Select value={promptId || 'none'} onValueChange={(value) => setPromptId(value === 'none' ? null : value)}>
              <SelectTrigger className="h-9 w-[min(100%,320px)] bg-background sm:w-[clamp(220px,24vw,320px)]">
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

            <div className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs text-muted-foreground">
              Current Prompt: {promptId || 'draft only'}
            </div>
            <div className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs text-muted-foreground">
              Source: {selectedCaseQuery.data?.source || 'manual'}
            </div>
            <div className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs text-muted-foreground">
              Model: {String(providerConfig.context?.modelName || prompts.find((item) => item.id === promptId)?.model_name || providerConfig.provider)}
            </div>
          </div>

          {selectedCaseQuery.data?.source === 'span' && baselineSnapshot ? (
            <div className="mt-4 rounded-2xl border border-[hsl(var(--info))]/20 bg-[hsl(var(--info))]/5 px-4 py-3 text-xs leading-6 text-foreground/85">
              <div className="font-medium text-foreground">Span Baseline</div>
              <div className="mt-1">
                当前 Playground 基线来自真实 generation span。未修改时会做 exact replay；修改 prompt、tools 或参数后会切到 patched replay。
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                {baselineSnapshot.traceId ? <span className="rounded-full border border-border/70 bg-background px-2 py-0.5">trace: {baselineSnapshot.traceId}</span> : null}
                {baselineSnapshot.spanId ? <span className="rounded-full border border-border/70 bg-background px-2 py-0.5">span: {baselineSnapshot.spanId}</span> : null}
                {baselineSnapshot.llmCallId ? <span className="rounded-full border border-border/70 bg-background px-2 py-0.5">llm_call: {baselineSnapshot.llmCallId}</span> : null}
                {currentExecutionMode ? <span className="rounded-full border border-border/70 bg-background px-2 py-0.5">mode: {currentExecutionMode}</span> : null}
              </div>
            </div>
          ) : null}
        </div>

        <div
          className="grid min-h-0 gap-4 px-3 py-3 sm:px-4 sm:py-4 lg:grid-cols-[minmax(0,1fr)] lg:px-5"
          style={{ paddingRight: dockedPanelOffset ? `${dockedPanelOffset + 12}px` : undefined }}
        >
          <section className="flex min-h-0 flex-col gap-4">
            <div className="flex min-h-[clamp(320px,52vh,680px)] flex-col overflow-hidden rounded-[24px] border border-border/70 bg-white/80 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)]">
              <div className="border-b border-border/70 px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-medium text-foreground">
                      {selectedCaseQuery.data?.name || 'Draft Prompt'}
                    </div>
                    {selectedCaseQuery.data?.caseMode ? <Badge variant="secondary">{selectedCaseQuery.data.caseMode}</Badge> : null}
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

                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Full-width editor</Badge>
                    {promptMode === 'draft' ? <Badge variant="secondary">Draft mode</Badge> : <Badge variant="outline">Saved mode</Badge>}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                {editorView === 'prompt' ? (
                  <div className="flex h-full flex-col">
                    {showEditorEmptyState ? (
                      <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(248,103,34,0.07),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.78),rgba(255,253,248,0.92))] px-6 py-6">
                        <div className="grid w-full max-w-5xl gap-4 xl:grid-cols-2">
                          <div className="rounded-[28px] border border-border/80 bg-white/90 p-6 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.28)]">
                            <div className="text-sm font-semibold text-foreground">从样本开始</div>
                            <div className="mt-2 text-sm leading-6 text-muted-foreground">
                              先从真实流量或历史会话生成 Case，参数、输出、对比面板都会立即有上下文，不会再出现一整块无意义白板。
                            </div>
                            <div className="mt-5">
                              <Button onClick={() => setLibraryOpen(true)}>
                                <Database className="mr-2 h-4 w-4" />
                                Open Library
                              </Button>
                            </div>
                          </div>

                          <div className="rounded-[28px] border border-dashed border-border/80 bg-white/75 p-6">
                            <div className="text-sm font-semibold text-foreground">直接写 Draft</div>
                            <div className="mt-2 text-sm leading-6 text-muted-foreground">
                              如果你只是想起草 Prompt，也可以直接进入编辑器。这个入口只在空态出现，避免宽屏下整块区域看起来像布局坏掉。
                            </div>
                            <div className="mt-5 flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setPromptMode('draft');
                                  setEditorEmptyStateDismissed(true);
                                }}
                              >
                                Start Writing
                              </Button>
                              <Button variant="ghost" onClick={() => setInputOpen(true)}>
                                <Wand2 className="mr-2 h-4 w-4" />
                                User Input
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
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
                        placeholder="从 Library 选择一个样本 Case，或者直接在这里输入 Draft Prompt。"
                        className="h-full min-h-0 resize-none border-0 bg-transparent px-5 py-4 font-mono text-sm leading-7 shadow-none focus-visible:ring-0"
                      />
                    )}
                  </div>
                ) : (
                  <div className="h-full px-5 py-4">
                    <JsonBlock value={promptPreview} className="h-full bg-background/90 text-xs" />
                  </div>
                )}
              </div>
            </div>

            <section className="flex min-h-[clamp(240px,30vh,360px)] flex-col overflow-hidden rounded-[24px] border border-border/70 bg-white/80 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)]">
              <div className="border-b border-border/70 bg-white/60 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Current Output</div>
                    <div className="mt-1 text-xs text-muted-foreground">文本、工具调用和原始响应在这里切换查看。</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant={outputView === 'text' ? 'default' : 'outline'} size="sm" onClick={() => setOutputView('text')}>
                      Text
                    </Button>
                    <Button variant={outputView === 'tool' ? 'default' : 'outline'} size="sm" onClick={() => setOutputView('tool')}>
                      Tool
                    </Button>
                    <Button variant={outputView === 'raw' ? 'default' : 'outline'} size="sm" onClick={() => setOutputView('raw')}>
                      Raw
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 gap-3 p-4 lg:grid-cols-[1.05fr_0.95fr]">
                {outputView === 'text' ? (
                  <>
                    <div className="flex min-h-[220px] flex-col overflow-hidden rounded-[18px] border border-border/70 bg-background">
                      <div className="border-b border-border/70 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Text Response</div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                        {outputText ? (
                          <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">{outputText}</div>
                        ) : (
                          <EmptyState title="No text output yet" description="先运行当前 Prompt，或者切到 Tool / Raw 看其他结果。" />
                        )}
                      </div>
                    </div>

                    <div className="flex min-h-[220px] flex-col overflow-hidden rounded-[18px] border border-border/70 bg-background">
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
                    <div className="flex min-h-[220px] flex-col overflow-hidden rounded-[18px] border border-border/70 bg-background">
                      <div className="border-b border-border/70 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Tool / Function Call</div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto p-4">
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

                    <div className="flex min-h-[220px] flex-col overflow-hidden rounded-[18px] border border-border/70 bg-background">
                      <div className="border-b border-border/70 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Tool Result Summary</div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto p-4">
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
                  <div className="flex min-h-[220px] flex-col overflow-hidden rounded-[18px] border border-border/70 bg-background lg:col-span-2">
                    <div className="border-b border-border/70 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Raw Provider Response</div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-4">
                      {rawProviderPayload ? (
                        <JsonBlock value={rawProviderPayload} className="h-full min-h-[220px]" />
                      ) : (
                        <EmptyState title="No raw payload available" description="当前 run 没有可展示的 provider 原始结果，先运行一次或者切回 Text / Tool。" />
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </section>
        </div>

        {desktopWindows.params.mode === 'docked' && desktopWindows.params.collapsed ? (
          <DockHandle title="Params" className="top-[148px]" onClick={() => openDockedWindow('params')} />
        ) : null}

        {desktopWindows.compare.mode === 'docked' && desktopWindows.compare.collapsed ? (
          <DockHandle title="Compare" className="top-[252px]" onClick={() => openDockedWindow('compare')} />
        ) : null}

        {desktopWindows.params.mode === 'docked' && !desktopWindows.params.collapsed ? (
          <DockedPanel
            title="Common Params"
            onClose={() => collapseWindow('params')}
            onPopOut={() => popOutWindow('params')}
            onPointerDown={startDockedWindowDrag('params')}
            className="w-[min(340px,calc(100vw-92px))]"
          >
            {paramsPanelContent}
          </DockedPanel>
        ) : null}

        {desktopWindows.compare.mode === 'docked' && !desktopWindows.compare.collapsed ? (
          <DockedPanel
            title="Compare Nodes"
            onClose={() => collapseWindow('compare')}
            onPopOut={() => popOutWindow('compare')}
            onPointerDown={startDockedWindowDrag('compare')}
            className="w-[min(300px,calc(100vw-92px))]"
          >
            {comparePanelContent}
          </DockedPanel>
        ) : null}

        {desktopWindows.params.mode === 'floating' ? (
          <FloatingPanel
            title="Common Params"
            x={desktopWindows.params.x}
            y={desktopWindows.params.y}
            onClose={() => collapseWindow('params')}
            onPointerDown={handleDesktopWindowPointerDown('params')}
            className="h-[640px] w-[min(360px,calc(100vw-96px))]"
          >
            {paramsPanelContent}
          </FloatingPanel>
        ) : null}

        {desktopWindows.compare.mode === 'floating' ? (
          <FloatingPanel
            title="Compare Nodes"
            x={desktopWindows.compare.x}
            y={desktopWindows.compare.y}
            onClose={() => collapseWindow('compare')}
            onPointerDown={handleDesktopWindowPointerDown('compare')}
            className="h-[420px] w-[min(320px,calc(100vw-96px))]"
          >
            {comparePanelContent}
          </FloatingPanel>
        ) : null}
      </div>

      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent side="left" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Library</SheetTitle>
            <SheetDescription>Traffic 样本、已保存 Cases 和近期 Runs。</SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex-1 overflow-hidden">
            {libraryErrorMessage ? (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{libraryErrorMessage}</AlertDescription>
              </Alert>
            ) : null}
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
                      <div className="flex items-center gap-2">
                        <Badge variant={message.role === 'assistant' ? 'secondary' : message.role === 'system' ? 'default' : 'outline'}>
                          {message.role}
                        </Badge>
                        <Select
                          value={message.role}
                          onValueChange={(value) =>
                            setPromptInput((prev) => ({
                              ...prev,
                              messages: prev.messages.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, role: value as typeof item.role } : item
                              ),
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="system">system</SelectItem>
                            <SelectItem value="user">user</SelectItem>
                            <SelectItem value="assistant">assistant</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
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
                  {toolEditorEntries.map((entry) => {
                    const isExpanded = expandedToolKey === entry.key;
                    return (
                      <div key={entry.key} className="overflow-hidden rounded-2xl border border-border/70">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-medium"
                          onClick={() => setExpandedToolKey((prev) => (prev === entry.key ? null : entry.key))}
                        >
                          <span>{entry.label}</span>
                          <span className="text-xs text-muted-foreground">{isExpanded ? '展开编辑' : '点击展开'}</span>
                        </button>
                        {isExpanded ? (
                          <div className="border-t border-border/70 p-3">
                            <Textarea
                              value={stringifyJson(entry.value)}
                              onChange={(event) => entry.onChange(event.target.value)}
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
