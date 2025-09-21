import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  User,
  MessageCircle,
  PlayCircle,
  PauseCircle,
  Filter,
  Download,
  Trash2,
  Eye
} from 'lucide-react';

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

// 获取私聊列表
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

// 更新单个私聊
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

// 批量更新私聊
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

// 删除单个私聊
const deletePrivateChat = async (userId: number) => {
  const response = await fetch(`/api/private-chats/${userId}`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    throw new Error('Failed to delete private chat');
  }
  return response.json();
};

// 批量删除私聊
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

// 从NapCat同步私聊
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

  // 用于跟踪每个用户的操作状态
  const [loadingStates, setLoadingStates] = useState<{
    [key: string]: boolean;
  }>({});

  // 查询私聊数据
  const { 
    data: privateChatsData, 
    isLoading, 
    error, 
    refetch,
    isRefetching 
  } = useQuery({
    queryKey: ['private-chats', page, search, filters],
    queryFn: () => fetchPrivateChats({ page, limit, search, ...filters }),
  });

  // 批量更新mutation
  const batchUpdateMutation = useMutation({
    mutationFn: batchUpdatePrivateChats,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
      setSelectedUsers([]);
    },
  });

  // 同步私聊mutation
  const syncPrivateChatsMutation = useMutation({
    mutationFn: syncPrivateChatsFromNapCat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
    },
  });

  // 删除私聊mutation
  const deletePrivateChatMutation = useMutation({
    mutationFn: deletePrivateChat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
    },
  });

  // 批量删除mutation
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
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
    setPage(1);
  };

  const handleSelectAll = () => {
    if (selectedUsers.length === privateChatsData?.data.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(privateChatsData?.data.map(user => user.user_id) || []);
    }
  };

  const handleSelectUser = (userId: number) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleBatchUpdate = (field: string, value: boolean) => {
    if (selectedUsers.length === 0) return;
    
    batchUpdateMutation.mutate({
      user_ids: selectedUsers,
      [field]: value
    });
  };

  // 独立的用户操作函数
  const handleUserUpdate = async (userId: number, field: string, value: boolean) => {
    const loadingKey = `${userId}_${field}`;
    setLoadingStates(prev => ({ ...prev, [loadingKey]: true }));
    
    try {
      await updatePrivateChat(userId, { [field]: value });
      queryClient.invalidateQueries({ queryKey: ['private-chats'] });
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
          <User className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">私聊管理</h1>
            <p className="text-muted-foreground">
              管理bot的私聊用户，控制消息接收和自动回复
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => syncPrivateChatsMutation.mutate()}
            disabled={syncPrivateChatsMutation.isPending}
          >
            <Download className={`h-4 w-4 mr-2 ${syncPrivateChatsMutation.isPending ? 'animate-spin' : ''}`} />
            从QQ同步
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          {privateChatsData && (
            <Badge variant="secondary">
              {privateChatsData.pagination.total} 个用户
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
                placeholder="搜索用户名或QQ号..."
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
                  checked={filters.is_enabled === true}
                  onCheckedChange={(checked) => 
                    handleFilterChange('is_enabled', checked ? true : undefined)
                  }
                />
                <span>已启用私聊</span>
              </label>
              
              <label className="flex items-center space-x-2">
                <Checkbox 
                  checked={filters.auto_reply_enabled === true}
                  onCheckedChange={(checked) => 
                    handleFilterChange('auto_reply_enabled', checked ? true : undefined)
                  }
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
        </CardContent>
      </Card>

      {/* 批量操作 */}
      {selectedUsers.length > 0 && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-blue-700">
                已选择 {selectedUsers.length} 个用户
              </p>
              <div className="flex items-center gap-2">
                <Button 
                  size="sm" 
                  onClick={() => handleBatchUpdate('is_enabled', true)}
                  disabled={batchUpdateMutation.isPending}
                >
                  <PlayCircle className="h-4 w-4 mr-1" />
                  批量启用
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => handleBatchUpdate('is_enabled', false)}
                  disabled={batchUpdateMutation.isPending}
                >
                  <PauseCircle className="h-4 w-4 mr-1" />
                  批量禁用
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => handleBatchUpdate('auto_reply_enabled', true)}
                  disabled={batchUpdateMutation.isPending}
                >
                  开启自动回复
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => handleBatchUpdate('auto_reply_enabled', false)}
                  disabled={batchUpdateMutation.isPending}
                >
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
                  <Trash2 className="h-4 w-4 mr-1" />
                  批量删除
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 私聊列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            用户列表
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
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedUsers.length === privateChatsData?.data.length}
                        onCheckedChange={handleSelectAll}
                      />
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
                  {privateChatsData?.data.map((user) => (
                    <TableRow key={user.user_id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedUsers.includes(user.user_id)}
                          onCheckedChange={() => handleSelectUser(user.user_id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono">
                        {user.user_id}
                      </TableCell>
                      <TableCell>
                        {user.nickname || '未知用户'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.status === 'success' ? "default" : user.status === 'failed' ? "destructive" : "secondary"}>
                          {user.status === 'success' ? '✅ 正常' : user.status === 'failed' ? '❌ 失败' : '⏳ 其他'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>总数: {user.total_conversations}</div>
                        <div className="text-muted-foreground">
                          成功: {user.successful_replies} / 失败: {user.failed_replies}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.success_rate > 80 ? "default" : user.success_rate > 50 ? "secondary" : "destructive"}>
                          {user.success_rate}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.is_enabled ? "default" : "secondary"}>
                          {user.is_enabled ? "已启用" : "已禁用"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.auto_reply_enabled ? "default" : "outline"}>
                          {user.auto_reply_enabled ? "开启" : "关闭"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.last_conversation_time ? formatDate(user.last_conversation_time) : '无'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/private-chats/${user.user_id}`)}
                            title="查看详情"
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUserUpdate(user.user_id, 'is_enabled', !user.is_enabled)}
                            disabled={loadingStates[`${user.user_id}_is_enabled`] || false}
                            title={user.is_enabled ? "禁用用户" : "启用用户"}
                          >
                            {user.is_enabled ? <PauseCircle className="h-3 w-3" /> : <PlayCircle className="h-3 w-3" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUserUpdate(user.user_id, 'auto_reply_enabled', !user.auto_reply_enabled)}
                            disabled={loadingStates[`${user.user_id}_auto_reply_enabled`] || false}
                            title={user.auto_reply_enabled ? "关闭自动回复" : "开启自动回复"}
                          >
                            <MessageCircle className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (confirm(`确定要删除用户 ${user.nickname || user.user_id} 吗？此操作不可撤销。`)) {
                                deletePrivateChatMutation.mutate(user.user_id);
                              }
                            }}
                            disabled={deletePrivateChatMutation.isPending}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="删除用户"
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
          )}
          
          {/* 分页 */}
          {privateChatsData && privateChatsData.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                第 {page} 页，共 {privateChatsData.pagination.totalPages} 页
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
                  onClick={() => setPage(Math.min(privateChatsData.pagination.totalPages, page + 1))}
                  disabled={page === privateChatsData.pagination.totalPages}
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