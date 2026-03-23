import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Archive,
  BrainCircuit,
  Database,
  Eye,
  FileText,
  GitBranch,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { PageHeaderBadge } from '@/components/console/PageHeader';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { FilterBar } from '@/components/console/FilterBar';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { StatusPill } from '@/components/console/StatusPill';
import { StructuredDataViewer } from '@/components/StructuredDataViewer';
import { formatTimestamp } from '@/lib/utils';
import {
  CognitionBelief,
  CognitionEvidence,
  CognitionMemory,
  CognitionObservation,
  CognitionPlan,
  CognitionReflection,
  CognitionSelfModel,
  updateCognitionProactivity,
  useCognitionBeliefs,
  useCognitionEvidence,
  useCognitionMemories,
  useCognitionObservations,
  useCognitionOverview,
  useCognitionPlans,
  useCognitionProactivity,
  useCognitionReflections,
  useCognitionSelfModels,
} from '@/lib/cognitionApi';

type CognitionTab =
  | 'observations'
  | 'beliefs'
  | 'memories'
  | 'evidence'
  | 'reflections'
  | 'self-model'
  | 'plans';

function scopeLabel(scope: string): string {
  switch (scope) {
    case 'private_chat':
      return '私聊';
    case 'group_chat':
      return '群聊';
    case 'tool_channel':
      return '工具';
    case 'private_user':
      return '私聊画像';
    case 'group_context':
      return '群上下文';
    case 'self_global':
      return '自我模型';
    case 'local_field':
      return '局部场域';
    default:
      return scope;
  }
}

function scopeTone(scope: string): 'info' | 'success' | 'warning' | 'neutral' {
  if (scope === 'group_chat' || scope === 'group_context') {
    return 'success';
  }

  if (scope === 'self_global') {
    return 'warning';
  }

  return 'info';
}

function formatPreview(text: string, maxLength = 80): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

function statusTone(status: string): 'success' | 'warning' | 'neutral' | 'info' {
  if (status === 'active') {
    return 'success';
  }

  if (status === 'revised') {
    return 'warning';
  }

  return 'neutral';
}

function reflectionStatusTone(status: string): 'success' | 'warning' | 'neutral' | 'info' {
  if (status === 'completed') {
    return 'success';
  }

  if (status === 'failed') {
    return 'warning';
  }

  return 'neutral';
}

function planStatusTone(status: string): 'success' | 'warning' | 'neutral' | 'info' {
  if (status === 'active' || status === 'completed') {
    return 'success';
  }

  if (status === 'queued') {
    return 'warning';
  }

  return 'neutral';
}

