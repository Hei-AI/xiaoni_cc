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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  CognitionCandidate,
  CognitionEdit,
  CognitionField,
  CognitionPatchEntityType,
  CognitionPatchPreviewResponse,
  CognitionEvidence,
  CognitionMemory,
  CognitionObservation,
  CognitionPlan,
  CognitionRelationship,
  patchCognitionBelief,
  patchCognitionMemory,
  patchCognitionRelationship,
  CognitionReflection,
  CognitionSelfModel,
  updateCognitionProactivity,
  useCognitionBeliefs,
  useCognitionEdits,
  useCognitionEvidence,
  useCognitionFieldDetail,
  useCognitionFields,
  useCognitionCandidates,
  useCognitionMemories,
  useCognitionObservations,
  useCognitionOverview,
  useCognitionPlans,
  useCognitionProactivity,
  useCognitionRelationships,
  useCognitionReflections,
  useCognitionSelfModels,
} from '@/lib/cognitionApi';

type CognitionTab =
  | 'workbench'
  | 'observations'
  | 'beliefs'
  | 'memories'
  | 'evidence'
  | 'reflections'
  | 'self-model'
  | 'plans'
  | 'relationships'
  | 'candidates'
  | 'fields'
  | 'edits';

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

function boundaryTone(boundary?: string | null): 'success' | 'warning' | 'neutral' | 'info' {
  if (boundary === 'allow_proactive') {
    return 'success';
  }
  if (boundary === 'observe_only') {
    return 'warning';
  }
  if (boundary === 'do_not_contact') {
    return 'neutral';
  }
  return 'info';
}

function fieldStatusTone(status: string): 'success' | 'warning' | 'neutral' | 'info' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'suppressed') {
    return 'warning';
  }
  return 'neutral';
}

type BeliefPatchFormState = {
  confidence: string;
  status: 'active' | 'stale' | 'revised';
};

type MemoryPatchFormState = {
  status: 'active' | 'disabled';
};

type RelationshipPatchFormState = {
  boundary_strategy: 'allow_proactive' | 'observe_only' | 'do_not_contact';
  boundary_notes: string;
};

