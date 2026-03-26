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

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(item => extractTextFromContent(item))
      .filter(Boolean)
      .join('\n');
  }

  if (!content || typeof content !== 'object') {
    return '';
  }

  const record = content as Record<string, unknown>;

  if (typeof record.text === 'string') {
    return record.text;
  }

  if (Array.isArray(record.parts)) {
    return record.parts
      .map(part => extractTextFromContent(part))
      .filter(Boolean)
      .join('\n');
  }

  if (Array.isArray(record.content)) {
    return record.content
      .map(item => extractTextFromContent(item))
      .filter(Boolean)
      .join('\n');
  }

  return '';
};

const parseStructuredPrompt = (
  mixedPrompt: unknown
): { systemPrompt?: string; userInput?: string } | null => {
  try {
    const parsed = typeof mixedPrompt === 'string'
      ? JSON.parse(mixedPrompt) as unknown
      : mixedPrompt;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).input)
        ? ((parsed as Record<string, unknown>).input as unknown[])
        : null;
    const explicitInstructions = parsed && typeof parsed === 'object'
      ? extractTextFromContent((parsed as Record<string, unknown>).instructions).trim()
      : '';

    if (!items && !explicitInstructions) {
      return null;
    }

    const systemChunks: string[] = explicitInstructions ? [explicitInstructions] : [];
    const userChunks: string[] = [];

    (items || []).forEach(item => {
      if (!item || typeof item !== 'object') {
        return;
      }

      const record = item as Record<string, unknown>;

      if (record.type === 'message' && typeof record.role === 'string') {
        const text = extractTextFromContent(record.content).trim();
        if (!text) {
          return;
        }

        if (record.role === 'system') {
          systemChunks.push(text);
          return;
        }

        userChunks.push(text);
        return;
      }

      const text = extractTextFromContent(record).trim();
      if (text) {
        userChunks.push(text);
      }
    });

    if (systemChunks.length === 0 && userChunks.length === 0) {
      return null;
    }

    return {
      systemPrompt: systemChunks.join('\n\n').trim() || undefined,
      userInput: userChunks.join('\n\n').trim() || undefined
    };
  } catch {
    return null;
  }
};

// Helper function to separate system prompt from mixed prompt content
export const separatePromptContent = (
  templates: PromptTemplate[],
  templateName: string,
  mixedPrompt: unknown
): { systemPrompt: string; userInput: string } => {
  const templateSystemPrompt = getSystemPromptByTemplateName(templates, templateName);
  const parsedPrompt = parseStructuredPrompt(mixedPrompt);
  const systemPrompt = parsedPrompt?.systemPrompt || templateSystemPrompt;
  const userInput = parsedPrompt?.userInput || (typeof mixedPrompt === 'string' ? mixedPrompt : JSON.stringify(mixedPrompt, null, 2));

  return { systemPrompt, userInput };
};
