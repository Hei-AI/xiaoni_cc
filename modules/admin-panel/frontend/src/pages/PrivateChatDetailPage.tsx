import React, { useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { usePromptTemplates } from '../hooks/usePromptTemplates';
import { applyChatSettingToggle, isChatSettingToggleDisabled, type ChatSettingsToggleField } from '@/lib/chat-settings';
import { formatPromptBindingLabel } from '@/lib/contract-display';
import { formatIsoOffset, formatTimestamp, getEast8StartOfDay } from '@/lib/utils';
import { 
  ArrowLeft, 
  RefreshCw, 
  Search,
  MessageCircle,
  User,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Link as LinkIcon,
  Calendar,
  BarChart3,
  Loader2
} from 'lucide-react';

interface Conversation {
  conversation_id: string;
  trace_id: string | null;
  user_message: string;
  ai_response: string | null;
  timestamp: string;
  response_time: string;
  status: string;
  error_reason: string | null;
  model_name: string | null;
  message_id: number | null;
  reply_to_message_id: number | null;
  reply_to_text: string | null;
}

interface UserSettings {
  user_id: number;
  nickname: string;
  is_enabled: number;
  continuous_learning_enabled: number;
  auto_reply_enabled: number;
  transcript_compact_offset: number;
  welcome_message: string | null;
  user_notes: string | null;
  agent_prompt_id: string | null;
  last_activity: string | null;
}

interface TodayStats {
  today_conversations: number;
  today_success: number;
  today_failed: number;
}

interface PrivateChatDetailResponse {
  success: boolean;
  data: {
    user_id: number;
    user_settings: UserSettings;
    today_stats: TodayStats;
    conversations: Conversation[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  };
}

// 获取用户对话详情
const fetchUserConversations = async (userId: string, params: {
  page: number;
  limit: number;
  search?: string;
  startTime?: string;
  endTime?: string;
}): Promise<PrivateChatDetailResponse> => {
  const queryParams = new URLSearchParams({
    page: params.page.toString(),
    limit: params.limit.toString(),
  });

  if (params.search) queryParams.append('search', params.search);
  if (params.startTime) queryParams.append('startTime', params.startTime);
  if (params.endTime) queryParams.append('endTime', params.endTime);

  const response = await fetch(`/api/private-chats/${userId}?${queryParams}`);
  if (!response.ok) {
    throw new Error('Failed to fetch user conversations');
  }
  return response.json();
};

// 更新用户设置
const updateUserSettings = async (userId: string, settings: Partial<UserSettings>) => {
  const response = await fetch(`/api/private-chats/${userId}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
  
  if (!response.ok) {
    throw new Error('Failed to update user settings');
  }
  return response.json();
};

const updateUserPrompt = async (userId: string, promptId: string | null) => {
  const response = await fetch(`/api/private-chats/${userId}/prompt`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt_id: promptId }),
  });

  if (!response.ok) {
    throw new Error('Failed to update user prompt');
  }

  return response.json();
};

export const PrivateChatDetailPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [timeRange, setTimeRange] = useState('all');
  const queryClient = useQueryClient();
  const limit = 20;

  if (!userId) {
    return <Navigate to="/private-chats" replace />;
  }

  // 查询用户对话数据
  const { 
    data: conversationData, 
    isLoading, 
    error, 
    refetch,
    isRefetching 
  } = useQuery({
    queryKey: ['private-chat-details', userId, page, search, timeRange],
    queryFn: () => {
      const now = new Date();
      let startTime: string | undefined;
      let endTime: string | undefined;

      if (timeRange === 'today') {
        const dayStart = getEast8StartOfDay(now);
        startTime = formatIsoOffset(dayStart);
        endTime = formatIsoOffset(new Date(dayStart.getTime() + 24 * 60 * 60 * 1000));
      } else if (timeRange === 'week') {
        startTime = formatIsoOffset(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      } else if (timeRange === 'month') {
        startTime = formatIsoOffset(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
      }

      return fetchUserConversations(userId, { 
        page, 
        limit, 
        search,
        startTime,
        endTime
      });
    },
  });

  // 更新设置mutation
  const updateSettingsMutation = useMutation({
    mutationFn: (settings: Partial<UserSettings>) => 
      updateUserSettings(userId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chat-details', userId] });
    },
  });

  const { data: promptTemplates = [], isLoading: promptLoading } = usePromptTemplates();
  const chatPrompts = React.useMemo(
    () => promptTemplates.filter(template => template.agent_type === 'chat_bot' && template.is_active),
    [promptTemplates]
  );

  const updatePromptMutation = useMutation({
    mutationFn: (promptId: string | null) => updateUserPrompt(userId, promptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chat-details', userId] });
    },
  });

  const currentPrompt = React.useMemo(() => {
    if (!conversationData?.data.user_settings.agent_prompt_id) {
      return null;
    }
    return chatPrompts.find(prompt => prompt.id === conversationData.data.user_settings.agent_prompt_id) || null;
  }, [conversationData, chatPrompts]);

  const isPromptBindingResolving = Boolean(
    conversationData?.data.user_settings.agent_prompt_id &&
    promptLoading &&
    !currentPrompt
  );

  const currentPromptLabel = React.useMemo(() => {
    if (isPromptBindingResolving) {
      return '正在加载已绑定 Prompt...';
    }
    return formatPromptBindingLabel({
      promptId: conversationData?.data.user_settings.agent_prompt_id,
      promptName: currentPrompt?.prompt_name ?? null
    });
  }, [conversationData?.data.user_settings.agent_prompt_id, currentPrompt?.prompt_name, isPromptBindingResolving]);

  const formatDate = (dateString: string) => {
    return formatTimestamp(dateString);
  };

  const formatDuration = (ms: string | number) => {
    const duration = typeof ms === 'string' ? parseFloat(ms) : ms;
    if (duration < 1000) return `${duration.toFixed(0)}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default"><CheckCircle className="h-3 w-3 mr-1" />成功</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />失败</Badge>;
      case 'processing':
        return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />处理中</Badge>;
      default:
        return <Badge variant="outline"><AlertCircle className="h-3 w-3 mr-1" />未知</Badge>;
    }
  };

  const handleQuickToggle = (field: ChatSettingsToggleField) => {
    if (!conversationData?.data.user_settings) return;
    
    const currentValue = conversationData.data.user_settings[field];
    updateSettingsMutation.mutate(applyChatSettingToggle(
      conversationData.data.user_settings,
      field,
      !currentValue
    ));
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/private-chats')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回列表
          </Button>
          <div>
            <h1 className="text-2xl font-bold">私聊详情</h1>
            <p className="text-muted-foreground">
              {conversationData?.data.user_settings.nickname || `用户 ${userId}`} 的对话历史
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          {conversationData && (
            <Badge variant="secondary">
              {conversationData.data.pagination.total} 条对话
            </Badge>
          )}
        </div>
      </div>

      {/* User Info Card */}
      {conversationData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* User Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                用户信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">QQ号:</span>
                  <span className="font-mono">{conversationData.data.user_id}</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">昵称:</span>
                  <span>{conversationData.data.user_settings.nickname}</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">接收状态:</span>
                  <Button
                    size="sm"
                    variant={conversationData.data.user_settings.is_enabled ? "default" : "outline"}
                    onClick={() => handleQuickToggle('is_enabled')}
                    disabled={updateSettingsMutation.isPending}
                  >
                    {conversationData.data.user_settings.is_enabled ? '接收中' : '已忽略'}
                  </Button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">持续学习:</span>
                  <Button
                    size="sm"
                    variant={conversationData.data.user_settings.continuous_learning_enabled ? "default" : "outline"}
                    onClick={() => handleQuickToggle('continuous_learning_enabled')}
                    disabled={updateSettingsMutation.isPending || isChatSettingToggleDisabled(conversationData.data.user_settings, 'continuous_learning_enabled')}
                  >
                    {conversationData.data.user_settings.continuous_learning_enabled ? '开启' : '关闭'}
                  </Button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">自动回复:</span>
                  <Button
                    size="sm"
                    variant={conversationData.data.user_settings.auto_reply_enabled ? "default" : "outline"}
                    onClick={() => handleQuickToggle('auto_reply_enabled')}
                    disabled={updateSettingsMutation.isPending || isChatSettingToggleDisabled(conversationData.data.user_settings, 'auto_reply_enabled')}
                  >
                    {conversationData.data.user_settings.auto_reply_enabled ? '开启' : '关闭'}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-sm font-medium">自定义 Prompt:</span>
                <div className="mb-2">
                  <span className="text-xs text-muted-foreground">当前使用: </span>
                  <Badge variant="outline">
                    {currentPromptLabel}
                  </Badge>
                </div>
                <Select
                  value={conversationData.data.user_settings.agent_prompt_id || 'unbound'}
                  onValueChange={(value) => {
                    const promptValue = value === 'unbound' ? null : value;
                    updatePromptMutation.mutate(promptValue);
                  }}
                  disabled={promptLoading || updatePromptMutation.isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={promptLoading ? '加载中...' : '选择 Prompt'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unbound">未绑定</SelectItem>
                    {chatPrompts.map(prompt => (
                      <SelectItem key={prompt.id} value={prompt.id}>
                        {prompt.prompt_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  这里只展示私聊级显式绑定。未绑定表示后端当前没有私聊级 Prompt 契约。
                </p>
              </div>
              <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                transcript summary / memory / topic 相关后台能力当前已屏蔽，管理端不再开放这些调优项。
              </div>
            </CardContent>
          </Card>

          {/* Today Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                今日统计
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">对话次数:</span>
                <Badge variant="secondary">{conversationData.data.today_stats.today_conversations}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">成功回复:</span>
                <Badge variant="default">{conversationData.data.today_stats.today_success}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">失败次数:</span>
                <Badge variant="destructive">{conversationData.data.today_stats.today_failed}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">成功率:</span>
                <Badge variant="outline">
                  {conversationData.data.today_stats.today_conversations > 0 
                    ? Math.round((conversationData.data.today_stats.today_success / conversationData.data.today_stats.today_conversations) * 100)
                    : 0}%
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex-1 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索对话内容..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="max-w-sm"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <select 
                value={timeRange} 
                onChange={(e) => {
                  setTimeRange(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="all">全部时间</option>
                <option value="today">今天</option>
                <option value="week">最近7天</option>
                <option value="month">最近30天</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conversations List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            对话记录
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
                    <TableHead>时间</TableHead>
                    <TableHead>用户消息</TableHead>
                    <TableHead>AI回复</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>响应时间</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conversationData?.data.conversations.map((conversation) => (
                    <TableRow key={conversation.conversation_id}>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3" />
                          {formatDate(conversation.timestamp)}
                        </div>
                        <div className="text-xs text-blue-600 mt-1">
                          TraceID: {conversation.trace_id ? conversation.trace_id.slice(0, 8) + '...' : '无'}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="truncate" title={conversation.user_message}>
                          {conversation.user_message}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        {conversation.ai_response ? (
                          <div className="truncate" title={conversation.ai_response}>
                            {conversation.ai_response}
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">无回复</span>
                        )}
                        {conversation.error_reason && (
                          <div className="text-xs text-red-600 mt-1">
                            错误: {conversation.error_reason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(conversation.status)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDuration(conversation.response_time)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {conversation.model_name ? (
                          <Badge variant="outline">{conversation.model_name}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/runs/${conversation.conversation_id}/trace`)}
                            title="查看对话链路详情"
                          >
                            <LinkIcon className="h-3 w-3" />
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
          {conversationData && conversationData.data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                第 {page} 页，共 {conversationData.data.pagination.totalPages} 页
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
                  onClick={() => setPage(Math.min(conversationData.data.pagination.totalPages, page + 1))}
                  disabled={page === conversationData.data.pagination.totalPages}
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