export const CognitionPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<CognitionTab>('workbench');
  const [observationPage, setObservationPage] = useState(1);
  const [beliefPage, setBeliefPage] = useState(1);
  const [memoryPage, setMemoryPage] = useState(1);
  const [evidencePage, setEvidencePage] = useState(1);
  const [reflectionPage, setReflectionPage] = useState(1);
  const [selfModelPage, setSelfModelPage] = useState(1);
  const [planPage, setPlanPage] = useState(1);
  const [relationshipPage, setRelationshipPage] = useState(1);
  const [candidatePage, setCandidatePage] = useState(1);
  const [fieldPage, setFieldPage] = useState(1);
  const [editPage, setEditPage] = useState(1);
  const [observationScope, setObservationScope] = useState<'all' | 'private' | 'group'>('all');
  const [beliefScope, setBeliefScope] = useState<'all' | 'private' | 'group'>('all');
  const [memoryScope, setMemoryScope] = useState<'all' | 'private' | 'group' | 'self'>('all');
  const [evidenceScope, setEvidenceScope] = useState<'all' | 'private' | 'group' | 'self'>('all');
  const [planScope, setPlanScope] = useState<'all' | 'private' | 'group' | 'self'>('all');
  const [relationshipScope, setRelationshipScope] = useState<'all' | 'private' | 'group' | 'self'>('all');
  const [observationSearch, setObservationSearch] = useState('');
  const [beliefSearch, setBeliefSearch] = useState('');
  const [memorySearch, setMemorySearch] = useState('');
  const [evidenceSearch, setEvidenceSearch] = useState('');
  const [reflectionSearch, setReflectionSearch] = useState('');
  const [selfModelSearch, setSelfModelSearch] = useState('');
  const [planSearch, setPlanSearch] = useState('');
  const [relationshipSearch, setRelationshipSearch] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [editSearch, setEditSearch] = useState('');
  const [selectedObservation, setSelectedObservation] = useState<CognitionObservation | null>(null);
  const [selectedBelief, setSelectedBelief] = useState<CognitionBelief | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<CognitionMemory | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<CognitionEvidence | null>(null);
  const [selectedReflection, setSelectedReflection] = useState<CognitionReflection | null>(null);
  const [selectedSelfModel, setSelectedSelfModel] = useState<CognitionSelfModel | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<CognitionPlan | null>(null);
  const [selectedRelationship, setSelectedRelationship] = useState<CognitionRelationship | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<CognitionCandidate | null>(null);
  const [selectedField, setSelectedField] = useState<CognitionField | null>(null);
  const [selectedEdit, setSelectedEdit] = useState<CognitionEdit | null>(null);
  const [patchDialogOpen, setPatchDialogOpen] = useState(false);
  const [patchEntityType, setPatchEntityType] = useState<CognitionPatchEntityType>('belief');
  const [patchReason, setPatchReason] = useState('');
  const [patchPreviewResult, setPatchPreviewResult] = useState<CognitionPatchPreviewResponse['data'] | null>(null);
  const [beliefPatchForm, setBeliefPatchForm] = useState<BeliefPatchFormState>({
    confidence: '0.8',
    status: 'active',
  });
  const [memoryPatchForm, setMemoryPatchForm] = useState<MemoryPatchFormState>({
    status: 'disabled',
  });
  const [relationshipPatchForm, setRelationshipPatchForm] = useState<RelationshipPatchFormState>({
    boundary_strategy: 'observe_only',
    boundary_notes: '',
  });
  const [proactivityForm, setProactivityForm] = useState({
    followupEnabled: true,
    isPaused: false,
    maxPerRun: '1',
    retryDelayMinutes: '360',
    allowedUserIdsText: '',
    observedGroupIdsText: '',
    allowedGroupIdsText: '',
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
  const relationshipsQuery = useCognitionRelationships({
    page: relationshipPage,
    limit,
    scope: relationshipScope,
    search: relationshipSearch || undefined,
  });
  const candidatesQuery = useCognitionCandidates({
    page: candidatePage,
    limit,
    search: candidateSearch || undefined,
  });
  const fieldsQuery = useCognitionFields({
    page: fieldPage,
    limit,
    search: fieldSearch || undefined,
  });
  const fieldDetailQuery = useCognitionFieldDetail(selectedField?.field_key);
  const editsQuery = useCognitionEdits({
    page: editPage,
    limit,
    search: editSearch || undefined,
  });
  const proactivityQuery = useCognitionProactivity();

  const observations = observationsQuery.data?.data || [];
  const beliefs = beliefsQuery.data?.data || [];
  const memories = memoriesQuery.data?.data || [];
  const evidence = evidenceQuery.data?.data || [];
  const reflections = reflectionsQuery.data?.data || [];
  const selfModels = selfModelsQuery.data?.data || [];
  const plans = plansQuery.data?.data || [];
  const relationships = relationshipsQuery.data?.data || [];
  const candidates = candidatesQuery.data?.data || [];
  const fields = fieldsQuery.data?.data || [];
  const edits = editsQuery.data?.data || [];
  const observationPagination = observationsQuery.data?.pagination;
  const beliefPagination = beliefsQuery.data?.pagination;
  const memoryPagination = memoriesQuery.data?.pagination;
  const evidencePagination = evidenceQuery.data?.pagination;
  const reflectionPagination = reflectionsQuery.data?.pagination;
  const selfModelPagination = selfModelsQuery.data?.pagination;
  const planPagination = plansQuery.data?.pagination;
  const relationshipPagination = relationshipsQuery.data?.pagination;
  const candidatePagination = candidatesQuery.data?.pagination;
  const fieldPagination = fieldsQuery.data?.pagination;
  const editPagination = editsQuery.data?.pagination;
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
      observedGroupIdsText: proactivity.observedGroupIds.join(', '),
      allowedGroupIdsText: proactivity.allowedGroupIds.join(', '),
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

  useEffect(() => {
    if (relationships.length === 0) {
      setSelectedRelationship(null);
      return;
    }

    if (!selectedRelationship || !relationships.some((item) => item.id === selectedRelationship.id)) {
      setSelectedRelationship(relationships[0]);
    }
  }, [relationships, selectedRelationship]);

  useEffect(() => {
    if (candidates.length === 0) {
      setSelectedCandidate(null);
      return;
    }

    if (!selectedCandidate || !candidates.some((item) => item.id === selectedCandidate.id)) {
      setSelectedCandidate(candidates[0]);
    }
  }, [candidates, selectedCandidate]);

  useEffect(() => {
    if (fields.length === 0) {
      setSelectedField(null);
      return;
    }

    if (!selectedField || !fields.some((item) => item.id === selectedField.id)) {
      setSelectedField(fields[0]);
    }
  }, [fields, selectedField]);

  useEffect(() => {
    if (edits.length === 0) {
      setSelectedEdit(null);
      return;
    }

    if (!selectedEdit || !edits.some((item) => item.id === selectedEdit.id)) {
      setSelectedEdit(edits[0]);
    }
  }, [edits, selectedEdit]);

  const updateProactivityMutation = useMutation({
    mutationFn: (payload: {
      followup_enabled: boolean;
      is_paused: boolean;
      allowed_user_ids: number[];
      observed_group_ids: number[];
      allowed_group_ids: number[];
      max_per_run: number;
      retry_delay_ms: number;
    }) => updateCognitionProactivity(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognition-proactivity'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-plans'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-overview'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-candidates'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-fields'] });
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({
      entityType,
      recordId,
      reason,
      patch,
      previewOnly,
    }: {
      entityType: CognitionPatchEntityType;
      recordId: number;
      reason: string;
      patch: Record<string, unknown>;
      previewOnly: boolean;
    }) => {
      if (entityType === 'memory') {
        return patchCognitionMemory(recordId, { reason, patch, preview_only: previewOnly });
      }
      if (entityType === 'relationship') {
        return patchCognitionRelationship(recordId, { reason, patch, preview_only: previewOnly });
      }
      return patchCognitionBelief(recordId, { reason, patch, preview_only: previewOnly });
    },
    onSuccess: (response, variables) => {
      setPatchPreviewResult(response.data);
      if (variables.previewOnly) {
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['cognition-beliefs'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-memories'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-relationships'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-candidates'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-fields'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-field-detail'] });
      queryClient.invalidateQueries({ queryKey: ['cognition-edits'] });
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
      observed_group_ids: parseAllowedUserIds(proactivityForm.observedGroupIdsText),
      allowed_group_ids: parseAllowedUserIds(proactivityForm.allowedGroupIdsText),
      max_per_run: maxPerRun,
      retry_delay_ms: retryDelayMinutes * 60_000,
    });
  };

  const openRelationshipBoundaryPatch = (relationship: CognitionRelationship | null, boundary: string) => {
    if (!relationship) {
      return;
    }
    setSelectedRelationship(relationship);
    setPatchEntityType('relationship');
    setPatchReason('');
    setRelationshipPatchForm({
      boundary_strategy: boundary as RelationshipPatchFormState['boundary_strategy'],
      boundary_notes: relationship.boundary_notes || '',
    });
    setPatchPreviewResult(null);
    setPatchDialogOpen(true);
  };

  const openBeliefConfidencePatch = (belief: CognitionBelief | null, confidence: number, status?: 'active' | 'stale') => {
    if (!belief) {
      return;
    }
    setSelectedBelief(belief);
    setPatchEntityType('belief');
    setPatchReason('');
    setBeliefPatchForm({
      confidence: confidence.toString(),
      status: status || belief.status,
    });
    setPatchPreviewResult(null);
    setPatchDialogOpen(true);
  };

  const openMemoryStatusPatch = (memory: CognitionMemory | null, status: 'active' | 'disabled') => {
    if (!memory) {
      return;
    }
    setSelectedMemory(memory);
    setPatchEntityType('memory');
    setPatchReason('');
    setMemoryPatchForm({ status });
    setPatchPreviewResult(null);
    setPatchDialogOpen(true);
  };

  const resolvePatchRecordId = (): number | null => {
    if (patchEntityType === 'memory') {
      return selectedMemory?.record_id ?? null;
    }
    if (patchEntityType === 'relationship') {
      return selectedRelationship?.record_id ?? null;
    }
    return selectedBelief?.record_id ?? null;
  };

  const buildPatchPayload = (): Record<string, unknown> => {
    if (patchEntityType === 'relationship') {
      return {
        boundary_strategy: relationshipPatchForm.boundary_strategy,
        boundary_notes: relationshipPatchForm.boundary_notes.trim(),
      };
    }

    if (patchEntityType === 'memory') {
      return {
        status: memoryPatchForm.status,
      };
    }

    const confidence = Math.max(0, Math.min(1, Number.parseFloat(beliefPatchForm.confidence) || 0));
    return {
      confidence,
      status: beliefPatchForm.status,
    };
  };

  const handlePreviewPatch = async () => {
    const recordId = resolvePatchRecordId();
    if (!recordId) {
      return;
    }

    await patchMutation.mutateAsync({
      entityType: patchEntityType,
      recordId,
      reason: patchReason,
      patch: buildPatchPayload(),
      previewOnly: true,
    });
  };

  const handleCommitPatch = async () => {
    const recordId = resolvePatchRecordId();
    if (!recordId) {
      return;
    }

    await patchMutation.mutateAsync({
      entityType: patchEntityType,
      recordId,
      reason: patchReason,
      patch: buildPatchPayload(),
      previewOnly: false,
    });
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Cognition"
        title="小腻认知视图"
        description="围绕虚拟行走主链查看关系、candidate、followup 和纠偏收敛；深查时再下钻到原始 cognition 表。"
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
          <TabsTrigger value="workbench">Virtual Walk</TabsTrigger>
          <TabsTrigger value="observations">Observations</TabsTrigger>
          <TabsTrigger value="beliefs">Beliefs</TabsTrigger>
          <TabsTrigger value="memories">Memories</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="reflections">Reflections</TabsTrigger>
          <TabsTrigger value="self-model">Self Model</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="candidates">Candidates</TabsTrigger>
          <TabsTrigger value="fields">Fields</TabsTrigger>
          <TabsTrigger value="edits">Edits</TabsTrigger>
        </TabsList>

        <TabsContent value="workbench" className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionPanel
              title="关系 -> Candidate -> 行动"
              description="先看哪里、为什么看这里、为什么此刻不说话，都在这一层收口。"
              icon={<GitBranch className="h-4 w-4 text-primary" />}
              contentClassName="space-y-4"
            >
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">当前关系快照</CardTitle>
                    <CardDescription>边界决定能不能主动，不由热度自动放宽。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {selectedRelationship ? (
                      <>
                        <div className="font-medium text-foreground">{selectedRelationship.target_label}</div>
                        <StatusPill tone={boundaryTone(selectedRelationship.boundary_strategy)}>
                          {selectedRelationship.boundary_strategy || 'unknown'}
                        </StatusPill>
                        <div className="text-muted-foreground">{selectedRelationship.relationship_summary}</div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => openRelationshipBoundaryPatch(selectedRelationship, 'allow_proactive')}>
                            放开主动
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openRelationshipBoundaryPatch(selectedRelationship, 'observe_only')}>
                            改为观察
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openRelationshipBoundaryPatch(selectedRelationship, 'do_not_contact')}>
                            禁止联系
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">当前没有可编辑的 relationship snapshot。</div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">当前 Walk Candidate</CardTitle>
                    <CardDescription>candidate 是主动链正式上游，不是解释页面。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {selectedCandidate ? (
                      <>
                        <div className="font-medium text-foreground">{selectedCandidate.field_key}</div>
                        <div className="text-muted-foreground">{selectedCandidate.selected_reason}</div>
                        <div className="flex flex-wrap gap-2">
                          <StatusPill tone={selectedCandidate.can_speak_now ? 'success' : 'warning'}>
                            {selectedCandidate.can_speak_now ? 'can_speak_now' : 'observe_only'}
                          </StatusPill>
                          <StatusPill tone="info">
                            score {selectedCandidate.priority_score.toFixed(2)}
                          </StatusPill>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          触发源：{selectedCandidate.trigger_sources.join(', ') || 'none'}
                        </div>
                        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                          为什么没说话：{selectedCandidate.suppressed_reason || '当前未被 suppress，可进入 compiler。'}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">当前没有最新 candidate。</div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">当前行动来源</CardTitle>
                    <CardDescription>followup_queue 必须能追到 plan / memory / relationship / candidate 来源。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {plans.filter((plan) => plan.plan_type === 'followup_queue').slice(0, 3).map((plan) => (
                      <div key={plan.id} className="rounded-md border p-3">
                        <div className="font-medium text-foreground">{plan.goal}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{plan.trigger_condition || '无 trigger_condition'}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <StatusPill tone={planStatusTone(plan.status)}>{plan.status}</StatusPill>
                          <StatusPill tone="info">{plan.target_label}</StatusPill>
                        </div>
                      </div>
                    ))}
                    {plans.filter((plan) => plan.plan_type === 'followup_queue').length === 0 ? (
                      <div className="text-sm text-muted-foreground">当前没有 queued/active followup。</div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Walk Candidate 列表</CardTitle>
                    <CardDescription>统一池里比较私聊和群聊，先决定今天看哪里。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={candidateSearch}
                        onChange={(event) => {
                          setCandidateSearch(event.target.value);
                          setCandidatePage(1);
                        }}
                        placeholder="搜索 field_key、原因或目标"
                        className="pl-9"
                      />
                    </div>
                    {candidatesQuery.error ? (
                      <ErrorState onRetry={() => candidatesQuery.refetch()} />
                    ) : candidates.length === 0 ? (
                      <EmptyState
                        icon={<GitBranch className="h-10 w-10" />}
                        title="没有 candidate"
                        description="先触发 recompute 或等待新 observation 写入。"
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>场域</TableHead>
                            <TableHead>Score</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead>触发</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {candidates.map((item) => (
                            <TableRow
                              key={item.id}
                              className="cursor-pointer"
                              data-state={selectedCandidate?.id === item.id ? 'selected' : undefined}
                              onClick={() => {
                                setSelectedCandidate(item);
                                const matchedField = fields.find((field) => field.field_key === item.field_key);
                                if (matchedField) {
                                  setSelectedField(matchedField);
                                }
                              }}
                            >
                              <TableCell className="font-medium text-foreground">{item.field_key}</TableCell>
                              <TableCell>{item.priority_score.toFixed(2)}</TableCell>
                              <TableCell>
                                <StatusPill tone={item.can_speak_now ? 'success' : 'warning'}>
                                  {item.can_speak_now ? '可说' : '观察'}
                                </StatusPill>
                              </TableCell>
                              <TableCell className="max-w-[220px]">
                                <div className="line-clamp-2 text-sm text-muted-foreground">{item.trigger_sources.join(', ') || '-'}</div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>第 {candidatePagination?.page || 1} / {candidatePagination?.totalPages || 1} 页</span>
                      <Button variant="outline" size="sm" onClick={() => candidatesQuery.refetch()} disabled={candidatesQuery.isFetching}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${candidatesQuery.isFetching ? 'animate-spin' : ''}`} />
                        刷新 candidate
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">最小纠偏面</CardTitle>
                    <CardDescription>先做三类专用操作：关系边界、belief 置信/状态、memory 启停。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-md border p-3">
                      <div className="text-sm font-medium text-foreground">Belief 纠偏</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {selectedBelief ? `${selectedBelief.subject_name} / ${selectedBelief.title}` : '先在 Beliefs tab 选中一个 belief。'}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={!selectedBelief} onClick={() => openBeliefConfidencePatch(selectedBelief, 0.9, 'active')}>
                          提升到 0.90
                        </Button>
                        <Button size="sm" variant="outline" disabled={!selectedBelief} onClick={() => openBeliefConfidencePatch(selectedBelief, 0.45, 'active')}>
                          下调到 0.45
                        </Button>
                        <Button size="sm" variant="outline" disabled={!selectedBelief} onClick={() => openBeliefConfidencePatch(selectedBelief, selectedBelief?.confidence ?? 0.5, 'stale')}>
                          标记 stale
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="text-sm font-medium text-foreground">Memory 纠偏</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {selectedMemory ? `${selectedMemory.subject_name} / ${selectedMemory.memory_type}` : '先在 Memories tab 选中一条 stable memory。'}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={!selectedMemory} onClick={() => openMemoryStatusPatch(selectedMemory, 'disabled')}>
                          停用 memory
                        </Button>
                        <Button size="sm" variant="outline" disabled={!selectedMemory} onClick={() => openMemoryStatusPatch(selectedMemory, 'active')}>
                          恢复 active
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                      当前 field detail 会显示 candidate 决策链和 suppress reason；commit 之后会自动刷新 relationship、candidate、field、edits 和 plans。
                    </div>
                  </CardContent>
                </Card>
              </div>
            </SectionPanel>
          </div>
        </TabsContent>

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
            action={selectedBelief ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => openBeliefConfidencePatch(selectedBelief, 0.9, 'active')}>
                  提升到 0.90
                </Button>
                <Button variant="outline" size="sm" onClick={() => openBeliefConfidencePatch(selectedBelief, 0.45, 'active')}>
                  下调到 0.45
                </Button>
                <Button variant="outline" size="sm" onClick={() => openBeliefConfidencePatch(selectedBelief, selectedBelief.confidence, 'stale')}>
                  标记 stale
                </Button>
              </div>
            ) : null}
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
            action={selectedMemory ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => openMemoryStatusPatch(selectedMemory, 'disabled')}>
                  停用 memory
                </Button>
                <Button variant="outline" size="sm" onClick={() => openMemoryStatusPatch(selectedMemory, 'active')}>
                  恢复 active
                </Button>
              </div>
            ) : null}
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

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="proactivity-observed-groups">观察中的群列表</Label>
                        <Input
                          id="proactivity-observed-groups"
                          value={proactivityForm.observedGroupIdsText}
                          onChange={(event) => setProactivityForm((current) => ({ ...current, observedGroupIdsText: event.target.value }))}
                          placeholder="群号，逗号分隔；留空表示默认不进入观察层"
                        />
                        <div className="text-sm leading-6 text-muted-foreground">
                          这里控制 ingest 之后，哪些群会进入虚拟行走的 candidate / field 观察层。
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="proactivity-allowed-groups">允许主动的群列表</Label>
                        <Input
                          id="proactivity-allowed-groups"
                          value={proactivityForm.allowedGroupIdsText}
                          onChange={(event) => setProactivityForm((current) => ({ ...current, allowedGroupIdsText: event.target.value }))}
                          placeholder="群号，逗号分隔；留空表示默认不主动发言"
                        />
                        <div className="text-sm leading-6 text-muted-foreground">
                          旧群自动回复开关只用于初始迁移；当前虚拟行走是否能主动发群消息，以这里的白名单为准。
                        </div>
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
                        observed groups {proactivity?.observedGroupIds.length || 0}
                      </StatusPill>
                      <StatusPill tone="info">
                        proactive groups {proactivity?.allowedGroupIds.length || 0}
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
                      <StatusRow label="群观察名单">{String(proactivity?.observedGroupIds.length || 0)}</StatusRow>
                      <StatusRow label="群主动白名单">{String(proactivity?.allowedGroupIds.length || 0)}</StatusRow>
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

        <TabsContent value="relationships" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={relationshipSearch}
                  onChange={(event) => {
                    setRelationshipSearch(event.target.value);
                    setRelationshipPage(1);
                  }}
                  placeholder="搜索用户、群、关系摘要或边界"
                  className="pl-9"
                />
              </div>
              <Select
                value={relationshipScope}
                onValueChange={(value) => {
                  setRelationshipScope(value as 'all' | 'private' | 'group' | 'self');
                  setRelationshipPage(1);
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
                <Button variant="outline" size="sm" onClick={() => relationshipsQuery.refetch()} disabled={relationshipsQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${relationshipsQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="warning">
                  {relationshipPagination ? `${relationshipPagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Relationship Snapshots"
            description="当前关系快照、边界策略和证据链入口。"
            icon={<BrainCircuit className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {relationshipsQuery.error ? (
              <ErrorState onRetry={() => relationshipsQuery.refetch()} />
            ) : relationships.length === 0 ? (
              <EmptyState
                icon={<BrainCircuit className="h-10 w-10" />}
                title="没有 relationship snapshot"
                description="当前环境还没有关系快照，或筛选条件没有命中。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>更新时间</TableHead>
                    <TableHead>目标</TableHead>
                    <TableHead>边界</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>摘要</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relationships.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedRelationship?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedRelationship(item)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(item.updated_at, { fallback: '-' })}
                      </TableCell>
                      <TableCell className="text-foreground">{item.target_label}</TableCell>
                      <TableCell>
                        <StatusPill tone={boundaryTone(item.boundary_strategy)}>
                          {item.boundary_strategy || '-'}
                        </StatusPill>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={statusTone(item.status)}>{item.status}</StatusPill>
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">{formatPreview(item.relationship_summary, 120)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {relationshipPagination?.page || 1} / {relationshipPagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={relationshipPage <= 1} onClick={() => setRelationshipPage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!relationshipPagination || relationshipPage >= relationshipPagination.totalPages}
                  onClick={() => setRelationshipPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Relationship"
            description="查看关系摘要、互动风格、边界备注和反思来源。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
            action={selectedRelationship ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => openRelationshipBoundaryPatch(selectedRelationship, 'allow_proactive')}>
                  allow_proactive
                </Button>
                <Button variant="outline" size="sm" onClick={() => openRelationshipBoundaryPatch(selectedRelationship, 'observe_only')}>
                  observe_only
                </Button>
                <Button variant="outline" size="sm" onClick={() => openRelationshipBoundaryPatch(selectedRelationship, 'do_not_contact')}>
                  do_not_contact
                </Button>
              </div>
            ) : null}
          >
            {selectedRelationship ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <StatusRow label="目标">{selectedRelationship.target_label}</StatusRow>
                  <StatusRow label="Field Scope">{selectedRelationship.field_scope || '-'}</StatusRow>
                  <StatusRow label="Boundary">
                    <StatusPill tone={boundaryTone(selectedRelationship.boundary_strategy)}>
                      {selectedRelationship.boundary_strategy || '-'}
                    </StatusPill>
                  </StatusRow>
                  <StatusRow label="Status">
                    <StatusPill tone={statusTone(selectedRelationship.status)}>
                      {selectedRelationship.status}
                    </StatusPill>
                  </StatusRow>
                  <StatusRow label="Confidence">{String(selectedRelationship.confidence)}</StatusRow>
                  <StatusRow label="Last Observed">
                    {formatTimestamp(selectedRelationship.last_observed_at || undefined, { fallback: '-' })}
                  </StatusRow>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Relationship Summary</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedRelationship.relationship_summary}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Interaction Style</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
                      {selectedRelationship.interaction_style || '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Boundary Notes</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-foreground">
                      {selectedRelationship.boundary_notes || '-'}
                    </div>
                  </div>
                  <StructuredDataViewer
                    title="Notes / Evidence"
                    value={selectedRelationship.raw_payload}
                    emptyLabel="No notes json"
                    heightClassName="h-[14rem]"
                  />
                  <StructuredDataViewer
                    title="Edit History"
                    value={edits
                      .filter((edit) => edit.entity_type === 'relationship' && edit.entity_id === selectedRelationship.record_id)
                      .slice(0, 8)}
                    emptyLabel="No edit history"
                    heightClassName="h-[12rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<BrainCircuit className="h-10 w-10" />}
                title="未选择 relationship"
                description="点击上方表格中的一行查看关系快照详情。"
              />
            )}
          </SectionPanel>
        </TabsContent>

        <TabsContent value="candidates" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={candidateSearch}
                  onChange={(event) => {
                    setCandidateSearch(event.target.value);
                    setCandidatePage(1);
                  }}
                  placeholder="搜索 candidate / field / suppress reason"
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => candidatesQuery.refetch()} disabled={candidatesQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${candidatesQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="info">
                  {candidatePagination ? `${candidatePagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Virtual Walk Candidates"
            description="candidate 先决定看哪里，再把能说的话送入 compiler。"
            icon={<GitBranch className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {candidatesQuery.error ? (
              <ErrorState onRetry={() => candidatesQuery.refetch()} />
            ) : candidates.length === 0 ? (
              <EmptyState
                icon={<GitBranch className="h-10 w-10" />}
                title="没有 candidate 数据"
                description="先触发 recompute 或等待后台 tick。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>Selected Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedCandidate?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedCandidate(item)}
                    >
                      <TableCell className="font-medium text-foreground">{item.field_key}</TableCell>
                      <TableCell>{item.priority_score.toFixed(2)}</TableCell>
                      <TableCell>
                        <StatusPill tone={item.can_speak_now ? 'success' : 'warning'}>
                          {item.can_speak_now ? 'can_speak_now' : 'suppressed'}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">{item.selected_reason}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionPanel>

          <SectionPanel
            title="选中 Candidate"
            description="这里是“为什么今天看这里”“为什么暂时不说话”的单点解释。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            {selectedCandidate ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <StatusRow label="Field">{selectedCandidate.field_key}</StatusRow>
                  <StatusRow label="Priority">{selectedCandidate.priority_score.toFixed(2)}</StatusRow>
                  <StatusRow label="Can Speak Now">
                    <StatusPill tone={selectedCandidate.can_speak_now ? 'success' : 'warning'}>
                      {selectedCandidate.can_speak_now ? 'true' : 'false'}
                    </StatusPill>
                  </StatusRow>
                  <StatusRow label="Triggers">{selectedCandidate.trigger_sources.join(', ') || '-'}</StatusRow>
                  <StatusRow label="Suppression">{selectedCandidate.suppressed_reason || '-'}</StatusRow>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Selected Reason</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedCandidate.selected_reason}
                    </div>
                  </div>
                  <StructuredDataViewer
                    title="Compiler Inputs"
                    value={selectedCandidate.compiler_inputs}
                    emptyLabel="No compiler inputs"
                    heightClassName="h-[14rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<GitBranch className="h-10 w-10" />}
                title="未选择 candidate"
                description="点击上方表格中的一行查看 candidate 详情。"
              />
            )}
          </SectionPanel>
        </TabsContent>

        <TabsContent value="fields" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={fieldSearch}
                  onChange={(event) => {
                    setFieldSearch(event.target.value);
                    setFieldPage(1);
                  }}
                  placeholder="搜索 field key / title / suppression reason"
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fieldsQuery.refetch()} disabled={fieldsQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${fieldsQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="info">
                  {fieldPagination ? `${fieldPagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Virtual Walk Fields"
            description="查看当前场域优先级、抑制原因和解释链。"
            icon={<Database className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {fieldsQuery.error ? (
              <ErrorState onRetry={() => fieldsQuery.refetch()} />
            ) : fields.length === 0 ? (
              <EmptyState
                icon={<Database className="h-10 w-10" />}
                title="没有 field 数据"
                description="先触发一次 recompute 或等待后台 tick。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Boundary</TableHead>
                    <TableHead>Suppression</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedField?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedField(item)}
                    >
                      <TableCell>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{item.title}</div>
                          <div className="text-xs text-muted-foreground">{item.field_key}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={fieldStatusTone(item.status)}>{item.status}</StatusPill>
                      </TableCell>
                      <TableCell className="text-foreground">{item.priority_score.toFixed(4)}</TableCell>
                      <TableCell className="text-foreground">{item.plan_score.toFixed(4)}</TableCell>
                      <TableCell className="text-foreground">{item.boundary_penalty.toFixed(4)}</TableCell>
                      <TableCell className="max-w-[240px] text-sm text-muted-foreground">{item.suppression_reason || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {fieldPagination?.page || 1} / {fieldPagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={fieldPage <= 1} onClick={() => setFieldPage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!fieldPagination || fieldPage >= fieldPagination.totalPages}
                  onClick={() => setFieldPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Field"
            description="查看 score、candidate 和边连接，解释为什么系统现在看向这里，以及为什么暂时不说话。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            {selectedField ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <StatusRow label="Field Key">{selectedField.field_key}</StatusRow>
                  <StatusRow label="Scope">{selectedField.field_scope}</StatusRow>
                  <StatusRow label="Status">
                    <StatusPill tone={fieldStatusTone(selectedField.status)}>
                      {selectedField.status}
                    </StatusPill>
                  </StatusRow>
                  <StatusRow label="Priority">{selectedField.priority_score.toFixed(4)}</StatusRow>
                  <StatusRow label="Suppression">{selectedField.suppression_reason || '-'}</StatusRow>
                  <StatusRow label="Last Active">
                    {formatTimestamp(selectedField.last_active_at, { fallback: '-' })}
                  </StatusRow>
                </div>
                <div className="space-y-3">
                  <StructuredDataViewer
                    title="Latest Score Explanation"
                    value={fieldDetailQuery.data?.data.scores?.[0]?.explanation_json ?? selectedField.raw_payload}
                    emptyLabel="No score explanation"
                    heightClassName="h-[10rem]"
                  />
                  <StructuredDataViewer
                    title="Score History"
                    value={fieldDetailQuery.data?.data.scores ?? []}
                    emptyLabel="No score history"
                    heightClassName="h-[10rem]"
                  />
                  <StructuredDataViewer
                    title="Candidates / Why Not Speaking"
                    value={fieldDetailQuery.data?.data.candidates ?? []}
                    emptyLabel="No candidate detail"
                    heightClassName="h-[10rem]"
                  />
                  <StructuredDataViewer
                    title="Recent Actions"
                    value={fieldDetailQuery.data?.data.recent_action_logs ?? []}
                    emptyLabel="No action logs"
                    heightClassName="h-[10rem]"
                  />
                  <StructuredDataViewer
                    title="Recent Feedback"
                    value={fieldDetailQuery.data?.data.recent_feedback_events ?? []}
                    emptyLabel="No feedback events"
                    heightClassName="h-[10rem]"
                  />
                  <StructuredDataViewer
                    title="Edges"
                    value={fieldDetailQuery.data?.data.edges ?? []}
                    emptyLabel="No edges"
                    heightClassName="h-[10rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Database className="h-10 w-10" />}
                title="未选择 field"
                description="点击上方表格中的一行查看场域详情。"
              />
            )}
          </SectionPanel>
        </TabsContent>

        <TabsContent value="edits" className="space-y-5">
          <FilterBar>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={editSearch}
                  onChange={(event) => {
                    setEditSearch(event.target.value);
                    setEditPage(1);
                  }}
                  placeholder="搜索实体类型、reason、operator"
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => editsQuery.refetch()} disabled={editsQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${editsQuery.isFetching ? 'animate-spin' : ''}`} />
                  刷新列表
                </Button>
                <StatusPill tone="warning">
                  {editPagination ? `${editPagination.total} rows` : 'loading'}
                </StatusPill>
              </div>
            </div>
          </FilterBar>

          <SectionPanel
            title="Cognition Edit Audit"
            description="查看每次纠偏的 before / after / impact 和操作理由。"
            icon={<FileText className="h-4 w-4 text-primary" />}
            contentClassName="pt-0"
          >
            {editsQuery.error ? (
              <ErrorState onRetry={() => editsQuery.refetch()} />
            ) : edits.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-10 w-10" />}
                title="没有 cognition edit"
                description="做一次 commit patch 后，这里会出现完整审计记录。"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>实体</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {edits.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      data-state={selectedEdit?.id === item.id ? 'selected' : undefined}
                      onClick={() => setSelectedEdit(item)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(item.created_at, { fallback: '-' })}
                      </TableCell>
                      <TableCell className="text-foreground">{item.entity_type} #{item.entity_id ?? '-'}</TableCell>
                      <TableCell>
                        <StatusPill tone="info">{item.action_type}</StatusPill>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.operator_id}</TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="line-clamp-2 text-sm leading-6 text-foreground">{formatPreview(item.reason, 120)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                第 {editPagination?.page || 1} / {editPagination?.totalPages || 1} 页
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={editPage <= 1} onClick={() => setEditPage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!editPagination || editPage >= editPagination.totalPages}
                  onClick={() => setEditPage((page) => page + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            title="选中 Edit"
            description="审计记录的完整 before / after / impact。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            {selectedEdit ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <StatusRow label="Entity">{selectedEdit.entity_type} #{selectedEdit.entity_id ?? '-'}</StatusRow>
                  <StatusRow label="Action">{selectedEdit.action_type}</StatusRow>
                  <StatusRow label="Operator">{selectedEdit.operator_id}</StatusRow>
                  <StatusRow label="Created At">
                    {formatTimestamp(selectedEdit.created_at, { fallback: '-' })}
                  </StatusRow>
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Reason</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-6 text-foreground">
                      {selectedEdit.reason}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <StructuredDataViewer
                    title="Before"
                    value={selectedEdit.before_json}
                    emptyLabel="No before json"
                    heightClassName="h-[8rem]"
                  />
                  <StructuredDataViewer
                    title="After"
                    value={selectedEdit.after_json}
                    emptyLabel="No after json"
                    heightClassName="h-[8rem]"
                  />
                  <StructuredDataViewer
                    title="Impact"
                    value={selectedEdit.impact_json}
                    emptyLabel="No impact json"
                    heightClassName="h-[8rem]"
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<FileText className="h-10 w-10" />}
                title="未选择 edit"
                description="点击上方表格中的一行查看纠偏审计详情。"
              />
            )}
          </SectionPanel>
        </TabsContent>
      </Tabs>

      <Dialog open={patchDialogOpen} onOpenChange={setPatchDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>专用纠偏 Preview / Commit</DialogTitle>
            <DialogDescription>
              先 preview，再 commit。当前目标是 {patchEntityType}，默认走专用表单而不是通用 JSON patch。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="patch-reason">Reason</Label>
                <Input
                  id="patch-reason"
                  value={patchReason}
                  onChange={(event) => setPatchReason(event.target.value)}
                  placeholder="说明这次纠偏为什么必要"
                />
              </div>
              {patchEntityType === 'belief' ? (
                <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="belief-confidence">Confidence</Label>
                    <Input
                      id="belief-confidence"
                      value={beliefPatchForm.confidence}
                      onChange={(event) => setBeliefPatchForm((current) => ({ ...current, confidence: event.target.value }))}
                      placeholder="0.72"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="belief-status">Status</Label>
                    <Select
                      value={beliefPatchForm.status}
                      onValueChange={(value) =>
                        setBeliefPatchForm((current) => ({
                          ...current,
                          status: value as BeliefPatchFormState['status'],
                        }))
                      }
                    >
                      <SelectTrigger id="belief-status">
                        <SelectValue placeholder="选择 status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="stale">stale</SelectItem>
                        <SelectItem value="revised">revised</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
              {patchEntityType === 'memory' ? (
                <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="memory-status">Status</Label>
                    <Select
                      value={memoryPatchForm.status}
                      onValueChange={(value) =>
                        setMemoryPatchForm({ status: value as MemoryPatchFormState['status'] })
                      }
                    >
                      <SelectTrigger id="memory-status">
                        <SelectValue placeholder="选择 status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
              {patchEntityType === 'relationship' ? (
                <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="relationship-boundary">Boundary</Label>
                    <Select
                      value={relationshipPatchForm.boundary_strategy}
                      onValueChange={(value) =>
                        setRelationshipPatchForm((current) => ({
                          ...current,
                          boundary_strategy: value as RelationshipPatchFormState['boundary_strategy'],
                        }))
                      }
                    >
                      <SelectTrigger id="relationship-boundary">
                        <SelectValue placeholder="选择 boundary" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="allow_proactive">allow_proactive</SelectItem>
                        <SelectItem value="observe_only">observe_only</SelectItem>
                        <SelectItem value="do_not_contact">do_not_contact</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="relationship-notes">Boundary Notes</Label>
                    <Input
                      id="relationship-notes"
                      value={relationshipPatchForm.boundary_notes}
                      onChange={(event) =>
                        setRelationshipPatchForm((current) => ({
                          ...current,
                          boundary_notes: event.target.value,
                        }))
                      }
                      placeholder="说明为什么要调整边界"
                    />
                  </div>
                </div>
              ) : null}
              <StructuredDataViewer
                title="Computed Patch"
                value={buildPatchPayload()}
                emptyLabel="No patch payload"
                heightClassName="h-[10rem]"
              />
              {patchMutation.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {patchMutation.error instanceof Error ? patchMutation.error.message : '纠偏请求失败'}
                </div>
              ) : null}
            </div>
            <div className="space-y-3">
              <StructuredDataViewer
                title="Preview Result"
                value={patchPreviewResult}
                emptyLabel="还没有 preview 结果"
                heightClassName="h-[22rem]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPatchDialogOpen(false)}>
              关闭
            </Button>
            <Button variant="outline" onClick={() => void handlePreviewPatch()} disabled={patchMutation.isPending}>
              <RefreshCw className={`mr-2 h-4 w-4 ${patchMutation.isPending ? 'animate-spin' : ''}`} />
              Preview
            </Button>
            <Button onClick={() => void handleCommitPatch()} disabled={patchMutation.isPending || !patchPreviewResult}>
              Commit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
