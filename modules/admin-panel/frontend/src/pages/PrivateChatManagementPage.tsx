import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Eye,
  Filter,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { applyChatSettingToggle, isChatSettingToggleDisabled, type ChatSettingsToggleField } from '@/lib/chat-settings';
import { formatTimestamp } from '@/lib/utils';

interface PrivateChatUser {
  user_id: number;
  nickname: string;
  last_conversation_time: string;
  status: string;
  total_conversations: number;
  successful_replies: number;
  failed_replies: number;
  success_rate: number;
  avg_response_time: string;
  is_enabled: number;
  continuous_learning_enabled: number;
  auto_reply_enabled: number;
  user_notes?: string;
}

interface PrivateChatResponse {
  success: boolean;
  data: PrivateChatUser[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

type PrivateChatToggleField = ChatSettingsToggleField;

const fetchPrivateChats = async (params: {
  page: number;
  limit: number;
  search?: string;
  is_enabled?: boolean;
  auto_reply_enabled?: boolean;
}): Promise<PrivateChatResponse> => {
  const queryParams = new URLSearchParams({
    page: params.page.toString(),
    limit: params.limit.toString(),
  });

  if (params.search) queryParams.append('search', params.search);
  if (params.is_enabled !== undefined) queryParams.append('is_enabled', params.is_enabled.toString());
  if (params.auto_reply_enabled !== undefined) queryParams.append('auto_reply_enabled', params.auto_reply_enabled.toString());

  const response = await fetch(`/api/private-chats?${queryParams}`);
  if (!response.ok) {
    throw new Error('Failed to fetch private chats');
  }
  return response.json();
};

const updatePrivateChat = async (userId: number, data: { is_enabled?: number; continuous_learning_enabled?: number; auto_reply_enabled?: number }) => {
  const response = await fetch(`/api/private-chats/${userId}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to update private chat');
  }
  return response.json();
};

const createPrivateChat = async (data: { user_id: number; username?: string }) => {
  const response = await fetch('/api/private-chats', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to create private chat');
  }
  return response.json();
};

const batchUpdatePrivateChats = async (data: {
  user_ids: number[];
  is_enabled?: number;
  continuous_learning_enabled?: number;
  auto_reply_enabled?: number;
}) => {
  const response = await fetch('/api/private-chats/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to batch update private chats');
  }
  return response.json();
};

const deletePrivateChat = async (userId: number) => {
  const response = await fetch(`/api/private-chats/${userId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete private chat');
  }
  return response.json();
};

const batchDeletePrivateChats = async (user_ids: number[]) => {
  const response = await fetch('/api/private-chats/batch', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_ids }),
  });

  if (!response.ok) {
    throw new Error('Failed to batch delete private chats');
  }
  return response.json();
};

