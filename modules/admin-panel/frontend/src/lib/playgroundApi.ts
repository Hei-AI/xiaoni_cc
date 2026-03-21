import type {
  PlaygroundCase,
  PlaygroundLibraryPayload,
  PlaygroundPromptInput,
  PlaygroundPromptMode,
  PlaygroundProviderConfig,
  PlaygroundRun,
} from '@/types/playground';

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new Error(payload.message || payload.error || 'Request failed');
  }
  return payload.data as T;
}

export async function fetchPlaygroundLibrary(search?: string, promptId?: string | null): Promise<PlaygroundLibraryPayload> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (promptId) params.set('promptId', promptId);
  const response = await fetch(`/api/playground/cases${params.toString() ? `?${params}` : ''}`);
  return parseResponse<PlaygroundLibraryPayload>(response);
}

export async function createCaseFromTraffic(trafficId: number, promptId?: string | null): Promise<PlaygroundCase> {
  const response = await fetch(`/api/playground/cases/from-traffic/${trafficId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(promptId ? { promptId } : {}),
  });
  return parseResponse<PlaygroundCase>(response);
}

export async function createCaseFromConversation(conversationId: string, promptId?: string | null): Promise<PlaygroundCase> {
  const response = await fetch(`/api/playground/cases/from-conversation/${conversationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(promptId ? { promptId } : {}),
  });
  return parseResponse<PlaygroundCase>(response);
}

export async function fetchPlaygroundCase(caseId: string): Promise<PlaygroundCase> {
  const response = await fetch(`/api/playground/cases/${caseId}`);
  return parseResponse<PlaygroundCase>(response);
}

export async function updatePlaygroundCase(caseId: string, payload: Partial<PlaygroundCase>): Promise<PlaygroundCase> {
  const response = await fetch(`/api/playground/cases/${caseId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<PlaygroundCase>(response);
}

export async function fetchPlaygroundRuns(caseId: string): Promise<PlaygroundRun[]> {
  const response = await fetch(`/api/playground/cases/${caseId}/runs`);
  return parseResponse<PlaygroundRun[]>(response);
}

export async function createPlaygroundRun(payload: {
  caseId: string;
  promptMode: PlaygroundPromptMode;
  promptId?: string | null;
  providerConfig: PlaygroundProviderConfig;
  promptInput: PlaygroundPromptInput;
  draftPrompt?: {
    systemInstruction?: string;
    userPromptTemplate?: string | null;
    contextVariables?: Record<string, unknown>;
  } | null;
}): Promise<PlaygroundRun> {
  const response = await fetch('/api/playground/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<PlaygroundRun>(response);
}

export async function clonePlaygroundRun(runId: string): Promise<PlaygroundRun> {
  const response = await fetch(`/api/playground/runs/${runId}/clone`, {
    method: 'POST',
  });
  return parseResponse<PlaygroundRun>(response);
}
