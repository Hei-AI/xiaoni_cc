import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  ArrowLeft,
  Edit,
  RefreshCw,
  Bot,
  Settings,
  FileText,
  Layers,
  Calendar,
  User,
  Code,
  MessageSquare,
  Brain,
  Cog
} from 'lucide-react';
import {
  asRecord,
  getPlaygroundProviderId,
  getProviderLabel,
  parseMaybeJson,
  resolvePromptProviderConfig,
} from '@/lib/provider-config';
import { formatConfiguredValue } from '@/lib/contract-display';
import { formatTimestamp } from '@/lib/utils';

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
  created_at: string;
  updated_at: string;
  description?: string | null;
}

interface AgentType {
  value: string;
  label: string;
  description: string;
}

// 获取单个 Prompt
const fetchPrompt = async (promptId: string): Promise<{ success: boolean; data: AgentPrompt }> => {
  // 防止尝试获取 'new' 这个特殊ID
  if (promptId === 'new') {
    throw new Error('Cannot fetch prompt with ID "new"');
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

export const PromptDetailPage: React.FC = () => {
  const { promptId } = useParams<{ promptId: string }>();
  const navigate = useNavigate();

  // 查询 Prompt 数据
  const { 
    data: promptData, 
    isLoading,
    error
  } = useQuery({
    queryKey: ['prompt', promptId],
    queryFn: () => fetchPrompt(promptId!),
    enabled: !!promptId,
  });

  // 查询 Agent 类型
  const { data: agentTypesData } = useQuery({
    queryKey: ['agent-types'],
    queryFn: fetchAgentTypes,
  });

  const getAgentTypeIcon = (type: string) => {
    switch (type) {
      case 'chat_bot': return <MessageSquare className="h-4 w-4" />;
      case 'intent_analyzer': return <Brain className="h-4 w-4" />;
      case 'requirement_processor': return <Code className="h-4 w-4" />;
      case 'tool_system': return <Cog className="h-4 w-4" />;
      case 'custom': return <Cog className="h-4 w-4" />;
      default: return <Bot className="h-4 w-4" />;
    }
  };

  const getAgentTypeInfo = (type: string) => {
    return agentTypesData?.data.find(at => at.value === type);
  };

  const parseSystemInstructions = (instructions: string | string[]) => {
    let parsed;
    if (typeof instructions === 'string') {
      try {
        parsed = JSON.parse(instructions);
      } catch {
        parsed = [instructions];
      }
    } else {
      parsed = instructions;
    }
    // 过滤掉空字符串
    return Array.isArray(parsed) 
      ? parsed.filter((inst: string) => inst.trim() !== '') 
      : parsed;
  };

  const formatDate = (dateString: string) => {
    return formatTimestamp(dateString);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">加载中...</span>
      </div>
    );
  }

  if (error || !promptData?.success) {
    return (
      <div className="text-center py-12 text-red-600">
        加载失败: {error instanceof Error ? error.message : '未知错误'}
      </div>
    );
  }

  const prompt = promptData.data;
  const agentTypeInfo = getAgentTypeInfo(prompt.agent_type);
  const systemInstructions = parseSystemInstructions(prompt.system_instructions);
  const providerConfig = resolvePromptProviderConfig(prompt);
  const parsedModelConfig = parseMaybeJson(prompt.model_config);
  const parsedAdvancedConfig = parseMaybeJson(prompt.advanced_config);
  const modelConfigObject = asRecord(parsedModelConfig);
  const advancedConfigObject = asRecord(parsedAdvancedConfig);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate('/prompts')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Bot className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{prompt.prompt_name}</h1>
            <p className="text-muted-foreground">
              {prompt.description || 'Prompt 详情信息'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate(`/prompts/${prompt.id}/edit`)}>
            <Edit className="h-4 w-4 mr-2" />
            编辑
          </Button>
          <Badge variant={prompt.is_active ? "default" : "secondary"}>
            {prompt.is_active ? "激活" : "禁用"}
          </Badge>
        </div>
      </div>

      {/* 基本信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            基本信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <h4 className="font-medium text-muted-foreground mb-2">Agent 类型</h4>
              <div className="flex items-center gap-2">
                {getAgentTypeIcon(prompt.agent_type)}
                <div>
                  <div className="font-medium">{agentTypeInfo?.label || prompt.agent_type}</div>
                  {agentTypeInfo?.description && (
                    <div className="text-sm text-muted-foreground">{agentTypeInfo.description}</div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium text-muted-foreground mb-2">状态</h4>
              <Badge variant={prompt.is_active ? "default" : "secondary"} className="text-sm">
                {prompt.is_active ? "🟢 激活" : "🔴 禁用"}
              </Badge>
            </div>

            <div>
              <h4 className="font-medium text-muted-foreground mb-2">版本</h4>
              <Badge variant="outline">v{prompt.version}</Badge>
            </div>

            <div>
              <h4 className="font-medium text-muted-foreground mb-2">创建者</h4>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span>{prompt.created_by}</span>
              </div>
            </div>

            <div>
              <h4 className="font-medium text-muted-foreground mb-2">创建时间</h4>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span className="text-sm">{formatDate(prompt.created_at)}</span>
              </div>
            </div>

            <div>
              <h4 className="font-medium text-muted-foreground mb-2">最后更新</h4>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span className="text-sm">{formatDate(prompt.updated_at)}</span>
              </div>
            </div>
          </div>

          {prompt.description && (
            <div className="mt-6">
              <h4 className="font-medium text-muted-foreground mb-2">描述</h4>
              <p className="text-sm bg-muted p-3 rounded-md">{prompt.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 系统指令 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            系统指令
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {systemInstructions.map((instruction: string, index: number) => (
              <div key={index} className="border rounded-md p-4 bg-muted/50">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className="text-xs">指令 {index + 1}</Badge>
                </div>
                <pre className="whitespace-pre-wrap text-sm font-mono text-foreground bg-background p-2 rounded border">
{instruction}
                </pre>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 用户提示模板 */}
      {prompt.user_prompt_template && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              用户提示模板
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm font-mono text-foreground bg-muted p-4 rounded-md border">
{prompt.user_prompt_template}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* 模型配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            模型配置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-muted-foreground mb-2">Provider</h4>
              <Badge variant="outline">{getProviderLabel(getPlaygroundProviderId(providerConfig))}</Badge>
            </div>

            <div>
              <h4 className="font-medium text-muted-foreground mb-2">模型名称</h4>
              <Badge variant="outline">{formatConfiguredValue(prompt.model_name)}</Badge>
            </div>
          </div>

          {modelConfigObject && (
            <div className="mt-6">
              <h4 className="font-medium text-muted-foreground mb-3">模型配置</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(modelConfigObject).map(([key, value]) => (
                  <div key={key} className="bg-muted/50 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">{key}</div>
                    <div className="text-lg font-mono">{String(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {advancedConfigObject && (
            <div className="mt-6">
              <h4 className="font-medium text-muted-foreground mb-3">高级配置</h4>
              <pre className="whitespace-pre-wrap text-sm font-mono text-foreground bg-muted p-4 rounded-md border">
{JSON.stringify(advancedConfigObject, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 上下文变量 */}
      {prompt.context_variables && Object.keys(prompt.context_variables).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              上下文变量
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm font-mono text-foreground bg-muted p-4 rounded-md border">
{JSON.stringify(prompt.context_variables, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
