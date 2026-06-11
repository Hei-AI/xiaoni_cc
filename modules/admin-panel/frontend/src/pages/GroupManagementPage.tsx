import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Filter,
  Plus,
  MessageCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { FilterBar } from '@/components/console/FilterBar';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { EntityCard } from '@/components/console/EntityCard';
import { ErrorState } from '@/components/console/ErrorState';
import { EmptyState } from '@/components/console/EmptyState';
import { StatusPill } from '@/components/console/StatusPill';
import { applyChatSettingToggle, isChatSettingToggleDisabled, type ChatSettingsToggleField } from '@/lib/chat-settings';
import { formatTimestamp } from '@/lib/utils';

interface GroupChat {
  group_id: number;
  group_name: string;
  last_conversation_time: string | null;
  total_conversations: number;
  successful_replies: number;
  failed_replies: number;
  success_rate: number;
  avg_response_time: number;
  activity_level: number;
  is_enabled: number;
  auto_reply_enabled: number;
  im_receive_enabled?: number;
  agent_im_entry_enabled?: number;
  admin_user_id: number | null;
  welcome_message: string | null;
  created_at: string;
  updated_at: string;
  status: string;
}

interface GroupResponse {
  success: boolean;
  data: GroupChat[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

type GroupToggleField = ChatSettingsToggleField;

const fetchGroups = async (params: {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sortBy?: string;
}): Promise<GroupResponse> => {
  const queryParams = new URLSearchParams({
    page: params.page.toString(),
    limit: params.limit.toString(),
  });

  if (params.search) queryParams.append('search', params.search);
  if (params.status) queryParams.append('status', params.status);
  if (params.sortBy) queryParams.append('sortBy', params.sortBy);

  const response = await fetch(`/api/group-chats?${queryParams}`);
  if (!response.ok) {
    throw new Error('Failed to fetch groups');
  }
  return response.json();
};

const updateGroup = async (
  groupId: number,
  data: { is_enabled?: number; auto_reply_enabled?: number; group_name?: string | null; welcome_message?: string | null }
) => {
  const response = await fetch(`/api/group-chats/${groupId}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to update group');
  }
  return response.json();
};

const createGroup = async (data: { group_id: number; group_name?: string }) => {
  const response = await fetch('/api/group-chats', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to create group');
  }
  return response.json();
};

export const GroupManagementPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<{
    status?: string;
    sortBy?: string;
  }>({});
  const [showFilters, setShowFilters] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    groupId: '',
    groupName: '',
  });

  const queryClient = useQueryClient();
  const limit = 20;

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['groups', page, search, filters],
    queryFn: () => fetchGroups({ page, limit, search, ...filters }),
  });
  const groupsQueryKey = ['groups', page, search, filters] as const;

  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const createGroupMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setCreateDialogOpen(false);
      setCreateForm({ groupId: '', groupName: '' });
    },
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleFilterChange = (key: string, value: string | undefined) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
    setPage(1);
  };

  const handleGroupUpdate = async (groupId: number, field: GroupToggleField, value: boolean) => {
    const loadingKey = `${groupId}_${field}`;
    setLoadingStates((prev) => ({ ...prev, [loadingKey]: true }));
    const previous = queryClient.getQueryData<GroupResponse>(groupsQueryKey);
    const currentGroup = previous?.data.find((group) => group.group_id === groupId);
    const optimisticPatch = currentGroup
      ? applyChatSettingToggle(currentGroup, field, value)
      : { [field]: value ? 1 : 0 };
    const effectivePatch = {
      ...optimisticPatch,
      ...(field === 'is_enabled'
        ? {
            im_receive_enabled: value ? 1 : 0,
            agent_im_entry_enabled: value && currentGroup?.auto_reply_enabled ? 1 : 0,
          }
        : {}),
      ...(field === 'auto_reply_enabled'
        ? {
            agent_im_entry_enabled: value && (currentGroup?.is_enabled ?? 1) ? 1 : 0,
          }
        : {}),
    };

    queryClient.setQueryData<GroupResponse>(groupsQueryKey, (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        data: current.data.map((group) => (
          group.group_id === groupId
            ? { ...group, ...effectivePatch }
            : group
        )),
      };
    });

    try {
      await updateGroup(groupId, optimisticPatch);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
    } catch (updateError) {
      queryClient.setQueryData(groupsQueryKey, previous);
      window.alert(updateError instanceof Error ? updateError.message : '群聊设置更新失败');
    } finally {
      setLoadingStates((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleCreateGroup = async () => {
    const groupId = Number(createForm.groupId.trim());
    if (!Number.isFinite(groupId) || groupId <= 0) {
      window.alert('请输入合法群号');
      return;
    }

    await createGroupMutation.mutateAsync({
      group_id: groupId,
      group_name: createForm.groupName.trim() || undefined,
    });
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '无';
    return formatTimestamp(dateString);
  };

  const rows = data?.data ?? [];
  const metrics = useMemo(() => {
    const enabled = rows.filter((group) => group.im_receive_enabled ?? group.is_enabled).length;
    const autoReply = rows.filter((group) => group.agent_im_entry_enabled ?? group.auto_reply_enabled).length;
    const avgActivity =
      rows.length > 0
        ? Math.round(rows.reduce((sum, group) => sum + group.activity_level, 0) / rows.length)
        : 0;
    return { enabled, autoReply, avgActivity };
  }, [rows]);

  const renderToggleControl = (group: GroupChat, field: GroupToggleField, label: string) => {
    const checked = Boolean(group[field]);
    const loadingKey = `${group.group_id}_${field}`;
    const disabled = (loadingStates[loadingKey] || false) || isChatSettingToggleDisabled(group, field);

    return (
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/70 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="text-xs text-muted-foreground">{checked ? '已开启' : '已关闭'}</div>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={(nextChecked) => void handleGroupUpdate(group.group_id, field, nextChecked)}
          disabled={disabled}
          aria-label={`group-${group.group_id}-${field}`}
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
            <DialogTitle>添加群聊策略</DialogTitle>
            <DialogDescription>输入指定群号后，默认会创建为“IM 入口开启，消息投递关闭”。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="group-id">群号</Label>
              <Input
                id="group-id"
                inputMode="numeric"
                value={createForm.groupId}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, groupId: e.target.value }))}
                placeholder="例如 123456789"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-name">群名称</Label>
              <Input
                id="group-name"
                value={createForm.groupName}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, groupName: e.target.value }))}
                placeholder="可选"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleCreateGroup()} disabled={createGroupMutation.isPending}>
              {createGroupMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Group Desk"
        title="群聊 IM 入口"
        description="查看和配置哪些群能进入小腻 IM，以及哪些群消息会投递给 agent loop。"
        icon={<Users className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              添加群聊
            </Button>
            <Badge variant="outline">{data?.pagination.total || 0} 个群聊</Badge>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="当前页群组" value={rows.length} icon={<Users className="h-5 w-5" />} />
        <MetricCard label="IM 入口开启" value={metrics.enabled} detail={`消息投递 ${metrics.autoReply}`} icon={<PlayCircle className="h-5 w-5" />} tone="success" />
        <MetricCard label="平均活跃度" value={`${metrics.avgActivity}%`} icon={<MessageCircle className="h-5 w-5" />} tone="warning" />
      </div>

      <FilterBar>
        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1 xl:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索群名称或群号"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)}>
            <Filter className="mr-2 h-4 w-4" />
            筛选
          </Button>
          <div className="sm:hidden">
            {paginationControls}
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 flex flex-wrap gap-4 rounded-lg border border-border bg-muted/45 p-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={filters.status === 'active'}
                onCheckedChange={(checked) => handleFilterChange('status', checked ? 'active' : undefined)}
              />
              <span>消息投递开启</span>
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={filters.sortBy === 'activity_level'}
                onCheckedChange={(checked) => handleFilterChange('sortBy', checked ? 'activity_level' : undefined)}
              />
              <span>按活跃度排序</span>
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

      <SectionPanel
        title="群组矩阵"
        description="手机展示为策略卡片，桌面展示为运营表格。"
        icon={<Users className="h-4 w-4 text-primary" />}
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
          <EmptyState icon={<Users className="h-10 w-10" />} title="没有群聊数据" description="先触发真实群聊消息或检查同步接口。" />
        ) : (
          <>
            <div className="space-y-4 md:hidden">
              {rows.map((group) => (
                <EntityCard
                  key={group.group_id}
                  title={group.group_name || `群聊 ${group.group_id}`}
                  subtitle={`群号 ${group.group_id}`}
                  badges={
                    <>
                      <StatusPill tone={(group.im_receive_enabled ?? group.is_enabled) ? 'success' : 'neutral'}>{(group.im_receive_enabled ?? group.is_enabled) ? '可进 IM' : '不进 IM'}</StatusPill>
                      <StatusPill tone={(group.agent_im_entry_enabled ?? group.auto_reply_enabled) ? 'info' : 'warning'}>
                        {(group.agent_im_entry_enabled ?? group.auto_reply_enabled) ? '消息投递' : '只进未读'}
                      </StatusPill>
                      <Badge variant="outline">活跃度 {group.activity_level}%</Badge>
                    </>
                  }
                  action={
                    null
                  }
                  meta={
                    <>
                      <span>对话 {group.total_conversations}</span>
                      <span>成功率 {group.success_rate}%</span>
                      <span>{formatDate(group.last_conversation_time)}</span>
                    </>
                  }
                >
                  <div className="space-y-2">
                    {renderToggleControl(group, 'is_enabled', '进入小腻 IM')}
                    {renderToggleControl(group, 'auto_reply_enabled', '消息投递')}
                  </div>
                </EntityCard>
              ))}
            </div>

            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>群号</TableHead>
                    <TableHead>群名称</TableHead>
                    <TableHead>IM 入口</TableHead>
                    <TableHead>消息投递</TableHead>
                    <TableHead>活跃度</TableHead>
                    <TableHead>统计信息</TableHead>
                    <TableHead>最后活跃</TableHead>
                    <TableHead>开关</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((group) => (
                    <TableRow key={group.group_id}>
                      <TableCell className="font-mono">{group.group_id}</TableCell>
                      <TableCell>{group.group_name || '未知群聊'}</TableCell>
                      <TableCell>
                        <StatusPill tone={(group.im_receive_enabled ?? group.is_enabled) ? 'success' : 'neutral'}>{(group.im_receive_enabled ?? group.is_enabled) ? '可进 IM' : '不进 IM'}</StatusPill>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={(group.agent_im_entry_enabled ?? group.auto_reply_enabled) ? 'info' : 'warning'}>{(group.agent_im_entry_enabled ?? group.auto_reply_enabled) ? '投递' : '不投递'}</StatusPill>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{group.activity_level}%</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>对话: {group.total_conversations}</div>
                        <div className="text-muted-foreground">成功率: {group.success_rate}%</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(group.last_conversation_time)}</TableCell>
                      <TableCell>
                        <div className="flex min-w-[180px] items-center gap-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">进 IM</span>
                            <Switch
                              checked={Boolean(group.is_enabled)}
                              onCheckedChange={(nextChecked) => void handleGroupUpdate(group.group_id, 'is_enabled', nextChecked)}
                              disabled={loadingStates[`${group.group_id}_is_enabled`] || false}
                              aria-label={`group-${group.group_id}-receive`}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">投递</span>
                            <Switch
                              checked={Boolean(group.auto_reply_enabled)}
                              onCheckedChange={(nextChecked) => void handleGroupUpdate(group.group_id, 'auto_reply_enabled', nextChecked)}
                              disabled={loadingStates[`${group.group_id}_auto_reply_enabled`] || isChatSettingToggleDisabled(group, 'auto_reply_enabled')}
                              aria-label={`group-${group.group_id}-auto-reply`}
                            />
                          </div>
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
