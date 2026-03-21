import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { SampleLibraryPanel } from '@/components/SampleLibraryPanel';
import { PlaygroundWorkbench } from '@/components/PlaygroundWorkbench';
import { ProviderSettingsPanel } from '@/components/ProviderSettingsPanel';
import { RunResultPanel } from '@/components/RunResultPanel';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
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
import { Beaker, RefreshCw, Save } from 'lucide-react';

type PromptSummary = {
  id: string;
  prompt_name: string;
  model_name?: string | null;
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
  const [toolsText, setToolsText] = useState(stringifyJson({}));
  const [mobileSamplesOpen, setMobileSamplesOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
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
      setMobileSamplesOpen(false);
      queryClient.invalidateQueries({ queryKey: ['playground-library'] });
    },
  });

  const createFromConversationMutation = useMutation({
    mutationFn: (conversationId: string) => createCaseFromConversation(conversationId, promptId),
    onSuccess: (record) => {
      setSelectedCaseId(record.id);
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
      return;
    }
  }, [createFromConversationMutation, createFromTrafficMutation, searchParams]);

  useEffect(() => {
    const currentCase = selectedCaseQuery.data;
    if (!currentCase) {
      return;
    }

    setPromptMode(currentCase.promptModeDefault);
    setPromptId(currentCase.promptId || promptId);
    setPromptInput(currentCase.promptInput);
    setProviderConfig(currentCase.providerConfig || DEFAULT_PROVIDER_CONFIG);
    setDraftSystemInstruction(currentCase.promptInput.systemInstruction || '');
    setContextVariablesText(stringifyJson(currentCase.promptInput.contextVariables || {}));
    setProviderSpecificText(stringifyJson(currentCase.providerConfig.providerSpecific || {}));
    setSafetyText(stringifyJson(currentCase.providerConfig.safety || []));
    setToolsText(stringifyJson(currentCase.providerConfig.tools || {}));
    setActiveRunId(null);
  }, [selectedCaseQuery.data]);

  const runs = runsQuery.data || [];
  const currentRun = useMemo<PlaygroundRun | null>(() => {
    if (runs.length === 0) {
      return null;
    }
    return runs.find((run) => run.id === activeRunId) || runs[0];
  }, [activeRunId, runs]);

  const prompts = promptData || [];

  const syncProviderTextFields = (next: PlaygroundProviderConfig) => {
    setProviderConfig(next);
    setProviderSpecificText(stringifyJson(next.providerSpecific || {}));
    setSafetyText(stringifyJson(next.safety || []));
    setToolsText(stringifyJson(next.tools || {}));
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
        contextVariables: parseJsonText<Record<string, unknown>>(contextVariablesText, {}),
      },
      providerConfig: {
        ...providerConfig,
        providerSpecific: parseJsonText<Record<string, unknown>>(providerSpecificText, {}),
        safety: parseJsonText<Array<Record<string, unknown>>>(safetyText, []),
        tools: parseJsonText<Record<string, unknown>>(toolsText, {}),
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

  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Prompt Lab"
        icon={<Beaker className="h-4 w-4" />}
        title="Playground"
        badge={<PageHeaderBadge>Provider centered</PageHeaderBadge>}
        description="用真实 Traffic 或时间线样本驱动 Prompt / Provider 实验。主界面参考 AI Studio 的工作台模型，但保持当前 Console 的视觉秩序。"
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

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)_360px] xl:grid-cols-[340px_minmax(0,1fr)_380px]">
        <div className="hidden lg:block">
          <SampleLibraryPanel
            library={libraryQuery.data}
            selectedCaseId={selectedCaseId}
            search={librarySearch}
            onSearchChange={setLibrarySearch}
            onCreateFromTraffic={(trafficId) => createFromTrafficMutation.mutate(trafficId)}
            onSelectCase={setSelectedCaseId}
            onCloneRun={(runId) => cloneRunMutation.mutate(runId)}
            isCreatingCase={createFromTrafficMutation.isPending}
          />
        </div>

        <div className="space-y-5">
          <PlaygroundWorkbench
            caseName={selectedCaseQuery.data?.name}
            caseMode={selectedCaseQuery.data?.caseMode}
            promptMode={promptMode}
            promptInput={promptInput}
            draftSystemInstruction={draftSystemInstruction}
            draftUserPromptTemplate={draftUserPromptTemplate}
            contextVariablesText={contextVariablesText}
            currentRun={currentRun}
            isRunning={runMutation.isPending}
            onPromptInputChange={setPromptInput}
            onDraftSystemInstructionChange={setDraftSystemInstruction}
            onDraftUserPromptTemplateChange={setDraftUserPromptTemplate}
            onContextVariablesTextChange={(value) => {
              setContextVariablesText(value);
              setPromptInput({
                ...promptInput,
                contextVariables: parseJsonText<Record<string, unknown>>(value, {}),
              });
            }}
            onRun={() => runMutation.mutate()}
            onOpenSamples={() => setMobileSamplesOpen(true)}
            onOpenSettings={() => setMobileSettingsOpen(true)}
          />
          <RunResultPanel
            currentRun={currentRun}
            runs={runs}
            onCloneRun={(runId) => cloneRunMutation.mutate(runId)}
            onSetBaseline={handleSetBaseline}
            onSelectRun={setActiveRunId}
          />
        </div>

        <div className="hidden lg:block">
          <ProviderSettingsPanel
            promptMode={promptMode}
            promptId={promptId}
            prompts={prompts}
            providerConfig={providerConfig}
            providerSpecificText={providerSpecificText}
            safetyText={safetyText}
            toolsText={toolsText}
            onPromptModeChange={setPromptMode}
            onPromptIdChange={setPromptId}
            onProviderConfigChange={syncProviderTextFields}
            onProviderSpecificTextChange={(value) => {
              setProviderSpecificText(value);
              setProviderConfig({
                ...providerConfig,
                providerSpecific: parseJsonText<Record<string, unknown>>(value, {}),
              });
            }}
            onSafetyTextChange={(value) => {
              setSafetyText(value);
              setProviderConfig({
                ...providerConfig,
                safety: parseJsonText<Array<Record<string, unknown>>>(value, []),
              });
            }}
            onToolsTextChange={(value) => {
              setToolsText(value);
              setProviderConfig({
                ...providerConfig,
                tools: parseJsonText<Record<string, unknown>>(value, {}),
              });
            }}
          />
        </div>
      </div>

      <Sheet open={mobileSamplesOpen} onOpenChange={setMobileSamplesOpen}>
        <SheetContent side="left" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Samples</SheetTitle>
            <SheetDescription>Traffic 样本、保存的 Cases 和近期 Runs。</SheetDescription>
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
                setMobileSamplesOpen(false);
              }}
              onCloneRun={(runId) => cloneRunMutation.mutate(runId)}
              isCreatingCase={createFromTrafficMutation.isPending}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Run Settings</SheetTitle>
            <SheetDescription>Provider、generation、thinking 和高级 JSON 覆盖。</SheetDescription>
          </SheetHeader>
          <div className="mt-4 overflow-y-auto pr-1">
            <ProviderSettingsPanel
              promptMode={promptMode}
              promptId={promptId}
              prompts={prompts}
              providerConfig={providerConfig}
              providerSpecificText={providerSpecificText}
              safetyText={safetyText}
              toolsText={toolsText}
              onPromptModeChange={setPromptMode}
              onPromptIdChange={setPromptId}
              onProviderConfigChange={syncProviderTextFields}
              onProviderSpecificTextChange={(value) => {
                setProviderSpecificText(value);
                setProviderConfig({
                  ...providerConfig,
                  providerSpecific: parseJsonText<Record<string, unknown>>(value, {}),
                });
              }}
              onSafetyTextChange={(value) => {
                setSafetyText(value);
                setProviderConfig({
                  ...providerConfig,
                  safety: parseJsonText<Array<Record<string, unknown>>>(value, []),
                });
              }}
              onToolsTextChange={(value) => {
                setToolsText(value);
                setProviderConfig({
                  ...providerConfig,
                  tools: parseJsonText<Record<string, unknown>>(value, {}),
                });
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
