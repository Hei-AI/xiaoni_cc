import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
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
import { applyChatSettingToggle, type ChatSettingsToggleField } from '@/lib/chat-settings';
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
  im_receive_enabled?: number;
  direct_force_im_trigger_enabled?: number;
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

export const normalizePrivateChatUser = (user: PrivateChatUser): PrivateChatUser => ({
  ...user,
  total_conversations: Number(user.total_conversations ?? 0),
  successful_replies: Number(user.successful_replies ?? 0),
  failed_replies: Number(user.failed_replies ?? 0),
  success_rate: Number(user.success_rate ?? 0),
  is_enabled: Number(user.is_enabled ?? 0),
  im_receive_enabled: Number(user.im_receive_enabled ?? user.is_enabled ?? 0),
  direct_force_im_trigger_enabled: Number(user.direct_force_im_trigger_enabled ?? 0),
});

type PrivateChatToggleField = ChatSettingsToggleField;

const fetchPrivateChats = async (params: {
  page: number;
  limit: number;
  search?: string;
}): Promise<PrivateChatResponse> => {
  const queryParams = new URLSearchParams({
    page: params.page.toString(),
    limit: params.limit.toString(),
  });

  if (params.search) queryParams.append('search', params.search);

  const response = await fetch(`/api/private-chats?${queryParams}`);
  if (!response.ok) {
    throw new Error('Failed to fetch private chats');
  }
  const result = await response.json() as PrivateChatResponse;
  return {
    ...result,
    data: Array.isArray(result.data) ? result.data.map((user) => normalizePrivateChatUser(user)) : [],
  };
};

const updatePrivateChat = async (userId: number, data: { is_enabled?: number }) => {
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
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    userId: '',
    username: '',
  });

  const queryClient = useQueryClient();
  const limit = 20;

  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['private-chats', page, search],
    queryFn: () => fetchPrivateChats({ page, limit, search }),
  });
  const privateChatsQueryKey = ['private-chats', page, search] as const;

  const batchUpdateMutation = useMutation({
    mutationFn: batchUpdatePrivateChats,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
      setSelectedUsers([]);
    },
  });

  const createPrivateChatMutation = useMutation({
    mutationFn: createPrivateChat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
      setCreateDialogOpen(false);
      setCreateForm({ userId: '', username: '' });
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
      [field]: value ? 1 : 0,
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
    const forced = Boolean(currentUser?.direct_force_im_trigger_enabled);
    const nextReceiveEnabled = value;
    const effectivePatch = {
      ...optimisticPatch,
      im_receive_enabled: forced || nextReceiveEnabled ? 1 : 0,
    };

    queryClient.setQueryData<PrivateChatResponse>(privateChatsQueryKey, (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        data: current.data.map((user) => (
          user.user_id === userId
            ? { ...user, ...effectivePatch }
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
    const enabled = rows.filter((user) => user.im_receive_enabled ?? user.is_enabled).length;
    const avgSuccess = rows.length > 0 ? Math.round(rows.reduce((sum, user) => sum + user.success_rate, 0) / rows.length) : 0;
    return { enabled, avgSuccess };
  }, [rows]);

  const renderToggleControl = (user: PrivateChatUser, field: PrivateChatToggleField, label: string) => {
    const forced = Boolean(user.direct_force_im_trigger_enabled);
    const checked = forced ? true : Boolean(user[field]);
    const loadingKey = `${user.user_id}_${field}`;
    const disabled = forced || (loadingStates[loadingKey] || false);

    return (
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/70 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="text-xs text-muted-foreground">{forced ? '工程强制' : checked ? '已开启' : '已关闭'}</div>
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
            <DialogDescription>输入指定 QQ 号后，默认会创建为 IM 入口开启。</DialogDescription>
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
              {createPrivateChatMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Direct Message Book"
        title="私聊 IM 入口"
        description="查看和配置哪些私聊能进入小腻 IM。"
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
        <MetricCard label="IM 入口开启" value={metrics.enabled} icon={<PlayCircle className="h-5 w-5" />} tone="success" />
        <MetricCard label="平均成功率" value={`${metrics.avgSuccess}%`} icon={<MessageCircle className="h-5 w-5" />} tone="warning" />
      </div>

      <FilterBar>
        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1 xl:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="搜索用户名或 QQ 号" value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="sm:hidden">{paginationControls}</div>
        </div>

      </FilterBar>

      {selectedUsers.length > 0 && (
        <SelectionBar
          summary={<>已选择 {selectedUsers.length} 个用户</>}
          actions={
            <>
              <Button size="sm" onClick={() => handleBatchUpdate('is_enabled', true)} disabled={batchUpdateMutation.isPending}>
                <PlayCircle className="mr-2 h-4 w-4" />
                批量开启 IM
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBatchUpdate('is_enabled', false)} disabled={batchUpdateMutation.isPending}>
                <PauseCircle className="mr-2 h-4 w-4" />
                批量关闭 IM
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
                      <StatusPill tone={(user.im_receive_enabled ?? user.is_enabled) ? 'success' : 'neutral'}>{(user.im_receive_enabled ?? user.is_enabled) ? '可进 IM' : '不进 IM'}</StatusPill>
                      {user.direct_force_im_trigger_enabled ? <Badge variant="outline">工程强制</Badge> : null}
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
                    {renderToggleControl(user, 'is_enabled', '进入小腻 IM')}
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
                    <TableHead>IM 入口</TableHead>
                    <TableHead>最后对话</TableHead>
                    <TableHead>开关</TableHead>
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
                        <div className="flex flex-col gap-1">
                          <StatusPill tone={(user.im_receive_enabled ?? user.is_enabled) ? 'success' : 'neutral'}>{(user.im_receive_enabled ?? user.is_enabled) ? '可进 IM' : '不进 IM'}</StatusPill>
                          {user.direct_force_im_trigger_enabled ? <Badge variant="outline" className="w-fit">工程强制</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{user.last_conversation_time ? formatDate(user.last_conversation_time) : '无'}</TableCell>
                      <TableCell>
                        <div className="flex min-w-[180px] items-center gap-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">进 IM</span>
                            <Switch
                              checked={Boolean(user.direct_force_im_trigger_enabled) || Boolean(user.is_enabled)}
                              onCheckedChange={(nextChecked) => void handleUserUpdate(user.user_id, 'is_enabled', nextChecked)}
                              disabled={Boolean(user.direct_force_im_trigger_enabled) || loadingStates[`${user.user_id}_is_enabled`] || false}
                              aria-label={`private-${user.user_id}-receive`}
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
