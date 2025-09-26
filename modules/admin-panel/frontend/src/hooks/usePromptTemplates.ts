import { useQuery } from '@tanstack/react-query';

interface PromptTemplate {
  id: string;
  agent_type: string;
  prompt_name: string;
  system_instructions: string[];
  user_prompt_template: string | null;
  context_variables: any;
  model_config: any;
  model_name: string;
  allowed_token_ids: number[] | null;
  is_active: number;
  version: number;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface PromptTemplatesResponse {
  success: boolean;
  data: PromptTemplate[];
  total: number;
  timestamp: string;
}

export const usePromptTemplates = () => {
  return useQuery({
    queryKey: ['promptTemplates'],
    queryFn: async (): Promise<PromptTemplate[]> => {
      const response = await fetch('/api/prompts');

      if (!response.ok) {
        throw new Error(`Failed to fetch prompt templates: ${response.statusText}`);
      }

      const data: PromptTemplatesResponse = await response.json();
      return data.data || [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });
};

// Helper function to get system prompt by template name
export const getSystemPromptByTemplateName = (
  templates: PromptTemplate[],
  templateName: string
): string => {
  const template = templates.find(t => t.prompt_name === templateName);
  if (!template) return '';

  try {
    const instructions = Array.isArray(template.system_instructions)
      ? template.system_instructions
      : JSON.parse(template.system_instructions);
    return Array.isArray(instructions) ? instructions.join('\n') : String(instructions);
  } catch (e) {
    return String(template.system_instructions);
  }
};

// Helper function to separate system prompt from mixed prompt content
export const separatePromptContent = (
  templates: PromptTemplate[],
  templateName: string,
  mixedPrompt: string
): { systemPrompt: string; userInput: string } => {
  const systemPrompt = getSystemPromptByTemplateName(templates, templateName);

  // The mixed prompt contains both system context and user input
  // For now, we treat the entire mixed content as user input since it contains context
  // In a proper implementation, we should get the actual user message separately
  const userInput = mixedPrompt;

  return { systemPrompt, userInput };
};