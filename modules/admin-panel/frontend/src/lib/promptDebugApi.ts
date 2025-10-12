export interface DebugSessionSummary {
  id: string;
  prompt_id: string;
  session_name: string;
  message_count?: number;
  input_count?: number;
  created_at: string;
  updated_at?: string;
  created_by?: string;
}

export interface DebugSessionDetail {
  id: string;
  prompt_id: string;
  session_name: string;
  messages: any[];
  input_count?: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface DebugSessionsResponse {
  success: boolean;
  data: {
    sessions: DebugSessionSummary[];
    pagination: any;
  };
}

export interface DebugSessionResponse {
  success: boolean;
  data: DebugSessionDetail;
}

export const fetchDebugSessions = async (promptId: string): Promise<DebugSessionsResponse> => {
  const response = await fetch(`/api/prompts/${promptId}/debug-sessions`);
  if (!response.ok) {
    throw new Error('Failed to fetch debug sessions');
  }
  return response.json();
};

export const fetchDebugSession = async (sessionId: string): Promise<DebugSessionResponse> => {
  const response = await fetch(`/api/debug-sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch debug session');
  }
  return response.json();
};

export const saveDebugSession = async (
  promptId: string,
  sessionName: string,
  messages: any[]
) => {
  const response = await fetch(`/api/prompts/${promptId}/debug-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_name: sessionName,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to save debug session');
  }

  return response.json();
};

export const deleteDebugSession = async (sessionId: string) => {
  const response = await fetch(`/api/debug-sessions/${sessionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete debug session');
  }

  return response.json();
};