export const CognitionPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<CognitionTab>('observations');
  const [observationPage, setObservationPage] = useState(1);
  const [beliefPage, setBeliefPage] = useState(1);
  const [memoryPage, setMemoryPage] = useState(1);
  const [evidencePage, setEvidencePage] = useState(1);
  const [reflectionPage, setReflectionPage] = useState(1);
  const [selfModelPage, setSelfModelPage] = useState(1);
  const [planPage, setPlanPage] = useState(1);
  const [observationScope, setObservationScope] = useState<'all' | 'private' | 'group'>('all');
  const [beliefScope, setBeliefScope] = useState<'all' | 'private' | 'group'>('all');
  const [memoryScope, setMemoryScope] = useState<'all' | 'private' | 'group' | 'self'>('all');
  const [evidenceScope, setEvidenceScope] = useState<'all' | 'private' | 'group' | 'self'>('all');
  const [planScope, setPlanScope] = useState<'all' | 'private' | 'group' | 'self'>('all');
  const [observationSearch, setObservationSearch] = useState('');
  const [beliefSearch, setBeliefSearch] = useState('');
  const [memorySearch, setMemorySearch] = useState('');
  const [evidenceSearch, setEvidenceSearch] = useState('');
  const [reflectionSearch, setReflectionSearch] = useState('');
  const [selfModelSearch, setSelfModelSearch] = useState('');
  const [planSearch, setPlanSearch] = useState('');
  const [selectedObservation, setSelectedObservation] = useState<CognitionObservation | null>(null);
  const [selectedBelief, setSelectedBelief] = useState<CognitionBelief | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<CognitionMemory | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<CognitionEvidence | null>(null);
  const [selectedReflection, setSelectedReflection] = useState<CognitionReflection | null>(null);
  const [selectedSelfModel, setSelectedSelfModel] = useState<CognitionSelfModel | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<CognitionPlan | null>(null);
  const [proactivityForm, setProactivityForm] = useState({
    followupEnabled: true,
    isPaused: false,
    maxPerRun: '1',
    retryDelayMinutes: '360',
    allowedUserIdsText: '',
  });

  const limit = 20;

  const overviewQuery = useCognitionOverview();
  const observationsQuery = useCognitionObservations({
    page: observationPage,
    limit,
    scope: observationScope,
    search: observationSearch || undefined,
  });
  const beliefsQuery = useCognitionBeliefs({
    page: beliefPage,
    limit,
    scope: beliefScope,
    search: beliefSearch || undefined,
  });
  const memoriesQuery = useCognitionMemories({
    page: memoryPage,
    limit,
    scope: memoryScope,
    search: memorySearch || undefined,
  });
  const evidenceQuery = useCognitionEvidence({
    page: evidencePage,
    limit,
    scope: evidenceScope,
    search: evidenceSearch || undefined,
  });
  const reflectionsQuery = useCognitionReflections({
    page: reflectionPage,
    limit,
    search: reflectionSearch || undefined,
  });
  const selfModelsQuery = useCognitionSelfModels({
    page: selfModelPage,
    limit,
    search: selfModelSearch || undefined,
  });
  const plansQuery = useCognitionPlans({
    page: planPage,
    limit,
    scope: planScope,
    search: planSearch || undefined,
  });
  const proactivityQuery = useCognitionProactivity();

  const observations = observationsQuery.data?.data || [];
  const beliefs = beliefsQuery.data?.data || [];
  const memories = memoriesQuery.data?.data || [];
  const evidence = evidenceQuery.data?.data || [];
  const reflections = reflectionsQuery.data?.data || [];
  const selfModels = selfModelsQuery.data?.data || [];
  const plans = plansQuery.data?.data || [];
  const observationPagination = observationsQuery.data?.pagination;
  const beliefPagination = beliefsQuery.data?.pagination;
  const memoryPagination = memoriesQuery.data?.pagination;
  const evidencePagination = evidenceQuery.data?.pagination;
  const reflectionPagination = reflectionsQuery.data?.pagination;
  const selfModelPagination = selfModelsQuery.data?.pagination;
  const planPagination = plansQuery.data?.pagination;
  const overview = overviewQuery.data?.data;
  const proactivity = proactivityQuery.data?.data;
  const latestOverviewAt =
    overview?.observations.latest_at ||
    overview?.beliefs.latest_at ||
    overview?.memories.latest_at ||
    overview?.evidence.latest_at ||
    overview?.reflections.latest_at ||
    overview?.self_models.latest_at ||
    overview?.plans.latest_at ||
    undefined;

  useEffect(() => {
    if (!proactivity) {
      return;
    }

    setProactivityForm({
      followupEnabled: proactivity.followupEnabled,
      isPaused: proactivity.isPaused,
      maxPerRun: String(proactivity.maxPerRun),
      retryDelayMinutes: String(Math.max(1, Math.round(proactivity.retryDelayMs / 60000))),
      allowedUserIdsText: proactivity.allowedUserIds.join(', '),
    });
  }, [proactivity]);

  useEffect(() => {
    if (observations.length === 0) {
      setSelectedObservation(null);
      return;
    }

    if (!selectedObservation || !observations.some((item) => item.id === selectedObservation.id)) {
      setSelectedObservation(observations[0]);
    }
  }, [observations, selectedObservation]);

  useEffect(() => {
    if (beliefs.length === 0) {
      setSelectedBelief(null);
      return;
    }

    if (!selectedBelief || !beliefs.some((item) => item.id === selectedBelief.id)) {
      setSelectedBelief(beliefs[0]);
    }
  }, [beliefs, selectedBelief]);

  useEffect(() => {
    if (memories.length === 0) {
      setSelectedMemory(null);
      return;
    }

    if (!selectedMemory || !memories.some((item) => item.id === selectedMemory.id)) {
      setSelectedMemory(memories[0]);
    }
  }, [memories, selectedMemory]);

  useEffect(() => {
    if (evidence.length === 0) {
      setSelectedEvidence(null);
      return;
    }

    if (!selectedEvidence || !evidence.some((item) => item.id === selectedEvidence.id)) {
      setSelectedEvidence(evidence[0]);
    }
  }, [evidence, selectedEvidence]);

  useEffect(() => {
    if (reflections.length === 0) {
      setSelectedReflection(null);
      return;
    }

    if (!selectedReflection || !reflections.some((item) => item.id === selectedReflection.id)) {
      setSelectedReflection(reflections[0]);
    }
  }, [reflections, selectedReflection]);

  useEffect(() => {
    if (selfModels.length === 0) {
      setSelectedSelfModel(null);
      return;
    }

    if (!selectedSelfModel || !selfModels.some((item) => item.id === selectedSelfModel.id)) {
      setSelectedSelfModel(selfModels[0]);
    }
  }, [selfModels, selectedSelfModel]);

  useEffect(() => {
    if (plans.length === 0) {
      setSelectedPlan(null);
      return;
    }

    if (!selectedPlan || !plans.some((item) => item.id === selectedPlan.id)) {
      setSelectedPlan(plans[0]);
    }
  }, [plans, selectedPlan]);

  const updateProactivityMutation = useMutation({
    mutationFn: (payload: {
      followup_enabled: boolean;
      is_paused: boolean;
      allowed_user_ids: number[];
      max_per_run: number;
      retry_delay_ms: number;
    }) => updateCognitionProactivity(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognition-proactivity'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-plans'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-overview'] });
    },
  });

  const parseAllowedUserIds = (value: string): number[] => {
    if (!value.trim()) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .split(',')
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isFinite(item) && item > 0),
      ),
    );
  };

  const handleSaveProactivity = async () => {
    const maxPerRun = Math.max(1, Math.min(5, Number.parseInt(proactivityForm.maxPerRun, 10) || 1));
    const retryDelayMinutes = Math.max(1, Number.parseInt(proactivityForm.retryDelayMinutes, 10) || 1);

    await updateProactivityMutation.mutateAsync({
      followup_enabled: proactivityForm.followupEnabled,
      is_paused: proactivityForm.isPaused,
      allowed_user_ids: parseAllowedUserIds(proactivityForm.allowedUserIdsText),
      max_per_run: maxPerRun,
      retry_delay_ms: retryDelayMinutes * 60_000,
    });
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Cognition"
        title="小腻认知视图"
        description="只读查看 observation、belief、memory 与 evidence。表不存在时会优雅空态，不阻塞主线。"
        icon={<BrainCircuit className="h-5 w-5" />}
        badge={
          <PageHeaderBadge>
            {(overview?.observations.total || 0) +
              (overview?.beliefs.total || 0) +
              (overview?.memories.total || 0) +
              (overview?.evidence.total || 0) +
              (overview?.reflections.total || 0) +
              (overview?.self_models.total || 0) +
              (overview?.plans.total || 0)} Records
          </PageHeaderBadge>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => overviewQuery.refetch()} disabled={overviewQuery.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${overviewQuery.isFetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')}>
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              回到总览
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <MetricCard
          label="Observation 总数"
          value={overviewQuery.isLoading ? '...' : (overview?.observations.total || 0).toLocaleString()}
          detail={`近 24h ${overview?.observations.last_24h || 0} 条`}
          icon={<Eye className="h-5 w-5" />}
        />
        <MetricCard
          label="Belief 总数"
          value={overviewQuery.isLoading ? '...' : (overview?.beliefs.total || 0).toLocaleString()}
          detail={`active ${overview?.beliefs.active_total || 0} / revised ${overview?.beliefs.revised_total || 0}`}
          icon={<FileText className="h-5 w-5" />}
          tone="warning"
        />
        <MetricCard
          label="Stable Memory 总数"
          value={overviewQuery.isLoading ? '...' : (overview?.memories.total || 0).toLocaleString()}
          detail={`active ${overview?.memories.active_total || 0} / revised ${overview?.memories.revised_total || 0}`}
          icon={<Database className="h-5 w-5" />}
          tone="success"
        />
        <MetricCard
          label="Evidence 总数"
          value={overviewQuery.isLoading ? '...' : (overview?.evidence.total || 0).toLocaleString()}
          detail={`最后更新时间 ${latestOverviewAt ? formatTimestamp(latestOverviewAt) : '-'}`}
          icon={<Archive className="h-5 w-5" />}
        />
        <MetricCard
          label="Reflection 总数"
          value={overviewQuery.isLoading ? '...' : (overview?.reflections.total || 0).toLocaleString()}
          detail={`completed ${overview?.reflections.completed_total || 0} / failed ${overview?.reflections.failed_total || 0}`}
          icon={<Sparkles className="h-5 w-5" />}
          tone="warning"
        />
        <MetricCard
          label="Self Model 快照"
          value={overviewQuery.isLoading ? '...' : (overview?.self_models.total || 0).toLocaleString()}
          detail={`current ${overview?.self_models.current_total || 0}`}
          icon={<BrainCircuit className="h-5 w-5" />}
          tone="success"
        />
        <MetricCard
          label="Plan 总数"
          value={overviewQuery.isLoading ? '...' : (overview?.plans.total || 0).toLocaleString()}
          detail={`queued ${overview?.plans.queued_total || 0} / active ${overview?.plans.active_total || 0}`}
          icon={<GitBranch className="h-5 w-5" />}
        />
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CognitionTab)}>
        <TabsList>
          <TabsTrigger value="observations">Observations</TabsTrigger>
          <TabsTrigger value="beliefs">Beliefs</TabsTrigger>
          <TabsTrigger value="memories">Memories</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="reflections">Reflections</TabsTrigger>
          <TabsTrigger value="self-model">Self Model</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="observations" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={observationSearch}
                  onChange={(event) => {
                    setObservationSearch(event.target.value);
                    setObservationPage(1);
                  }}
                  placeholder="搜索消息内容、发送者或 message_id"
                  className="pl-9"
                />
              </div>
              <Select
                value={observationScope}
                onValueChange={(value) => {
                  setObservationScope(value as 'all' | 'private' | 'group');
                  setObservationPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部范围</SelectItem>
                  <SelectItem value="private">私聊</SelectItem>
                  <SelectItem value="group">群聊</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => observationsQuery.refetch()} disabled={observationsQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${observationsQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="info">
                  {observationPagination ? `${observationPagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Observation 列表"
            description="来自 agent_observations 的 Phase 1 观察流。这里只读，不改写。"
            icon={<Eye className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {observationsQuery.error ? (
              <ErrorState onRetry={() => observationsQuery.refetch()} />
            ) : observations.length === 0 ? (
              <EmptyState
                icon={<Eye className="h-10 w-10" />}
                title="没有匹配的 observation"
                description="调整范围或搜索条件后重试。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>范围</TableHead>
                    <TableHead>主体</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {observations.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedObservation?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedObservation(item)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(item.sent_at, { fallback: '-' })}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={scopeTone(item.scope_type)}>
                          {scopeLabel(item.scope_type)}
                        </StatusPill>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{item.subject_name}</div>
                          <div className="text-xs text-muted-foreground">#{item.subject_id}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.sender_role}</TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">{formatPreview(item.content, 120)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {observationPagination?.page || 1} / {observationPagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={observationPage <= 1} onClick={() => setObservationPage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!observationPagination || observationPage >= observationPagination.totalPages}
                  onClick={() => setObservationPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Observation"
            description="单条消息的原始语义详情。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            {selectedObservation ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Source</div>
                    <div className="mt-1 font-medium text-foreground">{selectedObservation.source_table}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Subject</div>
                    <div className="mt-1 text-foreground">{selectedObservation.subject_name} / #{selectedObservation.subject_id}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Sender</div>
                    <div className="mt-1 text-foreground">{selectedObservation.sender_role} / {selectedObservation.sender_id}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Observation Type</div>
                    <div className="mt-1 text-foreground">{selectedObservation.source_type}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Time</div>
                    <div className="mt-1 text-foreground">{formatTimestamp(selectedObservation.sent_at)}</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Summary</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
                      {selectedObservation.summary}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Content</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedObservation.content}
                    </div>
                  </div>
                  <StructuredDataViewer
                    title="Raw Payload"
                    value={selectedObservation.raw_payload}
                    emptyLabel="No raw payload"
                    heightClassName="h-[18rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Sparkles className="h-10 w-10" />}
                title="未选择 observation"
                description="点击上方表格中的一行查看原始内容。"
              />
            )}
          </SectionPanel>
        </TabsContent>

        <TabsContent value="beliefs" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={beliefSearch}
                  onChange={(event) => {
                    setBeliefSearch(event.target.value);
                    setBeliefPage(1);
                  }}
                  placeholder="搜索用户、群、上下文 key 或内容"
                  className="pl-9"
                />
              </div>
              <Select
                value={beliefScope}
                onValueChange={(value) => {
                  setBeliefScope(value as 'all' | 'private' | 'group');
                  setBeliefPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部范围</SelectItem>
                  <SelectItem value="private">私聊</SelectItem>
                  <SelectItem value="group">群聊</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => beliefsQuery.refetch()} disabled={beliefsQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${beliefsQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="warning">
                  {beliefPagination ? `${beliefPagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Belief 列表"
            description="来自 agent_beliefs 的 Phase 1 只读信念视图。"
            icon={<FileText className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {beliefsQuery.error ? (
              <ErrorState onRetry={() => beliefsQuery.refetch()} />
            ) : beliefs.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-10 w-10" />}
                title="没有匹配的 belief"
                description="调整范围或搜索条件后重试。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>更新时间</TableHead>
                    <TableHead>范围</TableHead>
                    <TableHead>主体</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {beliefs.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedBelief?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedBelief(item)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(item.updated_at, { fallback: '-' })}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={scopeTone(item.scope_type)}>
                          {scopeLabel(item.scope_type)}
                        </StatusPill>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{item.subject_name}</div>
                          <div className="text-xs text-muted-foreground">#{item.subject_id}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.source_table}</TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">{formatPreview(item.content, 120)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {beliefPagination?.page || 1} / {beliefPagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={beliefPage <= 1} onClick={() => setBeliefPage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!beliefPagination || beliefPage >= beliefPagination.totalPages}
                  onClick={() => setBeliefPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Belief"
            description="选中条目的稳定状态和来源详情。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            {selectedBelief ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Title</div>
                    <div className="mt-1 font-medium text-foreground">{selectedBelief.title}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Source</div>
                    <div className="mt-1 text-foreground">{selectedBelief.source_table}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Subject</div>
                    <div className="mt-1 text-foreground">{selectedBelief.subject_name} / #{selectedBelief.subject_id}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Time</div>
                    <div className="mt-1 text-foreground">{formatTimestamp(selectedBelief.last_observed_at || selectedBelief.updated_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Status</div>
                    <div className="mt-1 flex items-center gap-2">
                      <StatusPill tone={statusTone(selectedBelief.status)}>
                        {selectedBelief.status}
                      </StatusPill>
                      <span className="text-sm text-muted-foreground">
                        confidence {selectedBelief.confidence}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Content</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedBelief.content}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Detail</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
                      {selectedBelief.detail || '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Evidence</div>
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      last_evidence_id: {selectedBelief.last_evidence_id ?? '-'} / observation_count: {selectedBelief.observation_count}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Sparkles className="h-10 w-10" />}
                title="未选择 belief"
                description="点击上方表格中的一行查看来源和内容。"
              />
            )}
          </SectionPanel>
        </TabsContent>

        <TabsContent value="memories" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={memorySearch}
                  onChange={(event) => {
                    setMemorySearch(event.target.value);
                    setMemoryPage(1);
                  }}
                  placeholder="搜索 memory content / summary / type / subject"
                  className="pl-9"
                />
              </div>
              <Select
                value={memoryScope}
                onValueChange={(value) => {
                  setMemoryScope(value as 'all' | 'private' | 'group' | 'self');
                  setMemoryPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部范围</SelectItem>
                  <SelectItem value="private">私聊</SelectItem>
                  <SelectItem value="group">群聊</SelectItem>
                  <SelectItem value="self">自我</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => memoriesQuery.refetch()} disabled={memoriesQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${memoriesQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="success">
                  {memoryPagination ? `${memoryPagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Stable Memory 列表"
            description="未来的长期记忆只读视图。表不存在时会自动空态。"
            icon={<Database className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {memoriesQuery.error ? (
              <ErrorState onRetry={() => memoriesQuery.refetch()} />
            ) : memories.length === 0 ? (
              <EmptyState
                icon={<Database className="h-10 w-10" />}
                title="没有匹配的 memory"
                description="当前表可能尚未建好，或者筛选条件没有命中。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>更新时间</TableHead>
                    <TableHead>范围</TableHead>
                    <TableHead>主体</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memories.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedMemory?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedMemory(item)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(item.updated_at, { fallback: '-' })}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={scopeTone(item.scope_type)}>
                          {scopeLabel(item.scope_type)}
                        </StatusPill>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{item.subject_name}</div>
                          <div className="text-xs text-muted-foreground">#{item.subject_id}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.memory_type}</TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">{formatPreview(item.content, 120)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {memoryPagination?.page || 1} / {memoryPagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={memoryPage <= 1} onClick={() => setMemoryPage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!memoryPagination || memoryPage >= memoryPagination.totalPages}
                  onClick={() => setMemoryPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Memory"
            description="稳定记忆与证据引用的详情。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            {selectedMemory ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Type</div>
                    <div className="mt-1 font-medium text-foreground">{selectedMemory.memory_type}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Source</div>
                    <div className="mt-1 text-foreground">{selectedMemory.source_table}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Subject</div>
                    <div className="mt-1 text-foreground">{selectedMemory.subject_name} / #{selectedMemory.subject_id}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Status</div>
                    <div className="mt-1 flex items-center gap-2">
                      <StatusPill tone={statusTone(selectedMemory.status)}>
                        {selectedMemory.status}
                      </StatusPill>
                      <span className="text-sm text-muted-foreground">
                        confidence {selectedMemory.confidence} / salience {selectedMemory.salience}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Source Kind</div>
                    <div className="mt-1 text-foreground">{selectedMemory.source_kind || '-'}</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Summary</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
                      {selectedMemory.summary || '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Content</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedMemory.content}
                    </div>
                  </div>
                  <StructuredDataViewer
                    title="Raw Payload"
                    value={selectedMemory.raw_payload}
                    emptyLabel="No raw payload"
                    heightClassName="h-[18rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Database className="h-10 w-10" />}
                title="未选择 memory"
                description="点击上方表格中的一行查看稳定记忆详情。"
              />
            )}
          </SectionPanel>
        </TabsContent>

        <TabsContent value="evidence" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={evidenceSearch}
                  onChange={(event) => {
                    setEvidenceSearch(event.target.value);
                    setEvidencePage(1);
                  }}
                  placeholder="搜索 quote / evidence_text / source"
                  className="pl-9"
                />
              </div>
              <Select
                value={evidenceScope}
                onValueChange={(value) => {
                  setEvidenceScope(value as 'all' | 'private' | 'group' | 'self');
                  setEvidencePage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部范围</SelectItem>
                  <SelectItem value="private">私聊</SelectItem>
                  <SelectItem value="group">群聊</SelectItem>
                  <SelectItem value="self">自我</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => evidenceQuery.refetch()} disabled={evidenceQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${evidenceQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="info">
                  {evidencePagination ? `${evidencePagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Evidence 列表"
            description="未来的记忆证据流，只读查看每条记忆的来源。"
            icon={<GitBranch className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {evidenceQuery.error ? (
              <ErrorState onRetry={() => evidenceQuery.refetch()} />
            ) : evidence.length === 0 ? (
              <EmptyState
                icon={<GitBranch className="h-10 w-10" />}
                title="没有匹配的 evidence"
                description="当前表可能尚未建好，或者筛选条件没有命中。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>范围</TableHead>
                    <TableHead>Memory</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>证据摘要</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evidence.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedEvidence?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedEvidence(item)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(item.created_at, { fallback: '-' })}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={scopeTone(item.memory_scope)}>
                          {scopeLabel(item.memory_scope)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        #{item.memory_id ?? '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.source_table}
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">
                          {formatPreview(item.quote || item.evidence_text || '-', 120)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {evidencePagination?.page || 1} / {evidencePagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={evidencePage <= 1} onClick={() => setEvidencePage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!evidencePagination || evidencePage >= evidencePagination.totalPages}
                  onClick={() => setEvidencePage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Evidence"
            description="记忆证据链的详情。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            {selectedEvidence ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Memory ID</div>
                    <div className="mt-1 font-medium text-foreground">#{selectedEvidence.memory_id ?? '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Scope</div>
                    <div className="mt-1 text-foreground">{scopeLabel(selectedEvidence.memory_scope)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Source</div>
                    <div className="mt-1 text-foreground">
                      {selectedEvidence.source_table} / {selectedEvidence.source_type}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Source Record</div>
                    <div className="mt-1 text-foreground">
                      {selectedEvidence.source_record_id ?? '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Confidence</div>
                    <div className="mt-1 text-foreground">{selectedEvidence.confidence ?? '-'}</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Quote</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
                      {selectedEvidence.quote || '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Evidence Text</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedEvidence.evidence_text || '-'}
                    </div>
                  </div>
                  <StructuredDataViewer
                    title="Raw Payload"
                    value={selectedEvidence.raw_payload}
                    emptyLabel="No raw payload"
                    heightClassName="h-[18rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<GitBranch className="h-10 w-10" />}
                title="未选择 evidence"
                description="点击上方表格中的一行查看证据链详情。"
              />
            )}
          </SectionPanel>
        </TabsContent>

        <TabsContent value="reflections" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={reflectionSearch}
                  onChange={(event) => {
                    setReflectionSearch(event.target.value);
                    setReflectionPage(1);
                  }}
                  placeholder="搜索 reflection key / kind / status / summary"
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => reflectionsQuery.refetch()} disabled={reflectionsQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${reflectionsQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="warning">
                  {reflectionPagination ? `${reflectionPagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Reflection 列表"
            description="查看 daily / weekly reflection 是否真的跑过，以及它们提升了多少 memory。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {reflectionsQuery.error ? (
              <ErrorState onRetry={() => reflectionsQuery.refetch()} />
            ) : reflections.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="h-10 w-10" />}
                title="没有 reflection 记录"
                description="当前环境可能尚未跑到 daily / weekly reflection，或者筛选条件没有命中。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>开始时间</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>摘要</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reflections.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedReflection?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedReflection(item)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(item.started_at, { fallback: '-' })}
                      </TableCell>
                      <TableCell className="text-foreground">{item.reflection_kind}</TableCell>
                      <TableCell>
                        <StatusPill tone={reflectionStatusTone(item.status)}>{item.status}</StatusPill>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.reflection_key}</TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">{formatPreview(item.summary || '-', 120)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {reflectionPagination?.page || 1} / {reflectionPagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={reflectionPage <= 1} onClick={() => setReflectionPage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!reflectionPagination || reflectionPage >= reflectionPagination.totalPages}
                  onClick={() => setReflectionPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Reflection"
            description="查看一次反思批次到底消费了哪些 belief，又提升了哪些 memory。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            {selectedReflection ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Key</div>
                    <div className="mt-1 font-medium text-foreground">{selectedReflection.reflection_key}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Kind</div>
                    <div className="mt-1 text-foreground">{selectedReflection.reflection_kind}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Status</div>
                    <div className="mt-1">
                      <StatusPill tone={reflectionStatusTone(selectedReflection.status)}>{selectedReflection.status}</StatusPill>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Started / Completed</div>
                    <div className="mt-1 text-foreground">
                      {formatTimestamp(selectedReflection.started_at)} / {formatTimestamp(selectedReflection.completed_at || undefined, { fallback: '-' })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Counts</div>
                    <div className="mt-1 rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
                      beliefs {selectedReflection.source_belief_count} / promoted memories {selectedReflection.promoted_memory_count}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Summary</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedReflection.summary || '-'}
                    </div>
                  </div>
                  <StructuredDataViewer
                    title="Source Belief IDs"
                    value={selectedReflection.source_belief_ids}
                    emptyLabel="No source beliefs"
                    heightClassName="h-[10rem]"
                  />
                  <StructuredDataViewer
                    title="Promoted Memory IDs"
                    value={selectedReflection.promoted_memory_ids}
                    emptyLabel="No promoted memories"
                    heightClassName="h-[10rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Sparkles className="h-10 w-10" />}
                title="未选择 reflection"
                description="点击上方表格中的一行查看反思批次详情。"
              />
            )}
          </SectionPanel>
        </TabsContent>

        <TabsContent value="self-model" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={selfModelSearch}
                  onChange={(event) => {
                    setSelfModelSearch(event.target.value);
                    setSelfModelPage(1);
                  }}
                  placeholder="搜索 identity summary / availability / concerns"
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => selfModelsQuery.refetch()} disabled={selfModelsQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${selfModelsQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="warning">
                  {selfModelPagination ? `${selfModelPagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Self Model 快照"
            description="查看当前自我模型快照与 internal state 片段是否已经写回数据库。"
            icon={<BrainCircuit className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {selfModelsQuery.error ? (
              <ErrorState onRetry={() => selfModelsQuery.refetch()} />
            ) : selfModels.length === 0 ? (
              <EmptyState
                icon={<BrainCircuit className="h-10 w-10" />}
                title="没有 self model 快照"
                description="这说明 reflection 结果还没有写回到 agent_self_model。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>更新时间</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead>Availability</TableHead>
                    <TableHead>Energy</TableHead>
                    <TableHead>Identity Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selfModels.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedSelfModel?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedSelfModel(item)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(item.updated_at, { fallback: '-' })}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={item.is_current ? 'success' : 'neutral'}>
                          {item.is_current ? 'current' : 'history'}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-foreground">{item.availability || '-'}</TableCell>
                      <TableCell className="text-foreground">{item.energy || '-'}</TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">{formatPreview(item.identity_summary || '-', 120)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {selfModelPagination?.page || 1} / {selfModelPagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={selfModelPage <= 1} onClick={() => setSelfModelPage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selfModelPagination || selfModelPage >= selfModelPagination.totalPages}
                  onClick={() => setSelfModelPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Self Model"
            description="查看 identity / traits / goals / concerns / availability / energy 的完整状态。"
            icon={<BrainCircuit className="h-4 w-4 text-primary" />}
          >
            {selectedSelfModel ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Identity Summary</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedSelfModel.identity_summary || '-'}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Availability</div>
                      <div className="mt-1 text-foreground">{selectedSelfModel.availability || '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Energy</div>
                      <div className="mt-1 text-foreground">{selectedSelfModel.energy || '-'}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Snapshot State</div>
                    <div className="mt-1">
                      <StatusPill tone={selectedSelfModel.is_current ? 'success' : 'neutral'}>
                        {selectedSelfModel.is_current ? 'current snapshot' : 'history snapshot'}
                      </StatusPill>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <StructuredDataViewer
                    title="Core Traits"
                    value={selectedSelfModel.core_traits}
                    emptyLabel="No core traits"
                    heightClassName="h-[8rem]"
                  />
                  <StructuredDataViewer
                    title="Long-term Goals"
                    value={selectedSelfModel.long_term_goals}
                    emptyLabel="No long-term goals"
                    heightClassName="h-[8rem]"
                  />
                  <StructuredDataViewer
                    title="Current Concerns"
                    value={selectedSelfModel.current_concerns}
                    emptyLabel="No current concerns"
                    heightClassName="h-[8rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<BrainCircuit className="h-10 w-10" />}
                title="未选择 self model 快照"
                description="点击上方表格中的一行查看自我模型与 internal state。"
              />
            )}
          </SectionPanel>
        </TabsContent>

        <TabsContent value="plans" className="space-y-5">
          <SectionPanel
            title="Proactivity Controls"
            description="直接控制 followup_queue 的运行、暂停、单轮吞吐和白名单，不再只靠容器环境变量。"
            icon={<GitBranch className="h-4 w-4 text-primary" />}
          >
            {proactivityQuery.error ? (
              <ErrorState
                description={proactivityQuery.error instanceof Error ? proactivityQuery.error.message : undefined}
                onRetry={() => proactivityQuery.refetch()}
              />
            ) : (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>运行开关</CardTitle>
                    <CardDescription>控制 followup dispatch 的启停、白名单和节流参数。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-border bg-muted/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium text-foreground">Followup Enabled</div>
                            <div className="mt-1 text-sm leading-6 text-muted-foreground">
                              关闭后不会消费 `followup_queue`。
                            </div>
                          </div>
                          <Switch
                            checked={proactivityForm.followupEnabled}
                            onCheckedChange={(checked) => setProactivityForm((current) => ({ ...current, followupEnabled: checked }))}
                          />
                        </div>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium text-foreground">Paused</div>
                            <div className="mt-1 text-sm leading-6 text-muted-foreground">
                              暂停后保留队列，但后台不再尝试执行。
                            </div>
                          </div>
                          <Switch
                            checked={proactivityForm.isPaused}
                            onCheckedChange={(checked) => setProactivityForm((current) => ({ ...current, isPaused: checked }))}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="proactivity-max-per-run">单轮上限</Label>
                        <Input
                          id="proactivity-max-per-run"
                          inputMode="numeric"
                          value={proactivityForm.maxPerRun}
                          onChange={(event) => setProactivityForm((current) => ({ ...current, maxPerRun: event.target.value }))}
                          placeholder="1-5"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="proactivity-retry-delay">重试延迟（分钟）</Label>
                        <Input
                          id="proactivity-retry-delay"
                          inputMode="numeric"
                          value={proactivityForm.retryDelayMinutes}
                          onChange={(event) => setProactivityForm((current) => ({ ...current, retryDelayMinutes: event.target.value }))}
                          placeholder="例如 360"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="proactivity-allowlist">允许用户列表</Label>
                      <Input
                        id="proactivity-allowlist"
                        value={proactivityForm.allowedUserIdsText}
                        onChange={(event) => setProactivityForm((current) => ({ ...current, allowedUserIdsText: event.target.value }))}
                        placeholder="QQ 号，逗号分隔；留空表示不限制"
                      />
                      <div className="text-sm leading-6 text-muted-foreground">
                        当前输入会覆盖 runtime allowlist。留空表示所有满足私聊开关的用户都可被 followup。
                      </div>
                    </div>

                    {updateProactivityMutation.error ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {updateProactivityMutation.error instanceof Error ? updateProactivityMutation.error.message : '保存失败'}
                      </div>
                    ) : null}

                    <div className="flex items-center gap-2">
                      <Button onClick={() => void handleSaveProactivity()} disabled={updateProactivityMutation.isPending}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${updateProactivityMutation.isPending ? 'animate-spin' : ''}`} />
                        保存控制项
                      </Button>
                      <Button variant="outline" onClick={() => proactivityQuery.refetch()} disabled={proactivityQuery.isFetching}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${proactivityQuery.isFetching ? 'animate-spin' : ''}`} />
                        刷新状态
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>当前状态摘要</CardTitle>
                    <CardDescription>这里看 runtime 生效状态，不看表单草稿。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone={proactivity?.followupEnabled ? 'success' : 'neutral'}>
                        {proactivity?.followupEnabled ? 'enabled' : 'disabled'}
                      </StatusPill>
                      <StatusPill tone={proactivity?.isPaused ? 'warning' : 'success'}>
                        {proactivity?.isPaused ? 'paused' : 'running'}
                      </StatusPill>
                      <StatusPill tone="info">
                        allowlist {proactivity?.allowedUserIds.length || 0}
                      </StatusPill>
                      <StatusPill tone="info">
                        max/run {proactivity?.maxPerRun || 0}
                      </StatusPill>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Queued Followups</div>
                        <div className="mt-2 text-2xl font-semibold text-foreground">{proactivity?.queuedFollowups || 0}</div>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Active Followups</div>
                        <div className="mt-2 text-2xl font-semibold text-foreground">{proactivity?.activeFollowups || 0}</div>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                      <StatusRow label="重试延迟">
                        {proactivity ? `${Math.round(proactivity.retryDelayMs / 60000)} 分钟` : '-'}
                      </StatusRow>
                      <StatusRow label="近 7 天 action logs">{String(proactivity?.recentActionLogCount || 0)}</StatusRow>
                      <StatusRow label="最近动作">
                        {formatTimestamp(proactivity?.lastActionAt || undefined, { fallback: '-' })}
                      </StatusRow>
                      <StatusRow label="配置来源">{proactivity?.source || '-'}</StatusRow>
                      <StatusRow label="配置更新时间">
                        {formatTimestamp(proactivity?.updatedAt || undefined, { fallback: '-' })}
                      </StatusRow>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </SectionPanel>

          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={planSearch}
                  onChange={(event) => {
                    setPlanSearch(event.target.value);
                    setPlanPage(1);
                  }}
                  placeholder="搜索 goal / trigger / type / target"
                  className="pl-9"
                />
              </div>
              <Select
                value={planScope}
                onValueChange={(value) => {
                  setPlanScope(value as 'all' | 'private' | 'group' | 'self');
                  setPlanPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部范围</SelectItem>
                  <SelectItem value="private">私聊</SelectItem>
                  <SelectItem value="group">群聊</SelectItem>
                  <SelectItem value="self">自我</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => plansQuery.refetch()} disabled={plansQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${plansQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="info">
                  {planPagination ? `${planPagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Plan / Followup 列表"
            description="查看 weekly_focus、day_plan、followup_queue、micro_intention 的只读状态。"
            icon={<GitBranch className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {plansQuery.error ? (
              <ErrorState onRetry={() => plansQuery.refetch()} />
            ) : plans.length === 0 ? (
              <EmptyState
                icon={<GitBranch className="h-10 w-10" />}
                title="没有 plan 记录"
                description="这说明 reflection 结果还没有产出 plans，或者筛选条件没有命中。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>更新时间</TableHead>
                    <TableHead>范围</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>目标</TableHead>
                    <TableHead>Goal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedPlan?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedPlan(item)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(item.updated_at, { fallback: '-' })}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={scopeTone(item.scope_type)}>
                          {scopeLabel(item.scope_type)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-foreground">{item.plan_type}</TableCell>
                      <TableCell>
                        <StatusPill tone={planStatusTone(item.status)}>{item.status}</StatusPill>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.target_label}</TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">{formatPreview(item.goal, 120)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {planPagination?.page || 1} / {planPagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={planPage <= 1} onClick={() => setPlanPage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!planPagination || planPage >= planPagination.totalPages}
                  onClick={() => setPlanPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Plan"
            description="查看计划的目标、触发条件、时间窗和来源 reflection。"
            icon={<GitBranch className="h-4 w-4 text-primary" />}
          >
            {selectedPlan ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Plan Type</div>
                    <div className="mt-1 font-medium text-foreground">{selectedPlan.plan_type}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Status</div>
                    <div className="mt-1">
                      <StatusPill tone={planStatusTone(selectedPlan.status)}>{selectedPlan.status}</StatusPill>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Target</div>
                    <div className="mt-1 text-foreground">{selectedPlan.target_label}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Field Scope</div>
                    <div className="mt-1 text-foreground">{selectedPlan.target_field_scope || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Schedule</div>
                    <div className="mt-1 text-foreground">
                      {formatTimestamp(selectedPlan.scheduled_start_at || undefined, { fallback: '-' })} / {formatTimestamp(selectedPlan.scheduled_end_at || undefined, { fallback: '-' })}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Goal</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedPlan.goal}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Trigger Condition</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
                      {selectedPlan.trigger_condition || '-'}
                    </div>
                  </div>
                  <StructuredDataViewer
                    title="Raw Payload"
                    value={selectedPlan.raw_payload}
                    emptyLabel="No raw payload"
                    heightClassName="h-[12rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<GitBranch className="h-10 w-10" />}
                title="未选择 plan"
                description="点击上方表格中的一行查看计划详情。"
              />
            )}
          </SectionPanel>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
};

const StatusRow: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
};
