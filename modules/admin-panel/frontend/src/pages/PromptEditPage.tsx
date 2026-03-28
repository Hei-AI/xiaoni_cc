import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { ResizableSplit } from '../components/ui/resizable-split';
import { type FloatingWorkspacePanelState } from '../components/ui/floating-workspace-panel';
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '../components/ui/sheet';
import { 
  ArrowLeft,
  Save,
  RefreshCw,
  Bot,
  Settings,
  Code,
  FileText,
  Layers,
  AlertCircle,
  Send,
  Brain,
  Eye,
  EyeOff,
  Trash2,
  MessageSquare,
  Plus,
  Copy,
  Lock,
  SlidersHorizontal,
  ShieldCheck,
  Navigation,
  ChevronRight,
  History,
  Clock
} from 'lucide-react';
import {
  fetchDebugSessions,
  fetchDebugSession,
  saveDebugSession,
  deleteDebugSession
} from '../lib/promptDebugApi';
import {
  getPlaygroundProviderId,
  getPlaygroundProviderSpecific,
  PLAYGROUND_PROVIDER_MODEL_OPTIONS,
  PROVIDER_OPTIONS,
  inferProviderFromModelName,
  normalizePromptProvider,
  resolvePromptProviderConfig
} from '@/lib/provider-config';
import { formatConfiguredValue } from '@/lib/contract-display';

interface AgentPrompt {
  id: string;
  agent_type: string;
  prompt_name: string;
  system_instructions: string | string[];
  user_prompt_template?: string | null;
  context_variables?: any;
  model_config?: any;
  advanced_config?: any;
  model_name?: string;
  is_active: number;
  version: number;
  created_by: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface AgentType {
  value: string;
  label: string;
  description: string;
}

interface DebugMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  thought?: string;
  showThought?: boolean;
  metadata?: {
    model?: string;
    tokensUsed?: number | string;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    processingTime?: number;
    tokenInfo?: {
      projectName?: string;
      tokenId?: string;
    };
    contextPolicy?: {
      source?: string;
      contextWindowTokens?: number;
      softTriggerTokens?: number;
      hardCeilingTokens?: number;
      replyBudgetTokens?: number;
    };
  };
}

interface PromptVariableRow {
  id: string;
  key: string;
  value: string;
  description?: string;
  required?: boolean;
}

type FunctionCallingModeOption = 'AUTO' | 'ANY' | 'NONE';

interface CustomToolConfigState {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
  origin?: 'manual';
  category?: string;
  tags?: string[];
  invokeMethod?: string;
  sideEffect?: boolean;
}

const toNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

interface ToolsConfigState {
  functionCalling: {
    mode: FunctionCallingModeOption;
    allowedFunctionNames: string[];
    allowedFunctionIds: string[];
  };
  predefinedTools: {
    enabledTools: string[];
    callingMode: FunctionCallingModeOption;
  };
  customTools: CustomToolConfigState[];
  googleSearch?: Record<string, any>;
  urlContext?: Record<string, any>;
  structuredOutput?: Record<string, any>;
}

type DrawerSectionKey =
  | 'basic'
  | 'prompt'
  | 'variables'
  | 'functions'
  | 'runtime'
  | 'safety'
  | 'preview'
  | 'code';

const DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
] as const;

const SAFETY_CATEGORY_ORDER = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT'
] as const;

type SafetyCategory = (typeof SAFETY_CATEGORY_ORDER)[number];

const SAFETY_CATEGORY_LABELS: Record<SafetyCategory, string> = {
  HARM_CATEGORY_HARASSMENT: '骚扰内容',
  HARM_CATEGORY_HATE_SPEECH: '仇恨言论',
  HARM_CATEGORY_SEXUALLY_EXPLICIT: '成人内容',
  HARM_CATEGORY_DANGEROUS_CONTENT: '危险内容'
};

const SAFETY_THRESHOLD_ORDER = [
  'BLOCK_NONE',
  'BLOCK_ONLY_HIGH',
  'BLOCK_MEDIUM_AND_ABOVE',
  'BLOCK_LOW_AND_ABOVE'
] as const;

type SafetyThreshold = (typeof SAFETY_THRESHOLD_ORDER)[number];

const SAFETY_THRESHOLD_LABELS: Record<SafetyThreshold, string> = {
  BLOCK_NONE: '不阻止',
  BLOCK_ONLY_HIGH: '仅阻止高风险',
  BLOCK_MEDIUM_AND_ABOVE: '阻止中及以上',
  BLOCK_LOW_AND_ABOVE: '阻止低及以上'
};

type SafetySettingConfig = {
  category: string;
  threshold: string;
  [key: string]: unknown;
};

type SafetySettingsEntry = {
  setting: SafetySettingConfig;
  originalIndex: number;
};

const thresholdToSliderValue = (threshold: string): number => {
  const index = SAFETY_THRESHOLD_ORDER.indexOf(threshold as SafetyThreshold);
  return index === -1 ? 0 : index;
};

const sliderValueToThreshold = (value: number): SafetyThreshold => {
  const clamped = Math.max(0, Math.min(value, SAFETY_THRESHOLD_ORDER.length - 1));
  return SAFETY_THRESHOLD_ORDER[clamped];
};

const getSafetyCategoryLabel = (category: string): string =>
  SAFETY_CATEGORY_LABELS[category as SafetyCategory] ?? category;

const getSafetyThresholdLabel = (threshold: string): string =>
  SAFETY_THRESHOLD_LABELS[threshold as SafetyThreshold] ?? threshold;

const MEDIA_RESOLUTION_OPTIONS = [
  { value: 'MEDIA_RESOLUTION_DEFAULT', label: '默认' },
  { value: 'MEDIA_RESOLUTION_LOW', label: '低分辨率' }
] as const;

const PROVIDER_MODEL_DESCRIPTIONS: Record<string, string> = {
  'gemini-2.5-flash': '平衡质量与延迟的常用模型',
  'gemini-2.5-pro': '复杂推理与持久对话首选',
  'gpt-5.4-mini': '轻量通用模型，适合快速迭代',
  'gpt-5.4': '高质量输出与复杂任务',
  'gpt-5.3-codex': '偏工具与代码执行场景'
};

const normalizeStopSequencesList = (value: any): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (item === null || typeof item === 'undefined') {
        return '';
      }
      return String(item);
    })
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const createDefaultFunctionParameters = (): Record<string, any> => ({
  type: 'object',
  properties: {},
  required: []
});

const generateToolId = () => `tool-${Math.random().toString(36).slice(2, 10)}`;

const normalizeFunctionCallingMode = (
  mode: unknown,
  fallback: FunctionCallingModeOption
): FunctionCallingModeOption => {
  if (typeof mode !== 'string') {
    return fallback;
  }
  const upper = mode.toUpperCase();
  return upper === 'AUTO' || upper === 'ANY' || upper === 'NONE'
    ? (upper as FunctionCallingModeOption)
    : fallback;
};

