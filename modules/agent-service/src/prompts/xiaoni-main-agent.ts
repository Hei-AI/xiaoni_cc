import { readXiaoniPromptFile, resolveXiaoniPromptFile } from './xiaoni-prompt-files';

export const XIAONI_MAIN_AGENT_PROMPT_ID = 'xiaoni-main-agent';
export const XIAONI_MAIN_AGENT_PROMPT_NAME = '小腻主AGENT';
export const XIAONI_MAIN_AGENT_DEFAULT_MODEL = 'gpt-5.5';
export const XIAONI_MAIN_AGENT_SYSTEM_PROMPT_FILE = 'system_prompt.md';
// system_prompt.md 顶层的 {{OS_WORLD_SYSTEM}} 占位符从这个文件读正文注入;
// 文件为空(默认)时占位符连同其后的空行一起删掉,拼出的 system prompt 与注入前逐字节一致。
export const XIAONI_OS_WORLD_SYSTEM_PROMPT_FILE = 'os_world_system.md';

const OS_WORLD_SYSTEM_PLACEHOLDER = /\{\{OS_WORLD_SYSTEM\}\}/;
const OS_WORLD_SYSTEM_PLACEHOLDER_BLOCK = /^[ \t]*\{\{OS_WORLD_SYSTEM\}\}[ \t]*(?:\r?\n)+/m;

export const XIAONI_MAIN_AGENT_SYSTEM_PROMPT_PATH = resolveXiaoniPromptFile(
  XIAONI_MAIN_AGENT_SYSTEM_PROMPT_FILE
);

export const XIAONI_OS_WORLD_SYSTEM_PROMPT_PATH = resolveXiaoniPromptFile(
  XIAONI_OS_WORLD_SYSTEM_PROMPT_FILE
);

export function getXiaoniOsWorldSystemSection() {
  try {
    return readXiaoniPromptFile(XIAONI_OS_WORLD_SYSTEM_PROMPT_FILE).trim();
  } catch {
    // 文件缺失按空处理:注入是可选层,不能因为少个文件把主 agent 起不来。
    return '';
  }
}

export function getXiaoniMainAgentSystemPrompt() {
  const template = readXiaoniPromptFile(XIAONI_MAIN_AGENT_SYSTEM_PROMPT_FILE);
  const osWorldSystem = getXiaoniOsWorldSystemSection();
  const rendered = osWorldSystem
    ? template.replace(OS_WORLD_SYSTEM_PLACEHOLDER, () => osWorldSystem)
    : template.replace(OS_WORLD_SYSTEM_PLACEHOLDER_BLOCK, '');
  return rendered.trimEnd();
}

export const XIAONI_MAIN_AGENT_SYSTEM_PROMPT = getXiaoniMainAgentSystemPrompt();
