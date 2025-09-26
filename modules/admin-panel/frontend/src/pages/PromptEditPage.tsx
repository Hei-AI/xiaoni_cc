import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { 
  ArrowLeft,
  Save,
  RefreshCw,
  Bot,
  Settings,
  Code,
  FileText,
  Layers,
  AlertCircle
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
}

interface AgentType {
  value: string;
  label: string;
  description: string;
}

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

  // 表单状态
  const [formData, setFormData] = useState({
    agent_type: 'chat_bot',
    prompt_name: '',
    system_instructions: '',
    user_prompt_template: '',
    context_variables: {},
    model_config: {
      topK: 40,
      topP: 0.95,
      temperature: 1.0,
      maxOutputTokens: 65536
    },
    advanced_config: {
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        }
      ],
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: -1,
          includeThoughts: true
        }
      }
    },
    model_name: 'gemini-2.5-flash',
    description: '',
    is_active: true,
    created_by: 'admin'
  });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      navigate('/prompts');
    },
  });

  // 加载现有数据到表单
  useEffect(() => {
    if (promptData?.success && promptData.data) {
      const prompt = promptData.data;
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
        context_variables: prompt.context_variables || {},
        model_config: prompt.model_config || {
          topK: 40,
          topP: 0.95,
          temperature: 1.0,
          maxOutputTokens: 65536
        },
        advanced_config: prompt.advanced_config || {
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_NONE"
            }
          ],
          generationConfig: {
            thinkingConfig: {
              thinkingBudget: -1,
              includeThoughts: true
            }
          }
        },
        model_name: prompt.model_name || 'gemini-2.5-flash',
        description: prompt.description || '',
        is_active: Boolean(prompt.is_active),
        created_by: prompt.created_by || 'admin'
      });
    }
  }, [promptData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.prompt_name.trim()) {
      alert('请输入 Prompt 名称');
      return;
    }
    
    if (!formData.system_instructions.trim()) {
      alert('请输入系统指令');
      return;
    }

    const submitData = {
      ...formData,
      // 将系统指令字符串转换为数组格式
      system_instructions: formData.system_instructions
        .split('\n\n')
        .map((inst: string) => inst.trim())
        .filter((inst: string) => inst !== ''),
      context_variables: Object.keys(formData.context_variables).length > 0
        ? formData.context_variables
        : undefined,
      user_prompt_template: formData.user_prompt_template.trim() || undefined,
      advanced_config: formData.advanced_config,
    };

    saveMutation.mutate(submitData);
  };


  const handleModelConfigChange = (key: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        [key]: value
      }
    }));
  };

  const handleAdvancedConfigChange = (section: string, key: string, value: any) => {
    setFormData(prev => ({
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

  const handleSafetySettingChange = (index: number, field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      advanced_config: {
        ...prev.advanced_config,
        safetySettings: (prev.advanced_config?.safetySettings || []).map((setting: any, i: number) =>
          i === index ? { ...setting, [field]: value } : setting
        )
      }
    }));
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
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate('/prompts')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Bot className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">
              {isNew ? '新建 Prompt' : `编辑 Prompt: ${formData.prompt_name}`}
            </h1>
            <p className="text-muted-foreground">
              {isNew ? '创建新的AI Agent提示词配置' : '修改现有的提示词配置'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {!isNew && !isEditing && (
            <Button onClick={() => setIsEditing(true)}>
              编辑
            </Button>
          )}
          {isEditing && (
            <>
              <Button 
                variant="outline" 
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
              <Button 
                onClick={handleSubmit}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                保存
              </Button>
            </>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 基本信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              基本信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="prompt_name">Prompt 名称 *</Label>
                <Input
                  id="prompt_name"
                  value={formData.prompt_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, prompt_name: e.target.value }))}
                  placeholder="输入 Prompt 名称"
                  disabled={!isEditing}
                  required
                />
              </div>
              
              <div>
                <Label htmlFor="agent_type">Agent 类型 *</Label>
                <select
                  id="agent_type"
                  value={formData.agent_type}
                  onChange={(e) => setFormData(prev => ({ ...prev, agent_type: e.target.value }))}
                  disabled={!isEditing}
                  className="w-full px-3 py-2 border rounded-md disabled:bg-gray-50"
                  required
                >
                  {agentTypesData?.data.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="输入 Prompt 的详细描述"
                disabled={!isEditing}
                rows={2}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                disabled={!isEditing}
              />
              <Label htmlFor="is_active">激活状态</Label>
            </div>
          </CardContent>
        </Card>

        {/* 系统指令 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              系统指令 *
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="system_instructions">系统指令内容</Label>
            <Textarea
              id="system_instructions"
              value={formData.system_instructions}
              onChange={(e) => setFormData(prev => ({ ...prev, system_instructions: e.target.value }))}
              placeholder="输入完整的系统指令内容..."
              disabled={!isEditing}
              rows={12}
              className="font-mono text-sm"
              required
            />
            <p className="text-xs text-muted-foreground mt-2">
              提示：使用双换行符分段，保存时会自动处理格式
            </p>
          </CardContent>
        </Card>

        {/* 用户提示模板 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              用户提示模板 (可选)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={formData.user_prompt_template}
              onChange={(e) => setFormData(prev => ({ ...prev, user_prompt_template: e.target.value }))}
              placeholder="输入用户提示模板，支持 {{variable}} 语法"
              disabled={!isEditing}
              rows={4}
            />
          </CardContent>
        </Card>

        {/* 模型配置 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              模型配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="model_name">模型名称</Label>
              <Input
                id="model_name"
                value={formData.model_name}
                onChange={(e) => setFormData(prev => ({ ...prev, model_name: e.target.value }))}
                placeholder="gemini-2.5-flash"
                disabled={!isEditing}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="topK">Top K</Label>
                <Input
                  id="topK"
                  type="number"
                  min="1"
                  max="100"
                  value={formData.model_config.topK}
                  onChange={(e) => handleModelConfigChange('topK', parseInt(e.target.value))}
                  disabled={!isEditing}
                />
              </div>
              
              <div>
                <Label htmlFor="topP">Top P</Label>
                <Input
                  id="topP"
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={formData.model_config.topP}
                  onChange={(e) => handleModelConfigChange('topP', parseFloat(e.target.value))}
                  disabled={!isEditing}
                />
              </div>
              
              <div>
                <Label htmlFor="temperature">Temperature</Label>
                <Input
                  id="temperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={formData.model_config.temperature}
                  onChange={(e) => handleModelConfigChange('temperature', parseFloat(e.target.value))}
                  disabled={!isEditing}
                />
              </div>
              
              <div>
                <Label htmlFor="maxOutputTokens">Max Tokens</Label>
                <Input
                  id="maxOutputTokens"
                  type="number"
                  min="1"
                  max="65536"
                  value={formData.model_config.maxOutputTokens}
                  onChange={(e) => handleModelConfigChange('maxOutputTokens', parseInt(e.target.value))}
                  disabled={!isEditing}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 高级Gemini配置 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              高级Gemini配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Safety Settings */}
            <div>
              <Label className="text-sm font-medium">安全设置 (Safety Settings)</Label>
              <div className="mt-2 space-y-3">
                {(formData.advanced_config?.safetySettings || []).map((setting: any, index: number) => (
                  <div key={index} className="flex items-center gap-4 p-3 border rounded-lg">
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">类别</Label>
                      <select
                        value={setting.category}
                        onChange={(e) => handleSafetySettingChange(index, 'category', e.target.value)}
                        disabled={!isEditing}
                        className="w-full mt-1 px-2 py-1 text-xs border rounded disabled:bg-gray-50"
                      >
                        <option value="HARM_CATEGORY_HARASSMENT">骚扰内容</option>
                        <option value="HARM_CATEGORY_HATE_SPEECH">仇恨言论</option>
                        <option value="HARM_CATEGORY_SEXUALLY_EXPLICIT">成人内容</option>
                        <option value="HARM_CATEGORY_DANGEROUS_CONTENT">危险内容</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">阈值</Label>
                      <select
                        value={setting.threshold}
                        onChange={(e) => handleSafetySettingChange(index, 'threshold', e.target.value)}
                        disabled={!isEditing}
                        className="w-full mt-1 px-2 py-1 text-xs border rounded disabled:bg-gray-50"
                      >
                        <option value="BLOCK_NONE">不阻止</option>
                        <option value="BLOCK_ONLY_HIGH">仅阻止高风险</option>
                        <option value="BLOCK_MEDIUM_AND_ABOVE">阻止中等及以上</option>
                        <option value="BLOCK_LOW_AND_ABOVE">阻止低风险及以上</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Thinking Config */}
            <div>
              <Label className="text-sm font-medium">思考配置 (Thinking Config)</Label>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="thinkingBudget" className="text-xs">思考预算</Label>
                  <Input
                    id="thinkingBudget"
                    type="number"
                    value={formData.advanced_config.generationConfig?.thinkingConfig?.thinkingBudget ?? -1}
                    onChange={(e) => handleAdvancedConfigChange('generationConfig', 'thinkingConfig', {
                      ...formData.advanced_config.generationConfig?.thinkingConfig,
                      thinkingBudget: parseInt(e.target.value)
                    })}
                    disabled={!isEditing}
                    placeholder="-1 为 dynamic"
                    className="text-xs"
                  />
                  <p className="text-xs text-muted-foreground mt-1">-1: dynamic (动态), 正数: 固定token限制</p>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="includeThoughts"
                    checked={formData.advanced_config.generationConfig?.thinkingConfig?.includeThoughts ?? true}
                    onCheckedChange={(checked) => handleAdvancedConfigChange('generationConfig', 'thinkingConfig', {
                      ...formData.advanced_config.generationConfig?.thinkingConfig,
                      includeThoughts: checked
                    })}
                    disabled={!isEditing}
                  />
                  <Label htmlFor="includeThoughts" className="text-xs">包含思考过程</Label>
                </div>
              </div>
            </div>

            {/* JSON预览 */}
            <div>
              <Label className="text-sm font-medium">配置预览 (JSON)</Label>
              <Textarea
                value={JSON.stringify(formData.advanced_config, null, 2)}
                readOnly
                rows={8}
                className="font-mono text-xs bg-gray-50"
              />
            </div>
          </CardContent>
        </Card>

        {saveMutation.isError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-4 w-4" />
                <span>保存失败: {saveMutation.error instanceof Error ? saveMutation.error.message : '未知错误'}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </form>
    </div>
  );
};