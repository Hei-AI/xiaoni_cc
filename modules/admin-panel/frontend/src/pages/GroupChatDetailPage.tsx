import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
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
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { usePromptTemplates } from '../hooks/usePromptTemplates';
import { 
  ArrowLeft,
  RefreshCw, 
  Search,
  Settings,
  Users,
  MessageCircle,
  PlayCircle,
  PauseCircle,
  Calendar,
  Hash,
  Clock,
  User,
  Eye
} from 'lucide-react';

interface GroupSettings {
  group_id: number;
  group_name: string;
  is_enabled: number;
  auto_reply_enabled: number;
  receive_events: number;
  welcome_message: string | null;
  admin_user_id: number | null;
  agent_prompt_id: string | null;
  last_activity: string | null;
  human_like_scan_interval_ms: number | null;
  human_like_min_interval_ms: number | null;
  human_like_max_interval_ms: number | null;
}

interface TodayStats {
  today_conversations: number;
  today_success: number;
  today_failed: number;
}

interface Conversation {
  id: string;
  user_id: number;
  user_message: string;
  ai_response: string;
  timestamp: string;
  response_time: number;
  model_name: string;
  status: string;
}

interface GroupChatDetailResponse {
  success: boolean;
  data: {
    group_id: number;
    group_settings: GroupSettings;
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

// 获取群聊详情
const fetchGroupChatDetail = async (groupId: string, params: {
  page: number;
  limit: number;
  search?: string;
  startTime?: string;
  endTime?: string;
  showAll?: boolean;
}): Promise<GroupChatDetailResponse> => {
  const queryParams = new URLSearchParams({
    page: params.page.toString(),
    limit: params.limit.toString(),
  });

  if (params.search) queryParams.append('search', params.search);
  if (params.startTime) queryParams.append('startTime', params.startTime);
  if (params.endTime) queryParams.append('endTime', params.endTime);
  if (params.showAll !== undefined) queryParams.append('showAll', params.showAll.toString());

  const response = await fetch(`/api/group-chats/${groupId}?${queryParams}`);
  if (!response.ok) {
    throw new Error('Failed to fetch group chat detail');
  }
  return response.json();
};

// 更新群聊设置
const updateGroupSettings = async (groupId: string, settings: Partial<GroupSettings>) => {
  const response = await fetch(`/api/group-chats/${groupId}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
  
  if (!response.ok) {
    throw new Error('Failed to update group settings');
  }
  return response.json();
};

const updateGroupPrompt = async (groupId: string, promptId: string | null) => {
  const response = await fetch(`/api/group-chats/${groupId}/prompt`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt_id: promptId }),
  });

  if (!response.ok) {
    throw new Error('Failed to update group prompt');
  }

  return response.json();
};

export const GroupChatDetailPage: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState({
    startTime: '',
    endTime: ''
  });
  const [showAll, setShowAll] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState<Partial<GroupSettings>>({});

  const limit = 50;

  // 查询群聊详情数据
  const { 
    data: groupData, 
    isLoading, 
    error, 
    refetch,
    isRefetching 
  } = useQuery({
    queryKey: ['group-chat-detail', groupId, page, search, dateRange, showAll],
    queryFn: () => fetchGroupChatDetail(groupId!, { 
      page, 
      limit, 
      search, 
      startTime: dateRange.startTime,
      endTime: dateRange.endTime,
      showAll 
    }),
    enabled: !!groupId,
  });

  // 更新群聊设置mutation
  const updateSettingsMutation = useMutation({
    mutationFn: (settings: Partial<GroupSettings>) => updateGroupSettings(groupId!, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-chat-detail', groupId] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setEditingSettings(false);
    },
  });

  const { data: promptTemplates = [], isLoading: promptLoading } = usePromptTemplates();
  const chatPrompts = React.useMemo(
    () => promptTemplates.filter(template => template.agent_type === 'chat_bot' && template.is_active),
    [promptTemplates]
  );

  const defaultPromptName = React.useMemo(() => {
    const candidates = ['echance_chat', 'enhanced_chat', 'default_chat'];
    for (const candidate of candidates) {
      const match = chatPrompts.find(prompt => prompt.prompt_name === candidate);
      if (match) {
        return match.prompt_name;
      }
    }
    return chatPrompts[0]?.prompt_name || 'enhanced_chat';
  }, [chatPrompts]);

  const defaultPromptLabel = React.useMemo(() => {
    return defaultPromptName ? `默认（${defaultPromptName}）` : '默认配置';
  }, [defaultPromptName]);

  const updatePromptMutation = useMutation({
    mutationFn: (promptId: string | null) => updateGroupPrompt(groupId!, promptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-chat-detail', groupId] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    }
  });

  const currentPrompt = React.useMemo(() => {
    if (!groupData?.data.group_settings.agent_prompt_id) {
      return null;
    }
    return chatPrompts.find(prompt => prompt.id === groupData.data.group_settings.agent_prompt_id) || null;
  }, [groupData, chatPrompts]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleDateRangeChange = (field: string, value: string) => {
    setDateRange(prev => ({
      ...prev,
      [field]: value
    }));
    setPage(1);
  };

  const handleSettingsSubmit = () => {
    if (Object.keys(settingsForm).length > 0) {
      updateSettingsMutation.mutate(settingsForm);
    }
  };

  const handleSettingsChange = (field: string, value: any) => {
    setSettingsForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleIntervalChange = (field: string, value: string) => {
    if (value === '') {
      handleSettingsChange(field, null);
      return;
    }
    const numericValue = parseInt(value, 10);
    handleSettingsChange(field, Number.isFinite(numericValue) ? numericValue : null);
  };

  const formatIntervalValue = (value?: number | null) => {
    if (value === null || value === undefined) {
      return '默认';
    }
    return formatDuration(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (!groupId) {
    return <div>群聊ID不能为空</div>;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate('/groups')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Users className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">
              群聊详情 - {groupData?.data.group_settings.group_name || `群${groupId}`}
            </h1>
            <p className="text-muted-foreground">
              群号: {groupId} | 管理群聊设置和对话历史
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
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2">加载中...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-12 text-red-600">
          加载失败: {error instanceof Error ? error.message : '未知错误'}
        </div>
      )}

      {/* Content */}
      {groupData && (
        <>
          {/* 群聊设置卡片 */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  群聊设置
                </CardTitle>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    setEditingSettings(!editingSettings);
                    if (!editingSettings) {
                      setSettingsForm(groupData.data.group_settings);
                    }
                  }}
                >
                  {editingSettings ? '取消' : '编辑'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {editingSettings ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="group_name">群名称</Label>
                      <Input
                        id="group_name"
                        value={settingsForm.group_name || ''}
                        onChange={(e) => handleSettingsChange('group_name', e.target.value)}
                        placeholder="输入群名称"
                      />
                    </div>
                    <div>
                      <Label htmlFor="admin_user_id">管理员QQ号</Label>
                      <Input
                        id="admin_user_id"
                        type="number"
                        value={settingsForm.admin_user_id || ''}
                        onChange={(e) => handleSettingsChange('admin_user_id', parseInt(e.target.value) || null)}
                        placeholder="输入管理员QQ号"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="welcome_message">欢迎消息</Label>
                    <Textarea
                      id="welcome_message"
                      value={settingsForm.welcome_message || ''}
                      onChange={(e) => handleSettingsChange('welcome_message', e.target.value)}
                      placeholder="输入欢迎消息（可选）"
                      rows={3}
                    />
                  </div>
                  
                  <div className="flex items-center space-x-6 flex-wrap gap-y-4">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="is_enabled"
                        checked={!!settingsForm.is_enabled}
                        onCheckedChange={(checked) => handleSettingsChange('is_enabled', checked ? 1 : 0)}
                      />
                      <Label htmlFor="is_enabled">启用群聊AI回复</Label>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="auto_reply_enabled"
                        checked={!!settingsForm.auto_reply_enabled}
                        onCheckedChange={(checked) => handleSettingsChange('auto_reply_enabled', checked ? 1 : 0)}
                      />
                      <Label htmlFor="auto_reply_enabled">启用自动回复</Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        id="receive_events"
                        checked={settingsForm.receive_events !== 0}
                        onCheckedChange={(checked) => handleSettingsChange('receive_events', checked ? 1 : 0)}
                      />
                      <Label htmlFor="receive_events">接收群聊事件</Label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="human_like_scan_interval_ms">扫描间隔 (毫秒)</Label>
                      <Input
                        id="human_like_scan_interval_ms"
                        type="number"
                        min={500}
                        value={settingsForm.human_like_scan_interval_ms ?? ''}
                        onChange={(e) => handleIntervalChange('human_like_scan_interval_ms', e.target.value)}
                        placeholder="留空使用默认 8000"
                      />
                      <p className="text-xs text-muted-foreground mt-1">消息批次的目标周期</p>
                    </div>
                    <div>
                      <Label htmlFor="human_like_min_interval_ms">最小间隔 (毫秒)</Label>
                      <Input
                        id="human_like_min_interval_ms"
                        type="number"
                        min={100}
                        value={settingsForm.human_like_min_interval_ms ?? ''}
                        onChange={(e) => handleIntervalChange('human_like_min_interval_ms', e.target.value)}
                        placeholder="留空使用默认 3000"
                      />
                      <p className="text-xs text-muted-foreground mt-1">处理完成后最短等待时间</p>
                    </div>
                    <div>
                      <Label htmlFor="human_like_max_interval_ms">最大间隔 (毫秒)</Label>
                      <Input
                        id="human_like_max_interval_ms"
                        type="number"
                        min={1000}
                        value={settingsForm.human_like_max_interval_ms ?? ''}
                        onChange={(e) => handleIntervalChange('human_like_max_interval_ms', e.target.value)}
                        placeholder="留空使用默认 30000"
                      />
                      <p className="text-xs text-muted-foreground mt-1">连续消息的最长等待时间</p>
                    </div>
                  </div>
                  
                  <div className="flex justify-end gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => setEditingSettings(false)}
                    >
                      取消
                    </Button>
                    <Button 
                      onClick={handleSettingsSubmit}
                      disabled={updateSettingsMutation.isPending}
                    >
                      {updateSettingsMutation.isPending ? '保存中...' : '保存设置'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">群名称</p>
                    <p className="font-medium">{groupData.data.group_settings.group_name || '未设置'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">启用状态</p>
                    <Badge variant={groupData.data.group_settings.is_enabled ? "default" : "secondary"}>
                      {groupData.data.group_settings.is_enabled ? "已启用" : "已禁用"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">自动回复</p>
                    <Badge variant={groupData.data.group_settings.auto_reply_enabled ? "default" : "outline"}>
                      {groupData.data.group_settings.auto_reply_enabled ? "开启" : "关闭"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">事件订阅</p>
                    <Badge variant={groupData.data.group_settings.receive_events ? "default" : "secondary"}>
                      {groupData.data.group_settings.receive_events ? "接收" : "忽略"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">扫描间隔</p>
                    <p className="font-medium">{formatIntervalValue(groupData.data.group_settings.human_like_scan_interval_ms)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">最小间隔</p>
                    <p className="font-medium">{formatIntervalValue(groupData.data.group_settings.human_like_min_interval_ms)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">最大间隔</p>
                    <p className="font-medium">{formatIntervalValue(groupData.data.group_settings.human_like_max_interval_ms)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">最后活跃</p>
                    <p className="text-sm">
                      {groupData.data.group_settings.last_activity 
                        ? formatDate(groupData.data.group_settings.last_activity) 
                        : '无'}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5" />
                Prompt 配置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">当前使用</p>
                <Badge variant="outline">
                  {currentPrompt ? currentPrompt.prompt_name : defaultPromptLabel}
                </Badge>
              </div>

              <Select
                value={groupData.data.group_settings.agent_prompt_id ?? 'default'}
                onValueChange={(value) => {
                  const promptValue = value === 'default' ? null : value;
                  updatePromptMutation.mutate(promptValue);
                }}
                disabled={promptLoading || updatePromptMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={promptLoading ? '加载中...' : '选择 Prompt'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{defaultPromptLabel}</SelectItem>
                  {chatPrompts.map(prompt => (
                    <SelectItem key={prompt.id} value={prompt.id}>
                      {prompt.prompt_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <p className="text-xs text-muted-foreground">
                选择特定 Prompt 将覆盖默认配置；选择“默认”会恢复到 {defaultPromptLabel}。
              </p>
            </CardContent>
          </Card>

          {/* 今日统计卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center">
                  <MessageCircle className="h-4 w-4 text-blue-600" />
                  <div className="ml-2">
                    <p className="text-sm font-medium text-muted-foreground">今日对话</p>
                    <p className="text-2xl font-bold">{groupData.data.today_stats.today_conversations}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center">
                  <PlayCircle className="h-4 w-4 text-green-600" />
                  <div className="ml-2">
                    <p className="text-sm font-medium text-muted-foreground">成功回复</p>
                    <p className="text-2xl font-bold text-green-600">{groupData.data.today_stats.today_success}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center">
                  <PauseCircle className="h-4 w-4 text-red-600" />
                  <div className="ml-2">
                    <p className="text-sm font-medium text-muted-foreground">失败回复</p>
                    <p className="text-2xl font-bold text-red-600">{groupData.data.today_stats.today_failed}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 搜索和过滤 */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1 flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="搜索对话内容..."
                      value={search}
                      onChange={(e) => handleSearch(e.target.value)}
                      className="max-w-sm"
                    />
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="showAll"
                      checked={showAll}
                      onCheckedChange={setShowAll}
                    />
                    <Label htmlFor="showAll">显示所有消息</Label>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <Input
                      type="datetime-local"
                      value={dateRange.startTime}
                      onChange={(e) => handleDateRangeChange('startTime', e.target.value)}
                      className="w-48"
                    />
                    <span className="text-muted-foreground">至</span>
                    <Input
                      type="datetime-local"
                      value={dateRange.endTime}
                      onChange={(e) => handleDateRangeChange('endTime', e.target.value)}
                      className="w-48"
                    />
                  </div>
                  
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setDateRange({ startTime: '', endTime: '' });
                      setSearch('');
                      setPage(1);
                    }}
                  >
                    清除筛选
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 对话历史列表 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5" />
                对话历史
                {groupData.data.pagination.total > 0 && (
                  <Badge variant="secondary">
                    {groupData.data.pagination.total} 条记录
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {groupData.data.conversations.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>时间</TableHead>
                        <TableHead>用户</TableHead>
                        <TableHead>用户消息</TableHead>
                        <TableHead>AI回复</TableHead>
                        <TableHead>模型</TableHead>
                        <TableHead>响应时间</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupData.data.conversations.map((conversation) => (
                        <TableRow key={conversation.id}>
                          <TableCell className="text-sm">
                            {formatDate(conversation.timestamp)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4" />
                              <span className="font-mono text-sm">{conversation.user_id}</span>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <div className="truncate" title={conversation.user_message}>
                              {conversation.user_message}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <div className="truncate" title={conversation.ai_response}>
                              {conversation.ai_response}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{conversation.model_name}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              <span className="text-sm">{formatDuration(conversation.response_time)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              conversation.status === 'success' ? "default" : 
                              conversation.status === 'failed' ? "destructive" : "secondary"
                            }>
                              {conversation.status === 'success' ? '✅ 成功' : 
                               conversation.status === 'failed' ? '❌ 失败' : '⏳ 其他'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(`/conversation/${conversation.id}/timeline`)}
                              title="查看对话链路详情"
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>暂无对话记录</p>
                  <p className="text-sm">当有群成员与机器人对话时，记录会显示在这里</p>
                </div>
              )}
              
              {/* 分页 */}
              {groupData.data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    第 {page} 页，共 {groupData.data.pagination.totalPages} 页
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
                      onClick={() => setPage(Math.min(groupData.data.pagination.totalPages, page + 1))}
                      disabled={page === groupData.data.pagination.totalPages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};
