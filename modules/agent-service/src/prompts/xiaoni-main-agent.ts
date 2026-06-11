import { readXiaoniPromptFile, resolveXiaoniPromptFile } from './xiaoni-prompt-files';

export const XIAONI_MAIN_AGENT_PROMPT_ID = 'xiaoni-main-agent';
export const XIAONI_MAIN_AGENT_PROMPT_NAME = '小腻主AGENT';
export const XIAONI_MAIN_AGENT_DEFAULT_MODEL = 'gpt-5.5';
export const XIAONI_MAIN_AGENT_SYSTEM_PROMPT_FILE = 'system_prompt.md';

export const XIAONI_MAIN_AGENT_SYSTEM_PROMPT_PATH = resolveXiaoniPromptFile(
  XIAONI_MAIN_AGENT_SYSTEM_PROMPT_FILE
);

export function getXiaoniMainAgentSystemPrompt() {
  return readXiaoniPromptFile(XIAONI_MAIN_AGENT_SYSTEM_PROMPT_FILE).trimEnd();
}

export const XIAONI_MAIN_AGENT_SYSTEM_PROMPT = getXiaoniMainAgentSystemPrompt();