export const PrivateChatManagementPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<{
    is_enabled?: boolean;
    auto_reply_enabled?: boolean;
  }>({});
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    userId: '',
    username: '',
  });

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const limit = 20;

  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['private-chats', page, search, filters],
    queryFn: () => fetchPrivateChats({ page, limit, search, ...filters }),
  });
  const privateChatsQueryKey = ['private-chats', page, search, filters] as const;

  const batchUpdateMutation = useMutation({
    mutationFn: batchUpdatePrivateChats,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
      setSelectedUsers([]);
    },
  });

  const createPrivateChatMutation = useMutation({
    mutationFn: createPrivateChat,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
      setCreateDialogOpen(false);
      setCreateForm({ userId: '', username: '' });
      navigate(`/private-chats/${variables.user_id}`);
    },
  });

  const deletePrivateChatMutation = useMutation({
    mutationFn: deletePrivateChat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: batchDeletePrivateChats,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
      setSelectedUsers([]);
    },
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleFilterChange = (key: string, value: boolean | undefined) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
    setPage(1);
  };

  const handleSelectAll = () => {
    if (selectedUsers.length === data?.data.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(data?.data.map((user) => user.user_id) || []);
    }
  };

  const handleSelectUser = (userId: number) => {
    setSelectedUsers((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const handleBatchUpdate = (field: PrivateChatToggleField, value: boolean) => {
    if (selectedUsers.length === 0) return;
    batchUpdateMutation.mutate({
      user_ids: selectedUsers,
      ...(field === 'is_enabled' && !value
        ? { is_enabled: 0, continuous_learning_enabled: 0, auto_reply_enabled: 0 }
        : { [field]: value ? 1 : 0 }),
    });
  };

  const handleUserUpdate = async (userId: number, field: PrivateChatToggleField, value: boolean) => {
    const loadingKey = `${userId}_${field}`;
    setLoadingStates((prev) => ({ ...prev, [loadingKey]: true }));
    const previous = queryClient.getQueryData<PrivateChatResponse>(privateChatsQueryKey);
    const currentUser = previous?.data.find((user) => user.user_id === userId);
    const optimisticPatch = currentUser
      ? applyChatSettingToggle(currentUser, field, value)
      : { [field]: value ? 1 : 0 };

    queryClient.setQueryData<PrivateChatResponse>(privateChatsQueryKey, (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        data: current.data.map((user) => (
          user.user_id === userId
            ? { ...user, ...optimisticPatch }
            : user
        )),
      };
    });

    try {
      await updatePrivateChat(userId, optimisticPatch);
      await queryClient.invalidateQueries({ queryKey: ['private-chats'] });
    } catch (updateError) {
      queryClient.setQueryData(privateChatsQueryKey, previous);
      window.alert(updateError instanceof Error ? updateError.message : '私聊设置更新失败');
    } finally {
      setLoadingStates((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleCreatePrivateChat = async () => {
    const userId = Number(createForm.userId.trim());
    if (!Number.isFinite(userId) || userId <= 0) {
      window.alert('请输入合法 QQ 号');
      return;
    }

    await createPrivateChatMutation.mutateAsync({
      user_id: userId,
      username: createForm.username.trim() || undefined,
    });
  };

  const formatDate = (dateString: string) => formatTimestamp(dateString);

  const rows = data?.data || [];
  const metrics = useMemo(() => {
    const enabled = rows.filter((user) => user.is_enabled).length;
    const learning = rows.filter((user) => user.continuous_learning_enabled).length;
    const autoReply = rows.filter((user) => user.auto_reply_enabled).length;
    const avgSuccess = rows.length > 0 ? Math.round(rows.reduce((sum, user) => sum + user.success_rate, 0) / rows.length) : 0;
    return { enabled, learning, autoReply, avgSuccess };
  }, [rows]);

  const renderToggleControl = (user: PrivateChatUser, field: PrivateChatToggleField, label: string) => {
    const checked = Boolean(user[field]);
    const loadingKey = `${user.user_id}_${field}`;
    const disabled = (loadingStates[loadingKey] || false) || isChatSettingToggleDisabled(user, field);

    return (
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/70 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="text-xs text-muted-foreground">{checked ? '已开启' : '已关闭'}</div>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={(nextChecked) => void handleUserUpdate(user.user_id, field, nextChecked)}
          disabled={disabled}
          aria-label={`private-${user.user_id}-${field}`}
        />
      </label>
    );
  };

  const paginationControls = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>
        上一页
      </Button>
      <StatusPill tone="info">
        {page} / {data?.pagination.totalPages || 1}
      </StatusPill>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setPage((value) => Math.min(data?.pagination.totalPages || 1, value + 1))}
        disabled={page === (data?.pagination.totalPages || 1)}
      >
        下一页
      </Button>
    </div>
  );

  return (
    <PageShell>
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加私聊策略</DialogTitle>
            <DialogDescription>输入指定 QQ 号后，默认会创建为“接收开启，自动回复关闭”。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="private-user-id">QQ号</Label>
              <Input
                id="private-user-id"
                inputMode="numeric"
                value={createForm.userId}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, userId: e.target.value }))}
                placeholder="例如 1129974489"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="private-username">备注名称</Label>
              <Input
                id="private-username"
                value={createForm.username}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))}
                placeholder="可选"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleCreatePrivateChat()} disabled={createPrivateChatMutation.isPending}>
              {createPrivateChatMutation.isPending ? '创建中...' : '创建并进入详情'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Direct Message Book"
        title="私聊管理"
        description="统一管理私聊接收策略、自动回复开关和批量操作，同时重排为适合手机操作的卡片流。"
        icon={<User className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              添加私聊
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Badge variant="outline">{data?.pagination.total || 0} 个用户</Badge>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="当前页用户" value={rows.length} icon={<User className="h-5 w-5" />} />
        <MetricCard label="接收开启" value={metrics.enabled} detail={`学习开启 ${metrics.learning} / 自动回复 ${metrics.autoReply}`} icon={<PlayCircle className="h-5 w-5" />} tone="success" />
        <MetricCard label="平均成功率" value={`${metrics.avgSuccess}%`} icon={<MessageCircle className="h-5 w-5" />} tone="warning" />
      </div>

      <FilterBar>
        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1 xl:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="搜索用户名或 QQ 号" value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-9" />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)}>
            <Filter className="mr-2 h-4 w-4" />
            筛选
          </Button>
          <div className="sm:hidden">{paginationControls}</div>
        </div>

        {showFilters && (
          <div className="mt-4 flex flex-wrap gap-4 rounded-lg border border-border bg-muted/45 p-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={filters.is_enabled === true}
                onCheckedChange={(checked) => handleFilterChange('is_enabled', checked ? true : undefined)}
              />
              <span>接收中</span>
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={filters.auto_reply_enabled === true}
                onCheckedChange={(checked) => handleFilterChange('auto_reply_enabled', checked ? true : undefined)}
              />
              <span>自动回复开启</span>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilters({});
                setPage(1);
              }}
            >
              清除筛选
            </Button>
          </div>
        )}
      </FilterBar>

      {selectedUsers.length > 0 && (
        <SelectionBar
          summary={<>已选择 {selectedUsers.length} 个用户</>}
          actions={
            <>
              <Button size="sm" onClick={() => handleBatchUpdate('is_enabled', true)} disabled={batchUpdateMutation.isPending}>
                <PlayCircle className="mr-2 h-4 w-4" />
                批量开始接收
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBatchUpdate('is_enabled', false)} disabled={batchUpdateMutation.isPending}>
                <PauseCircle className="mr-2 h-4 w-4" />
                批量停止接收
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBatchUpdate('continuous_learning_enabled', true)} disabled={batchUpdateMutation.isPending}>
                开启持续学习
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBatchUpdate('continuous_learning_enabled', false)} disabled={batchUpdateMutation.isPending}>
                关闭持续学习
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBatchUpdate('auto_reply_enabled', true)} disabled={batchUpdateMutation.isPending}>
                开启自动回复
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBatchUpdate('auto_reply_enabled', false)} disabled={batchUpdateMutation.isPending}>
                关闭自动回复
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (confirm(`确定要删除选中的 ${selectedUsers.length} 个用户吗？此操作不可撤销。`)) {
                    batchDeleteMutation.mutate(selectedUsers);
                  }
                }}
                disabled={batchDeleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                批量删除
              </Button>
            </>
          }
        />
      )}

      <SectionPanel
        title="用户列表"
        description="移动端为实体卡片，桌面端保留批量勾选与密集表格操作。"
        icon={<User className="h-4 w-4 text-primary" />}
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
          <EmptyState icon={<User className="h-10 w-10" />} title="暂无私聊用户" description="检查 NapCat 同步接口，或等待真实用户触发会话后再查看。" />
        ) : (
          <>
            <div className="space-y-4 md:hidden">
              {rows.map((user) => (
                <EntityCard
                  key={user.user_id}
                  title={user.nickname || `用户 ${user.user_id}`}
                  subtitle={`QQ ${user.user_id}`}
                  badges={
                    <>
                      <StatusPill tone={user.status === 'success' ? 'success' : user.status === 'failed' ? 'danger' : 'warning'}>
                        {user.status === 'success' ? '正常' : user.status === 'failed' ? '失败' : '其他'}
                      </StatusPill>
                      <StatusPill tone={user.is_enabled ? 'success' : 'neutral'}>{user.is_enabled ? '接收中' : '已忽略'}</StatusPill>
                      <StatusPill tone={user.continuous_learning_enabled ? 'info' : 'neutral'}>
                        {user.continuous_learning_enabled ? '持续学习开启' : '持续学习关闭'}
                      </StatusPill>
                      <Badge variant="outline">成功率 {user.success_rate}%</Badge>
                    </>
                  }
                  action={
                    <Checkbox checked={selectedUsers.includes(user.user_id)} onCheckedChange={() => handleSelectUser(user.user_id)} />
                  }
                  meta={
                    <>
                      <span>总对话 {user.total_conversations}</span>
                      <span>最后对话 {user.last_conversation_time ? formatDate(user.last_conversation_time) : '无'}</span>
                    </>
                  }
                >
                  <div className="grid grid-cols-1 gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/private-chats/${user.user_id}`)}>
                      <Eye className="mr-2 h-4 w-4" />
                      详情
                    </Button>
                    {renderToggleControl(user, 'is_enabled', '接收开关')}
                    {renderToggleControl(user, 'continuous_learning_enabled', '持续学习')}
                    {renderToggleControl(user, 'auto_reply_enabled', '自动回复')}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`确定要删除用户 ${user.nickname || user.user_id} 吗？此操作不可撤销。`)) {
                          deletePrivateChatMutation.mutate(user.user_id);
                        }
                      }}
                      disabled={deletePrivateChatMutation.isPending}
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
                      <Checkbox checked={selectedUsers.length > 0 && selectedUsers.length === rows.length} onCheckedChange={handleSelectAll} />
                    </TableHead>
                    <TableHead>QQ号</TableHead>
                    <TableHead>用户名</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>对话统计</TableHead>
                    <TableHead>成功率</TableHead>
                    <TableHead>接收状态</TableHead>
                    <TableHead>持续学习</TableHead>
                    <TableHead>自动回复</TableHead>
                    <TableHead>最后对话</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((user) => (
                    <TableRow key={user.user_id}>
                      <TableCell>
                        <Checkbox checked={selectedUsers.includes(user.user_id)} onCheckedChange={() => handleSelectUser(user.user_id)} />
                      </TableCell>
                      <TableCell className="font-mono">{user.user_id}</TableCell>
                      <TableCell>{user.nickname || '未知用户'}</TableCell>
                      <TableCell>
                        <StatusPill tone={user.status === 'success' ? 'success' : user.status === 'failed' ? 'danger' : 'warning'}>
                          {user.status === 'success' ? '正常' : user.status === 'failed' ? '失败' : '其他'}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>总数: {user.total_conversations}</div>
                        <div className="text-muted-foreground">
                          成功: {user.successful_replies} / 失败: {user.failed_replies}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{user.success_rate}%</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={user.is_enabled ? 'success' : 'neutral'}>{user.is_enabled ? '接收中' : '已忽略'}</StatusPill>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={user.continuous_learning_enabled ? 'info' : 'neutral'}>{user.continuous_learning_enabled ? '开启' : '关闭'}</StatusPill>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={user.auto_reply_enabled ? 'info' : 'warning'}>{user.auto_reply_enabled ? '开启' : '关闭'}</StatusPill>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{user.last_conversation_time ? formatDate(user.last_conversation_time) : '无'}</TableCell>
                      <TableCell>
                        <div className="flex min-w-[240px] items-center gap-4">
                          <Button size="sm" variant="outline" onClick={() => navigate(`/private-chats/${user.user_id}`)}>
                            <Eye className="h-3 w-3" />
                          </Button>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">接收</span>
                            <Switch
                              checked={Boolean(user.is_enabled)}
                              onCheckedChange={(nextChecked) => void handleUserUpdate(user.user_id, 'is_enabled', nextChecked)}
                              disabled={loadingStates[`${user.user_id}_is_enabled`] || false}
                              aria-label={`private-${user.user_id}-receive`}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">学习</span>
                            <Switch
                              checked={Boolean(user.continuous_learning_enabled)}
                              onCheckedChange={(nextChecked) => void handleUserUpdate(user.user_id, 'continuous_learning_enabled', nextChecked)}
                              disabled={loadingStates[`${user.user_id}_continuous_learning_enabled`] || isChatSettingToggleDisabled(user, 'continuous_learning_enabled')}
                              aria-label={`private-${user.user_id}-continuous-learning`}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">自动回复</span>
                            <Switch
                              checked={Boolean(user.auto_reply_enabled)}
                              onCheckedChange={(nextChecked) => void handleUserUpdate(user.user_id, 'auto_reply_enabled', nextChecked)}
                              disabled={loadingStates[`${user.user_id}_auto_reply_enabled`] || isChatSettingToggleDisabled(user, 'auto_reply_enabled')}
                              aria-label={`private-${user.user_id}-auto-reply`}
                            />
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`确定要删除用户 ${user.nickname || user.user_id} 吗？此操作不可撤销。`)) {
                                deletePrivateChatMutation.mutate(user.user_id);
                              }
                            }}
                            disabled={deletePrivateChatMutation.isPending}
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
          </>
        )}
      </SectionPanel>
    </PageShell>
  );
};
