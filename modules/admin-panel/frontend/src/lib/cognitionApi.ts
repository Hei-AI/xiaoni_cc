import { useQuery } from '@tanstack/react-query';

export type CognitionObservationScope = 'all' | 'private' | 'group';
export type CognitionBeliefScope = 'all' | 'private' | 'group';
export type CognitionMemoryScope = 'all' | 'private' | 'group' | 'self';

export interface CognitionOverview {
  observations: {
    total: number;
    private_total: number;
    group_total: number;
    last_24h: number;
    last_7d: number;
    latest_at: string | null;
  };
  beliefs: {
    total: number;
    active_total: number;
    revised_total: number;
    stale_total: number;
    latest_at: string | null;
  };
  memories: {
    total: number;
    active_total: number;
    revised_total: number;
    latest_at: string | null;
  };
  evidence: {
    total: number;
    latest_at: string | null;
  };
  reflections: {
    total: number;
    completed_total: number;
    failed_total: number;
    latest_at: string | null;
  };
  self_models: {
    total: number;
    current_total: number;
    latest_at: string | null;
  };
  plans: {
    total: number;
    queued_total: number;
    active_total: number;
    completed_total: number;
    latest_at: string | null;
  };
}

export interface CognitionObservation {
  id: string;
  record_id: number;
  scope_type: 'private_chat' | 'group_chat' | 'tool_channel';
  subject_type: 'user' | 'group' | 'system';
  subject_id: number | string;
  subject_name: string;
  source_table: 'agent_observations';
  conversation_id: string | null;
  message_id: number | null;
  sender_id: number;
  sender_role: 'user' | 'bot' | 'system';
  content_type: 'text';
  source_type: 'incoming_message' | 'outgoing_message' | 'reply_anchor' | 'tool_result' | 'tick';
  message_type: 'private' | 'group' | null;
  content: string;
  summary: string;
  sent_at: string;
  tool_payload_ref?: string | null;
  counterparty_ids?: number[] | null;
  raw_payload?: unknown;
  created_at: string;
  updated_at: string;
}

export interface CognitionBelief {
  id: string;
  record_id: number;
  scope_type: 'private_user' | 'group_context' | 'self_global';
  subject_type: 'user' | 'group' | 'self' | 'conversation';
  subject_id: number | string;
  subject_name: string;
  source_table: 'agent_beliefs';
  title: string;
  content: string;
  detail: string | null;
  belief_key: string;
  polarity: 'positive' | 'negative' | 'neutral';
  confidence: number;
  status: 'active' | 'revised' | 'stale';
  observation_count: number;
  last_evidence_id: number | null;
  first_observed_at: string;
  last_observed_at: string;
  updated_at: string;
  created_at: string | null;
}

export interface CognitionMemory {
  id: string;
  record_id: number;
  scope_type: 'private_user' | 'group_context' | 'self_global' | 'local_field' | string;
  subject_type: 'user' | 'group' | 'self' | 'conversation' | string;
  subject_id: number | string;
  subject_name: string;
  source_table: 'agent_memories';
  memory_type: string;
  content: string;
  summary: string | null;
  confidence: number;
  salience: number;
  status: 'active' | 'revised' | 'stale' | 'disabled' | string;
  source_kind: string | null;
  promoted_to_global: number | boolean | null;
  last_evidence_id: number | null;
  last_recalled_at: string | null;
  raw_payload?: unknown;
  created_at: string;
  updated_at: string;
}

export interface CognitionEvidence {
  id: string;
  record_id: number;
  memory_id: number | null;
  memory_scope: 'private_user' | 'group_context' | 'self_global' | 'local_field' | string;
  source_type: string;
  source_table: string;
  source_record_id: number | string | null;
  quote: string | null;
  evidence_text: string | null;
  confidence: number | null;
  raw_payload?: unknown;
  created_at: string;
}

