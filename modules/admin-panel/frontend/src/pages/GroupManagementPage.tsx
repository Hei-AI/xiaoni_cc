import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Users,
  MessageCircle,
  PlayCircle,
  PauseCircle,
  Filter,
  Eye
} from 'lucide-react';

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

// 获取群聊列表
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

// 更新单个群聊
const updateGroup = async (groupId: number, data: { is_enabled?: boolean; auto_reply_enabled?: boolean; group_name?: string; welcome_message?: string }) => {
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

// Note: Batch operations and sync functions removed for simplicity
// These can be implemented later when needed

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

  // 查询群聊数据
  const { 
    data: groupsData, 
    isLoading, 
    error, 
    refetch,
    isRefetching 
  } = useQuery({
    queryKey: ['groups', page, search, filters],
    queryFn: () => fetchGroups({ page, limit, search, ...filters }),
  });

  // 用于跟踪每个群聊的操作状态
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});

  // Note: Batch operations and sync functions removed for simplicity
  // These can be implemented later when needed in backend

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleFilterChange = (key: string, value: string | undefined) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
    setPage(1);
  };

  // 独立的群聊操作函数
  const handleGroupUpdate = async (groupId: number, field: string, value: boolean) => {
    const loadingKey = `${groupId}_${field}`;
    setLoadingStates(prev => ({ ...prev, [loadingKey]: true }));
    
    try {
      await updateGroup(groupId, { [field]: value });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    } catch (error) {
      console.error('Update failed:', error);
    } finally {
      setLoadingStates(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">群聊管理</h1>
            <p className="text-muted-foreground">
              管理bot参与的群聊，控制事件接收和自动回复
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
          {groupsData && (
            <Badge variant="secondary">
              {groupsData.pagination.total} 个群聊
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
                placeholder="搜索群名称或群号..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="max-w-sm"
              />
            </div>
            
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
              <label className="flex items-center space-x-2">
                <Checkbox 
                  checked={filters.status === 'active'}
                  onCheckedChange={(checked) => 
                    handleFilterChange('status', checked ? 'active' : undefined)
                  }
                />
                <span>活跃群聊</span>
              </label>
              
              <label className="flex items-center space-x-2">
                <Checkbox 
                  checked={filters.sortBy === 'activity_level'}
                  onCheckedChange={(checked) => 
                    handleFilterChange('sortBy', checked ? 'activity_level' : undefined)
                  }
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
        </CardContent>
      </Card>

      {/* 群聊列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            群聊列表
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
                  {groupsData?.data.map((group) => (
                    <TableRow key={group.group_id}>
                      <TableCell className="font-mono">
                        {group.group_id}
                      </TableCell>
                      <TableCell>
                        {group.group_name || '未知群聊'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={group.is_enabled ? "default" : "secondary"}>
                          {group.is_enabled ? "已启用" : "已禁用"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={group.auto_reply_enabled ? "default" : "outline"}>
                          {group.auto_reply_enabled ? "开启" : "关闭"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={group.activity_level > 50 ? "default" : group.activity_level > 20 ? "secondary" : "outline"}>
                          {group.activity_level}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>对话: {group.total_conversations}</div>
                        <div className="text-muted-foreground">
                          成功率: {group.success_rate}%
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {group.last_conversation_time ? formatDate(group.last_conversation_time) : '无'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleGroupUpdate(group.group_id, 'is_enabled', !group.is_enabled)}
                            disabled={loadingStates[`${group.group_id}_is_enabled`] || false}
                            title={group.is_enabled ? "点击禁用LLM处理" : "点击启用LLM处理"}
                          >
                            {group.is_enabled ? <PauseCircle className="h-3 w-3" /> : <PlayCircle className="h-3 w-3" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleGroupUpdate(group.group_id, 'auto_reply_enabled', !group.auto_reply_enabled)}
                            disabled={loadingStates[`${group.group_id}_auto_reply_enabled`] || false}
                            title={group.auto_reply_enabled ? "点击禁用自动回复" : "点击启用自动回复"}
                          >
                            <MessageCircle className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/groups/${group.group_id}`)}
                            title="查看群聊详情"
                          >
                            <Eye className="h-3 w-3" />
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
          {groupsData && groupsData.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                第 {page} 页，共 {groupsData.pagination.totalPages} 页
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
                  onClick={() => setPage(Math.min(groupsData.pagination.totalPages, page + 1))}
                  disabled={page === groupsData.pagination.totalPages}
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
