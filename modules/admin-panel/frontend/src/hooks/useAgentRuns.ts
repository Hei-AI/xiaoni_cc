import { useQuery } from '@tanstack/react-query';
import { AgentRunDetail, AgentRunListItem, AgentRunSessionSummary, ConversationTraceData } from '@/types';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  total?: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.statusText}`);
  }
  const payload = await response.json() as ApiResponse<T>;
  if (!payload.success) {
    throw new Error('Request failed');
  }
  return payload.data;
}

export function useRunSessions(search: string) {
  return useQuery<ApiResponse<AgentRunSessionSummary[]>>({
    queryKey: ['run-sessions', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set('search', search.trim());
      }
      const response = await fetch(`/api/runs/sessions?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch run sessions');
      }
      return response.json() as Promise<ApiResponse<AgentRunSessionSummary[]>>;
    },
    staleTime: 10000,
  });
}

export function useSessionRuns(sessionKey: string | null) {
  return useQuery<AgentRunListItem[]>({
    queryKey: ['session-runs', sessionKey],
    queryFn: () => fetchJson<AgentRunListItem[]>(`/api/runs/sessions/${encodeURIComponent(sessionKey || '')}`),
    enabled: Boolean(sessionKey),
    staleTime: 10000,
  });
}

export function useAgentRunDetail(runId: string | null) {
  return useQuery<AgentRunDetail>({
    queryKey: ['run-detail', runId],
    queryFn: () => fetchJson<AgentRunDetail>(`/api/runs/${runId}`),
    enabled: Boolean(runId),
    staleTime: 10000,
  });
}

export function useRunTrace(runId: string, autoRefreshEnabled = true) {
  return useQuery<ConversationTraceData>({
    queryKey: ['run-trace', runId],
    queryFn: () => fetchJson<ConversationTraceData>(`/api/runs/${runId}/trace`),
    enabled: Boolean(runId),
    refetchInterval: autoRefreshEnabled ? 30000 : false,
  });
}