export interface CognitionReflection {
  id: string;
  record_id: number;
  reflection_kind: 'daily' | 'weekly' | 'promotion' | string;
  reflection_key: string;
  status: 'completed' | 'failed' | string;
  summary: string | null;
  source_belief_ids: number[];
  source_observation_ids: number[];
  promoted_memory_ids: number[];
  source_belief_count: number;
  promoted_memory_count: number;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  raw_payload?: unknown;
}

export interface CognitionSelfModel {
  id: string;
  record_id: number;
  identity_summary: string | null;
  core_traits: string[];
  long_term_goals: string[];
  current_concerns: string[];
  availability: string | null;
  energy: string | null;
  source_reflection_id: number | null;
  is_current: boolean;
  created_at: string;
  updated_at: string;
  raw_payload?: unknown;
}

export interface CognitionPlan {
  id: string;
  record_id: number;
  scope_type: 'private_user' | 'group_context' | 'self_global' | string;
  target_label: string;
  plan_type: 'weekly_focus' | 'day_plan' | 'followup_queue' | 'micro_intention' | string;
  target_field_scope: string | null;
  target_user_id: number | null;
  target_group_id: number | null;
  goal: string;
  trigger_condition: string | null;
  status: 'queued' | 'active' | 'completed' | 'cancelled' | string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  source_reflection_id: number | null;
  created_at: string;
  updated_at: string;
  raw_payload?: unknown;
}

export interface CognitionProactivityState {
  followupEnabled: boolean;
  isPaused: boolean;
  allowedUserIds: number[];
  maxPerRun: number;
  retryDelayMs: number;
  queuedFollowups: number;
  activeFollowups: number;
  recentActionLogCount: number;
  lastActionAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  source: 'database' | 'defaults';
}

export interface CognitionOverviewResponse {
  success: boolean;
  data: CognitionOverview;
  timestamp: string;
}

export interface CognitionProactivityResponse {
  success: boolean;
  data: CognitionProactivityState;
  timestamp: string;
}

export interface CognitionListResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  timestamp: string;
}

export interface CognitionListParams {
  page?: number;
  limit?: number;
  scope?: CognitionObservationScope;
  search?: string;
}

export interface CognitionMemoryListParams {
  page?: number;
  limit?: number;
  scope?: CognitionMemoryScope;
  search?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return response.json();
}

async function sendJson<T>(url: string, method: 'PATCH', body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || payload?.error || `Failed to ${method} ${url}`);
  }
  return response.json();
}

export const fetchCognitionOverview = async (): Promise<CognitionOverviewResponse> => {
  return fetchJson<CognitionOverviewResponse>('/api/cognition/overview');
};

export const fetchCognitionObservations = async (
  params: CognitionListParams = {}
): Promise<CognitionListResponse<CognitionObservation>> => {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));
  query.set('scope', params.scope ?? 'all');
  if (params.search) {
    query.set('search', params.search);
  }
  return fetchJson<CognitionListResponse<CognitionObservation>>(`/api/cognition/observations?${query.toString()}`);
};

export const fetchCognitionBeliefs = async (
  params: CognitionListParams = {}
): Promise<CognitionListResponse<CognitionBelief>> => {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));
  query.set('scope', params.scope ?? 'all');
  if (params.search) {
    query.set('search', params.search);
  }
  return fetchJson<CognitionListResponse<CognitionBelief>>(`/api/cognition/beliefs?${query.toString()}`);
};

export const fetchCognitionMemories = async (
  params: CognitionMemoryListParams = {}
): Promise<CognitionListResponse<CognitionMemory>> => {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));
  query.set('scope', params.scope ?? 'all');
  if (params.search) {
    query.set('search', params.search);
  }
  return fetchJson<CognitionListResponse<CognitionMemory>>(`/api/cognition/memories?${query.toString()}`);
};

