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
import { applyChatSettingToggle, isChatSettingToggleDisabled } from '@/lib/chat-settings';
import { formatTimestamp } from '@/lib/utils';
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
  BarChart3,
  Clock,
  User,
  Eye
} from 'lucide-react';

interface GroupSettings {
  group_id: number;
  group_name: string;
  is_enabled: number;
  continuous_learning_enabled: number;
  auto_reply_enabled: number;
  transcript_compact_offset: number;
  welcome_message: string | null;
  admin_user_id: number | null;
  agent_prompt_id: string | null;
  last_activity: string | null;
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

interface ToolMetric {
  tool_name: string;
  hit_count: number;
  run_count: number;
  successful_hit_count: number;
  run_hit_rate: number;
  avg_hits_per_hit_run: number;
  last_hit_at: string | null;
}

interface ToolMetricsResponse {
  success: boolean;
  data: {
    session_key: string;
    window_days: number;
    total_runs: number;
    tools: ToolMetric[];
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

const fetchGroupToolMetrics = async (groupId: string, days = 7): Promise<ToolMetricsResponse> => {
  const response = await fetch(`/api/group-chats/${groupId}/tool-metrics?days=${days}`);
  if (!response.ok) {
    throw new Error('Failed to fetch group tool metrics');
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

  const { data: toolMetricsData, refetch: refetchToolMetrics } = useQuery({
    queryKey: ['group-chat-tool-metrics', groupId, 7],
    queryFn: () => fetchGroupToolMetrics(groupId!, 7),
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
    if (field === 'is_enabled' || field === 'continuous_learning_enabled' || field === 'auto_reply_enabled') {
      setSettingsForm(prev => ({
        ...prev,
        ...applyChatSettingToggle((prev as GroupSettings) || {}, field, Boolean(value))
      }));
      return;
    }
    setSettingsForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const formatDate = (dateString: string) => {
    return formatTimestamp(dateString);
  };

  const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

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
            onClick={() => {
              refetch();
              refetchToolMetrics();
            }}
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

                  <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    transcript summary / memory / topic 相关后台能力当前已屏蔽，这一版只保留最简单的对话运行链路。
                  </div>
                  
                  <div className="flex items-center space-x-6 flex-wrap gap-y-4">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="is_enabled"
                        checked={!!settingsForm.is_enabled}
                        onCheckedChange={(checked) => handleSettingsChange('is_enabled', checked)}
                      />
                      <Label htmlFor="is_enabled">接收群聊消息</Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        id="continuous_learning_enabled"
                        checked={!!settingsForm.continuous_learning_enabled}
                        onCheckedChange={(checked) => handleSettingsChange('continuous_learning_enabled', checked)}
                        disabled={isChatSettingToggleDisabled(settingsForm, 'continuous_learning_enabled')}
                      />
                      <Label htmlFor="continuous_learning_enabled">持续学习</Label>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="auto_reply_enabled"
                        checked={!!settingsForm.auto_reply_enabled}
                        onCheckedChange={(checked) => handleSettingsChange('auto_reply_enabled', checked)}
                        disabled={isChatSettingToggleDisabled(settingsForm, 'auto_reply_enabled')}
                      />
                      <Label htmlFor="auto_reply_enabled">开启自动回复</Label>
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">群名称</p>
                    <p className="font-medium">{groupData.data.group_settings.group_name || '未设置'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">接收状态</p>
                    <Badge variant={groupData.data.group_settings.is_enabled ? "default" : "secondary"}>
                      {groupData.data.group_settings.is_enabled ? "接收中" : "已忽略"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">持续学习</p>
                    <Badge variant={groupData.data.group_settings.continuous_learning_enabled ? "default" : "outline"}>
                      {groupData.data.group_settings.continuous_learning_enabled ? "开启" : "关闭"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">自动回复</p>
                    <Badge variant={groupData.data.group_settings.auto_reply_enabled ? "default" : "outline"}>
                      {groupData.data.group_settings.auto_reply_enabled ? "开启" : "关闭"}
                    </Badge>
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
                  小腻主AGENT
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                小腻现在只有一套代码内置 Prompt。群级 Prompt 绑定字段只作为历史兼容数据展示，不再参与运行决策。
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                工具命中率
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>窗口：最近 {toolMetricsData?.data.window_days ?? 7} 天</span>
                <Badge variant="outline">总 run {toolMetricsData?.data.total_runs ?? 0}</Badge>
              </div>

              {toolMetricsData?.data.tools?.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>工具</TableHead>
                        <TableHead>命中次数</TableHead>
                        <TableHead>命中 run 数</TableHead>
                        <TableHead>run 覆盖率</TableHead>
                        <TableHead>平均每次命中 run 调用</TableHead>
                        <TableHead>最近命中</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {toolMetricsData.data.tools.map((tool) => (
                        <TableRow key={tool.tool_name}>
                          <TableCell className="font-mono text-xs">{tool.tool_name}</TableCell>
                          <TableCell>{tool.hit_count}</TableCell>
                          <TableCell>{tool.run_count}</TableCell>
                          <TableCell>{formatPercent(tool.run_hit_rate)}</TableCell>
                          <TableCell>{tool.avg_hits_per_hit_run.toFixed(2)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {tool.last_hit_at ? formatDate(tool.last_hit_at) : '无'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  最近窗口内还没有工具命中记录。
                </div>
              )}
            </CardContent>
          </Card>

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
                              onClick={() => navigate(`/runs/${conversation.id}/trace`)}
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
