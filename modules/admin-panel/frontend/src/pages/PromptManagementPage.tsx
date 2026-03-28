import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Brain,
  Bug,
  Code,
  Cog,
  Edit,
  Filter,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { FilterBar } from '@/components/console/FilterBar';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { EntityCard } from '@/components/console/EntityCard';
import { SelectionBar } from '@/components/console/SelectionBar';
import { ErrorState } from '@/components/console/ErrorState';
import { EmptyState } from '@/components/console/EmptyState';
import { StatusPill } from '@/components/console/StatusPill';
import { formatConfiguredValue } from '@/lib/contract-display';
import { getPlaygroundProviderId, getProviderLabel, resolvePromptProviderConfig } from '@/lib/provider-config';
import { formatTimestamp } from '@/lib/utils';

interface AgentPrompt {
  id: string;
  agent_type: 'chat_bot' | 'intent_analyzer' | 'requirement_processor' | 'tool_system' | 'custom' | string;
  prompt_name: string;
  system_instructions: string | string[];
  user_prompt_template?: string | null;
  context_variables?: unknown;
  model_config?: unknown;
  advanced_config?: unknown;
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

interface PromptResponse {
  success: boolean;
  data: AgentPrompt[];
  total: number;
  timestamp: string;
}

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

const fetchAgentTypes = async (): Promise<{ success: boolean; data: AgentType[] }> => {
  const response = await fetch('/api/agent-types');
  if (!response.ok) {
    throw new Error('Failed to fetch agent types');
  }
  return response.json();
};

const deletePrompt = async (promptId: string) => {
  const response = await fetch(`/api/prompts/${promptId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete prompt');
  }
  return response.json();
};

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
  const [agentTypeFilter, setAgentTypeFilter] = useState('all');
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const limit = 20;

  const { data: promptsData, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['prompts', page, search, agentTypeFilter],
    queryFn: () =>
      fetchPrompts({
        page,
        limit,
        search,
        agent_type: agentTypeFilter === 'all' ? undefined : agentTypeFilter,
      }),
  });

  const { data: agentTypesData } = useQuery({
    queryKey: ['agent-types'],
    queryFn: fetchAgentTypes,
  });

  const deletePromptMutation = useMutation({
    mutationFn: deletePrompt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      refetch();
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ promptId, isActive }: { promptId: string; isActive: boolean }) => togglePromptActive(promptId, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });

  const totalPages = promptsData ? Math.ceil(promptsData.total / limit) : 0;

  const handleSelectAll = () => {
    if (selectedPrompts.length === promptsData?.data.length) {
      setSelectedPrompts([]);
    } else {
      setSelectedPrompts(promptsData?.data.map((prompt) => prompt.id) || []);
    }
  };

  const handleSelectPrompt = (promptId: string) => {
    setSelectedPrompts((prev) => (prev.includes(promptId) ? prev.filter((id) => id !== promptId) : [...prev, promptId]));
  };

  const getAgentTypeIcon = (type: string) => {
    switch (type) {
      case 'chat_bot':
        return <MessageSquare className="h-4 w-4" />;
      case 'intent_analyzer':
        return <Brain className="h-4 w-4" />;
      case 'requirement_processor':
        return <Code className="h-4 w-4" />;
      case 'tool_system':
        return <Cog className="h-4 w-4" />;
      case 'custom':
        return <Cog className="h-4 w-4" />;
      default:
        return <Bot className="h-4 w-4" />;
    }
  };

  const getAgentTypeLabel = (type: string) => {
    const agentType = agentTypesData?.data.find((item) => item.value === type);
    return agentType?.label || type;
  };

  const formatDate = (dateString: string) => formatTimestamp(dateString);

  const parseSystemInstructions = (instructions: string | string[]) => {
    let parsed: string[] | string;
    if (typeof instructions === 'string') {
      try {
        parsed = JSON.parse(instructions);
      } catch {
        parsed = [instructions];
      }
    } else {
      parsed = instructions;
    }

    return Array.isArray(parsed) ? parsed.filter((inst) => inst.trim() !== '').join(' ') : parsed;
  };

  const rows = promptsData?.data || [];
  const metrics = useMemo(() => {
    const activeCount = rows.filter((prompt) => prompt.is_active).length;
    const draftableModels = rows.filter((prompt) => prompt.model_name).length;
    return { activeCount, draftableModels };
  }, [rows]);
  const paginationControls = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>
        上一页
      </Button>
      <StatusPill tone="info">
        {page} / {Math.max(totalPages, 1)}
      </StatusPill>
      <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages || totalPages === 0}>
        下一页
      </Button>
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Prompt Exchange"
        title="Prompt 管理"
        description="围绕模板、变量、模型和调试能力构建统一工作台。移动端保留核心操作，桌面端保持编辑效率。"
        icon={<Bot className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" onClick={() => navigate('/prompts/new')}>
              <Plus className="mr-2 h-4 w-4" />
              新建 Prompt
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Badge variant="outline">{promptsData?.total || 0} 个配置</Badge>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="当前页 Prompt" value={rows.length} icon={<Bot className="h-5 w-5" />} />
        <MetricCard label="激活配置" value={metrics.activeCount} detail={`指定模型 ${metrics.draftableModels}`} icon={<Settings className="h-5 w-5" />} tone="success" />
        <MetricCard label="当前分页" value={`${page}/${Math.max(totalPages, 1)}`} icon={<Code className="h-5 w-5" />} tone="warning" />
      </div>

      <FilterBar>
        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1 xl:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索 Prompt 名称或描述"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={agentTypeFilter}
            onValueChange={(value) => {
              setAgentTypeFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full md:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有类型</SelectItem>
              {agentTypesData?.data.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)}>
            <Filter className="mr-2 h-4 w-4" />
            筛选
          </Button>
          <div className="sm:hidden">{paginationControls}</div>
        </div>

        {showFilters && (
          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch('');
                setAgentTypeFilter('all');
                setPage(1);
              }}
            >
              清除筛选
            </Button>
          </div>
        )}
      </FilterBar>

      {selectedPrompts.length > 0 && (
        <SelectionBar
          summary={<>已选择 {selectedPrompts.length} 个 Prompt 配置</>}
          actions={
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (confirm(`确定要删除选中的 ${selectedPrompts.length} 个配置吗？此操作不可撤销。`)) {
                  selectedPrompts.forEach((id) => {
                    deletePromptMutation.mutate(id);
                  });
                  setSelectedPrompts([]);
                }
              }}
              disabled={deletePromptMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              批量删除
            </Button>
          }
        />
      )}

      <SectionPanel
        title="Prompt 矩阵"
        description="手机以配置卡片浏览，桌面保留多列信息和快速操作。"
        icon={<Settings className="h-4 w-4 text-primary" />}
        action={<div className="hidden sm:block">{paginationControls}</div>}
      >
        {error ? (
          <ErrorState description={error.message} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="terminal-card h-40 animate-pulse rounded-xl bg-muted/60" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Bot className="h-10 w-10" />} title="暂无 Prompt 配置" description="从新建 Prompt 开始，或检查后端接口是否返回数据。" />
        ) : (
          <>
            <div className="space-y-4 md:hidden">
              {rows.map((prompt) => (
                <EntityCard
                  key={prompt.id}
                  title={prompt.prompt_name}
                  subtitle={prompt.description || '无描述'}
                  badges={
                    <>
                      <Badge variant="outline" className="gap-2">
                        {getAgentTypeIcon(prompt.agent_type)}
                        {getAgentTypeLabel(prompt.agent_type)}
                      </Badge>
                      <StatusPill tone={prompt.is_active ? 'success' : 'neutral'}>{prompt.is_active ? '激活' : '禁用'}</StatusPill>
                      <Badge variant="outline">v{prompt.version}</Badge>
                    </>
                  }
                  action={<Checkbox checked={selectedPrompts.includes(prompt.id)} onCheckedChange={() => handleSelectPrompt(prompt.id)} />}
                      meta={
                        <>
                          <span>{getProviderLabel(getPlaygroundProviderId(resolvePromptProviderConfig(prompt)))}</span>
                          <span>{formatConfiguredValue(prompt.model_name)}</span>
                          <span>{formatDate(prompt.created_at)}</span>
                        </>
                  }
                >
                  <div className="rounded-lg border border-border bg-muted/45 p-3 text-sm text-muted-foreground">
                    {parseSystemInstructions(prompt.system_instructions).slice(0, 120)}
                    {parseSystemInstructions(prompt.system_instructions).length > 120 ? '...' : ''}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/prompts/${prompt.id}/edit`)}>
                      <Edit className="mr-2 h-4 w-4" />
                      编辑
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/playground?promptId=${prompt.id}`)}>
                      <Bug className="mr-2 h-4 w-4" />
                      调试
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        toggleActiveMutation.mutate({
                          promptId: prompt.id,
                          isActive: !prompt.is_active,
                        })
                      }
                      disabled={toggleActiveMutation.isPending}
                    >
                      {prompt.is_active ? '停用' : '激活'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`确定要删除 ${prompt.prompt_name} 吗？此操作不可撤销。`)) {
                          deletePromptMutation.mutate(prompt.id);
                        }
                      }}
                      disabled={deletePromptMutation.isPending}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </EntityCard>
              ))}
            </div>

            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox checked={selectedPrompts.length > 0 && selectedPrompts.length === rows.length} onCheckedChange={handleSelectAll} />
                    </TableHead>
                    <TableHead>Prompt</TableHead>
                    <TableHead>类型与状态</TableHead>
                    <TableHead>版本与更新</TableHead>
                    <TableHead className="w-[320px]">下一步操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((prompt) => (
                    <TableRow
                      key={prompt.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/prompts/${prompt.id}/edit`)}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedPrompts.includes(prompt.id)}
                          onCheckedChange={() => handleSelectPrompt(prompt.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell className="max-w-0">
                        <div className="space-y-2">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{prompt.prompt_name}</div>
                            <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                              {prompt.description || '暂无描述，建议补充使用场景和维护说明。'}
                            </div>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                            <div className="mb-1 font-medium text-foreground">系统指令预览</div>
                            <div className="line-clamp-2 leading-5">
                              {(() => {
                                const preview = parseSystemInstructions(prompt.system_instructions);
                                return preview.length > 120 ? `${preview.substring(0, 120)}...` : preview;
                              })()}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="gap-2">
                              {getAgentTypeIcon(prompt.agent_type)}
                              {getAgentTypeLabel(prompt.agent_type)}
                            </Badge>
                            <Badge variant="outline">
                              {getProviderLabel(getPlaygroundProviderId(resolvePromptProviderConfig(prompt)))}
                            </Badge>
                            <StatusPill tone={prompt.is_active ? 'success' : 'neutral'}>
                              {prompt.is_active ? '激活' : '禁用'}
                            </StatusPill>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatConfiguredValue(prompt.model_name)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2 text-sm">
                          <Badge variant="outline">v{prompt.version}</Badge>
                          <div className="text-xs text-muted-foreground">
                            更新于 {formatDate(prompt.updated_at)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            创建于 {formatDate(prompt.created_at)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                          <Button size="sm" variant="outline" onClick={() => navigate(`/prompts/${prompt.id}/edit`)}>
                            <Edit className="mr-2 h-3.5 w-3.5" />
                            编辑
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => navigate(`/playground?promptId=${prompt.id}`)}>
                            <Bug className="mr-2 h-3.5 w-3.5" />
                            去 Playground
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              toggleActiveMutation.mutate({
                                promptId: prompt.id,
                                isActive: !prompt.is_active,
                              })
                            }
                            disabled={toggleActiveMutation.isPending}
                          >
                            {prompt.is_active ? '停用' : '激活'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`确定要删除 ${prompt.prompt_name} 吗？此操作不可撤销。`)) {
                                deletePromptMutation.mutate(prompt.id);
                              }
                            }}
                            disabled={deletePromptMutation.isPending}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </SectionPanel>
    </PageShell>
  );
};
