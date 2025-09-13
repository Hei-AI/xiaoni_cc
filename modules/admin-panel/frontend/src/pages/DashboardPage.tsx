import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { 
  MessageCircle, 
  Clock, 
  TrendingUp, 
  Activity,
  Search,
  ExternalLink,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { useDashboardStats, useConversations, useTokenStats } from '../hooks/useDashboardData';

export const DashboardPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);

  // Debounce search term to avoid too many API calls
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setCurrentPage(1); // Reset to first page when searching
    }, 500);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch data using our custom hooks
  const { data: dashboardStats, isLoading: statsLoading } = useDashboardStats();
  const { data: tokenStats, isLoading: tokenStatsLoading } = useTokenStats();
  
  // Get conversations with search and pagination
  const conversationsQuery = useConversations({
    limit: showAll ? 50 : 10,
    page: currentPage,
    search: debouncedSearchTerm || undefined,
    sortBy: 'timestamp',
    sortOrder: 'desc',
  });

  const { data: conversationsData, isLoading: conversationsLoading, error: conversationsError } = conversationsQuery;

  const conversations = conversationsData?.data || [];
  const totalConversations = conversationsData?.total || 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold">管理仪表盘</h1>
        <p className="text-muted-foreground mt-1">
          QQ智能机器人运行状态和数据概览
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              总消息数
            </CardTitle>
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <div className="text-2xl font-bold">{dashboardStats?.totalMessages || 0}</div>
                <p className="text-xs text-muted-foreground">
                  AI响应 {dashboardStats?.aiResponses || 0} 次
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              活跃群组
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <div className="text-2xl font-bold">{dashboardStats?.activeGroups || 0}</div>
                <p className="text-xs text-muted-foreground">
                  系统运行时间: {dashboardStats?.uptime || 'N/A'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              系统健康度
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <div className="text-2xl font-bold capitalize">{dashboardStats?.systemHealth || 'unknown'}</div>
                <p className="text-xs text-muted-foreground">
                  实时状态监控
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Token状态
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {tokenStatsLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <div className="text-2xl font-bold">{tokenStats?.activeTokens || 'N/A'}</div>
                <p className="text-xs text-muted-foreground">
                  今日成本: ¥{tokenStats?.todayCost || '0.00'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Conversations */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              最近对话 
              {!conversationsLoading && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({totalConversations} 条记录)
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  placeholder="搜索对话或ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 pr-4 py-2 text-sm border border-input rounded-md bg-background"
                />
              </div>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => setShowAll(!showAll)}
                disabled={conversationsLoading}
              >
                {conversationsLoading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                {showAll ? '收起' : '查看全部'}
              </Button>
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => conversationsQuery.refetch()}
                disabled={conversationsLoading}
              >
                <RefreshCw className={`h-3 w-3 ${conversationsLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {conversationsError ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>加载对话记录时出错</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2"
                onClick={() => conversationsQuery.refetch()}
              >
                重试
              </Button>
            </div>
          ) : conversationsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-3 border rounded-lg">
                  <div className="animate-pulse">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-4 w-16 bg-muted rounded"></div>
                      <div className="h-4 w-20 bg-muted rounded"></div>
                    </div>
                    <div className="h-4 w-full bg-muted rounded mb-1"></div>
                    <div className="h-4 w-3/4 bg-muted rounded"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{searchTerm ? '没有找到匹配的对话记录' : '暂无对话记录'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        用户 {conversation.user_id}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {conversation.model_name}
                      </Badge>
                      <Badge variant="default">
                        完成
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-1">
                      <strong>问:</strong> {conversation.user_message}
                    </p>
                    <p className="text-sm text-muted-foreground line-clamp-1">
                      <strong>答:</strong> {conversation.ai_response}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        {new Date(conversation.timestamp).toLocaleString('zh-CN')}
                      </span>
                      <span>
                        响应时间: {conversation.response_time}ms
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link to={`/conversation/${conversation.id}/timeline`}>
                      <Button size="sm" variant="outline">
                        <Clock className="h-3 w-3 mr-1" />
                        时间线
                      </Button>
                    </Link>
                    <Button size="sm" variant="ghost">
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              
              {/* Pagination info */}
              {showAll && totalConversations > conversations.length && (
                <div className="text-center pt-4">
                  <p className="text-sm text-muted-foreground">
                    显示 {conversations.length} / {totalConversations} 条记录
                  </p>
                  {totalConversations > 50 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-2"
                      onClick={() => {
                        setCurrentPage(currentPage + 1);
                      }}
                    >
                      加载更多
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>快速操作</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button variant="outline" className="justify-start">
              <MessageCircle className="h-4 w-4 mr-2" />
              发送测试消息
            </Button>
            <Button variant="outline" className="justify-start">
              <Activity className="h-4 w-4 mr-2" />
              查看系统状态
            </Button>
            <Button variant="outline" className="justify-start">
              <TrendingUp className="h-4 w-4 mr-2" />
              Token健康检查
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};