const normalizeCustomTool = (tool: any, index: number): CustomToolConfigState => {
  const defaultName = `custom_function_${index + 1}`;
  const providedName =
    typeof tool?.name === 'string' && tool.name.trim().length > 0
      ? tool.name.trim()
      : defaultName;

  const id =
    typeof tool?.id === 'string' && tool.id.trim().length > 0
      ? tool.id.trim()
      : `${generateToolId()}-${index}`;

  const parameters =
    tool?.parameters && typeof tool.parameters === 'object'
      ? tool.parameters
      : createDefaultFunctionParameters();

  const category =
    typeof tool?.category === 'string' && tool.category.trim().length > 0 ? tool.category : undefined;
  const tags = Array.isArray(tool?.tags)
    ? tool.tags
        .map((tag: unknown) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter((tag: string) => tag.length > 0)
    : undefined;
  const invokeMethod =
    typeof tool?.invokeMethod === 'string' && tool.invokeMethod.trim().length > 0
      ? tool.invokeMethod
      : undefined;
  const sideEffect = typeof tool?.sideEffect === 'boolean' ? tool.sideEffect : undefined;

  return {
    id,
    name: providedName,
    description: typeof tool?.description === 'string' ? tool.description : '',
    parameters,
    origin: 'manual',
    category,
    tags,
    invokeMethod,
    sideEffect
  };
};

const dedupeCustomTools = (tools: CustomToolConfigState[]): CustomToolConfigState[] => {
  const unique: CustomToolConfigState[] = [];
  const nameIndexMap = new Map<string, { index: number; id?: string }>();

  tools.forEach((tool) => {
    const normalizedId = typeof tool.id === 'string' ? tool.id.trim() : '';
    if (normalizedId && unique.some((existing) => (existing.id || '').trim() === normalizedId)) {
      return;
    }

    const normalizedName = typeof tool.name === 'string' ? tool.name.trim().toLowerCase() : '';
    const existingByName = normalizedName ? nameIndexMap.get(normalizedName) : undefined;

    if (existingByName) {
      return;
    }

    const insertIndex = unique.length;
    unique.push(tool);
    if (normalizedName) {
      nameIndexMap.set(normalizedName, { index: insertIndex, id: normalizedId || undefined });
    }
  });

  return unique;
};

const createDefaultToolsConfig = (): ToolsConfigState => ({
  functionCalling: {
    mode: 'NONE',
    allowedFunctionNames: [],
    allowedFunctionIds: []
  },
  predefinedTools: {
    enabledTools: [],
    callingMode: 'AUTO'
  },
  customTools: []
});

const normalizeToolsConfig = (rawConfig: any): ToolsConfigState => {
  const defaults = createDefaultToolsConfig();
  if (!rawConfig || typeof rawConfig !== 'object') {
    return { ...defaults };
  }

  const normalizedCustomTools = Array.isArray(rawConfig.customTools)
    ? rawConfig.customTools.map((tool: any, index: number) => normalizeCustomTool(tool, index))
    : defaults.customTools;
  const customTools = dedupeCustomTools(normalizedCustomTools);

  const rawAllowedNames = rawConfig.functionCalling?.allowedFunctionNames;
  const providedAllowedFunctionNames = Array.isArray(rawAllowedNames)
    ? Array.from(
        new Set(
          rawAllowedNames
            .filter((name: unknown): name is string => typeof name === 'string')
            .map((name) => name.trim())
            .filter((name) => name.length > 0)
        )
      )
    : undefined;

  const rawAllowedIds = rawConfig.functionCalling?.allowedFunctionIds;
  const providedAllowedFunctionIds = Array.isArray(rawAllowedIds)
    ? Array.from(
        new Set(
          rawAllowedIds
            .filter((id: unknown): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        )
      )
    : undefined;

  const customToolNames = customTools
    .map((tool: CustomToolConfigState) => tool.name?.trim())
    .filter((name): name is string => Boolean(name && name.length > 0));
  const customToolIds = customTools
    .map((tool: CustomToolConfigState) => tool.id?.trim())
    .filter((id): id is string => Boolean(id && id.length > 0));
  const customToolNameSet = new Set(customToolNames);
  const customToolIdSet = new Set(customToolIds);

  const allowedFunctionNames =
    providedAllowedFunctionNames !== undefined
      ? providedAllowedFunctionNames.filter((name) => customToolNameSet.has(name))
      : customToolNames;

  const allowedFunctionIds =
    providedAllowedFunctionIds !== undefined
      ? providedAllowedFunctionIds.filter((id) => customToolIdSet.has(id))
      : customToolIds;

  const functionCallingMode = normalizeFunctionCallingMode(
    rawConfig.functionCalling?.mode,
    'NONE'
  );

  const predefinedTools = rawConfig.predefinedTools || defaults.predefinedTools;

  return {
    functionCalling: {
      mode: functionCallingMode,
      allowedFunctionNames,
      allowedFunctionIds
    },
    predefinedTools: {
      enabledTools: Array.isArray(predefinedTools.enabledTools)
        ? predefinedTools.enabledTools
        : [],
      callingMode: normalizeFunctionCallingMode(predefinedTools.callingMode, 'AUTO')
    },
    customTools,
    googleSearch: rawConfig.googleSearch,
    urlContext: rawConfig.urlContext,
    structuredOutput: rawConfig.structuredOutput
  };
};

const ensureAdvancedConfigDefaults = (advancedConfig: any): any => {
  const base = advancedConfig && typeof advancedConfig === 'object' ? { ...advancedConfig } : {};

  // 🔥 删除顶层的旧配置字段（统一迁移到 generationConfig 下）
  delete base.thinkingConfig;
  delete base.temperature;
  delete base.topP;
  delete base.topK;
  delete base.maxOutputTokens;
  delete base.stopSequences;

  if (!Array.isArray(base.safetySettings)) {
    base.safetySettings = DEFAULT_SAFETY_SETTINGS.map((setting) => ({ ...setting }));
  }
  if (!base.generationConfig) {
    base.generationConfig = {};
  }

  if (!base.thinkingConfig || typeof base.thinkingConfig !== 'object') {
    const legacyThinking = base.generationConfig?.thinkingConfig;
    base.thinkingConfig =
      legacyThinking && typeof legacyThinking === 'object'
        ? { ...(legacyThinking as Record<string, unknown>) }
        : {
            thinkingBudget: -1,
            includeThoughts: true
          };
  }

  if (base.generationConfig?.thinkingConfig) {
    delete base.generationConfig.thinkingConfig;
  }

  base.toolsConfig = normalizeToolsConfig(base.toolsConfig);

  return base;
};

const coerceNumber = (value: any): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const deepCleanValue = (value: any): any => {
  if (Array.isArray(value)) {
    return value
      .map((item) => deepCleanValue(item))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const cleanedEntries = Object.entries(value).reduce<Record<string, any>>((acc, [key, val]) => {
      const cleaned = deepCleanValue(val);
      if (cleaned !== undefined) {
        acc[key] = cleaned;
      }
      return acc;
    }, {});

    return Object.keys(cleanedEntries).length > 0 ? cleanedEntries : undefined;
  }

  return value === undefined ? undefined : value;
};

interface GetConfigJsonParams {
  modelName?: string | null;
  systemInstruction: string;
  modelConfig: Record<string, any>;
  generationConfig?: Record<string, any>;
  safetySettings?: SafetySettingConfig[];
  toolsConfig: ToolsConfigState;
  advancedConfig?: Record<string, any> | null;
  stopSequences?: string[];
}

const generateGetConfigJson = ({
  modelName,
  systemInstruction,
  modelConfig,
  generationConfig,
  safetySettings,
  toolsConfig,
  advancedConfig,
  stopSequences
}: GetConfigJsonParams): string => {
  const normalizedModelName =
    typeof modelName === 'string' && modelName.trim().length > 0 ? modelName.trim() : null;
  const trimmedInstruction =
    typeof systemInstruction === 'string' ? systemInstruction.trim() : '';

  const normalizedSafety = Array.isArray(safetySettings)
    ? safetySettings.filter(
        (setting) =>
          setting &&
          typeof setting.category === 'string' &&
          setting.category.length > 0 &&
          typeof setting.threshold === 'string' &&
          setting.threshold.length > 0
      )
    : [];

  const provider = normalizePromptProvider(
    modelConfig?.provider || advancedConfig?.provider || inferProviderFromModelName(normalizedModelName)
  );
  const providerSpecific =
    modelConfig?.providerSpecific && typeof modelConfig.providerSpecific === 'object'
      ? modelConfig.providerSpecific
      : {};
  const generation = {
    ...(generationConfig && typeof generationConfig === 'object' ? generationConfig : {}),
    temperature: coerceNumber(modelConfig?.temperature) ?? coerceNumber(generationConfig?.temperature),
    topP: coerceNumber(modelConfig?.topP) ?? coerceNumber(generationConfig?.topP),
    topK: coerceNumber(modelConfig?.topK) ?? coerceNumber(generationConfig?.topK),
    maxOutputTokens:
      coerceNumber(modelConfig?.maxOutputTokens) ?? coerceNumber(generationConfig?.maxOutputTokens),
    stopSequences:
      Array.isArray(stopSequences) && stopSequences.length > 0
        ? stopSequences
        : Array.isArray(modelConfig?.stopSequences)
          ? modelConfig.stopSequences
          : generationConfig?.stopSequences,
  };
  const tools = {
    ...toolsConfig,
    functionCallingConfig:
      toolsConfig?.functionCalling?.mode && toolsConfig.functionCalling.mode !== 'NONE'
        ? {
            mode: toolsConfig.functionCalling.mode,
            ...(toolsConfig.functionCalling.mode === 'ANY' &&
            Array.isArray(toolsConfig.functionCalling.allowedFunctionNames) &&
            toolsConfig.functionCalling.allowedFunctionNames.length > 0
              ? { allowedFunctionNames: toolsConfig.functionCalling.allowedFunctionNames }
              : {})
          }
        : undefined
  };
  const payload = {
    model: {
      provider,
      name: normalizedModelName,
      providerSpecific
    },
    generation,
    thinking: advancedConfig?.thinkingConfig || {},
    safety: normalizedSafety,
    tools,
    context: trimmedInstruction ? { systemInstruction: trimmedInstruction } : undefined
  };

  const cleaned = deepCleanValue(payload) ?? {};
  return JSON.stringify(cleaned, null, 2);
};

const parseJsonField = <T,>(value: any, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  if (typeof value === 'object') {
    return value as T;
  }

  return fallback;
};

const applyContextVariables = (
  template: string,
  contextVariables: Record<string, any> = {},
  runtimeVariables: Record<string, any> = {}
): string => {
  if (!template || typeof template !== 'string') {
    return template || '';
  }

  const allVariables = {
    ...contextVariables,
    ...runtimeVariables
  };

  let processedTemplate = template;

  processedTemplate = processedTemplate.replace(/\{\{(\w+)\}\}/g, (fullMatch, varName) => {
    if (Object.prototype.hasOwnProperty.call(allVariables, varName)) {
      const value = allVariables[varName];
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
    return fullMatch;
  });

  processedTemplate = processedTemplate.replace(/\$\{(\w+)\}/g, (fullMatch, varName) => {
    if (Object.prototype.hasOwnProperty.call(allVariables, varName)) {
      const value = allVariables[varName];
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
    return fullMatch;
  });

  processedTemplate = processedTemplate.replace(/\{\{now\.(\w+)\}\}/g, (_full, format) => {
    const now = new Date();
    switch (format) {
      case 'iso':
        return now.toISOString();
      case 'date':
        return now.toDateString();
      case 'time':
        return now.toTimeString();
      case 'locale':
        return now.toLocaleString('zh-CN');
      default:
        return now.toISOString();
    }
  });

  return processedTemplate;
};

const createContextVariableRow = (overrides: Partial<PromptVariableRow> = {}): PromptVariableRow => ({
  id: overrides.id ?? `var-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  key: overrides.key ?? '',
  value: overrides.value ?? '',
  description: overrides.description ?? '',
  required: overrides.required ?? false,
});

const parseVariableValue = (raw: string): any => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed === 'true' || trimmed === 'false') {
    return trimmed === 'true';
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
};

const rowsToContextObject = (rows: PromptVariableRow[]): Record<string, any> => {
  return rows.reduce<Record<string, any>>((acc, row) => {
    const key = row.key.trim();
    if (!key) {
      return acc;
    }
    acc[key] = parseVariableValue(row.value);
    return acc;
  }, {});
};

const normalizeSessionMessage = (raw: any, index: number): DebugMessage => {
  const timestamp = raw?.timestamp ? new Date(raw.timestamp) : new Date();
  const rawRole = raw?.role === 'model' ? 'assistant' : raw?.role;
  const role: DebugMessage['role'] = rawRole === 'user' || rawRole === 'assistant' ? rawRole : 'assistant';

  const metadataSource = raw?.metadata ?? {};
  let tokenInfo = metadataSource?.tokenInfo;

  if (!tokenInfo) {
    const tokenSource = metadataSource?.token_used ?? raw?.token_used;
    if (tokenSource && typeof tokenSource === 'object') {
      const tokenIdValue =
        tokenSource.id ??
        tokenSource.tokenId ??
        tokenSource.token_id ??
        tokenSource.tokenID;
      tokenInfo = {
        projectName:
          tokenSource.project_name ?? tokenSource.projectName ?? undefined,
        tokenId: typeof tokenIdValue === 'undefined' ? undefined : String(tokenIdValue)
      };
    }
  }

  const tokensUsed =
    metadataSource?.tokensUsed ??
    metadataSource?.totalTokenCount ??
    metadataSource?.totalTokens ??
    (typeof raw?.token_used === 'number' || typeof raw?.token_used === 'string'
      ? raw.token_used
      : raw?.token_used?.total ??
        raw?.token_used?.totalTokens ??
        raw?.token_used?.totalTokenCount);

  const processingTime =
    metadataSource?.processingTime ??
    metadataSource?.processing_time ??
    metadataSource?.processing_time_ms ??
    raw?.processingTime ??
    raw?.performance?.duration_ms ??
    raw?.performance?.processing_time_ms;

  const model = metadataSource?.model ?? raw?.model;

  const metadata =
    model ||
    typeof tokensUsed !== 'undefined' ||
    typeof processingTime !== 'undefined' ||
    tokenInfo
      ? {
          model,
          tokensUsed,
          processingTime,
          tokenInfo,
        }
      : undefined;

  const thoughtValue = raw?.thought;
  const thought =
    typeof thoughtValue === 'string'
      ? thoughtValue
      : Array.isArray(thoughtValue)
      ? thoughtValue.join('\n')
      : undefined;

  return {
    id: raw?.id ?? `session-${index}`,
    role,
    content: typeof raw?.content === 'string' ? raw.content : '',
    thought,
    timestamp,
    showThought: false,
    metadata,
  };
};

const serializeMessagesForSave = (messages: DebugMessage[]): any[] =>
  messages.map((msg) => {
    const { showThought, ...rest } = msg;
    return {
      ...rest,
      timestamp:
        msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
    };
  });

const variableValueToString = (value: any): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const validateContextVariableRows = (rows: PromptVariableRow[]): string | null => {
  const seenKeys = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) {
      continue;
    }
    if (seenKeys.has(key)) {
      return `上下文变量中存在重复键 "${key}"`;
    }
    seenKeys.add(key);
  }
  return null;
};

// 获取单个 Prompt
const fetchPrompt = async (promptId: string): Promise<{ success: boolean; data: AgentPrompt }> => {
  // 防止尝试获取 'new' 这个特殊ID - 直接返回空数据
  if (promptId === 'new') {
    return {
      success: false,
      data: {} as AgentPrompt
    };
  }

  const response = await fetch(`/api/prompts/${promptId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch prompt');
  }
  return response.json();
};

// 获取 Agent 类型
const fetchAgentTypes = async (): Promise<{ success: boolean; data: AgentType[] }> => {
  const response = await fetch('/api/agent-types');
  if (!response.ok) {
    throw new Error('Failed to fetch agent types');
  }
  return response.json();
};

// 更新或创建 Prompt
const savePrompt = async (promptId: string | null, data: any) => {
  const url = promptId ? `/api/prompts/${promptId}` : '/api/prompts';
  const method = promptId ? 'PUT' : 'POST';
  
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to ${promptId ? 'update' : 'create'} prompt`);
  }
  return response.json();
};

export const PromptEditPage: React.FC = () => {
  const { promptId } = useParams<{ promptId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Check if we're on the "new" route by looking at the path
  const isNew = location.pathname === '/prompts/new' || promptId === 'new';
  const [isEditing, setIsEditing] = useState(isNew);

  // 响应路由参数变化，更新编辑状态
  useEffect(() => {
    const newIsNew = location.pathname === '/prompts/new' || promptId === 'new';
    setIsEditing(newIsNew);
  }, [promptId, location.pathname]);

  useEffect(() => {
    if (isNew) {
      setUseDraftConfig(true);
    }
  }, [isNew]);

  useEffect(() => {
    if (!prevEditingRef.current && isEditing) {
      setUseDraftConfig(true);
    }
    if (prevEditingRef.current && !isEditing && !isNew) {
      setUseDraftConfig(false);
    }
    prevEditingRef.current = isEditing;
  }, [isEditing, isNew]);

  // 表单状态
  const [formData, setFormData] = useState(() => ({
    agent_type: 'chat_bot',
    prompt_name: '',
    system_instructions: '',
    user_prompt_template: '',
    context_variables: {},
    model_config: {
      provider: 'google-gemini-cli',
      providerSpecific: {},
      topK: 40,
      topP: 0.95,
      temperature: 1.0,
      maxOutputTokens: 65536,
      stopSequences: [] as string[],
      mediaResolution: 'MEDIA_RESOLUTION_DEFAULT'
    },
    advanced_config: ensureAdvancedConfigDefaults({
      safetySettings: DEFAULT_SAFETY_SETTINGS.map((setting) => ({ ...setting })),
      generationConfig: {},
      thinkingConfig: {
        thinkingBudget: -1,
        includeThoughts: true
      },
      toolsConfig: createDefaultToolsConfig()
    }),
    model_name: '',
    description: '',
    is_active: true,
    created_by: 'admin',
    version: 1
  }));
  const [contextVariableRows, setContextVariableRows] = useState<PromptVariableRow[]>([]);
  const [contextVariablesError, setContextVariablesError] = useState<string | null>(null);
  const [customToolEditors, setCustomToolEditors] = useState<Record<string, { json: string; error?: string }>>({});
  const [messages, setMessages] = useState<DebugMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isDebugging, setIsDebugging] = useState(false);
  const [useDraftConfig, setUseDraftConfig] = useState<boolean>(() => isNew);
  const [newStopSequence, setNewStopSequence] = useState('');
  const [providerSpecificText, setProviderSpecificText] = useState('{}');
  const [providerSpecificError, setProviderSpecificError] = useState<string | null>(null);
  const [configJsonCopied, setConfigJsonCopied] = useState(false);
  const [systemInstructionsCopied, setSystemInstructionsCopied] = useState(false);
  const [isSafetyDialogOpen, setIsSafetyDialogOpen] = useState(false);
  const [isHistorySheetOpen, setIsHistorySheetOpen] = useState(false);
  const [isSaveSessionDialogOpen, setIsSaveSessionDialogOpen] = useState(false);
  const [saveSessionName, setSaveSessionName] = useState('');
  const prevEditingRef = useRef<boolean>(isEditing);
  const playgroundCardRef = useRef<HTMLDivElement | null>(null);
  const playgroundWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const configContentRef = useRef<HTMLDivElement | null>(null);
  const [playgroundMinHeight, setPlaygroundMinHeight] = useState<number | null>(null);
  const [isPlaygroundDesktopLayout, setIsPlaygroundDesktopLayout] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.innerWidth >= 1024;
  });
  const [overviewPanel, setOverviewPanel] = useState<FloatingWorkspacePanelState>({
    collapsed: false,
    x: 980,
    y: 24,
    width: 360,
    height: 430,
  });
  const [historyPanel, setHistoryPanel] = useState<FloatingWorkspacePanelState>({
    collapsed: true,
    x: 1000,
    y: 180,
    width: 420,
    height: 520,
  });
  const systemInstructionRef = useRef<HTMLTextAreaElement | null>(null);
  const userPromptTemplateRef = useRef<HTMLTextAreaElement | null>(null);
  const promptPreviewRef = useRef<HTMLDivElement | null>(null);
  const [activePromptSection, setActivePromptSection] = useState<'system' | 'user' | 'preview'>('system');
  const [isConfigDrawerOpen, setIsConfigDrawerOpen] = useState(false);
  const [activeDrawerKey, setActiveDrawerKey] = useState<DrawerSectionKey | null>('basic');
  const canUseSessionFeatures = !isNew && !!promptId && promptId !== 'new';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const applyMatch = (matches: boolean) => setIsPlaygroundDesktopLayout(matches);
    applyMatch(mediaQuery.matches);
    const listener = (event: MediaQueryListEvent) => applyMatch(event.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    if (isPlaygroundDesktopLayout && !activeDrawerKey) {
      setActiveDrawerKey('basic');
    }
  }, [activeDrawerKey, isPlaygroundDesktopLayout]);

  // 查询现有 Prompt 数据（仅编辑模式）
  const {
    data: promptData,
    isLoading: isLoadingPrompt,
    error: promptError
  } = useQuery({
    queryKey: ['prompt', promptId],
    queryFn: () => fetchPrompt(promptId!),
    enabled: !isNew && promptId !== 'new' && !!promptId && promptId !== undefined,
    staleTime: 0, // Always consider data stale to force refetch
    gcTime: 0, // Don't cache data (React Query v5 uses gcTime instead of cacheTime)
    refetchOnMount: 'always', // Always refetch when component mounts
  });

  // 查询 Agent 类型
  const { data: agentTypesData } = useQuery({
    queryKey: ['agent-types'],
    queryFn: fetchAgentTypes,
  });

  const {
    data: debugSessionsData,
    isLoading: isLoadingSessions,
    refetch: refetchDebugSessions
  } = useQuery({
    queryKey: ['debugSessions', promptId],
    queryFn: () => fetchDebugSessions(promptId!),
    enabled: canUseSessionFeatures
  });

  // 保存 Prompt mutation
  const saveMutation = useMutation({
    mutationFn: (data: any) => savePrompt(isNew ? null : promptId!, data),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      if (isNew && response?.data?.id) {
        navigate(`/prompts/${response.data.id}/edit`, { replace: true });
      } else {
        queryClient.invalidateQueries({ queryKey: ['prompt', promptId] });
        setIsEditing(false);
      }
    },
  });

  const saveSessionMutation = useMutation({
    mutationFn: ({ sessionName, messages: messagesToSave }: { sessionName: string; messages: any[] }) =>
      saveDebugSession(promptId!, sessionName, messagesToSave),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debugSessions', promptId] });
      setIsSaveSessionDialogOpen(false);
      setSaveSessionName('');
    },
  });

  const loadSessionMutation = useMutation({
    mutationFn: fetchDebugSession,
    onSuccess: (data) => {
      if (data.success) {
        const loadedMessages = Array.isArray(data.data.messages)
          ? data.data.messages.map((msg, index) => normalizeSessionMessage(msg, index))
          : [];
        setMessages(loadedMessages);
        setUserInput('');
        setIsHistorySheetOpen(false);
      }
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: deleteDebugSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debugSessions', promptId] });
    },
  });

  // 加载现有数据到表单
  useEffect(() => {
    if (promptData?.success && promptData.data) {
      const prompt = promptData.data;
      const parsedContext = parseJsonField<Record<string, any>>(prompt.context_variables, {});
      const parsedModelConfig = parseJsonField(prompt.model_config, {
        provider: 'google-gemini-cli',
        providerSpecific: {},
        topK: 40,
        topP: 0.95,
        temperature: 1.0,
        maxOutputTokens: 65536,
        stopSequences: [] as string[],
        mediaResolution: 'MEDIA_RESOLUTION_DEFAULT'
      });
      const resolvedProviderConfig = resolvePromptProviderConfig(prompt);
      const normalizedModelConfig = {
        ...parsedModelConfig,
        provider: getPlaygroundProviderId(resolvedProviderConfig),
        providerSpecific: getPlaygroundProviderSpecific(resolvedProviderConfig),
        topK: resolvedProviderConfig.generation?.topK ?? (parsedModelConfig as any).topK ?? 40,
        topP: resolvedProviderConfig.generation?.topP ?? (parsedModelConfig as any).topP ?? 0.95,
        temperature: resolvedProviderConfig.generation?.temperature ?? (parsedModelConfig as any).temperature ?? 1.0,
        maxOutputTokens:
          resolvedProviderConfig.generation?.maxOutputTokens ?? (parsedModelConfig as any).maxOutputTokens ?? 65536,
        stopSequences: normalizeStopSequencesList((parsedModelConfig as any).stopSequences),
        mediaResolution:
          typeof (parsedModelConfig as any).mediaResolution === 'string'
            ? (parsedModelConfig as any).mediaResolution
            : 'MEDIA_RESOLUTION_DEFAULT'
      };
      const parsedAdvancedConfig = parseJsonField(prompt.advanced_config, {
        safetySettings: DEFAULT_SAFETY_SETTINGS.map((setting) => ({ ...setting })),
        generationConfig: {},
        thinkingConfig: {
          thinkingBudget: -1,
          includeThoughts: true
        },
        toolsConfig: createDefaultToolsConfig()
      });
      const normalizedAdvancedConfig = ensureAdvancedConfigDefaults({
        ...parsedAdvancedConfig,
        generationConfig: {
          ...(parsedAdvancedConfig?.generationConfig && typeof parsedAdvancedConfig.generationConfig === 'object'
            ? parsedAdvancedConfig.generationConfig
            : {}),
          temperature: resolvedProviderConfig.generation?.temperature ?? (parsedAdvancedConfig?.generationConfig as any)?.temperature,
          topP: resolvedProviderConfig.generation?.topP ?? (parsedAdvancedConfig?.generationConfig as any)?.topP,
          topK: resolvedProviderConfig.generation?.topK ?? (parsedAdvancedConfig?.generationConfig as any)?.topK,
          maxOutputTokens:
            resolvedProviderConfig.generation?.maxOutputTokens ??
            (parsedAdvancedConfig?.generationConfig as any)?.maxOutputTokens,
          stopSequences:
            normalizeStopSequencesList(
              resolvedProviderConfig.generation?.stopSequences ??
              (parsedAdvancedConfig?.generationConfig as any)?.stopSequences
            )
        },
        thinkingConfig:
          resolvedProviderConfig.thinking && Object.keys(resolvedProviderConfig.thinking).length > 0
            ? resolvedProviderConfig.thinking
            : parsedAdvancedConfig?.thinkingConfig
      });

      setFormData({
        agent_type: prompt.agent_type,
        prompt_name: prompt.prompt_name,
        system_instructions: (() => {
          let instructions;
          if (Array.isArray(prompt.system_instructions)) {
            instructions = prompt.system_instructions;
          } else if (typeof prompt.system_instructions === 'string') {
            try {
              instructions = JSON.parse(prompt.system_instructions);
            } catch {
              instructions = [prompt.system_instructions];
            }
          } else {
            instructions = [''];
          }
          // 将数组合并为一个完整的文本，过滤空字符串
          const filtered = instructions.filter((inst: string) => inst.trim() !== '');
          return filtered.join('\n\n');
        })(),
        user_prompt_template: prompt.user_prompt_template || '',
        context_variables: parsedContext,
        model_config: normalizedModelConfig,
        advanced_config: normalizedAdvancedConfig,
        model_name: prompt.model_name || '',
        description: prompt.description || '',
        is_active: Boolean(prompt.is_active),
        created_by: prompt.created_by || 'admin',
        version: typeof prompt.version === 'number' ? prompt.version : 1
      });
      const rows = Object.keys(parsedContext).length
        ? Object.entries(parsedContext).map(([key, value]) =>
            createContextVariableRow({
              key,
              value: variableValueToString(value)
            })
          )
        : [createContextVariableRow()];
      setContextVariableRows(rows);
      setContextVariablesError(validateContextVariableRows(rows));
      setProviderSpecificText(JSON.stringify(normalizedModelConfig.providerSpecific || {}, null, 2));
      setProviderSpecificError(null);
      setFormData((prev) => ({
        ...prev,
        context_variables: rowsToContextObject(rows)
      }));
    }
  }, [promptData]);

  useEffect(() => {
    if (isNew && contextVariableRows.length === 0) {
      const rows = [createContextVariableRow()];
      setContextVariableRows(rows);
      setContextVariablesError(validateContextVariableRows(rows));
    }
  }, [isNew, contextVariableRows.length]);

  useEffect(() => {
    if (!isNew) {
      return;
    }
    setProviderSpecificText(JSON.stringify(formData.model_config?.providerSpecific || {}, null, 2));
    setProviderSpecificError(null);
  }, [isNew, formData.model_config?.providerSpecific]);

  const handleSubmit = () => {
    if (saveMutation.isPending) {
      return;
    }

    if (!formData.prompt_name.trim()) {
      alert('请输入 Prompt 名称');
      return;
    }

    if (!formData.system_instructions.trim()) {
      alert('请输入系统指令');
      return;
    }

    if (contextVariablesError) {
      alert('上下文变量配置存在问题，请修正后再试');
      return;
    }

    if (providerSpecificError) {
      alert('Provider 专属配置 JSON 格式有误，请修正后再试');
      return;
    }

    if (!formData.model_name.trim()) {
      alert('模型 ID 为必填项，不能使用默认值');
      return;
    }

    const contextVariablesObject = rowsToContextObject(contextVariableRows);

    const submitAdvancedConfig = advancedConfigSnapshot;
    const effectiveProvider = normalizePromptProvider(
      formData.model_config?.provider || inferProviderFromModelName(formData.model_name)
    );
    const effectiveModelName = formData.model_name.trim();

    const submitData = {
      ...formData,
      model_name: effectiveModelName,
      system_instructions: formData.system_instructions
        .split('\n\n')
        .map((inst: string) => inst.trim())
        .filter((inst: string) => inst !== ''),
      context_variables: Object.keys(contextVariablesObject).length > 0
        ? contextVariablesObject
        : undefined,
      user_prompt_template: formData.user_prompt_template.trim() || undefined,
      model_config: {
        ...formData.model_config,
        provider: effectiveProvider,
        providerSpecific: formData.model_config?.providerSpecific || {}
      },
      advanced_config: submitAdvancedConfig
    };

    saveMutation.mutate(submitData);
  };

  const mutateContextVariableRows = (
    updater: (rows: PromptVariableRow[]) => PromptVariableRow[]
  ) => {
    setContextVariableRows((prevRows) => {
      const nextRows = updater(prevRows);
      const normalizedRows = nextRows.length > 0 ? nextRows : [createContextVariableRow()];
      const error = validateContextVariableRows(normalizedRows);
      setContextVariablesError(error);
      const contextObject = rowsToContextObject(normalizedRows);
      setFormData((prev) => ({
        ...prev,
        context_variables: contextObject
      }));
      return normalizedRows;
    });
  };

  const handleContextVariableChange = (
    rowId: string,
    field: keyof PromptVariableRow,
    value: string | boolean
  ) => {
    mutateContextVariableRows((rows) =>
      rows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [field]: value
            }
          : row
      )
    );
  };

  const addContextVariableRow = () => {
    mutateContextVariableRows((rows) => [...rows, createContextVariableRow()]);
  };

  const removeContextVariableRow = (rowId: string) => {
    mutateContextVariableRows((rows) => rows.filter((row) => row.id !== rowId));
  };

  const handleModelConfigChange = (key: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        [key]: value
      }
    }));
  };

  const handleProviderSpecificTextChange = (value: string) => {
    setProviderSpecificText(value);

    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setProviderSpecificError('Provider 专属配置必须是 JSON 对象');
        return;
      }

      setProviderSpecificError(null);
      setFormData((prev) => ({
        ...prev,
        model_config: {
          ...prev.model_config,
          providerSpecific: parsed
        }
      }));
    } catch {
      setProviderSpecificError('Provider 专属配置 JSON 解析失败');
    }
  };

  const handleAdvancedConfigChange = (section: string, key: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      advanced_config: {
        ...prev.advanced_config,
        [section]: {
          ...(prev.advanced_config as any)[section],
          [key]: value
        }
      }
    }));
  };

  const handleStopSequencesCleanup = () => {
    setFormData((prev) => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        stopSequences: normalizeStopSequencesList(prev.model_config.stopSequences)
      }
    }));
  };

  const handleAddStopSequence = () => {
    const trimmed = newStopSequence.trim();
    if (!trimmed) {
      return;
    }
    setFormData((prev) => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        stopSequences: [...(prev.model_config.stopSequences || []), trimmed]
      }
    }));
    setNewStopSequence('');
  };

  const handleRemoveStopSequence = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        stopSequences: (prev.model_config.stopSequences || []).filter((_, i) => i !== index)
      }
    }));
  };

  const handleAdvancedFlagToggle =
    (key: 'structuredOutput' | 'googleSearch' | 'urlContext') => (checked: boolean) => {
      setFormData((prev) => {
        const normalizedAdvanced = ensureAdvancedConfigDefaults(prev.advanced_config);
        const next = { ...normalizedAdvanced };
        if (checked) {
          next[key] = next[key] || {};
        } else {
          delete next[key];
        }
        return {
          ...prev,
          advanced_config: next
        };
      });
    };

  const handleSafetySettingChange = (index: number, field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      advanced_config: {
        ...prev.advanced_config,
        safetySettings: (prev.advanced_config?.safetySettings || []).map((setting: any, i: number) =>
          i === index ? { ...setting, [field]: value } : setting
        )
      }
    }));
  };

  const handleSafetyThresholdSliderChange = (index: number, sliderValue: number) => {
    const threshold = sliderValueToThreshold(sliderValue);
    handleSafetySettingChange(index, 'threshold', threshold);
  };

  const handleResetSafetySettings = () => {
    setFormData((prev) => ({
      ...prev,
      advanced_config: {
        ...prev.advanced_config,
        safetySettings: DEFAULT_SAFETY_SETTINGS.map((setting) => ({ ...setting }))
      }
    }));
  };

  const runDebugRequest = async (history: DebugMessage[], latestUserMessage: string) => {
    const rawConversation: DebugMessage[] = [
      ...history,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: latestUserMessage,
        timestamp: new Date()
      }
    ];

    const conversationId =
      !isNew && promptId && promptId !== 'new'
        ? promptId
        : `draft-${(formData.prompt_name || 'prompt').replace(/\s+/g, '-').toLowerCase()}`;

    const shouldUseDraft = isNew ? true : useDraftConfig;

    const baseMessages = rawConversation.map((message) => ({
      role: message.role === 'assistant' ? 'model' : message.role,
      content: message.content
    }));

    const payload: Record<string, any> = {
      messages: baseMessages,
      conversation_id: conversationId,
      userInput: latestUserMessage
    };

    if (!shouldUseDraft && promptId && promptId !== 'new') {
      payload.prompt_id = promptId;
    } else {
      const runtimeVariables = {
        conversation_id: conversationId,
        timestamp: new Date().toISOString(),
        model: formData.model_name.trim()
      };

      payload.systemPrompt = applyContextVariables(
        formData.system_instructions,
        formData.context_variables,
        runtimeVariables
      );
      payload.model = formData.model_name.trim();

      payload.messages = baseMessages.map((message, index) => {
        if (message.role !== 'user' || !formData.user_prompt_template) {
          return message;
        }

        const originalUserContent = rawConversation[index]?.content || message.content;

        return {
          ...message,
          content: applyContextVariables(
            formData.user_prompt_template || '',
            formData.context_variables,
            {
              ...runtimeVariables,
              user_input: originalUserContent
            }
          )
        };
      });

      payload.parameters = {
        model_config: {
          ...formData.model_config,
          provider: selectedProvider,
          providerSpecific: formData.model_config?.providerSpecific || {}
        },
        advanced_config: advancedConfigSnapshot,
        context_variables: formData.context_variables,
        user_prompt_template: formData.user_prompt_template
      };
    }

    const response = await fetch('/api/debug/prompt-v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Debug request failed');
    }

    return response.json();
  };

  const handleSendMessage = async () => {
    if (!userInput.trim() || isDebugging) {
      return;
    }

    if (!formData.system_instructions.trim()) {
      alert('请先填写系统指令，再进行调试');
      return;
    }

    if (contextVariablesError) {
      alert('上下文变量配置存在问题，请修正后重试');
      return;
    }

    if (!formData.model_name.trim()) {
      alert('请先显式填写模型 ID，再进行调试');
      return;
    }

    const newMessage: DebugMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userInput.trim(),
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, newMessage]);
    setUserInput('');
    setIsDebugging(true);

    try {
      const response = await runDebugRequest(messages, newMessage.content);
      if (!response.success) {
        throw new Error(response.error || '调试请求失败');
      }

      const rawTokenUsed = response.token_used;
      const normalizedTokenInfo =
        rawTokenUsed && typeof rawTokenUsed === 'object'
          ? (() => {
              const projectName =
                (rawTokenUsed.project_name ?? rawTokenUsed.projectName) || undefined;
              const tokenIdRaw =
                rawTokenUsed.id ??
                rawTokenUsed.tokenId ??
                rawTokenUsed.token_id ??
                rawTokenUsed.tokenID;

              return {
                projectName,
                tokenId: typeof tokenIdRaw === 'undefined' ? undefined : String(tokenIdRaw)
              };
            })()
          : undefined;

      const resolvedTokenUsage = (() => {
        if (typeof rawTokenUsed === 'number' || typeof rawTokenUsed === 'string') {
          return rawTokenUsed;
        }

        if (rawTokenUsed && typeof rawTokenUsed === 'object') {
          const { total, totalTokens, totalTokenCount } = rawTokenUsed as Record<string, any>;
          if (typeof total === 'number') {
            return total;
          }
          if (typeof totalTokens === 'number') {
            return totalTokens;
          }
          if (typeof totalTokenCount === 'number') {
            return totalTokenCount;
          }
        }

        const usage =
          response.usage?.totalTokenCount ??
          response.usageMetadata?.totalTokenCount;

        return typeof usage === 'number' ? usage : undefined;
      })();

      const resolvedProcessingTime =
        response.performance?.duration_ms ??
        response.performance?.durationMs ??
        response.performance?.processing_time_ms ??
        response.performance?.processingTimeMs ??
        response.processingTime;
      const contextPolicy = response.context_policy
        ? {
            source: typeof response.context_policy.source === 'string' ? response.context_policy.source : undefined,
            contextWindowTokens: toNumber(response.context_policy.context_window_tokens),
            softTriggerTokens: toNumber(response.context_policy.soft_trigger_tokens),
            hardCeilingTokens: toNumber(response.context_policy.hard_ceiling_tokens),
            replyBudgetTokens: toNumber(response.context_policy.reply_budget_tokens)
          }
        : undefined;

      const assistantMessage: DebugMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: (response.response || '').trim(),
        thought: (response.thinking || '').trim() || undefined,
        timestamp: new Date(),
        metadata: {
          model: response.model || formData.model_name,
          tokensUsed: resolvedTokenUsage,
          cachedInputTokens:
            toNumber(response.usage_details?.cached_input_tokens) ??
            toNumber(response.usage?.cached_input_tokens),
          reasoningTokens:
            toNumber(response.usage_details?.reasoning_tokens) ??
            toNumber(response.usage?.reasoning_tokens),
          processingTime: resolvedProcessingTime,
          tokenInfo: normalizedTokenInfo,
          contextPolicy
        }
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: DebugMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: new Date()
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsDebugging(false);
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const toggleThought = (messageId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? { ...message, showThought: !message.showThought }
          : message
      )
    );
  };

  const generateSessionName = () => {
    const firstUserMessage = messages.find((msg) => msg.role === 'user');
    if (firstUserMessage) {
      const content = firstUserMessage.content.trim();
      if (content.length > 20) {
        return `${content.slice(0, 20)}...`;
      }
      if (content.length > 0) {
        return content;
      }
    }
    return `调试会话 ${new Date().toLocaleDateString()}`;
  };

  const openHistoryPanel = () => {
    if (!canUseSessionFeatures) {
      return;
    }
    if (isPlaygroundDesktopLayout) {
      if (!historyPanel.collapsed) {
        setHistoryPanel((current) => ({ ...current, collapsed: true }));
        setIsHistorySheetOpen(false);
        return;
      }
      setHistoryPanel((current) => ({ ...current, collapsed: false }));
      setIsHistorySheetOpen(false);
    } else {
      setIsHistorySheetOpen(true);
    }
    refetchDebugSessions();
  };

  const openSaveSessionDialog = () => {
    if (!canUseSessionFeatures || !messages.length) {
      return;
    }
    setSaveSessionName(generateSessionName());
    setIsSaveSessionDialogOpen(true);
  };

  const handleSaveSession = () => {
    if (!canUseSessionFeatures || !messages.length || !saveSessionName.trim()) {
      return;
    }
    const payloadMessages = serializeMessagesForSave(messages);
    saveSessionMutation.mutate({
      sessionName: saveSessionName.trim(),
      messages: payloadMessages
    });
  };

  const handleLoadSession = (sessionId: string) => {
    if (!canUseSessionFeatures) {
      return;
    }
    loadSessionMutation.mutate(sessionId);
  };

  const handleDeleteSession = (sessionId: string) => {
    if (!canUseSessionFeatures) {
      return;
    }
    if (confirm('确定要删除这个调试会话吗？')) {
      deleteSessionMutation.mutate(sessionId);
    }
  };

  const focusPromptSection = (section: 'system' | 'user' | 'preview') => {
    setActivePromptSection(section);
    const scrollOptions: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' };

    if (section === 'system' && systemInstructionRef.current) {
      systemInstructionRef.current.focus();
      systemInstructionRef.current.scrollIntoView(scrollOptions);
      return;
    }

    if (section === 'user' && userPromptTemplateRef.current) {
      userPromptTemplateRef.current.focus();
      userPromptTemplateRef.current.scrollIntoView(scrollOptions);
      return;
    }

    if (section === 'preview' && promptPreviewRef.current) {
      promptPreviewRef.current.scrollIntoView(scrollOptions);
      promptPreviewRef.current.focus();
    }
  };

  const handleCopySystemInstructions = async () => {
    if (!formData.system_instructions) {
      return;
    }

    try {
      await navigator.clipboard.writeText(formData.system_instructions);
      setSystemInstructionsCopied(true);
    } catch (error) {
      console.error('复制系统指令失败', error);
    }
  };

  const systemInstructionCharCount = formData.system_instructions.length;

  const instructionSegments = useMemo(
    () =>
      formData.system_instructions
        .split(/\n{2,}/)
        .map((segment) => segment.trim())
        .filter(Boolean),
    [formData.system_instructions]
  );

  const userTemplatePlaceholders = useMemo(() => {
    const placeholderPattern = /{{\s*([\w.]+)\s*}}|\$\{\s*([\w.]+)\s*\}/g;
    const found = new Set<string>();
    const template = formData.user_prompt_template ?? '';
    let match: RegExpExecArray | null;

    while ((match = placeholderPattern.exec(template)) !== null) {
      const key = (match[1] ?? match[2] ?? '').trim();
      if (key) {
        found.add(key);
      }
    }

    return Array.from(found);
  }, [formData.user_prompt_template]);

  const toolsConfig = useMemo(
    () => normalizeToolsConfig((formData.advanced_config as any)?.toolsConfig),
    [formData.advanced_config]
  );

  const customToolsSignature = useMemo(
    () => toolsConfig.customTools.map((tool) => tool.id).join('|'),
    [toolsConfig.customTools]
  );

  useEffect(() => {
    setCustomToolEditors((prev) => {
      let updated = false;
      const next: Record<string, { json: string; error?: string }> = {};

      toolsConfig.customTools.forEach((tool) => {
        const prevEntry = prev[tool.id];
        if (prevEntry) {
          next[tool.id] = prevEntry;
        } else {
          next[tool.id] = {
            json: JSON.stringify(tool.parameters ?? createDefaultFunctionParameters(), null, 2)
          };
          updated = true;
        }
      });

      if (Object.keys(prev).length !== Object.keys(next).length) {
        updated = true;
      }

      return updated ? next : prev;
    });
  }, [customToolsSignature, toolsConfig]);

  useEffect(() => {
    if (!configJsonCopied) {
      return;
    }
    const timer = window.setTimeout(() => setConfigJsonCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [configJsonCopied]);

  useEffect(() => {
    if (!systemInstructionsCopied) {
      return;
    }
    const timer = window.setTimeout(() => setSystemInstructionsCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [systemInstructionsCopied]);

  const updateToolsConfig = (updater: (prev: ToolsConfigState) => ToolsConfigState) => {
    setFormData((prev) => {
      const normalizedAdvanced = ensureAdvancedConfigDefaults(prev.advanced_config);
      const currentTools = normalizeToolsConfig(normalizedAdvanced.toolsConfig);
      const updatedTools = updater(currentTools);
      return {
        ...prev,
        advanced_config: {
          ...normalizedAdvanced,
          toolsConfig: normalizeToolsConfig(updatedTools)
        }
      };
    });
  };

  const handleFunctionModeChange = (mode: FunctionCallingModeOption) => {
    updateToolsConfig((prevTools) => ({
      ...prevTools,
      functionCalling: {
        ...prevTools.functionCalling,
        mode
      }
    }));
  };

  const handleAllowedFunctionToggle = (tool: CustomToolConfigState, enabled: boolean) => {
    updateToolsConfig((prevTools) => {
      const currentAllowed = Array.isArray(prevTools.functionCalling.allowedFunctionNames)
        ? [...prevTools.functionCalling.allowedFunctionNames]
        : [];
      const currentAllowedIds = Array.isArray(prevTools.functionCalling.allowedFunctionIds)
        ? [...prevTools.functionCalling.allowedFunctionIds]
        : [];

      const withoutTargetNames = currentAllowed.filter((name) => name !== tool.name);
      const withoutTargetIds = currentAllowedIds.filter((id) => id !== tool.id);

      const nextNames = enabled ? [...withoutTargetNames, tool.name] : withoutTargetNames;
      const nextIds = enabled ? [...withoutTargetIds, tool.id] : withoutTargetIds;

      return {
        ...prevTools,
        functionCalling: {
          ...prevTools.functionCalling,
          allowedFunctionNames: nextNames
            .filter((name) => name && name.length > 0),
          allowedFunctionIds: nextIds
            .filter((id) => id && id.length > 0)
        }
      };
    });
  };

  const handleToolFieldChange = (toolId: string, field: 'name' | 'description', value: string) => {
    updateToolsConfig((prevTools) => {
      const updatedCustomTools = prevTools.customTools.map((tool) =>
        tool.id === toolId ? { ...tool, [field]: value } : tool
      );

      let updatedAllowedNames = prevTools.functionCalling.allowedFunctionNames || [];
      if (field === 'name') {
        const previousTool = prevTools.customTools.find((tool) => tool.id === toolId);
        if (previousTool && previousTool.name !== value) {
          updatedAllowedNames = updatedAllowedNames.map((name) => (name === previousTool.name ? value : name));
        }
      }

      return {
        ...prevTools,
        customTools: updatedCustomTools,
        functionCalling: {
          ...prevTools.functionCalling,
          allowedFunctionNames: (updatedAllowedNames || []).filter((name) => name && name.length > 0)
        }
      };
    });
  };

  const handleParametersChange = (toolId: string, value: string) => {
    let parsedParameters: Record<string, any> | null = null;
    let error: string | undefined;
    const trimmed = value.trim();

    if (!trimmed) {
      error = '请输入有效的 JSON Schema';
    } else {
      try {
        parsedParameters = JSON.parse(value);
      } catch (parseError) {
        error = 'JSON 解析失败，请检查格式';
      }
    }

    if (!error && parsedParameters) {
      updateToolsConfig((prevTools) => ({
        ...prevTools,
        customTools: prevTools.customTools.map((tool) =>
          tool.id === toolId ? { ...tool, parameters: parsedParameters as Record<string, any> } : tool
        )
      }));
    }

    setCustomToolEditors((prev) => ({
      ...prev,
      [toolId]: {
        json: value,
        error
      }
    }));
  };

  const handleAddCustomTool = () => {
    const existingNames = new Set(toolsConfig.customTools.map((tool) => tool.name));
    let suffix = toolsConfig.customTools.length + 1;
    let candidateName = `custom_function_${suffix}`;
    while (existingNames.has(candidateName)) {
      suffix += 1;
      candidateName = `custom_function_${suffix}`;
    }

    const newToolId = generateToolId();
    const defaultParameters = createDefaultFunctionParameters();
    const newTool: CustomToolConfigState = {
      id: newToolId,
      name: candidateName,
      description: 'Describe what this function does',
      parameters: defaultParameters
    };

    updateToolsConfig((prevTools) => {
      const updatedCustomTools = [...prevTools.customTools, newTool];
      const existingAllowed = Array.isArray(prevTools.functionCalling.allowedFunctionNames)
        ? prevTools.functionCalling.allowedFunctionNames
        : [];
      const existingAllowedIds = Array.isArray(prevTools.functionCalling.allowedFunctionIds)
        ? prevTools.functionCalling.allowedFunctionIds
        : [];
      const defaultAllowedNames = updatedCustomTools.map((tool) => tool.name);
      const defaultAllowedIds = updatedCustomTools.map((tool) => tool.id);
      const allowedNames = existingAllowed.length > 0 ? existingAllowed : defaultAllowedNames;
      const allowedIds = existingAllowedIds.length > 0 ? existingAllowedIds : defaultAllowedIds;
      return {
        ...prevTools,
        customTools: updatedCustomTools,
        functionCalling: {
          ...prevTools.functionCalling,
          allowedFunctionNames: allowedNames,
          allowedFunctionIds: allowedIds
        }
      };
    });

    setCustomToolEditors((prev) => ({
      ...prev,
      [newToolId]: { json: JSON.stringify(defaultParameters, null, 2) }
    }));
  };

  const handleRemoveCustomTool = (toolId: string) => {
    updateToolsConfig((prevTools) => {
      const toolToRemove = prevTools.customTools.find((tool) => tool.id === toolId);
      const remainingTools = prevTools.customTools.filter((tool) => tool.id !== toolId);
      let updatedAllowedNames = prevTools.functionCalling.allowedFunctionNames || [];
      let updatedAllowedIds = prevTools.functionCalling.allowedFunctionIds || [];
      if (toolToRemove) {
        updatedAllowedNames = updatedAllowedNames.filter((name) => name !== toolToRemove.name);
        updatedAllowedIds = updatedAllowedIds.filter((id) => id !== toolToRemove.id);
      }
      return {
        ...prevTools,
        customTools: remainingTools,
        functionCalling: {
          ...prevTools.functionCalling,
          allowedFunctionNames: updatedAllowedNames,
          allowedFunctionIds: updatedAllowedIds
        }
      };
    });

    setCustomToolEditors((prev) => {
      if (!(toolId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[toolId];
      return next;
    });
  };

  const openDrawer = (key: DrawerSectionKey) => {
    setActiveDrawerKey(key);
    if (isPlaygroundDesktopLayout) {
      requestAnimationFrame(() => scrollToSection(configContentRef));
      return;
    }
    setIsConfigDrawerOpen(true);
  };

  const handleDrawerOpenChange = (open: boolean) => {
    setIsConfigDrawerOpen(open);
    if (!open) {
      setActiveDrawerKey(null);
    }
  };

  const scrollToSection = (target: React.RefObject<HTMLElement>) => {
    if (!target.current || typeof window === 'undefined') {
      return;
    }
    const top = target.current.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({
      top,
      behavior: 'smooth'
    });
  };

  useEffect(() => {
    if (location.hash === '#playground') {
      scrollToSection(playgroundCardRef);
    }
  }, [location.hash]);

  const isDraftMode = isNew ? true : useDraftConfig;
  const selectedProvider = normalizePromptProvider(
    formData.model_config?.provider || inferProviderFromModelName(formData.model_name)
  );
  const providerModelOptions = PLAYGROUND_PROVIDER_MODEL_OPTIONS[selectedProvider] || [];
  const selectedModelOption = providerModelOptions.find((option) => option === formData.model_name);
  const modelBadgeLabel = selectedModelOption || formatConfiguredValue(formData.model_name);
  const providerBadgeLabel = PROVIDER_OPTIONS.find((option) => option.value === selectedProvider)?.label || selectedProvider;
  const isGoogleProvider = selectedProvider === 'google-gemini-cli' || selectedProvider === 'google-legacy';
  const canSendMessage =
    Boolean(userInput.trim()) &&
    !isDebugging &&
    !contextVariablesError &&
    !providerSpecificError &&
    Boolean(formData.model_name.trim()) &&
    Boolean(formData.system_instructions.trim());
  const historyButtonLoading =
    loadSessionMutation.isPending ||
    ((isHistorySheetOpen || (isPlaygroundDesktopLayout && !historyPanel.collapsed)) && isLoadingSessions);
  const customTools = useMemo(
    () => dedupeCustomTools(Array.isArray(toolsConfig.customTools) ? toolsConfig.customTools : []),
    [toolsConfig.customTools]
  );
  const customToolIdSet = useMemo(() => new Set(customTools.map((tool) => tool.id)), [customTools]);
  const customToolNameSet = useMemo(() => new Set(customTools.map((tool) => tool.name)), [customTools]);
  const allowedFunctionNames = (toolsConfig.functionCalling.allowedFunctionNames || []).filter((name) =>
    customToolNameSet.has(name)
  );
  const allowedFunctionIds = (toolsConfig.functionCalling.allowedFunctionIds || []).filter((id) =>
    customToolIdSet.has(id)
  );
  const functionCallingMode = toolsConfig.functionCalling.mode;
  const isFunctionCallingDisabled = functionCallingMode === 'NONE';
  const contextVariablesPreview = JSON.stringify(rowsToContextObject(contextVariableRows), null, 2);
  const stopSequences = useMemo(
    () => normalizeStopSequencesList(formData.model_config?.stopSequences),
    [formData.model_config?.stopSequences]
  );
  const orderedSafetySettings = useMemo<SafetySettingsEntry[]>(() => {
    if (!Array.isArray(formData.advanced_config?.safetySettings)) {
      return [];
    }
    const orderMap = SAFETY_CATEGORY_ORDER.reduce<Record<string, number>>((acc, category, index) => {
      acc[category] = index;
      return acc;
    }, {});
    return formData.advanced_config.safetySettings
      .map((setting: SafetySettingConfig, index: number) => ({ setting, originalIndex: index }))
      .sort((a: SafetySettingsEntry, b: SafetySettingsEntry) => {
        const aOrder = orderMap[a.setting?.category ?? ''] ?? SAFETY_CATEGORY_ORDER.length;
        const bOrder = orderMap[b.setting?.category ?? ''] ?? SAFETY_CATEGORY_ORDER.length;
        return aOrder - bOrder;
      });
  }, [formData.advanced_config?.safetySettings]);
  const structuredOutputEnabled = Boolean((formData.advanced_config as any)?.structuredOutput);
  const googleSearchEnabled = Boolean((formData.advanced_config as any)?.googleSearch);
  const urlContextEnabled = Boolean((formData.advanced_config as any)?.urlContext);
  const thinkingConfig = formData.advanced_config.thinkingConfig ?? {
    thinkingBudget: -1,
    includeThoughts: true
  };
  const manualThinkingEnabled =
    typeof thinkingConfig.thinkingBudget === 'number' && thinkingConfig.thinkingBudget >= 0;
  const thinkingBudgetValue = manualThinkingEnabled ? thinkingConfig.thinkingBudget : 4096;
  const { advancedConfigSnapshot, sanitizedToolsConfig } = useMemo(() => {
    const normalizedToolsConfig = normalizeToolsConfig((formData.advanced_config as any)?.toolsConfig);
    const sanitizedFunctionCalling = {
      ...normalizedToolsConfig.functionCalling,
      allowedFunctionNames: Array.from(
        new Set(normalizedToolsConfig.functionCalling.allowedFunctionNames || [])
      ).filter((name) => name && name.length > 0),
      allowedFunctionIds: Array.from(
        new Set(normalizedToolsConfig.functionCalling.allowedFunctionIds || [])
      ).filter((id) => id && id.length > 0)
    };

    const sanitizedTools = {
      ...normalizedToolsConfig,
      functionCalling: sanitizedFunctionCalling
    };

    const advancedConfig = ensureAdvancedConfigDefaults({
      ...formData.advanced_config,
      toolsConfig: sanitizedTools
    });
    const generationConfig = {
      ...(advancedConfig.generationConfig || {}),
      temperature: coerceNumber(formData.model_config?.temperature),
      topP: coerceNumber(formData.model_config?.topP),
      topK: coerceNumber(formData.model_config?.topK),
      maxOutputTokens: coerceNumber(formData.model_config?.maxOutputTokens),
      ...(stopSequences.length > 0 ? { stopSequences } : {})
    };
    if (!stopSequences.length) {
      delete generationConfig.stopSequences;
    }
    advancedConfig.generationConfig = generationConfig;
    advancedConfig.thinkingConfig = {
      ...(advancedConfig.thinkingConfig || {})
    };
    advancedConfig.toolsConfig = {
      ...sanitizedTools,
      functionCallingConfig:
        sanitizedFunctionCalling.mode !== 'NONE'
          ? {
              mode: sanitizedFunctionCalling.mode,
              ...(sanitizedFunctionCalling.mode === 'ANY' && sanitizedFunctionCalling.allowedFunctionNames.length > 0
                ? { allowedFunctionNames: sanitizedFunctionCalling.allowedFunctionNames }
                : {})
            }
          : undefined
    };
    delete advancedConfig.maxOutputTokens;

    return {
      advancedConfigSnapshot: advancedConfig,
      sanitizedToolsConfig: sanitizedTools
    };
  }, [formData.advanced_config, formData.model_config, stopSequences]);

  const modelConfigSnapshot = useMemo(
    () => ({ ...(formData.model_config || {}) }),
    [formData.model_config]
  );

  const configJsonPreview = useMemo(
    () =>
      generateGetConfigJson({
        modelName: formData.model_name,
        systemInstruction: formData.system_instructions || '',
        modelConfig: modelConfigSnapshot,
        generationConfig: advancedConfigSnapshot?.generationConfig,
        safetySettings: advancedConfigSnapshot?.safetySettings,
        toolsConfig: sanitizedToolsConfig,
        advancedConfig: advancedConfigSnapshot,
        stopSequences
      }),
    [
      advancedConfigSnapshot,
      formData.model_name,
      formData.system_instructions,
      modelConfigSnapshot,
      selectedProvider,
      sanitizedToolsConfig,
      stopSequences
    ]
  );
  const lastUpdatedAt = useMemo(() => {
    if (!promptData?.data?.updated_at) {
      return '未更新';
    }
    const parsed = new Date(promptData.data.updated_at);
    return Number.isNaN(parsed.getTime()) ? '未更新' : parsed.toLocaleString();
  }, [promptData?.data?.updated_at]);
  const createdAtLabel = useMemo(() => {
    if (!promptData?.data?.created_at) {
      return '未记录';
    }
    const parsed = new Date(promptData.data.created_at);
    return Number.isNaN(parsed.getTime()) ? '未记录' : parsed.toLocaleString();
  }, [promptData?.data?.created_at]);
  const versionLabel = promptData?.data?.version ?? formData.version ?? 1;
  const viewModeLabel = isEditing ? '编辑中' : isNew ? '草稿模式' : '查看模式';
  const headerMetaItems = [
    {
      key: 'model',
      label: 'Provider / 模型',
      value: `${providerBadgeLabel} / ${modelBadgeLabel}`
    },
    {
      key: 'version',
      label: '版本',
      value: `v${versionLabel}`
    },
    {
      key: 'updated',
      label: '最近更新',
      value: lastUpdatedAt
    },
    {
      key: 'created',
      label: '创建时间',
      value: createdAtLabel
    },
    {
      key: 'owner',
      label: '创建人',
      value: formData.created_by || 'admin'
    }
  ] as const;
  const drawerNavItems: Array<{
    key: DrawerSectionKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { key: 'basic', label: '基础信息', icon: Settings },
    { key: 'prompt', label: '提示内容', icon: FileText },
    { key: 'variables', label: '变量与默认值', icon: Layers },
    { key: 'functions', label: '工具配置', icon: Code },
    { key: 'runtime', label: '运行参数', icon: SlidersHorizontal },
    { key: 'safety', label: '内容安全', icon: ShieldCheck },
    { key: 'preview', label: '配置预览', icon: Eye },
    { key: 'code', label: 'Unified Config JSON', icon: Copy }
  ];
  const quickNavItems = [
    { key: 'playground', label: 'Prompt Playground', icon: MessageSquare },
    ...drawerNavItems
  ] as const;
  const drawerDescriptions: Record<DrawerSectionKey, string> = {
    basic: '命名 Prompt 并选择所属的 Agent 类型，保持描述简洁明了。',
    prompt: '使用分段描述复杂任务，保存时会自动拆分为数组。',
    variables: '这些变量会在生成系统指令与用户模板时自动替换。',
    functions: '配置模型可调用的本地工具声明以及调用策略，帮助自动化处理结构化任务。',
    runtime: '维护通用 provider 的模型与运行参数。',
    safety: 'Google provider 可视化安全设置，其余 provider 保留 JSON 扩展。',
    preview: 'JSON 视图便于再次确认。',
    code: '导出统一 provider 配置快照。'
  };
  const activeDrawerNavItem = activeDrawerKey
    ? drawerNavItems.find((item) => item.key === activeDrawerKey)
    : null;

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let frame: number | null = null;

    const measureLayout = () => {
      const cardEl = playgroundCardRef.current;
      if (!cardEl) {
        return;
      }
      const cardRect = cardEl.getBoundingClientRect();
      const availableHeight = window.innerHeight - cardRect.top - 24;
      const nextHeight = Number.isFinite(availableHeight) ? Math.max(availableHeight, 320) : 320;
      setPlaygroundMinHeight(nextHeight);
    };

    const scheduleMeasure = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(measureLayout);
    };

    scheduleMeasure();
    window.addEventListener('resize', scheduleMeasure);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [isDraftMode, isEditing, isNew, contextVariablesError, messages.length, viewModeLabel]);

  const handleQuickNavClick = (key: (typeof quickNavItems)[number]['key']) => {
    if (key === 'playground') {
      scrollToSection(playgroundCardRef);
      return;
    }
    openDrawer(key as DrawerSectionKey);
  };
  const renderDrawerContent = () => {
    if (!activeDrawerKey) {
      return null;
    }

    const contentMap: Record<DrawerSectionKey, React.ReactNode> = {
      basic: (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Settings className="h-4 w-4" />
                基础信息
              </div>
              <h2 className="mt-2 text-xl font-semibold">定义 Prompt 的角色</h2>
              <p className="text-sm text-muted-foreground">
                命名 Prompt 并选择所属的 Agent 类型，保持描述简洁明了。
              </p>
            </div>
            {!isNew && <Badge variant="outline">v{promptData?.data?.version ?? 1}</Badge>}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="prompt_name">Prompt 名称 *</Label>
              <Input
                id="prompt_name"
                value={formData.prompt_name}
                onChange={(e) => setFormData((prev) => ({ ...prev, prompt_name: e.target.value }))}
                placeholder="例如：群聊助手 · 情绪安抚"
                disabled={!isEditing}
                required
              />
            </div>
            <div>
              <Label htmlFor="agent_type">Agent 类型 *</Label>
              <select
                id="agent_type"
                value={formData.agent_type}
                onChange={(e) => setFormData((prev) => ({ ...prev, agent_type: e.target.value }))}
                disabled={!isEditing}
                className="mt-[2px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm disabled:bg-muted/80 disabled:opacity-60"
                required
              >
                {agentTypesData?.data.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="补充 Prompt 的使用场景、目标或调参与注意事项。"
                disabled={!isEditing}
                rows={3}
              />
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-muted/45 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">激活状态</p>
              <p className="text-xs text-muted-foreground">停用后将不会在生产流中被调用。</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="prompt-active"
                checked={Boolean(formData.is_active)}
                onCheckedChange={(checked) => {
                  if (!isEditing) return;
                  setFormData((prev) => ({ ...prev, is_active: checked }));
                }}
                disabled={!isEditing}
              />
              <span className="text-sm text-muted-foreground">
                {formData.is_active ? '当前已激活' : '已停用'}
              </span>
            </div>
          </div>
        </section>
      ),
      prompt: (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-muted/40 bg-gradient-to-r from-muted/30 to-transparent px-6 py-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  提示内容
                </div>
                <h2 className="mt-2 text-xl font-semibold">编写系统指令与用户模板</h2>
                <p className="text-sm text-muted-foreground">
                  使用分段描述复杂任务，保存时会自动拆分为数组。
                </p>
              </div>
              <Badge variant="secondary" className="self-start lg:self-auto">
                {systemInstructionCharCount} 字符
              </Badge>
            </div>
          </div>
          <div className="flex flex-col gap-6 px-6 py-6 lg:grid lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-muted/40 px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground normal-case">
                    <Code className="h-4 w-4 text-muted-foreground" />
                    系统指令
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-2 rounded-full px-3 text-xs"
                      onClick={handleCopySystemInstructions}
                      disabled={!formData.system_instructions}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {systemInstructionsCopied ? '已复制' : '复制'}
                    </Button>
                  </div>
                </div>
                <div className="px-4 py-4">
                  <Textarea
                    id="system_instructions"
                    ref={systemInstructionRef}
                    value={formData.system_instructions}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, system_instructions: e.target.value }))
                    }
                    onFocus={() => setActivePromptSection('system')}
                    placeholder="使用双换行分隔段落，描述模型的角色、约束与步骤。"
                    disabled={!isEditing}
                    rows={12}
                    className="min-h-[240px] resize-none rounded-xl border bg-background/60 font-mono text-sm leading-relaxed shadow-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                    required
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    建议按阶段拆分指令，便于在运行时重组与调试。
                  </p>
                </div>
                {instructionSegments.length > 0 && (
                  <div
                    ref={promptPreviewRef}
                    tabIndex={-1}
                    className="border-t border-muted/40 bg-muted/45 px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                      <span>段落预览</span>
                      <span className="font-medium text-foreground">{instructionSegments.length} 段</span>
                    </div>
                    <ScrollArea className="mt-3 max-h-[240px] pr-2">
                      <div className="space-y-3 font-mono text-xs text-muted-foreground">
                        {instructionSegments.map((segment, index) => (
                          <pre
                            key={`${index}-${segment.slice(0, 12)}`}
                            className="whitespace-pre-wrap rounded-xl border border-muted/40 bg-background px-4 py-3 text-foreground shadow-sm"
                          >
                            {segment}
                          </pre>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-muted/40 px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground normal-case">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    用户提示模板
                  </span>
                  <span className="text-xs text-muted-foreground">可选</span>
                </div>
                <div className="px-4 py-4">
                  <Textarea
                    id="user_prompt_template"
                    ref={userPromptTemplateRef}
                    value={formData.user_prompt_template}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, user_prompt_template: e.target.value }))
                    }
                    onFocus={() => setActivePromptSection('user')}
                    placeholder="例如：请基于用户输入 {{user_message}} 生成回应..."
                    disabled={!isEditing}
                    rows={6}
                    className="min-h-[140px] resize-none rounded-xl border bg-background/60 text-sm leading-relaxed shadow-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <div className="mt-3 rounded-xl border border-dashed border-muted/50 bg-muted/10 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                    模板中支持使用{' '}
                    <code className="mx-1 rounded bg-muted px-1 py-[1px] font-mono text-[11px]">
                      {'{{variable}}'}
                    </code>
                    或{' '}
                    <code className="mx-1 rounded bg-muted px-1 py-[1px] font-mono text-[11px]">
                      ${'{variable}'}
                    </code>{' '}
                    占位符，将在运行时由下方变量表替换。
                  </div>
                </div>
              </div>
            </div>
            <aside className="space-y-4 rounded-xl border border-border bg-muted/35 p-4 lg:sticky lg:top-24">
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                <span>编辑导航</span>
                <span className="text-[11px] text-muted-foreground/80">点击聚焦</span>
              </div>
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="ghost"
                  className={`w-full justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                    activePromptSection === 'system'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/40'
                  }`}
                  onClick={() => focusPromptSection('system')}
                >
                  <span className="flex items-center gap-2">
                    <Code className="h-4 w-4" />
                    系统指令
                  </span>
                  <Badge variant={activePromptSection === 'system' ? 'default' : 'secondary'}>
                    {instructionSegments.length || 0} 段
                  </Badge>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className={`w-full justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                    activePromptSection === 'user'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/40'
                  }`}
                  onClick={() => focusPromptSection('user')}
                >
                  <span className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    用户模板
                  </span>
                  <Badge variant={activePromptSection === 'user' ? 'default' : 'secondary'}>
                    {userTemplatePlaceholders.length} 变量
                  </Badge>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className={`w-full justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                    activePromptSection === 'preview'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/40'
                  }`}
                  onClick={() => focusPromptSection('preview')}
                  disabled={instructionSegments.length === 0}
                >
                  <span className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    预览
                  </span>
                  <Badge variant={activePromptSection === 'preview' ? 'default' : 'secondary'}>
                    {instructionSegments.length}
                  </Badge>
                </Button>
              </div>
              <div className="rounded-xl border border-dashed border-muted/50 bg-muted/15 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">提示</p>
                <p className="mt-2">
                  采用结构化分段可以帮助 LLM 明确任务流程。可以在变量表中维护默认上下文，减少重复填写。
                </p>
                {userTemplatePlaceholders.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      检测到的占位符
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {userTemplatePlaceholders.map((key) => (
                        <span
                          key={key}
                          className="rounded-lg border border-muted/40 bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground"
                        >
                          {`{{${key}}}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </section>
      ),
      variables: (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Layers className="h-4 w-4" />
                变量与默认值
              </div>
              <h2 className="mt-2 text-xl font-semibold">为 Prompt 注入上下文</h2>
              <p className="text-sm text-muted-foreground">
                这些变量会在生成系统指令与用户模板时自动替换。
              </p>
            </div>
            {isEditing && (
              <Button type="button" variant="outline" size="sm" onClick={addContextVariableRow}>
                <Plus className="mr-2 h-4 w-4" />
                新增变量
              </Button>
            )}
          </div>
          <div className="mt-6 space-y-4">
            {contextVariableRows.map((row, index) => (
              <div
                key={row.id}
                className="rounded-xl border border-border bg-card p-4 transition hover:border-primary/40"
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>变量 #{index + 1}</span>
                  {row.key ? (
                    <code className="rounded bg-muted px-2 py-[2px] text-xs text-muted-foreground/80">
                      {`{{${row.key}}}`}
                    </code>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>变量 Key</Label>
                    <Input
                      value={row.key}
                      onChange={(e) => handleContextVariableChange(row.id, 'key', e.target.value)}
                      placeholder="user_name"
                      disabled={!isEditing}
                    />
                  </div>
                  <div>
                    <Label>默认值</Label>
                    <Input
                      value={row.value}
                      onChange={(e) => handleContextVariableChange(row.id, 'value', e.target.value)}
                      placeholder='例如：小明 / true / {"items":[]}'
                      disabled={!isEditing}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="flex-1">
                    <Label>说明 (可选)</Label>
                    <Input
                      value={row.description ?? ''}
                      onChange={(e) => handleContextVariableChange(row.id, 'description', e.target.value)}
                      placeholder="用于提示中说明变量来源或用法"
                      disabled={!isEditing}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`required-${row.id}`}
                      checked={Boolean(row.required)}
                      onCheckedChange={(checked) => handleContextVariableChange(row.id, 'required', checked)}
                      disabled={!isEditing}
                    />
                    <label htmlFor={`required-${row.id}`} className="text-xs text-muted-foreground">
                      运行时必填
                    </label>
                  </div>
                  {isEditing && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeContextVariableRow(row.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      删除
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {contextVariablesError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>上下文变量配置存在问题</AlertTitle>
              <AlertDescription>{contextVariablesError}</AlertDescription>
            </Alert>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              留空的变量会被忽略。数字、布尔值和 JSON 文本会自动解析。
            </p>
          )}
        </section>
      ),
      functions: (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Code className="h-4 w-4" />
                工具配置
              </div>
              <h2 className="mt-2 text-xl font-semibold">定义本地工具与调用策略</h2>
              <p className="text-sm text-muted-foreground">
                这里只保留本地工具声明和调用方式，不再依赖外部注册接口。
              </p>
            </div>
            <Badge variant={isFunctionCallingDisabled ? 'secondary' : 'default'}>
              {functionCallingMode === 'NONE' ? '禁用' : functionCallingMode === 'AUTO' ? 'Auto' : 'Any'}
            </Badge>
          </div>

          <div className="mt-6 space-y-6">
            <div className="rounded-xl border border-border bg-muted/45 p-4">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">调用模式</Label>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  { value: 'NONE', label: '禁用', description: '始终返回文本，不触发函数调用' },
                  { value: 'AUTO', label: '自动', description: '模型自行判断是否需要调用函数' },
                  { value: 'ANY', label: '强制', description: '模型至少调用一次函数再返回结果' }
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      if (!isEditing) return;
                      updateToolsConfig((prev) => ({
                        ...prev,
                        functionCalling: { ...prev.functionCalling, mode: option.value as FunctionCallingModeOption }
                      }));
                    }}
                    className={`flex flex-1 min-w-[140px] flex-col rounded-xl border px-4 py-3 text-left text-sm transition ${
                      functionCallingMode === option.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-dashed border-muted/50 text-muted-foreground hover:border-primary/40'
                    }`}
                    disabled={!isEditing}
                  >
                    <span className="font-semibold text-foreground">{option.label}</span>
                    <span className="mt-1 text-xs text-muted-foreground">{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">允许调用的本地工具</p>
                  <p className="text-xs text-muted-foreground">
                    {allowedFunctionIds.length > 0
                      ? `已选择 ${allowedFunctionIds.length} 个工具，模型将限制在这些工具中调用。`
                      : '暂未指定允许工具，自动模式下将尝试调用全部工具。'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={() => openDrawer('runtime')}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  查看运行参数
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {customTools.length > 0 ? (
                  customTools.map((tool) => {
                    const selected =
                      allowedFunctionIds.includes(tool.id) || allowedFunctionNames.includes(tool.name);
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          selected ? 'border-primary bg-primary/10 text-primary' : 'border-muted/40 text-muted-foreground'
                        }`}
                        onClick={() => {
                          if (!isEditing) return;
                          handleAllowedFunctionToggle(tool, !selected);
                        }}
                        disabled={!isEditing}
                      >
                        {tool.name}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-xs text-muted-foreground">尚未配置本地工具。</p>
                )}
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-muted/45 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">本地工具</p>
                  <p className="text-xs text-muted-foreground">函数使用 JSON Schema 定义参数，名称需唯一。</p>
                </div>
                {isEditing && (
                  <Button type="button" size="sm" onClick={handleAddCustomTool}>
                    <Plus className="mr-2 h-4 w-4" />
                    新增工具
                  </Button>
                )}
              </div>
              {customTools.length === 0 ? (
                <div className="rounded-xl border border-dashed border-muted/40 bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground">
                  尚未配置任何本地工具。可以点击“新增工具”创建自定义声明。
                </div>
              ) : (
                <div className="space-y-4">
                  {customTools.map((tool) => {
                    const editor = customToolEditors[tool.id] ?? { json: JSON.stringify(tool.parameters, null, 2) };
                    const hasError = Boolean(editor.error);
                    return (
                      <Card key={tool.id} className="border-border bg-card shadow-none">
                        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <CardTitle className="text-base font-semibold">{tool.name}</CardTitle>
                            <CardDescription>{tool.description || '未填写描述'}</CardDescription>
                          </div>
                          {isEditing && (
                            <div className="flex gap-2">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button type="button" variant="outline" size="sm">
                                    预览
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-xl">
                                  <DialogHeader>
                                    <DialogTitle>{tool.name}</DialogTitle>
                                    <DialogDescription>{tool.description}</DialogDescription>
                                  </DialogHeader>
                                  <pre className="scrollbar-thin max-h-[360px] overflow-auto rounded-md bg-muted/45 p-3 text-xs">
                                    {JSON.stringify(tool.parameters, null, 2)}
                                  </pre>
                                </DialogContent>
                              </Dialog>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => handleRemoveCustomTool(tool.id)}
                              >
                                删除
                              </Button>
                            </div>
                          )}
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <Label>工具名称</Label>
                                <Input
                                  value={tool.name}
                                  onChange={(e) => handleToolFieldChange(tool.id, 'name', e.target.value)}
                                  disabled={!isEditing}
                                />
                              </div>
                              <div>
                                <Label>工具描述</Label>
                                <Input
                                  value={tool.description}
                                  onChange={(e) =>
                                    handleToolFieldChange(tool.id, 'description', e.target.value)
                                  }
                                  disabled={!isEditing}
                                />
                              </div>
                            </div>
                            <div>
                              <Label className="mb-2 block">参数 Schema (JSON)</Label>
                              <Textarea
                                value={editor.json}
                                onChange={(e) => handleParametersChange(tool.id, e.target.value)}
                                className={`h-48 font-mono text-xs ${
                                  hasError ? 'border-destructive' : 'border-muted'
                                }`}
                                disabled={!isEditing}
                              />
                              {hasError ? (
                                <p className="mt-2 text-xs text-destructive">JSON 格式错误，请检查后再试。</p>
                              ) : (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  JSON Schema 应包含 type、properties 等字段，用于声明工具参数结构。
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      ),
      runtime: (
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">运行参数</CardTitle>
            <CardDescription>按内部通用 provider contract 维护模型、推理参数和 provider 专属扩展。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Provider</Label>
              <select
                value={selectedProvider}
                onChange={(e) => {
                  if (!isEditing) return;
                  const nextProvider = normalizePromptProvider(e.target.value);
                  setFormData((prev) => ({
                    ...prev,
                    model_config: {
                      ...prev.model_config,
                      provider: nextProvider
                    }
                  }));
                }}
                disabled={!isEditing}
                className="mt-3 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm disabled:bg-muted/80 disabled:opacity-60"
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">模型</Label>
              <div className="mt-3 grid gap-2">
                {providerModelOptions.map((option) => {
                  const isActiveModel = formData.model_name === option;
                  return (
                    <Button
                      key={option}
                      type="button"
                      variant={isActiveModel ? 'default' : 'outline'}
                      className="justify-between"
                      disabled={!isEditing}
                      onClick={() => {
                        if (!isEditing) return;
                        setFormData((prev) => ({ ...prev, model_name: option }));
                      }}
                    >
                      <span>{option}</span>
                      <span className="text-xs text-muted-foreground">
                        {PROVIDER_MODEL_DESCRIPTIONS[option] || '当前 provider 的常用预设'}
                      </span>
                    </Button>
                  );
                })}
                {providerModelOptions.length === 0 && (
                  <Button type="button" variant="outline" disabled className="justify-between">
                    <span>无预设模型</span>
                    <span className="text-xs text-muted-foreground">请直接填写自定义模型 ID</span>
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-4 rounded-xl border border-border bg-muted/45 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="model_name">自定义模型名称</Label>
                  <Input
                    id="model_name"
                    value={formData.model_name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, model_name: e.target.value }))}
                    placeholder="例如：gpt-5.4-mini"
                    disabled={!isEditing}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">模型 ID 必须显式填写。预设按钮只帮助选型，不会自动补默认值。</p>
                </div>
                <div>
                  <Label className="mb-2 block">providerSpecific JSON</Label>
                  <Textarea
                    value={providerSpecificText}
                    onChange={(e) => handleProviderSpecificTextChange(e.target.value)}
                    className={`min-h-[120px] font-mono text-xs ${providerSpecificError ? 'border-destructive' : ''}`}
                    disabled={!isEditing}
                  />
                  <p className={`mt-2 text-xs ${providerSpecificError ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {providerSpecificError || '用于 baseUrl、responsesPath、reasoningEffort、textVerbosity 等 provider 专属字段。'}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <Label htmlFor="maxOutputTokens">Max Output Tokens</Label>
                <Input
                  id="maxOutputTokens"
                  type="number"
                  value={formData.model_config.maxOutputTokens}
                  onChange={(e) =>
                    handleModelConfigChange(
                      'maxOutputTokens',
                      Math.max(1, parseInt(e.target.value || '0', 10))
                    )
                  }
                  disabled={!isEditing}
                />
              </div>
              <div>
                <Label htmlFor="temperature">Temperature</Label>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    id="temperature"
                    type="range"
                    min="0"
                    max="2"
                    step="0.01"
                    value={Number(formData.model_config.temperature ?? 0)}
                    onChange={(e) =>
                      handleModelConfigChange('temperature', parseFloat(e.target.value || '0'))
                    }
                    disabled={!isEditing}
                    className="h-1 w-full accent-primary"
                  />
                  <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">
                    {Number(formData.model_config.temperature ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
              <div>
                <Label htmlFor="topP">Top P</Label>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    id="topP"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={Number(formData.model_config.topP ?? 0)}
                    onChange={(e) =>
                      handleModelConfigChange('topP', parseFloat(e.target.value || '0'))
                    }
                    disabled={!isEditing}
                    className="h-1 w-full accent-primary"
                  />
                  <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">
                    {Number(formData.model_config.topP ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="mediaResolution">媒体输出</Label>
                <select
                  id="mediaResolution"
                  value={formData.model_config.mediaResolution}
                  onChange={(e) => handleModelConfigChange('mediaResolution', e.target.value)}
                  disabled={!isEditing}
                className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm disabled:bg-muted/80 disabled:opacity-60"
                >
                  {MEDIA_RESOLUTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isGoogleProvider ? '低分辨率适合多媒体调试，默认保持原画质。' : '该配置仅对 Google provider 生效；其他 provider 会忽略。'}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">当前 Provider / 模型</p>
                <p className="mt-1 break-all">{providerBadgeLabel}</p>
                <p className="mt-1 break-all">{formatConfiguredValue(formData.model_name)}</p>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Stop Sequences</Label>
                {isEditing && stopSequences.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleStopSequencesCleanup}
                  >
                    清理空值
                  </Button>
                )}
              </div>
              {stopSequences.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {stopSequences.map((seq, index) => (
                    <Badge
                      key={`${seq}-${index}`}
                      variant="outline"
                      className="flex items-center gap-2 px-3 py-1 text-xs"
                    >
                      <code>{seq}</code>
                      {isEditing && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveStopSequence(index)}
                        >
                          ×
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">未配置停止符号，模型将按 Token 限制结束。</p>
              )}
              {isEditing && (
                <div className="mt-3 flex gap-2">
                  <Input
                    value={newStopSequence}
                    onChange={(e) => setNewStopSequence(e.target.value)}
                    placeholder="END_OF_RESPONSE"
                    className="flex-1"
                  />
                  <Button type="button" onClick={handleAddStopSequence} disabled={!newStopSequence.trim()}>
                    添加
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-4 rounded-xl border border-border bg-muted/45 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">思考预算</p>
                  <p className="text-xs text-muted-foreground">Auto = -1，Manual 可固定 token 上限。</p>
                </div>
                <Switch
                  id="manual-thinking"
                  checked={manualThinkingEnabled}
                  onCheckedChange={(checked) => {
                    if (!isEditing) return;
                    const nextBudget =
                      checked && (!thinkingConfig.thinkingBudget || thinkingConfig.thinkingBudget < 0)
                        ? 4096
                        : checked
                          ? thinkingConfig.thinkingBudget
                          : -1;
                    handleAdvancedConfigChange('thinkingConfig', 'thinkingBudget', nextBudget ?? 4096);
                  }}
                  disabled={!isEditing}
                />
              </div>
              <div>
                <Label
                  htmlFor="thinkingBudgetInput"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Token 上限
                </Label>
                <Input
                  id="thinkingBudgetInput"
                  type="number"
                  min="0"
                  value={manualThinkingEnabled ? thinkingConfig.thinkingBudget ?? 0 : thinkingBudgetValue}
                  onChange={(e) =>
                    handleAdvancedConfigChange('thinkingConfig', 'thinkingBudget', Math.max(0, parseInt(e.target.value || '0', 10)))
                  }
                  disabled={!isEditing || !manualThinkingEnabled}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
                <div>
                  <p className="text-sm font-medium">包含思考过程</p>
                  <p className="text-xs text-muted-foreground">启用后会在调试对话中暴露 Thought。</p>
                </div>
                <Switch
                  id="includeThoughts"
                  checked={thinkingConfig.includeThoughts ?? true}
                  onCheckedChange={(checked) => handleAdvancedConfigChange('thinkingConfig', 'includeThoughts', checked)}
                  disabled={!isEditing}
                />
              </div>
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-muted/45 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">工具与上下文</p>
                  <p className="text-xs text-muted-foreground">快速切换结构化输出、外部搜索及本地工具调用。</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => openDrawer('functions')}
                >
                  管理工具
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                <div>
                  <p className="text-sm font-medium">工具调用</p>
                  <p className="text-xs text-muted-foreground">
                    当前: {functionCallingMode === 'NONE' ? '禁用' : functionCallingMode === 'AUTO' ? '自动' : '强制'}
                  </p>
                </div>
                <Switch
                  id="function-calling-toggle"
                  checked={functionCallingMode !== 'NONE'}
                  onCheckedChange={(checked) => handleFunctionModeChange(checked ? 'AUTO' : 'NONE')}
                  disabled={!isEditing}
                />
              </div>
              {customTools.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  已声明 {customTools.length} 个工具，允许调用 {allowedFunctionNames.length} 个。
                </p>
              )}
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Structured Output</p>
                  <p className="text-xs text-muted-foreground">生成符合 JSON Schema 的回复。</p>
                </div>
                <Switch
                  id="structured-output-toggle"
                  checked={structuredOutputEnabled}
                  onCheckedChange={handleAdvancedFlagToggle('structuredOutput')}
                  disabled={!isEditing}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Google Search</p>
                  <p className="text-xs text-muted-foreground">
                    {isGoogleProvider ? '为回答补充实时网页内容。' : '当前 provider 不提供可视化开关，建议改 provider 或直接编辑 JSON。'}
                  </p>
                </div>
                <Switch
                  id="google-search-toggle"
                  checked={googleSearchEnabled}
                  onCheckedChange={handleAdvancedFlagToggle('googleSearch')}
                  disabled={!isEditing || !isGoogleProvider}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">URL Context</p>
                  <p className="text-xs text-muted-foreground">
                    {isGoogleProvider ? '在推理前抓取网页内容作为上下文。' : '当前 provider 不提供可视化开关，建议改 provider 或直接编辑 JSON。'}
                  </p>
                </div>
                <Switch
                  id="url-context-toggle"
                  checked={urlContextEnabled}
                  onCheckedChange={handleAdvancedFlagToggle('urlContext')}
                  disabled={!isEditing || !isGoogleProvider}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ),
      safety: (
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">内容安全</CardTitle>
            <CardDescription>
              {isGoogleProvider
                ? 'Google provider 可视化编辑安全阈值。'
                : '非 Google provider 默认不暴露可视化安全控件，保留已有配置并通过 JSON 扩展。'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isGoogleProvider && (
              <Alert>
                <AlertTitle>当前 provider 不是 Google</AlertTitle>
                <AlertDescription>
                  安全设置会继续保留在配置中，但本页不再用 Gemini 专属控件误导你。需要细调时，请在 providerSpecific 或高级 JSON 中处理。
                </AlertDescription>
              </Alert>
            )}
            <div className="rounded-xl border border-border bg-muted/45 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">当前策略</p>
              <div className="mt-3 space-y-2">
                {orderedSafetySettings.length > 0
                  ? orderedSafetySettings.map((entry, index) => {
                      const { setting } = entry;
                      return (
                        <div
                          key={`${setting.category ?? 'unknown'}-${index}`}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="font-medium text-foreground">
                            {getSafetyCategoryLabel(setting.category)}
                          </span>
                          <span className="text-muted-foreground">
                            {getSafetyThresholdLabel(setting.threshold)}
                          </span>
                        </div>
                      );
                    })
                  : (
                    <p className="text-xs text-muted-foreground">暂未显式配置内容安全规则。</p>
                  )}
              </div>
            </div>

            <Dialog open={isSafetyDialogOpen} onOpenChange={setIsSafetyDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={!isEditing || !isGoogleProvider} className="w-full sm:w-auto">
                  调整安全设置
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>内容安全设置</DialogTitle>
                  <DialogDescription>
                    调整模型对各类潜在风险内容的拦截程度，保存 Prompt 后生效。
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {orderedSafetySettings.length > 0
                    ? orderedSafetySettings.map((entry, index) => {
                        const { setting, originalIndex } = entry;
                        const sliderValue = thresholdToSliderValue(setting.threshold);
                        return (
                          <div
                            key={`${setting.category ?? 'unknown'}-${index}`}
                            className="space-y-3 rounded-lg border border-border bg-muted/45 p-4"
                          >
                            <div className="flex items-center justify-between text-sm font-medium">
                              <span>{getSafetyCategoryLabel(setting.category)}</span>
                              <span className="text-muted-foreground">
                                {getSafetyThresholdLabel(setting.threshold)}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={SAFETY_THRESHOLD_ORDER.length - 1}
                              step={1}
                              value={sliderValue}
                              onChange={(event) =>
                                handleSafetyThresholdSliderChange(originalIndex, Number(event.target.value))
                              }
                              disabled={!isEditing}
                              className="w-full accent-primary"
                              aria-label={`${getSafetyCategoryLabel(setting.category)} 阈值`}
                              aria-valuetext={getSafetyThresholdLabel(setting.threshold)}
                            />
                            <div className="flex justify-between text-[11px] text-muted-foreground">
                              {SAFETY_THRESHOLD_ORDER.map((threshold) => (
                                <span key={`${setting.category}-${threshold}`} className="tracking-wide">
                                  {getSafetyThresholdLabel(threshold)}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })
                    : (
                      <p className="text-sm text-muted-foreground">暂无可配置的安全规则。</p>
                    )}
                </div>
                <DialogFooter className="sm:flex-row sm:justify-between">
                  <Button variant="ghost" onClick={handleResetSafetySettings} disabled={!isEditing} type="button">
                    恢复默认值
                  </Button>
                  <Button type="button" onClick={() => setIsSafetyDialogOpen(false)}>
                    完成
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      ),
      preview: (
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">配置预览</CardTitle>
            <CardDescription>JSON 视图便于再次确认</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="model" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="model">模型</TabsTrigger>
                <TabsTrigger value="variables">变量</TabsTrigger>
                <TabsTrigger value="advanced">高级</TabsTrigger>
              </TabsList>
              <TabsContent value="model">
                <pre className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-md bg-muted/45 p-3 text-xs">
                  {JSON.stringify(formData.model_config, null, 2)}
                </pre>
              </TabsContent>
              <TabsContent value="variables">
                <pre className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-md bg-muted/45 p-3 text-xs">
                  {contextVariablesPreview}
                </pre>
              </TabsContent>
              <TabsContent value="advanced">
                <pre className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-md bg-muted/45 p-3 text-xs">
                  {JSON.stringify(formData.advanced_config, null, 2)}
                </pre>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ),
      code: (
        <Card className="bg-card shadow-sm">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Unified Config JSON</CardTitle>
              <CardDescription>复制当前 Prompt 的 provider-aware 配置快照。</CardDescription>
            </div>
            <Button
              type="button"
              variant={configJsonCopied ? 'default' : 'outline'}
              size="sm"
              onClick={handleCopyConfigJson}
            >
              {configJsonCopied ? '已复制' : '复制'}
              <Copy className="ml-2 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="scrollbar-thin max-h-80 overflow-auto rounded-md bg-muted/45 p-3 text-xs">
              {configJsonPreview}
            </pre>
          </CardContent>
        </Card>
      )
    };

    return contentMap[activeDrawerKey];
  };
  const handleCopyConfigJson = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(configJsonPreview);
        setConfigJsonCopied(true);
      } else {
        throw new Error('浏览器不支持剪贴板写入');
      }
    } catch (error) {
      console.error('Failed to copy run configuration', error);
      setConfigJsonCopied(false);
    }
  };
  if (!isNew && isLoadingPrompt) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">加载中...</span>
      </div>
    );
  }

  if (!isNew && promptError) {
    return (
      <div className="text-center py-12 text-red-600">
        加载失败: {promptError instanceof Error ? promptError.message : '未知错误'}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col pb-16">
      <div className="sticky top-0 z-30 border-b border-border bg-background/95">
        <div className="mx-auto w-full max-w-screen-2xl px-4 py-4 xl:max-w-none xl:px-8 2xl:px-12">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <Button variant="ghost" size="icon" onClick={() => navigate('/prompts')}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    <h1 className="truncate text-lg font-semibold leading-tight md:text-xl">
                      {formData.prompt_name || '未命名 Prompt'}
                      {isNew ? ' · 草稿' : ''}
                    </h1>
                    <Badge variant={formData.is_active ? 'default' : 'secondary'}>
                      {formData.is_active ? '激活' : '禁用'}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-normal">
                      {viewModeLabel}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    在一个工作台中维护 Prompt、Provider、变量与调试闭环。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(promptId ? `/playground?promptId=${promptId}` : '/playground')}
                >
                  <Navigation className="mr-1 h-3.5 w-3.5" />
                  完整 Playground
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => scrollToSection(playgroundCardRef)}
                >
                  <MessageSquare className="mr-1 h-3.5 w-3.5" />
                  调试
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={() => openDrawer('prompt')}
                >
                  <FileText className="mr-1 h-3.5 w-3.5" />
                  配置
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hidden lg:inline-flex"
                  onClick={() => openDrawer('functions')}
                >
                  <Code className="mr-1 h-3.5 w-3.5" />
                  工具
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="hidden lg:inline-flex"
                  onClick={() => openDrawer('runtime')}
                >
                  <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                  参数
                </Button>
                {isEditing ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (isNew) {
                          navigate('/prompts');
                        } else {
                          setIsEditing(false);
                        }
                      }}
                    >
                      取消
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={saveMutation.isPending} size="sm">
                      {saveMutation.isPending ? (
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      保存
                    </Button>
                  </>
                ) : (
                  !isNew && (
                    <Button type="button" size="sm" onClick={() => setIsEditing(true)}>
                      编辑
                    </Button>
                  )
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground sm:gap-4">
              {headerMetaItems.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-2 rounded-md border border-muted/40 bg-muted/10 px-3 py-1"
                >
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="whitespace-nowrap text-muted-foreground">{item.value}</span>
                </div>
              ))}
            </div>
            {!isEditing && !isNew && (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/20 bg-primary/10 px-3 py-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span>点击右上角“编辑”后可修改配置，灰色字段表示当前暂不可编辑。</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1">
        <div className="mx-auto flex h-full w-full max-w-screen-2xl flex-col px-4 pb-40 pt-8 xl:max-w-none xl:px-8 2xl:px-12">
          <div
            ref={playgroundWorkspaceRef}
            className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]"
          >
            <div className="min-w-0 space-y-6">
              <Card
                ref={playgroundCardRef}
                className="flex min-h-0 flex-col bg-card shadow-sm"
                style={playgroundMinHeight ? { height: `${playgroundMinHeight}px` } : undefined}
              >
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold">
                      <MessageSquare className="h-4 w-4" />
                      Prompt Playground
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={isDraftMode ? 'default' : 'secondary'}>
                        {isDraftMode ? '草稿配置' : '已保存配置'}
                      </Badge>
                      <Badge variant="outline">{modelBadgeLabel}</Badge>
                    </div>
                  </div>
                  <CardDescription>
                    在同一工作台里完成调试，再继续编辑配置。桌面端默认采用稳定的主区 + 侧栏，不再用漂浮窗口打断操作。
                  </CardDescription>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="draft-mode"
                        checked={isDraftMode}
                        disabled={isNew}
                        onCheckedChange={(checked) => setUseDraftConfig(checked)}
                      />
                      <label htmlFor="draft-mode" className="cursor-pointer text-xs font-medium">
                        使用草稿配置调试
                      </label>
                      {isNew && (
                        <span className="rounded-full bg-primary/10 px-2 py-[2px] text-[10px] font-medium text-primary">
                          新建提示默认启用
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setOverviewPanel((current) => ({ ...current, collapsed: !current.collapsed }))}
                      >
                        <Navigation className="mr-2 h-3.5 w-3.5" />
                        {overviewPanel.collapsed ? '显示侧栏' : '隐藏侧栏'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (isPlaygroundDesktopLayout && overviewPanel.collapsed) {
                            setOverviewPanel((current) => ({ ...current, collapsed: false }));
                          }
                          openHistoryPanel();
                        }}
                        disabled={!canUseSessionFeatures || historyButtonLoading}
                      >
                        {historyButtonLoading ? (
                          <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <History className="mr-2 h-3.5 w-3.5" />
                        )}
                        {isPlaygroundDesktopLayout && !historyPanel.collapsed ? '收起历史' : '调试历史'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={openSaveSessionDialog}
                        disabled={!canUseSessionFeatures || !messages.length}
                      >
                        {saveSessionMutation.isPending ? (
                          <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-3.5 w-3.5" />
                        )}
                        保存会话
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearMessages}
                        disabled={!messages.length}
                        className="h-7 px-2 text-xs"
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        清空对话
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
                  {isNew && (
                    <div className="rounded-xl border border-dashed border-muted/50 bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                      草稿模式默认开启，先在这里验证，再向下进入基础信息、变量和运行参数。
                    </div>
                  )}

                  {!isNew && !isEditing && (
                    <div className="rounded-xl border border-dashed border-muted/50 bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                      当前处于查看模式，调试仍会调用最新保存的配置。若需更新 Prompt，请先点击右上角的“编辑”按钮。
                    </div>
                  )}

                  {contextVariablesError && (
                    <Alert variant="destructive">
                      <AlertTitle>上下文变量配置存在问题</AlertTitle>
                      <AlertDescription>修复后才能确保草稿配置与正式配置保持一致。</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
                    <ResizableSplit
                      direction="vertical"
                      disabled={!isPlaygroundDesktopLayout}
                      defaultSize={76}
                      minFirstSize={280}
                      minSecondSize={160}
                      className="h-full"
                      firstClassName="h-full"
                      secondClassName="h-full"
                      handleLabel="调整消息区与输入区高度"
                      first={(
                        <div className="h-full min-h-0 space-y-4 overflow-y-auto p-4">
                          {messages.length === 0 ? (
                            <div className="flex h-[340px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                              <Bot className="h-10 w-10 text-muted-foreground/60" />
                              <p>输入消息开始对话调试，实时查看模型输出。</p>
                              <p className="text-xs text-muted-foreground/80">
                                {isNew
                                  ? '保存前的草稿配置同样生效，方便在同一页面快速迭代。'
                                  : '在下方输入框填写内容并点击“发送”即可触发调试。'}
                              </p>
                              {!isNew && !isEditing && (
                                <p className="text-xs text-muted-foreground/80">
                                  当前为查看模式，调试将使用最近一次保存的参数。
                                </p>
                              )}
                            </div>
                          ) : (
                            messages.map((message) => {
                              const timestamp = message.timestamp instanceof Date
                                ? message.timestamp
                                : new Date(message.timestamp);
                              const isUser = message.role === 'user';
                              return (
                                <div
                                  key={message.id}
                                  className={`group flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                                >
                                  {!isUser && (
                                    <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                      <Bot className="h-4 w-4" />
                                    </div>
                                  )}
                                  <div
                                    className={`max-w-[75%] rounded-xl px-4 py-3 shadow-sm transition group-hover:shadow-md ${
                                      isUser
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted text-foreground'
                                    }`}
                                  >
                                    <div className="mb-2 flex items-center justify-between text-xs opacity-70">
                                      <span>{isUser ? '用户' : '模型'}</span>
                                      <span>{timestamp.toLocaleTimeString()}</span>
                                    </div>
                                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                                      {message.content || '（空响应）'}
                                    </div>
                                    {message.thought && (
                                      <div className="mt-3 rounded-md border border-border bg-card/90 p-3 text-xs text-foreground">
                                        <button
                                          type="button"
                                          className="mb-2 flex items-center gap-1 text-xs font-medium text-primary"
                                          onClick={() => toggleThought(message.id)}
                                        >
                                          <Brain className="h-3 w-3" />
                                          {message.showThought ? '收起思考过程' : '展开思考过程'}
                                          {message.showThought ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                        </button>
                                        {message.showThought && (
                                          <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                                            {message.thought}
                                          </pre>
                                        )}
                                      </div>
                                    )}
                                    {message.metadata && (
                                      <div className="mt-3 grid gap-2 rounded-md border border-border bg-card/90 p-2 text-xs text-muted-foreground">
                                        {message.metadata.model && (
                                          <div className="flex items-center justify-between">
                                            <span>模型</span>
                                            <code>{message.metadata.model}</code>
                                          </div>
                                        )}
                                        {typeof message.metadata.tokensUsed !== 'undefined' && (
                                          <div className="flex items-center justify-between">
                                            <span>Tokens</span>
                                            <span>{message.metadata.tokensUsed}</span>
                                          </div>
                                        )}
                                        {typeof message.metadata.cachedInputTokens !== 'undefined' && (
                                          <div className="flex items-center justify-between">
                                            <span>Cached Input</span>
                                            <span>{message.metadata.cachedInputTokens}</span>
                                          </div>
                                        )}
                                        {typeof message.metadata.reasoningTokens !== 'undefined' && (
                                          <div className="flex items-center justify-between">
                                            <span>Reasoning</span>
                                            <span>{message.metadata.reasoningTokens}</span>
                                          </div>
                                        )}
                                        {message.metadata.tokenInfo && (
                                          <div className="flex items-center justify-between">
                                            <span>Token</span>
                                            <span>
                                              {message.metadata.tokenInfo.projectName || '未识别'}
                                              {message.metadata.tokenInfo.tokenId
                                                ? ` (ID: ${message.metadata.tokenInfo.tokenId})`
                                                : ''}
                                            </span>
                                          </div>
                                        )}
                                        {typeof message.metadata.processingTime !== 'undefined' && (
                                          <div className="flex items-center justify-between">
                                            <span>耗时</span>
                                            <span>{message.metadata.processingTime} ms</span>
                                          </div>
                                        )}
                                        {typeof message.metadata.contextPolicy?.contextWindowTokens !== 'undefined' && (
                                          <div className="flex items-center justify-between">
                                            <span>Context Window</span>
                                            <span>{message.metadata.contextPolicy.contextWindowTokens}</span>
                                          </div>
                                        )}
                                        {typeof message.metadata.contextPolicy?.softTriggerTokens !== 'undefined' && (
                                          <div className="flex items-center justify-between">
                                            <span>Soft Trigger</span>
                                            <span>{message.metadata.contextPolicy.softTriggerTokens}</span>
                                          </div>
                                        )}
                                        {typeof message.metadata.contextPolicy?.hardCeilingTokens !== 'undefined' && (
                                          <div className="flex items-center justify-between">
                                            <span>Hard Ceiling</span>
                                            <span>{message.metadata.contextPolicy.hardCeilingTokens}</span>
                                          </div>
                                        )}
                                        {typeof message.metadata.contextPolicy?.replyBudgetTokens !== 'undefined' && (
                                          <div className="flex items-center justify-between">
                                            <span>Reply Budget</span>
                                            <span>{message.metadata.contextPolicy.replyBudgetTokens}</span>
                                          </div>
                                        )}
                                        {message.metadata.contextPolicy?.source && (
                                          <div className="flex items-center justify-between">
                                            <span>策略来源</span>
                                            <span>{message.metadata.contextPolicy.source}</span>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                      second={(
                        <div className="h-full min-h-0 overflow-auto border-t border-border bg-background p-4">
                          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:flex-row sm:items-end">
                            <Textarea
                              value={userInput}
                              onChange={(e) => setUserInput(e.target.value)}
                              placeholder="向模型发送一条调试消息..."
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                  event.preventDefault();
                                  handleSendMessage();
                                }
                              }}
                              rows={4}
                              className="h-full min-h-[120px] flex-1 resize-none bg-card"
                              disabled={isDebugging}
                            />
                            <div className="flex w-full justify-center sm:w-auto sm:justify-end">
                              <Button
                                type="button"
                                onClick={handleSendMessage}
                                disabled={!canSendMessage}
                                className="w-full sm:w-auto"
                              >
                                {isDebugging ? (
                                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Send className="mr-2 h-4 w-4" />
                                )}
                                发送
                              </Button>
                            </div>
                          </div>
                          <p className="mx-auto mt-2 w-full max-w-3xl text-right text-xs text-muted-foreground">
                            按 Enter 发送，Shift + Enter 换行
                          </p>
                        </div>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {isPlaygroundDesktopLayout && activeDrawerKey ? (
                <div ref={configContentRef} className="space-y-4">
                  <Card className="bg-card shadow-sm">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-base font-semibold">配置工作区</CardTitle>
                      <CardDescription>按“基础信息 → 提示内容 → 变量 → 参数”的顺序维护 Prompt。</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      {drawerNavItems.map((item) => (
                        <Button
                          key={item.key}
                          type="button"
                          variant={activeDrawerKey === item.key ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setActiveDrawerKey(item.key)}
                        >
                          <item.icon className="mr-2 h-4 w-4" />
                          {item.label}
                        </Button>
                      ))}
                    </CardContent>
                  </Card>
                  {renderDrawerContent()}
                </div>
              ) : null}
            </div>

            {isPlaygroundDesktopLayout && !overviewPanel.collapsed ? (
              <aside className="hidden lg:block">
                <div className="space-y-4 lg:sticky lg:top-28">
                  <Card className="bg-card shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <Bot className="h-4 w-4 text-primary" />
                        Prompt 概览
                      </CardTitle>
                      <CardDescription>编辑时只看关键状态，避免视线被 JSON 和工具选项打断。</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">状态</span>
                        <Badge variant={formData.is_active ? 'default' : 'secondary'}>
                          {formData.is_active ? '激活' : '禁用'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">模式</span>
                        <span className="font-medium text-foreground">{viewModeLabel}</span>
                      </div>
                      <div>
                        <p className="text-muted-foreground">模型</p>
                        <p className="font-medium text-foreground">{modelBadgeLabel}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">最近更新</p>
                        <p>{lastUpdatedAt}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">创建人</p>
                        <p>{formData.created_by || 'admin'}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-card shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <Navigation className="h-4 w-4 text-primary" />
                        快速跳转
                      </CardTitle>
                      <CardDescription>固定在右侧，主区滚动时也能稳定切换当前任务。</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {quickNavItems.map((item) => {
                        const isActive = item.key !== 'playground' && activeDrawerKey === item.key;
                        return (
                          <Button
                            key={item.key}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={`w-full justify-between rounded-lg border text-left text-sm transition ${
                              isActive
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-transparent text-foreground hover:border-border hover:bg-muted/40'
                            }`}
                            onClick={() => handleQuickNavClick(item.key)}
                          >
                            <span className="flex items-center gap-2">
                              <item.icon className="h-4 w-4 text-muted-foreground" />
                              {item.label}
                            </span>
                            <ChevronRight
                              className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-muted-foreground/70'}`}
                            />
                          </Button>
                        );
                      })}
                    </CardContent>
                  </Card>

                  {canUseSessionFeatures ? (
                    <Card className="bg-card shadow-sm">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-base font-semibold">
                              <History className="h-4 w-4 text-primary" />
                              调试历史
                            </CardTitle>
                            <CardDescription>恢复之前的对话，不必在独立浮窗里找记录。</CardDescription>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={openHistoryPanel}
                            disabled={historyButtonLoading}
                          >
                            {historyPanel.collapsed ? '展开' : '收起'}
                          </Button>
                        </div>
                      </CardHeader>
                      {!historyPanel.collapsed ? (
                        <CardContent className="space-y-3">
                          {historyButtonLoading && (
                            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted/40 p-6 text-sm text-muted-foreground">
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              <span>加载历史记录...</span>
                            </div>
                          )}
                          {!historyButtonLoading &&
                            (!debugSessionsData?.data?.sessions ||
                              debugSessionsData.data.sessions.length === 0) && (
                              <div className="rounded-lg border border-dashed border-muted/40 p-6 text-center text-sm text-muted-foreground">
                                暂无调试历史，保存一次对话后会显示在这里。
                              </div>
                            )}
                          {!historyButtonLoading &&
                            debugSessionsData?.data.sessions?.map((session) => (
                              <div
                                key={session.id}
                                className="group rounded-lg border border-border bg-card p-3 transition hover:border-primary/40 hover:bg-primary/5"
                                onClick={() => handleLoadSession(session.id)}
                                role="button"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <h3 className="truncate text-sm font-medium text-foreground">
                                      {session.session_name || '未命名会话'}
                                    </h3>
                                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                      <Clock className="h-3.5 w-3.5" />
                                      <span>
                                        {new Date(session.updated_at ?? session.created_at).toLocaleString()}
                                      </span>
                                    </div>
                                  </div>
                                  <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
                                    {(session.message_count ?? 0).toString()} 条
                                  </Badge>
                                </div>
                                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                                  <span>输入消息: {session.input_count ?? session.message_count ?? 0}</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs text-red-500 hover:text-red-600 group-hover:opacity-100"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleDeleteSession(session.id);
                                    }}
                                    disabled={deleteSessionMutation.isPending}
                                  >
                                    <Trash2 className="mr-1 h-3 w-3" />
                                    删除
                                  </Button>
                                </div>
                              </div>
                            ))}
                        </CardContent>
                      ) : null}
                    </Card>
                  ) : null}
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </div>

      <Sheet
        open={!isPlaygroundDesktopLayout && isHistorySheetOpen}
        onOpenChange={(open) => {
          if (isPlaygroundDesktopLayout) {
            setIsHistorySheetOpen(false);
            return;
          }
          setIsHistorySheetOpen(open);
          if (open && canUseSessionFeatures) {
            refetchDebugSessions();
          }
        }}
      >
        <SheetContent side="right" className="w-[320px] sm:w-[420px] border-l bg-background">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              调试历史
            </SheetTitle>
            <SheetDescription>
              查询并加载已保存的调试会话，点击条目即可恢复对话内容。
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {historyButtonLoading && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted/40 p-6 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>加载历史记录...</span>
              </div>
            )}
            {!historyButtonLoading &&
              (!debugSessionsData?.data?.sessions ||
                debugSessionsData.data.sessions.length === 0) && (
                <div className="rounded-lg border border-dashed border-muted/40 p-6 text-center text-sm text-muted-foreground">
                  暂无调试历史，保存一次对话后会显示在这里。
                </div>
              )}
            {!historyButtonLoading &&
              debugSessionsData?.data.sessions?.map((session) => (
                <div
                  key={session.id}
                  className="group rounded-lg border border-border bg-card p-3 transition hover:border-primary/40 hover:bg-primary/5"
                  onClick={() => handleLoadSession(session.id)}
                  role="button"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium text-foreground">
                        {session.session_name || '未命名会话'}
                      </h3>
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        <span>
                          {new Date(session.updated_at ?? session.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
                      {(session.message_count ?? 0).toString()} 条
                    </Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>输入消息: {session.input_count ?? session.message_count ?? 0}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-red-500 hover:text-red-600 group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteSession(session.id);
                      }}
                      disabled={deleteSessionMutation.isPending}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      删除
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={isSaveSessionDialogOpen} onOpenChange={setIsSaveSessionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>保存调试会话</DialogTitle>
            <DialogDescription>
              将当前对话记录保存为会话，方便下次继续调试。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="debug-session-name">会话名称</Label>
              <Input
                id="debug-session-name"
                value={saveSessionName}
                onChange={(e) => setSaveSessionName(e.target.value)}
                placeholder="例如：客服开场白调试"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              将保存当前 {messages.length} 条消息，包含模型思考过程与元数据。
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsSaveSessionDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={handleSaveSession}
              disabled={saveSessionMutation.isPending || !saveSessionName.trim()}
            >
              {saveSessionMutation.isPending && (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={isConfigDrawerOpen} onOpenChange={handleDrawerOpenChange}>
        <SheetContent side="right" className="w-full max-w-3xl border-l border-border bg-background px-0">
          <SheetHeader className="border-b border-muted/40 px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {activeDrawerNavItem ? (
                  <activeDrawerNavItem.icon className="h-5 w-5 text-primary" />
                ) : (
                  <Navigation className="h-5 w-5 text-muted-foreground" />
                )}
                <SheetTitle>
                  {activeDrawerNavItem ? activeDrawerNavItem.label : '配置面板'}
                </SheetTitle>
              </div>
              <Badge variant="outline" className="shrink-0">
                {viewModeLabel}
              </Badge>
            </div>
            {activeDrawerKey && (
              <SheetDescription>{drawerDescriptions[activeDrawerKey]}</SheetDescription>
            )}
          </SheetHeader>
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="border-b border-muted/30 px-6 py-3">
              <div className="flex flex-wrap gap-2">
                {drawerNavItems.map((item) => (
                  <Button
                    key={item.key}
                    type="button"
                    size="sm"
                    variant={activeDrawerKey === item.key ? 'default' : 'outline'}
                    className="rounded-full"
                    onClick={() => {
                      if (activeDrawerKey === item.key) {
                        return;
                      }
                      openDrawer(item.key);
                    }}
                  >
                    <item.icon className="mr-2 h-4 w-4" />
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {activeDrawerKey ? (
                <div className="space-y-6">{renderDrawerContent()}</div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  选择右侧条目以编辑配置
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {saveMutation.isError && (
        <Card className="mx-auto max-w-4xl border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-2 py-4 text-red-600">
            <AlertCircle className="h-4 w-4" />
            <span>保存失败: {saveMutation.error instanceof Error ? saveMutation.error.message : '未知错误'}</span>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
