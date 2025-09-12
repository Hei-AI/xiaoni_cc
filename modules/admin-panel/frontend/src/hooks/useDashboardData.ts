import { useQuery } from '@tanstack/react-query';

// API response types
interface ApiResponse<T> {
  success: boolean;
  data: T;
  total?: number;
  page?: number;
  limit?: number;
  timestamp: string;
}

interface ConversationData {
  id: string;
  user_id: number;
  user_message: string;
  ai_response: string;
  timestamp: string;
  response_time: number;
  model_name: string;
  message_id: number;
  reply_to_message_id: number | null;
  reply_to_text: string | null;
  created_at: string;
  updated_at: string;
}

interface DashboardStats {
  totalMessages: number;
  activeGroups: number;
  aiResponses: number;
  systemHealth: string;
  uptime: string;
  timestamp: string;
}

interface ConversationsParams {
  limit?: number;
  page?: number;
  user_id?: string;
  search?: string;
  sortBy?: 'created_at' | 'timestamp' | 'response_time';
  sortOrder?: 'asc' | 'desc';
}

// Hook for fetching dashboard statistics
export const useDashboardStats = () => {
  return useQuery<DashboardStats>({
    queryKey: ['dashboardStats'],
    queryFn: async (): Promise<DashboardStats> => {
      const response = await fetch('/api/dashboard/stats');
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard stats');
      }
      const data = await response.json();
      return data;
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every 1 minute
  });
};

// Hook for fetching conversations
export const useConversations = (params: ConversationsParams = {}) => {
  const { 
    limit = 20, 
    page = 1, 
    user_id, 
    search, 
    sortBy = 'timestamp',
    sortOrder = 'desc'
  } = params;
  
  return useQuery<ApiResponse<ConversationData[]>>({
    queryKey: ['conversations', { limit, page, user_id, search, sortBy, sortOrder }],
    queryFn: async (): Promise<ApiResponse<ConversationData[]>> => {
      const searchParams = new URLSearchParams({
        limit: limit.toString(),
        page: page.toString(),
        sort_by: sortBy,
        sort_order: sortOrder,
      });
      
      if (user_id) {
        searchParams.append('user_id', user_id);
      }
      
      if (search) {
        searchParams.append('search', search);
      }

      const response = await fetch(`/api/conversations?${searchParams}`);
      if (!response.ok) {
        throw new Error('Failed to fetch conversations');
      }
      
      const result = await response.json();
      
      // Client-side sorting as fallback if backend doesn't support it
      if (result.data && Array.isArray(result.data)) {
        result.data.sort((a: ConversationData, b: ConversationData) => {
          const aTime = new Date(a.timestamp || a.created_at).getTime();
          const bTime = new Date(b.timestamp || b.created_at).getTime();
          
          return sortOrder === 'desc' ? bTime - aTime : aTime - bTime;
        });
      }
      
      return result;
    },
    staleTime: 10000, // 10 seconds
  });
};

// Hook for fetching a single conversation
export const useConversation = (id: string) => {
  return useQuery<ApiResponse<ConversationData>>({
    queryKey: ['conversation', id],
    queryFn: async (): Promise<ApiResponse<ConversationData>> => {
      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch conversation');
      }
      return await response.json();
    },
    enabled: !!id,
  });
};

// Hook for fetching token statistics (for cost calculations)
export const useTokenStats = () => {
  return useQuery({
    queryKey: ['tokenStats'],
    queryFn: async () => {
      const response = await fetch('/api/tokens/stats');
      if (!response.ok) {
        throw new Error('Failed to fetch token stats');
      }
      return await response.json();
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every 1 minute
  });
};