export const fetchCognitionEvidence = async (
  params: CognitionMemoryListParams = {}
): Promise<CognitionListResponse<CognitionEvidence>> => {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));
  query.set('scope', params.scope ?? 'all');
  if (params.search) {
    query.set('search', params.search);
  }
  return fetchJson<CognitionListResponse<CognitionEvidence>>(`/api/cognition/evidence?${query.toString()}`);
};

export const fetchCognitionReflections = async (
  params: CognitionListParams = {}
): Promise<CognitionListResponse<CognitionReflection>> => {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));
  if (params.search) {
    query.set('search', params.search);
  }
  return fetchJson<CognitionListResponse<CognitionReflection>>(`/api/cognition/reflections?${query.toString()}`);
};

export const fetchCognitionSelfModels = async (
  params: CognitionListParams = {}
): Promise<CognitionListResponse<CognitionSelfModel>> => {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));
  if (params.search) {
    query.set('search', params.search);
  }
  return fetchJson<CognitionListResponse<CognitionSelfModel>>(`/api/cognition/self-model?${query.toString()}`);
};

export const fetchCognitionPlans = async (
  params: CognitionMemoryListParams = {}
): Promise<CognitionListResponse<CognitionPlan>> => {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));
  query.set('scope', params.scope ?? 'all');
  if (params.search) {
    query.set('search', params.search);
  }
  return fetchJson<CognitionListResponse<CognitionPlan>>(`/api/cognition/plans?${query.toString()}`);
};

export const fetchCognitionProactivity = async (): Promise<CognitionProactivityResponse> => {
  return fetchJson<CognitionProactivityResponse>('/api/cognition/proactivity');
};

export const updateCognitionProactivity = async (payload: {
  followup_enabled?: boolean;
  is_paused?: boolean;
  allowed_user_ids?: number[];
  max_per_run?: number;
  retry_delay_ms?: number;
}): Promise<CognitionProactivityResponse> => {
  return sendJson<CognitionProactivityResponse>('/api/cognition/proactivity', 'PATCH', payload);
};

export const useCognitionOverview = () => {
  return useQuery({
    queryKey: ['cognition-overview'],
    queryFn: fetchCognitionOverview,
    staleTime: 30_000,
  });
};

export const useCognitionObservations = (params: CognitionListParams) => {
  return useQuery({
    queryKey: ['cognition-observations', params],
    queryFn: () => fetchCognitionObservations(params),
    staleTime: 10_000,
  });
};

export const useCognitionBeliefs = (params: CognitionListParams) => {
  return useQuery({
    queryKey: ['cognition-beliefs', params],
    queryFn: () => fetchCognitionBeliefs(params),
    staleTime: 10_000,
  });
};

export const useCognitionMemories = (params: CognitionMemoryListParams) => {
  return useQuery({
    queryKey: ['cognition-memories', params],
    queryFn: () => fetchCognitionMemories(params),
    staleTime: 10_000,
  });
};

export const useCognitionEvidence = (params: CognitionMemoryListParams) => {
  return useQuery({
    queryKey: ['cognition-evidence', params],
    queryFn: () => fetchCognitionEvidence(params),
    staleTime: 10_000,
  });
};

export const useCognitionReflections = (params: CognitionListParams) => {
  return useQuery({
    queryKey: ['cognition-reflections', params],
    queryFn: () => fetchCognitionReflections(params),
    staleTime: 10_000,
  });
};

export const useCognitionSelfModels = (params: CognitionListParams) => {
  return useQuery({
    queryKey: ['cognition-self-models', params],
    queryFn: () => fetchCognitionSelfModels(params),
    staleTime: 10_000,
  });
};

export const useCognitionPlans = (params: CognitionMemoryListParams) => {
  return useQuery({
    queryKey: ['cognition-plans', params],
    queryFn: () => fetchCognitionPlans(params),
    staleTime: 10_000,
  });
};

export const useCognitionProactivity = () => {
  return useQuery({
    queryKey: ['cognition-proactivity'],
    queryFn: fetchCognitionProactivity,
    staleTime: 10_000,
  });
};
