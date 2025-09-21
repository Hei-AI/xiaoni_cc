import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import {
  RefreshCw,
  Search,
  Settings,
  Bot,
  Plus,
  Edit,
  Trash2,
  Filter,
  Code,
  MessageSquare,
  Brain,
  Cog,
  Bug
} from 'lucide-react';

interface AgentPrompt {
  id: string;
  agent_type: 'chat_bot' | 'intent_analyzer' | 'requirement_processor' | 'custom';
  prompt_name: string;
  system_instructions: string | string[];
  user_prompt_template?: string | null;
  context_variables?: any;
  model_config?: any;
  model_name?: string;
  allowed_token_ids?: number[] | null;
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

interface PromptResponse {
  success: boolean;
  data: AgentPrompt[];
  total: number;
  timestamp: string;
}

// 获取 Prompt 列表
const fetchPrompts = async (params: {
  page: number;
  limit: number;
  search?: string;
  agent_type?: string;
}): Promise<PromptResponse> => {
  const queryParams = new URLSearchParams({
    page: params.page.toString(),
    limit: params.limit.toString(),
  });

  if (params.search) queryParams.append('search', params.search);
  if (params.agent_type) queryParams.append('agent_type', params.agent_type);

  const response = await fetch(`/api/prompts?${queryParams}`);
  if (!response.ok) {
    throw new Error('Failed to fetch prompts');
  }
  return response.json();
};

// 获取 Agent 类型列表
const fetchAgentTypes = async (): Promise<{ success: boolean; data: AgentType[] }> => {
  const response = await fetch('/api/agent-types');
  if (!response.ok) {
    throw new Error('Failed to fetch agent types');
  }
  return response.json();
};

// 删除 Prompt
const deletePrompt = async (promptId: string) => {
  const response = await fetch(`/api/prompts/${promptId}`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    throw new Error('Failed to delete prompt');
  }
  return response.json();
};

// 切换 Prompt 激活状态
const togglePromptActive = async (promptId: string, isActive: boolean) => {
  const response = await fetch(`/api/prompts/${promptId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ is_active: isActive }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to update prompt status');
  }
  return response.json();
};

export const PromptManagementPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [agentTypeFilter, setAgentTypeFilter] = useState('');
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const limit = 20;

  // 查询 Prompt 数据
  const { 
    data: promptsData, 
    isLoading, 
    error, 
    refetch,
    isRefetching 
  } = useQuery({
    queryKey: ['prompts', page, search, agentTypeFilter],
    queryFn: () => fetchPrompts({ 
      page, 
      limit, 
      search, 
      agent_type: agentTypeFilter 
    }),
  });

  // 查询 Agent 类型
  const { data: agentTypesData } = useQuery({
    queryKey: ['agent-types'],
    queryFn: fetchAgentTypes,
  });

  // 删除 Prompt mutation
  const deletePromptMutation = useMutation({
    mutationFn: deletePrompt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });

  // 切换激活状态 mutation
  const toggleActiveMutation = useMutation({
    mutationFn: ({ promptId, isActive }: { promptId: string; isActive: boolean }) => 
      togglePromptActive(promptId, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleAgentTypeFilter = (value: string) => {
    setAgentTypeFilter(value);
    setPage(1);
  };

  // 计算总页数
  const totalPages = promptsData ? Math.ceil(promptsData.total / limit) : 0;

  const handleSelectAll = () => {
    if (selectedPrompts.length === promptsData?.data.length) {
      setSelectedPrompts([]);
    } else {
      setSelectedPrompts(promptsData?.data.map(prompt => prompt.id) || []);
    }
  };

  const handleSelectPrompt = (promptId: string) => {
    setSelectedPrompts(prev => 
      prev.includes(promptId) 
        ? prev.filter(id => id !== promptId)
        : [...prev, promptId]
    );
  };

  const getAgentTypeIcon = (type: string) => {
    switch (type) {
      case 'chat_bot': return <MessageSquare className="h-4 w-4" />;
      case 'intent_analyzer': return <Brain className="h-4 w-4" />;
      case 'requirement_processor': return <Code className="h-4 w-4" />;
      case 'custom': return <Cog className="h-4 w-4" />;
      default: return <Bot className="h-4 w-4" />;
    }
  };

  const getAgentTypeLabel = (type: string) => {
    const agentType = agentTypesData?.data.find(at => at.value === type);
    return agentType?.label || type;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
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
    // 过滤掉空字符串，合并为一个完整的指令用于预览
    const filtered = Array.isArray(parsed) 
      ? parsed.filter((inst: string) => inst.trim() !== '').join(' ') 
      : parsed;
    return filtered;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Prompt 管理</h1>
            <p className="text-muted-foreground">
              管理AI Agent的提示词配置和系统指令
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            onClick={() => navigate('/prompts/new')}
          >
            <Plus className="h-4 w-4 mr-2" />
            新建 Prompt
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          {promptsData && (
            <Badge variant="secondary">
              {promptsData.total} 个配置
            </Badge>
          )}
        </div>
      </div>

      {/* 搜索和过滤 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex-1 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索 Prompt 名称或描述..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="max-w-sm"
              />
            </div>
            
            <select
              value={agentTypeFilter}
              onChange={(e) => handleAgentTypeFilter(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm"
            >
              <option value="">所有类型</option>
              {agentTypesData?.data.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4 mr-2" />
              筛选
            </Button>
          </div>
          
          {showFilters && (
            <div className="mt-4 flex flex-wrap gap-4 p-4 bg-muted/50 rounded-lg">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setSearch('');
                  setAgentTypeFilter('');
                  setPage(1);
                }}
              >
                清除筛选
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 批量操作 */}
      {selectedPrompts.length > 0 && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-blue-700">
                已选择 {selectedPrompts.length} 个配置
              </p>
              <div className="flex items-center gap-2">
                <Button 
                  size="sm" 
                  variant="destructive"
                  onClick={() => {
                    if (confirm(`确定要删除选中的 ${selectedPrompts.length} 个配置吗？此操作不可撤销。`)) {
                      selectedPrompts.forEach(id => {
                        deletePromptMutation.mutate(id);
                      });
                      setSelectedPrompts([]);
                    }
                  }}
                  disabled={deletePromptMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  批量删除
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Prompt 列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Prompt 配置列表
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2">加载中...</span>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">
              加载失败: {error instanceof Error ? error.message : '未知错误'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedPrompts.length === promptsData?.data.length}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>描述</TableHead>
                    <TableHead>系统指令预览</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>版本</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promptsData?.data.map((prompt) => (
                    <TableRow key={prompt.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedPrompts.includes(prompt.id)}
                          onCheckedChange={() => handleSelectPrompt(prompt.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getAgentTypeIcon(prompt.agent_type)}
                          <span className="text-sm">{getAgentTypeLabel(prompt.agent_type)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{prompt.prompt_name}</div>
                        {prompt.model_name && (
                          <div className="text-xs text-muted-foreground">
                            {prompt.model_name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="truncate" title={prompt.description || ''}>
                          {prompt.description || '无描述'}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="text-sm text-muted-foreground">
                          {(() => {
                            const preview = parseSystemInstructions(prompt.system_instructions);
                            return preview.length > 50 
                              ? preview.substring(0, 50) + '...' 
                              : preview;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell>
                        {prompt.model_name ? (
                          <Badge variant="outline">{prompt.model_name}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">未指定</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={prompt.is_active ? "default" : "secondary"}>
                          {prompt.is_active ? "激活" : "禁用"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">v{prompt.version}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(prompt.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/prompts/${prompt.id}/edit`)}
                            title="编辑"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/prompts/${prompt.id}/debug`)}
                            title="调试对话"
                            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                          >
                            <Bug className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleActiveMutation.mutate({
                              promptId: prompt.id,
                              isActive: !prompt.is_active
                            })}
                            disabled={toggleActiveMutation.isPending}
                            title={prompt.is_active ? "禁用" : "激活"}
                          >
                            {prompt.is_active ? "🔴" : "🟢"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (confirm(`确定要删除 ${prompt.prompt_name} 吗？此操作不可撤销。`)) {
                                deletePromptMutation.mutate(prompt.id);
                              }
                            }}
                            disabled={deletePromptMutation.isPending}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="删除"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          
          {/* 分页 */}
          {promptsData && totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                第 {page} 页，共 {totalPages} 页 (共 {promptsData.total} 个配置)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};