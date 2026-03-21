import { useQuery } from '@tanstack/react-query';
import { ConversationTraceData } from '../types';

export const useConversationTrace = (conversationId: string, autoRefreshEnabled: boolean = true) => {
  return useQuery({
    queryKey: ['conversation-trace', conversationId],
    queryFn: async (): Promise<ConversationTraceData> => {
      const response = await fetch(`/api/debug/conversation/${conversationId}/trace`);
      if (!response.ok) {
        throw new Error(`Failed to fetch conversation trace: ${response.statusText}`);
      }

      const payload = await response.json();
      if (!payload?.success || !payload?.data) {
        throw new Error(payload?.error || 'Malformed trace response');
      }

      return payload.data as ConversationTraceData;
    },
    enabled: Boolean(conversationId),
    refetchInterval: autoRefreshEnabled ? 30000 : false
  });
};
