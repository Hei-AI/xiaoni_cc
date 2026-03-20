import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Eye,
  Filter,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Users,
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
import { ErrorState } from '@/components/console/ErrorState';
import { EmptyState } from '@/components/console/EmptyState';
import { StatusPill } from '@/components/console/StatusPill';

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
  data: { is_enabled?: boolean; auto_reply_enabled?: boolean; group_name?: string; welcome_message?: string }
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

export const GroupManagementPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<{
    status?: string;
    sortBy?: string;
  }>({});
  const [showFilters, setShowFilters] = useState(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const limit = 20;

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['groups', page, search, filters],
    queryFn: () => fetchGroups({ page, limit, search, ...filters }),
  });

  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});

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

  const handleGroupUpdate = async (groupId: number, field: string, value: boolean) => {
    const loadingKey = `${groupId}_${field}`;
    setLoadingStates((prev) => ({ ...prev, [loadingKey]: true }));

    try {
      await updateGroup(groupId, { [field]: value });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    } finally {
      setLoadingStates((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '无';
    return new Date(dateString).toLocaleString('zh-CN');
  };

  const rows = data?.data ?? [];
  const metrics = useMemo(() => {
    const enabled = rows.filter((group) => group.is_enabled).length;
    const autoReply = rows.filter((group) => group.auto_reply_enabled).length;
    const avgActivity =
      rows.length > 0
        ? Math.round(rows.reduce((sum, group) => sum + group.activity_level, 0) / rows.length)
        : 0;
    return { enabled, autoReply, avgActivity };
  }, [rows]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Group Desk"
        title="群聊管理"
        description="统一管理群级策略、自动回复状态和活跃度。移动端切为卡片流，桌面端保留高密度操作表。"
        icon={<Users className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Badge variant="outline">{data?.pagination.total || 0} 个群聊</Badge>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="当前页群组" value={rows.length} icon={<Users className="h-5 w-5" />} />
        <MetricCard label="启用状态" value={metrics.enabled} detail={`自动回复开启 ${metrics.autoReply}`} icon={<PlayCircle className="h-5 w-5" />} tone="success" />
        <MetricCard label="平均活跃度" value={`${metrics.avgActivity}%`} icon={<MessageCircle className="h-5 w-5" />} tone="warning" />
      </div>

      <FilterBar>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
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
          <div className="mt-4 flex flex-wrap gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={filters.status === 'active'}
                onCheckedChange={(checked) => handleFilterChange('status', checked ? 'active' : undefined)}
              />
              <span>活跃群聊</span>
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

      <SectionPanel title="群组矩阵" description="手机展示为策略卡片，桌面展示为运营表格。" icon={<Users className="h-4 w-4 text-primary" />}>
        {error ? (
          <ErrorState description={error.message} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="terminal-card h-40 animate-pulse rounded-[1.4rem] bg-white/[0.04]" />
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
                      <StatusPill tone={group.is_enabled ? 'success' : 'neutral'}>{group.is_enabled ? '已启用' : '已禁用'}</StatusPill>
                      <StatusPill tone={group.auto_reply_enabled ? 'info' : 'warning'}>
                        {group.auto_reply_enabled ? '自动回复开启' : '自动回复关闭'}
                      </StatusPill>
                      <Badge variant="outline">活跃度 {group.activity_level}%</Badge>
                    </>
                  }
                  action={
                    <Button variant="outline" size="sm" onClick={() => navigate(`/groups/${group.group_id}`)}>
                      <Eye className="mr-2 h-4 w-4" />
                      详情
                    </Button>
                  }
                  meta={
                    <>
                      <span>对话 {group.total_conversations}</span>
                      <span>成功率 {group.success_rate}%</span>
                      <span>{formatDate(group.last_conversation_time)}</span>
                    </>
                  }
                >
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleGroupUpdate(group.group_id, 'is_enabled', !group.is_enabled)}
                      disabled={loadingStates[`${group.group_id}_is_enabled`] || false}
                    >
                      {group.is_enabled ? <PauseCircle className="mr-2 h-4 w-4" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                      {group.is_enabled ? '禁用处理' : '启用处理'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleGroupUpdate(group.group_id, 'auto_reply_enabled', !group.auto_reply_enabled)}
                      disabled={loadingStates[`${group.group_id}_auto_reply_enabled`] || false}
                    >
                      <MessageCircle className="mr-2 h-4 w-4" />
                      自动回复
                    </Button>
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
                    <TableHead>启用状态</TableHead>
                    <TableHead>自动回复</TableHead>
                    <TableHead>活跃度</TableHead>
                    <TableHead>统计信息</TableHead>
                    <TableHead>最后活跃</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((group) => (
                    <TableRow key={group.group_id}>
                      <TableCell className="font-mono">{group.group_id}</TableCell>
                      <TableCell>{group.group_name || '未知群聊'}</TableCell>
                      <TableCell>
                        <StatusPill tone={group.is_enabled ? 'success' : 'neutral'}>{group.is_enabled ? '已启用' : '已禁用'}</StatusPill>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={group.auto_reply_enabled ? 'info' : 'warning'}>{group.auto_reply_enabled ? '开启' : '关闭'}</StatusPill>
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
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleGroupUpdate(group.group_id, 'is_enabled', !group.is_enabled)}
                            disabled={loadingStates[`${group.group_id}_is_enabled`] || false}
                          >
                            {group.is_enabled ? <PauseCircle className="h-3 w-3" /> : <PlayCircle className="h-3 w-3" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleGroupUpdate(group.group_id, 'auto_reply_enabled', !group.auto_reply_enabled)}
                            disabled={loadingStates[`${group.group_id}_auto_reply_enabled`] || false}
                          >
                            <MessageCircle className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => navigate(`/groups/${group.group_id}`)}>
                            <Eye className="h-3 w-3" />
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
