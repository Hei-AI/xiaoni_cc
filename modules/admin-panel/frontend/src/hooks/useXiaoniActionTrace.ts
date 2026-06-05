import { useQuery } from '@tanstack/react-query';
import {
  ConversationTraceData,
  TraceSpanDetailData,
} from '@/types';

interface ApiResponse<T> {
  success: boolean;
  data: T;
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

export function useXiaoniActionEventTrace(eventId: string, autoRefreshEnabled = true) {
  return useQuery<ConversationTraceData>({
    queryKey: ['xiaoni-action-event-trace', eventId],
    queryFn: () => fetchJson<ConversationTraceData>(
      `/api/xiaoni/action-stream/events/${encodeURIComponent(eventId)}/trace`
    ),
    enabled: Boolean(eventId),
    refetchInterval: autoRefreshEnabled ? 30000 : false,
  });
}

export function useXiaoniActionEventTraceSpanDetail(eventId: string | null, spanId: string | null) {
  return useQuery<TraceSpanDetailData>({
    queryKey: ['xiaoni-action-event-trace-span-detail', eventId, spanId],
    queryFn: () => fetchJson<TraceSpanDetailData>(
      `/api/xiaoni/action-stream/events/${encodeURIComponent(eventId || '')}/trace/spans/${encodeURIComponent(spanId || '')}/detail`
    ),
    enabled: Boolean(eventId && spanId),
    staleTime: 30000,
  });
}
