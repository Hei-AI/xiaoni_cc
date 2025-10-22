export interface RegistryFunctionDefinition {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  parametersSchema: Record<string, any>;
  category?: string;
  tags?: string[];
  invokeMethod?: string;
  sideEffect?: boolean;
  expectResponse?: boolean;
}

export interface FunctionRegistryListResponse {
  items: RegistryFunctionDefinition[];
  total: number;
}

export interface PromptFunctionBindingResponse {
  promptId: string;
  functions: RegistryFunctionDefinition[];
}

export const fetchFunctionRegistryFunctions = async (): Promise<FunctionRegistryListResponse> => {
  const response = await fetch('/api/function-registry/functions');
  if (!response.ok) {
    throw new Error('Failed to fetch function registry list');
  }
  return response.json();
};

export const fetchPromptFunctionBindings = async (
  promptId: string
): Promise<PromptFunctionBindingResponse> => {
  const response = await fetch(`/api/function-registry/prompts/${promptId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch prompt function bindings');
  }
  return response.json();
};
