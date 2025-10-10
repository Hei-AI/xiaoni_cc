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
  ChevronRight
} from 'lucide-react';

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
  allowed_token_ids?: number[] | null;
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
    tokensUsed?: number;
    processingTime?: number;
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
}

interface ToolsConfigState {
  functionCalling: {
    mode: FunctionCallingModeOption;
    allowedFunctionNames: string[];
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

const MODEL_OPTIONS = [
  {
    value: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: '复杂推理与持久对话首选'
  },
  {
    value: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: '平衡质量与延迟，生产默认'
  },
  {
    value: 'gemini-flash-latest',
    label: 'Gemini Flash Latest',
    description: '最新轻量版本，适合快速迭代'
  }
] as const;

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

  return {
    id,
    name: providedName,
    description: typeof tool?.description === 'string' ? tool.description : '',
    parameters
  };
};

const createDefaultToolsConfig = (): ToolsConfigState => ({
  functionCalling: {
    mode: 'NONE',
    allowedFunctionNames: []
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

  const customTools = Array.isArray(rawConfig.customTools)
    ? rawConfig.customTools.map((tool: any, index: number) => normalizeCustomTool(tool, index))
    : defaults.customTools;

  const rawAllowedNames = rawConfig.functionCalling?.allowedFunctionNames;
  const allowedFunctionNames = Array.isArray(rawAllowedNames)
    ? rawAllowedNames
        .filter((name: unknown): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
    : undefined;

  const functionCallingMode = normalizeFunctionCallingMode(
    rawConfig.functionCalling?.mode,
    'NONE'
  );

  const predefinedTools = rawConfig.predefinedTools || defaults.predefinedTools;

  return {
    functionCalling: {
      mode: functionCallingMode,
      allowedFunctionNames:
        allowedFunctionNames !== undefined
          ? allowedFunctionNames
          : customTools
              .map((tool: CustomToolConfigState) => tool.name)
              .filter((name: string) => name && name.length > 0)
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

  if (!Array.isArray(base.safetySettings)) {
    base.safetySettings = DEFAULT_SAFETY_SETTINGS.map((setting) => ({ ...setting }));
  }
  if (!base.generationConfig) {
    base.generationConfig = {
      thinkingConfig: {
        thinkingBudget: -1,
        includeThoughts: true
      }
    };
  } else if (!base.generationConfig.thinkingConfig) {
    base.generationConfig.thinkingConfig = {
      thinkingBudget: -1,
      includeThoughts: true
    };
  }

  base.toolsConfig = normalizeToolsConfig(base.toolsConfig);

  return base;
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
      topK: 40,
      topP: 0.95,
      temperature: 1.0,
      maxOutputTokens: 65536,
      stopSequences: [] as string[],
      mediaResolution: 'MEDIA_RESOLUTION_DEFAULT'
    },
    advanced_config: ensureAdvancedConfigDefaults({
      safetySettings: DEFAULT_SAFETY_SETTINGS.map((setting) => ({ ...setting })),
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: -1,
          includeThoughts: true
        }
      },
      toolsConfig: createDefaultToolsConfig()
    }),
    model_name: 'gemini-2.5-flash',
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
  const [getCodeCopied, setGetCodeCopied] = useState(false);
  const [systemInstructionsCopied, setSystemInstructionsCopied] = useState(false);
  const [isSafetyDialogOpen, setIsSafetyDialogOpen] = useState(false);
  const prevEditingRef = useRef<boolean>(isEditing);
  const playgroundCardRef = useRef<HTMLDivElement | null>(null);
  const [playgroundMinHeight, setPlaygroundMinHeight] = useState<number | null>(null);
  const systemInstructionRef = useRef<HTMLTextAreaElement | null>(null);
  const userPromptTemplateRef = useRef<HTMLTextAreaElement | null>(null);
  const promptPreviewRef = useRef<HTMLDivElement | null>(null);
  const [activePromptSection, setActivePromptSection] = useState<'system' | 'user' | 'preview'>('system');
  const [isConfigDrawerOpen, setIsConfigDrawerOpen] = useState(false);
  const [activeDrawerKey, setActiveDrawerKey] = useState<DrawerSectionKey | null>(null);

  // 查询现有 Prompt 数据（仅编辑模式）
  const {
    data: promptData,
    isLoading: isLoadingPrompt,
    error: promptError
  } = useQuery({
    queryKey: ['prompt', promptId],
    queryFn: () => fetchPrompt(promptId!),
    enabled: !isNew && promptId !== 'new' && !!promptId && promptId !== undefined,
  });

  // 查询 Agent 类型
  const { data: agentTypesData } = useQuery({
    queryKey: ['agent-types'],
    queryFn: fetchAgentTypes,
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

  // 加载现有数据到表单
  useEffect(() => {
    if (promptData?.success && promptData.data) {
      const prompt = promptData.data;
      const parsedContext = parseJsonField<Record<string, any>>(prompt.context_variables, {});
      const parsedModelConfig = parseJsonField(prompt.model_config, {
        topK: 40,
        topP: 0.95,
        temperature: 1.0,
        maxOutputTokens: 65536,
        stopSequences: [] as string[],
        mediaResolution: 'MEDIA_RESOLUTION_DEFAULT'
      });
      const normalizedModelConfig = {
        ...parsedModelConfig,
        stopSequences: normalizeStopSequencesList((parsedModelConfig as any).stopSequences),
        mediaResolution:
          typeof (parsedModelConfig as any).mediaResolution === 'string'
            ? (parsedModelConfig as any).mediaResolution
            : 'MEDIA_RESOLUTION_DEFAULT'
      };
      const parsedAdvancedConfig = parseJsonField(prompt.advanced_config, {
        safetySettings: DEFAULT_SAFETY_SETTINGS.map((setting) => ({ ...setting })),
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: -1,
            includeThoughts: true
          }
        },
        toolsConfig: createDefaultToolsConfig()
      });
      const normalizedAdvancedConfig = ensureAdvancedConfigDefaults(parsedAdvancedConfig);

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
        model_name: prompt.model_name || 'gemini-2.5-flash',
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

    const contextVariablesObject = rowsToContextObject(contextVariableRows);

    const normalizedToolsConfig = normalizeToolsConfig((formData.advanced_config as any)?.toolsConfig);
    const sanitizedToolsConfig = {
      ...normalizedToolsConfig,
      functionCalling: {
        ...normalizedToolsConfig.functionCalling,
        allowedFunctionNames: Array.from(
          new Set(normalizedToolsConfig.functionCalling.allowedFunctionNames || [])
        ).filter((name) => name && name.length > 0)
      }
    };

    const submitAdvancedConfig = ensureAdvancedConfigDefaults({
      ...formData.advanced_config,
      toolsConfig: sanitizedToolsConfig
    });

    const submitData = {
      ...formData,
      system_instructions: formData.system_instructions
        .split('\n\n')
        .map((inst: string) => inst.trim())
        .filter((inst: string) => inst !== ''),
      context_variables: Object.keys(contextVariablesObject).length > 0
        ? contextVariablesObject
        : undefined,
      user_prompt_template: formData.user_prompt_template.trim() || undefined,
      advanced_config: submitAdvancedConfig,
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
        model: formData.model_name || 'gemini-2.5-flash'
      };

      payload.systemPrompt = applyContextVariables(
        formData.system_instructions,
        formData.context_variables,
        runtimeVariables
      );
      payload.model = formData.model_name || 'gemini-2.5-flash';

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
        model_config: formData.model_config,
        advanced_config: formData.advanced_config,
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

      const assistantMessage: DebugMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: (response.response || '').trim(),
        thought: (response.thinking || '').trim() || undefined,
        timestamp: new Date(),
        metadata: {
          model: response.model || formData.model_name,
          tokensUsed:
            response.token_used ||
            response.usage?.totalTokenCount ||
            response.usageMetadata?.totalTokenCount,
          processingTime:
            response.performance?.duration_ms ||
            response.performance?.durationMs ||
            response.processingTime
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
    if (!getCodeCopied) {
      return;
    }
    const timer = window.setTimeout(() => setGetCodeCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [getCodeCopied]);

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

  const handleAllowedFunctionToggle = (toolName: string, enabled: boolean) => {
    updateToolsConfig((prevTools) => {
      const currentAllowed = Array.isArray(prevTools.functionCalling.allowedFunctionNames)
        ? [...prevTools.functionCalling.allowedFunctionNames]
        : [];
      const withoutTarget = currentAllowed.filter((name) => name !== toolName);
      const nextAllowed = enabled ? [...withoutTarget, toolName] : withoutTarget;
      return {
        ...prevTools,
        functionCalling: {
          ...prevTools.functionCalling,
          allowedFunctionNames: nextAllowed.filter((name) => name && name.length > 0)
        }
      };
    });
  };

  const handleToolFieldChange = (toolId: string, field: 'name' | 'description', value: string) => {
    updateToolsConfig((prevTools) => {
      const updatedCustomTools = prevTools.customTools.map((tool) =>
        tool.id === toolId ? { ...tool, [field]: value } : tool
      );

      let updatedAllowed = prevTools.functionCalling.allowedFunctionNames || [];
      if (field === 'name') {
        const previousTool = prevTools.customTools.find((tool) => tool.id === toolId);
        if (previousTool && previousTool.name !== value) {
          updatedAllowed = updatedAllowed.map((name) => (name === previousTool.name ? value : name));
        }
      }

      return {
        ...prevTools,
        customTools: updatedCustomTools,
        functionCalling: {
          ...prevTools.functionCalling,
          allowedFunctionNames: (updatedAllowed || []).filter((name) => name && name.length > 0)
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
      const allowed = existingAllowed.length > 0 ? existingAllowed : updatedCustomTools.map((tool) => tool.name);
      return {
        ...prevTools,
        customTools: updatedCustomTools,
        functionCalling: {
          ...prevTools.functionCalling,
          allowedFunctionNames: allowed
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
      let updatedAllowed = prevTools.functionCalling.allowedFunctionNames || [];
      if (toolToRemove) {
        updatedAllowed = updatedAllowed.filter((name) => name !== toolToRemove.name);
      }
      return {
        ...prevTools,
        customTools: remainingTools,
        functionCalling: {
          ...prevTools.functionCalling,
          allowedFunctionNames: updatedAllowed
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

  const isDraftMode = isNew ? true : useDraftConfig;
  const selectedModelOption = MODEL_OPTIONS.find((option) => option.value === formData.model_name);
  const modelBadgeLabel = selectedModelOption
    ? selectedModelOption.label
    : formData.model_name || 'Gemini 2.5 Flash';
  const canSendMessage =
    Boolean(userInput.trim()) &&
    !isDebugging &&
    !contextVariablesError &&
    Boolean(formData.system_instructions.trim());
  const customTools = toolsConfig.customTools;
  const allowedFunctionNames = toolsConfig.functionCalling.allowedFunctionNames || [];
  const functionCallingMode = toolsConfig.functionCalling.mode;
  const isFunctionCallingDisabled = functionCallingMode === 'NONE';
  const contextVariablesPreview = JSON.stringify(rowsToContextObject(contextVariableRows), null, 2);
  const stopSequences = Array.isArray(formData.model_config.stopSequences)
    ? formData.model_config.stopSequences
    : [];
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
  const thinkingConfig = formData.advanced_config.generationConfig?.thinkingConfig ?? {
    thinkingBudget: -1,
    includeThoughts: true
  };
  const manualThinkingEnabled =
    typeof thinkingConfig.thinkingBudget === 'number' && thinkingConfig.thinkingBudget >= 0;
  const thinkingBudgetValue = manualThinkingEnabled ? thinkingConfig.thinkingBudget : 4096;
  const previewConfig = {
    model: formData.model_name || 'gemini-2.5-flash',
    temperature: formData.model_config.temperature,
    topP: formData.model_config.topP,
    topK: formData.model_config.topK,
    maxOutputTokens: formData.model_config.maxOutputTokens,
    ...(stopSequences.length ? { stopSequences } : {}),
    ...(formData.model_config.mediaResolution &&
    formData.model_config.mediaResolution !== 'MEDIA_RESOLUTION_DEFAULT'
      ? { mediaResolution: formData.model_config.mediaResolution }
      : {}),
    thinkingConfig: {
      thinkingBudget: thinkingConfig.thinkingBudget,
      includeThoughts: thinkingConfig.includeThoughts
    },
    safetySettings: formData.advanced_config?.safetySettings ?? DEFAULT_SAFETY_SETTINGS,
    ...(structuredOutputEnabled
      ? { structuredOutput: (formData.advanced_config as any)?.structuredOutput || {} }
      : {}),
    ...(googleSearchEnabled
      ? { googleSearch: (formData.advanced_config as any)?.googleSearch || {} }
      : {}),
    ...(urlContextEnabled
      ? { urlContext: (formData.advanced_config as any)?.urlContext || {} }
      : {}),
    ...(functionCallingMode === 'NONE'
      ? {}
      : {
          functionCalling: {
            mode: functionCallingMode,
            allow: allowedFunctionNames
          }
        })
  };
  const previewTools =
    functionCallingMode === 'NONE'
      ? ''
      : `const tools = ${JSON.stringify(
          customTools.map((tool) => ({
            name: tool.name,
            description: tool.description
          })),
          null,
          2
        )};\n\n`;
  const getCodePreview = `${previewTools}const config = ${JSON.stringify(previewConfig, null, 2)};`;
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
      label: '模型',
      value: modelBadgeLabel
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
    { key: 'functions', label: '函数调用', icon: Code },
    { key: 'runtime', label: '运行参数', icon: SlidersHorizontal },
    { key: 'safety', label: '内容安全', icon: ShieldCheck },
    { key: 'preview', label: '配置预览', icon: Eye },
    { key: 'code', label: 'Get code', icon: Copy }
  ];
  const quickNavItems = [
    { key: 'playground', label: 'Prompt Playground', icon: MessageSquare },
    ...drawerNavItems
  ] as const;
  const drawerDescriptions: Record<DrawerSectionKey, string> = {
    basic: '命名 Prompt 并选择所属的 Agent 类型，保持描述简洁明了。',
    prompt: '使用分段描述复杂任务，保存时会自动拆分为数组。',
    variables: '这些变量会在生成系统指令与用户模板时自动替换。',
    functions: '配置模型可调用的函数声明以及调用策略，帮助自动化处理结构化任务。',
    runtime: '同步 Google AI Studio 的推理设置。',
    safety: '映射 HarmBlockThreshold 配置项。',
    preview: 'JSON 视图便于再次确认。',
    code: '复制到自动化脚本或 SDK。'
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
        <section className="rounded-2xl border bg-card/60 p-6 shadow-sm">
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
                className="mt-[2px] w-full rounded-md border px-3 py-2 text-sm disabled:bg-muted/60"
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
          <div className="mt-6 flex flex-col gap-4 rounded-2xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
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
        <section className="overflow-hidden rounded-3xl border bg-card/70 shadow-sm">
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
              <div className="rounded-2xl border bg-background/80 shadow-inner">
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
                    className="border-t border-muted/40 bg-muted/20 px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
              <div className="rounded-2xl border bg-background/80 shadow-inner">
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
            <aside className="space-y-4 rounded-2xl border bg-background/40 p-4 shadow-inner lg:sticky lg:top-24">
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
        <section className="rounded-2xl border bg-card/60 p-6 shadow-sm">
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
                className="rounded-2xl border bg-background/80 p-4 shadow-inner transition hover:border-primary/50"
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
        <section className="rounded-2xl border bg-card/60 p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Code className="h-4 w-4" />
                函数调用
              </div>
              <h2 className="mt-2 text-xl font-semibold">定义可调用的函数与策略</h2>
              <p className="text-sm text-muted-foreground">
                配置模型可调用的函数声明以及调用策略，帮助自动化处理结构化任务。
              </p>
            </div>
            <Badge variant={isFunctionCallingDisabled ? 'secondary' : 'default'}>
              {functionCallingMode === 'NONE' ? '禁用' : functionCallingMode === 'AUTO' ? 'Auto' : 'Any'}
            </Badge>
          </div>

          <div className="mt-6 space-y-6">
            <div className="rounded-2xl border bg-muted/20 p-4">
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

            <div className="rounded-2xl border bg-background/80 p-4 shadow-inner">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">允许调用的函数</p>
                  <p className="text-xs text-muted-foreground">
                    {allowedFunctionNames.length > 0
                      ? '已选择自定义函数，模型将限制在这些函数中调用。'
                      : '暂未指定允许函数，自动模式下将尝试调用全部函数。'}
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
                    const selected = allowedFunctionNames.includes(tool.name);
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          selected ? 'border-primary bg-primary/10 text-primary' : 'border-muted/40 text-muted-foreground'
                        }`}
                        onClick={() => {
                          if (!isEditing) return;
                          handleAllowedFunctionToggle(tool.name, !selected);
                        }}
                        disabled={!isEditing}
                      >
                        {tool.name}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-xs text-muted-foreground">尚未配置自定义函数。</p>
                )}
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">自定义函数</p>
                  <p className="text-xs text-muted-foreground">函数使用 JSON Schema 定义参数，名称需唯一。</p>
                </div>
                {isEditing && (
                  <Button type="button" size="sm" onClick={handleAddCustomTool}>
                    <Plus className="mr-2 h-4 w-4" />
                    新增函数
                  </Button>
                )}
              </div>
              {customTools.length === 0 ? (
                <div className="rounded-xl border border-dashed border-muted/40 bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground">
                  尚未添加自定义函数。点击“新增函数”创建函数声明，指导模型触发外部工具。
                </div>
              ) : (
                <div className="space-y-4">
                  {customTools.map((tool) => {
                    const editor = customToolEditors[tool.id] ?? { json: JSON.stringify(tool.parameters, null, 2) };
                    const hasError = Boolean(editor.error);
                    return (
                      <Card key={tool.id} className="border-muted/40 bg-background/70 shadow-none">
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
                                  <pre className="scrollbar-thin max-h-[360px] overflow-auto rounded-md bg-muted/20 p-3 text-xs">
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
                                <Label>函数名称</Label>
                                <Input
                                  value={tool.name}
                                  onChange={(e) => handleToolFieldChange(tool.id, 'name', e.target.value)}
                                  disabled={!isEditing}
                                />
                              </div>
                              <div>
                                <Label>函数描述</Label>
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
                                  JSON Schema 应包含 type、properties 等字段，用于声明函数参数结构。
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
        <Card className="bg-card/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">运行参数</CardTitle>
            <CardDescription>同步 Google AI Studio 的推理设置。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">模型</Label>
              <div className="mt-3 grid gap-2">
                {MODEL_OPTIONS.map((option) => {
                  const isActiveModel = formData.model_name === option.value;
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={isActiveModel ? 'default' : 'outline'}
                      className="justify-between"
                      disabled={!isEditing}
                      onClick={() => {
                        if (!isEditing) return;
                        setFormData((prev) => ({ ...prev, model_name: option.value }));
                      }}
                    >
                      <span>{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label htmlFor="model_name">自定义模型名称</Label>
              <Input
                id="model_name"
                value={formData.model_name}
                onChange={(e) => setFormData((prev) => ({ ...prev, model_name: e.target.value }))}
                placeholder="例如：gemini-2.5-flash"
                disabled={!isEditing}
              />
              <p className="mt-1 text-xs text-muted-foreground">覆盖按钮选择时，可直接填写完整模型 ID。</p>
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
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:bg-muted/60"
                >
                  {MEDIA_RESOLUTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">低分辨率适合多媒体调试，默认保持原画质。</p>
              </div>
              <div className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">当前模型</p>
                <p className="mt-1 break-all">{formData.model_name || '未设置'}</p>
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
            <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
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
                    handleAdvancedConfigChange('generationConfig', 'thinkingConfig', {
                      ...thinkingConfig,
                      thinkingBudget: nextBudget ?? 4096
                    });
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
                    handleAdvancedConfigChange('generationConfig', 'thinkingConfig', {
                      ...thinkingConfig,
                      thinkingBudget: Math.max(0, parseInt(e.target.value || '0', 10))
                    })
                  }
                  disabled={!isEditing || !manualThinkingEnabled}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border bg-background/60 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">包含思考过程</p>
                  <p className="text-xs text-muted-foreground">启用后会在调试对话中暴露 Thought。</p>
                </div>
                <Switch
                  id="includeThoughts"
                  checked={thinkingConfig.includeThoughts ?? true}
                  onCheckedChange={(checked) =>
                    handleAdvancedConfigChange('generationConfig', 'thinkingConfig', {
                      ...thinkingConfig,
                      includeThoughts: checked
                    })
                  }
                  disabled={!isEditing}
                />
              </div>
            </div>
            <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">工具与上下文</p>
                  <p className="text-xs text-muted-foreground">快速切换结构化输出、外部搜索及函数调用。</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => openDrawer('functions')}
                >
                  管理函数
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">函数调用</p>
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
                  已声明 {customTools.length} 个函数，允许调用 {allowedFunctionNames.length} 个。
                </p>
              )}
              <div className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2">
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
              <div className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Google Search</p>
                  <p className="text-xs text-muted-foreground">为回答补充实时网页内容。</p>
                </div>
                <Switch
                  id="google-search-toggle"
                  checked={googleSearchEnabled}
                  onCheckedChange={handleAdvancedFlagToggle('googleSearch')}
                  disabled={!isEditing}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">URL Context</p>
                  <p className="text-xs text-muted-foreground">在推理前抓取网页内容作为上下文。</p>
                </div>
                <Switch
                  id="url-context-toggle"
                  checked={urlContextEnabled}
                  onCheckedChange={handleAdvancedFlagToggle('urlContext')}
                  disabled={!isEditing}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ),
      safety: (
        <Card className="bg-card/60 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">内容安全</CardTitle>
            <CardDescription>映射 HarmBlockThreshold 配置项。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-muted/20 p-4">
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
                    <p className="text-xs text-muted-foreground">暂未配置内容安全规则，默认使用最低限制。</p>
                  )}
              </div>
            </div>

            <Dialog open={isSafetyDialogOpen} onOpenChange={setIsSafetyDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={!isEditing} className="w-full sm:w-auto">
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
                            className="space-y-3 rounded-lg border bg-muted/20 p-4"
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
        <Card className="bg-card/60 shadow-sm">
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
                <pre className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-md bg-muted/20 p-3 text-xs">
                  {JSON.stringify(formData.model_config, null, 2)}
                </pre>
              </TabsContent>
              <TabsContent value="variables">
                <pre className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-md bg-muted/20 p-3 text-xs">
                  {contextVariablesPreview}
                </pre>
              </TabsContent>
              <TabsContent value="advanced">
                <pre className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-md bg-muted/20 p-3 text-xs">
                  {JSON.stringify(formData.advanced_config, null, 2)}
                </pre>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ),
      code: (
        <Card className="bg-card/60 shadow-sm">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Get code</CardTitle>
              <CardDescription>复制到自动化脚本或 SDK。</CardDescription>
            </div>
            <Button
              type="button"
              variant={getCodeCopied ? 'default' : 'outline'}
              size="sm"
              onClick={handleCopyGetCode}
            >
              {getCodeCopied ? '已复制' : '复制'}
              <Copy className="ml-2 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="scrollbar-thin max-h-80 overflow-auto rounded-md bg-muted/20 p-3 text-xs">
              {getCodePreview}
            </pre>
          </CardContent>
        </Card>
      )
    };

    return contentMap[activeDrawerKey];
  };
  const handleCopyGetCode = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(getCodePreview);
        setGetCodeCopied(true);
      } else {
        throw new Error('浏览器不支持剪贴板写入');
      }
    } catch (error) {
      console.error('Failed to copy run configuration', error);
      setGetCodeCopied(false);
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
      <div className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
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
                    参照 Google AI Studio，在一个工作台中完成 Prompt 配置、变量和调试。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                  函数
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
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span>点击右上角“编辑”后可修改配置，灰色字段表示当前暂不可编辑。</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1">
        <div className="mx-auto flex h-full w-full max-w-screen-2xl flex-col px-4 pb-40 pt-8 xl:max-w-none xl:px-8 2xl:px-12">
          <div className="grid min-h-0 flex-1 gap-6 items-start lg:grid-cols-[minmax(0,1.85fr)_minmax(260px,0.85fr)]">
            <div className="flex min-h-0 flex-col gap-6">
              <Card
                ref={playgroundCardRef}
                className="flex min-h-0 flex-col bg-card/60 shadow-sm"
                style={playgroundMinHeight ? { minHeight: `${playgroundMinHeight}px` } : undefined}
              >
                <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <MessageSquare className="h-4 w-4" />
                    Prompt Playground
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={isDraftMode ? 'default' : 'secondary'}>
                      {isDraftMode ? '草稿配置' : '已保存配置'}
                    </Badge>
                    <Badge variant="outline">{modelBadgeLabel}</Badge>
                  </div>
                </div>
                <CardDescription>
                  不离开页面即可调试提示词，实时查看模型回复与思考过程。
                </CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-muted/50 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
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
                  </div>
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

                {isNew && (
                  <div className="rounded-xl border border-dashed border-muted/50 bg-background/80 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                    草稿模式默认开启，填写左侧信息并保存后即可验证最新版本。
                  </div>
                )}

                {!isNew && !isEditing && (
                  <div className="rounded-xl border border-dashed border-muted/50 bg-background/80 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
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
                  <div className="flex-1 space-y-4 overflow-y-auto p-4">
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
                              <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-inner">
                                <Bot className="h-4 w-4" />
                              </div>
                            )}
                            <div
                              className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-sm transition group-hover:shadow-md ${
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
                                <div className="mt-3 rounded-md bg-background/70 p-3 text-xs text-foreground">
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
                                <div className="mt-3 grid gap-2 rounded-md bg-background/70 p-2 text-xs text-muted-foreground">
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
                                  {typeof message.metadata.processingTime !== 'undefined' && (
                                    <div className="flex items-center justify-between">
                                      <span>耗时</span>
                                      <span>{message.metadata.processingTime} ms</span>
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
                  <div className="border-t bg-background/95 p-4">
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:flex-row sm:items-end">
                      <Textarea
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        placeholder="向模型发送一条调试消息..."
                        rows={3}
                        className="flex-1 resize-none bg-background/70"
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
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <aside className="hidden lg:block">
            <div className="space-y-4">
              <Card className="bg-card/60 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Bot className="h-4 w-4 text-primary" />
                    Prompt 概览
                  </CardTitle>
                  <CardDescription>核心配置一目了然。</CardDescription>
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
              <Card className="bg-card/60 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Navigation className="h-4 w-4 text-primary" />
                    快速跳转
                  </CardTitle>
                  <CardDescription>定位到页面中的主要配置。</CardDescription>
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
            </div>
          </aside>
        </div>
      </div>
    </div>

      <Sheet open={isConfigDrawerOpen} onOpenChange={handleDrawerOpenChange}>
        <SheetContent side="right" className="w-full max-w-3xl border-l bg-background/95 backdrop-blur px-0">
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
