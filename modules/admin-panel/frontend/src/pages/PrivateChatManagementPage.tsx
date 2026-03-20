import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Download,
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

const updatePrivateChat = async (userId: number, data: { is_enabled?: boolean; auto_reply_enabled?: boolean }) => {
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

const batchUpdatePrivateChats = async (data: {
  user_ids: number[];
  is_enabled?: boolean;
  auto_reply_enabled?: boolean;
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

const syncPrivateChatsFromNapCat = async () => {
  const response = await fetch('/api/sync/private-chats', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to sync private chats from NapCat');
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

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const limit = 20;

  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['private-chats', page, search, filters],
    queryFn: () => fetchPrivateChats({ page, limit, search, ...filters }),
  });

  const batchUpdateMutation = useMutation({
    mutationFn: batchUpdatePrivateChats,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
      setSelectedUsers([]);
    },
  });

  const syncPrivateChatsMutation = useMutation({
    mutationFn: syncPrivateChatsFromNapCat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
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

  const handleBatchUpdate = (field: string, value: boolean) => {
    if (selectedUsers.length === 0) return;
    batchUpdateMutation.mutate({
      user_ids: selectedUsers,
      [field]: value,
    });
  };

  const handleUserUpdate = async (userId: number, field: string, value: boolean) => {
    const loadingKey = `${userId}_${field}`;
    setLoadingStates((prev) => ({ ...prev, [loadingKey]: true }));

    try {
      await updatePrivateChat(userId, { [field]: value });
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
    } finally {
      setLoadingStates((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const formatDate = (dateString: string) => new Date(dateString).toLocaleString('zh-CN');

  const rows = data?.data || [];
  const metrics = useMemo(() => {
    const enabled = rows.filter((user) => user.is_enabled).length;
    const autoReply = rows.filter((user) => user.auto_reply_enabled).length;
    const avgSuccess = rows.length > 0 ? Math.round(rows.reduce((sum, user) => sum + user.success_rate, 0) / rows.length) : 0;
    return { enabled, autoReply, avgSuccess };
  }, [rows]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Direct Message Book"
        title="私聊管理"
        description="用户级策略、批量操作和自动回复开关全部保留，同时重排为适合手机操作的卡片流。"
        icon={<User className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => syncPrivateChatsMutation.mutate()} disabled={syncPrivateChatsMutation.isPending}>
              <Download className={`mr-2 h-4 w-4 ${syncPrivateChatsMutation.isPending ? 'animate-spin' : ''}`} />
              从 QQ 同步
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
        <MetricCard label="启用状态" value={metrics.enabled} detail={`自动回复开启 ${metrics.autoReply}`} icon={<PlayCircle className="h-5 w-5" />} tone="success" />
        <MetricCard label="平均成功率" value={`${metrics.avgSuccess}%`} icon={<MessageCircle className="h-5 w-5" />} tone="warning" />
      </div>

      <FilterBar>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1 xl:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="搜索用户名或 QQ 号" value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-9" />
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)}>
              <Filter className="mr-2 h-4 w-4" />
              筛选
            </Button>
          </div>

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
        </div>

        {showFilters && (
          <div className="mt-4 flex flex-wrap gap-4 rounded-lg border border-border bg-muted/45 p-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={filters.is_enabled === true}
                onCheckedChange={(checked) => handleFilterChange('is_enabled', checked ? true : undefined)}
              />
              <span>已启用私聊</span>
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
                批量启用
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleBatchUpdate('is_enabled', false)} disabled={batchUpdateMutation.isPending}>
                <PauseCircle className="mr-2 h-4 w-4" />
                批量禁用
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

      <SectionPanel title="用户列表" description="移动端为实体卡片，桌面端保留批量勾选与密集表格操作。" icon={<User className="h-4 w-4 text-primary" />}>
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
                      <StatusPill tone={user.is_enabled ? 'success' : 'neutral'}>{user.is_enabled ? '已启用' : '已禁用'}</StatusPill>
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
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/private-chats/${user.user_id}`)}>
                      <Eye className="mr-2 h-4 w-4" />
                      详情
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUserUpdate(user.user_id, 'is_enabled', !user.is_enabled)}
                      disabled={loadingStates[`${user.user_id}_is_enabled`] || false}
                    >
                      {user.is_enabled ? <PauseCircle className="mr-2 h-4 w-4" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                      启用开关
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUserUpdate(user.user_id, 'auto_reply_enabled', !user.auto_reply_enabled)}
                      disabled={loadingStates[`${user.user_id}_auto_reply_enabled`] || false}
                    >
                      <MessageCircle className="mr-2 h-4 w-4" />
                      自动回复
                    </Button>
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
                    <TableHead>启用状态</TableHead>
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
                        <StatusPill tone={user.is_enabled ? 'success' : 'neutral'}>{user.is_enabled ? '已启用' : '已禁用'}</StatusPill>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={user.auto_reply_enabled ? 'info' : 'warning'}>{user.auto_reply_enabled ? '开启' : '关闭'}</StatusPill>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{user.last_conversation_time ? formatDate(user.last_conversation_time) : '无'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => navigate(`/private-chats/${user.user_id}`)}>
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUserUpdate(user.user_id, 'is_enabled', !user.is_enabled)}
                            disabled={loadingStates[`${user.user_id}_is_enabled`] || false}
                          >
                            {user.is_enabled ? <PauseCircle className="h-3 w-3" /> : <PlayCircle className="h-3 w-3" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUserUpdate(user.user_id, 'auto_reply_enabled', !user.auto_reply_enabled)}
                            disabled={loadingStates[`${user.user_id}_auto_reply_enabled`] || false}
                          >
                            <MessageCircle className="h-3 w-3" />
                          </Button>
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
