import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  MessageCircle,
  Clock,
  Search,
  ExternalLink,
  RefreshCw,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useConversations } from '../hooks/useDashboardData';

export const ConversationsPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  // Debounce search term to avoid too many API calls
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setCurrentPage(1); // Reset to first page when searching
    }, 500);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Get conversations with search and pagination
  const conversationsQuery = useConversations({
    limit: itemsPerPage,
    page: currentPage,
    search: debouncedSearchTerm || undefined,
    sortBy: 'timestamp',
    sortOrder: 'desc',
  });

  const { data: conversationsData, isLoading: conversationsLoading, error: conversationsError } = conversationsQuery;

  const conversations = conversationsData?.data || [];
  const totalConversations = conversationsData?.total || 0;
  const totalPages = Math.ceil(totalConversations / itemsPerPage);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold">对话管理</h1>
        <p className="text-muted-foreground mt-1">
          查看和管理所有QQ机器人对话记录
        </p>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  placeholder="搜索对话内容、用户ID或消息ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 pr-4 py-2 text-sm border border-input rounded-md bg-background w-full"
                />
              </div>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-2" />
                筛选
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-3 py-2 text-sm border border-input rounded-md bg-background"
              >
                <option value={10}>10条/页</option>
                <option value={20}>20条/页</option>
                <option value={50}>50条/页</option>
                <option value={100}>100条/页</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => conversationsQuery.refetch()}
                disabled={conversationsLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${conversationsLoading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
              <Button size="sm" variant="outline">
                <Download className="h-4 w-4 mr-2" />
                导出
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{totalConversations}</div>
              <div className="text-sm text-muted-foreground">总对话数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{conversations.filter(c => c.ai_response).length}</div>
              <div className="text-sm text-muted-foreground">AI响应数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {conversations.length > 0 ? Math.round(conversations.reduce((sum, c) => sum + (c.response_time || 0), 0) / conversations.length) : 0}ms
              </div>
              <div className="text-sm text-muted-foreground">平均响应时间</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{new Set(conversations.map(c => c.user_id)).size}</div>
              <div className="text-sm text-muted-foreground">活跃用户</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conversations List */}
      <Card>
        <CardHeader>
          <CardTitle>
            对话记录
            {!conversationsLoading && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (第 {currentPage} 页，共 {totalPages} 页)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {conversationsError ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="mb-2">加载对话记录时出错</p>
              <p className="text-sm mb-4">错误信息: {conversationsError.message}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => conversationsQuery.refetch()}
              >
                重试
              </Button>
            </div>
          ) : conversationsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: itemsPerPage }).map((_, i) => (
                <div key={i} className="p-4 border rounded-lg">
                  <div className="animate-pulse">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-4 w-20 bg-muted rounded"></div>
                      <div className="h-4 w-24 bg-muted rounded"></div>
                      <div className="h-4 w-16 bg-muted rounded"></div>
                    </div>
                    <div className="h-4 w-full bg-muted rounded mb-2"></div>
                    <div className="h-4 w-full bg-muted rounded mb-2"></div>
                    <div className="h-4 w-3/4 bg-muted rounded mb-3"></div>
                    <div className="flex items-center gap-4">
                      <div className="h-3 w-32 bg-muted rounded"></div>
                      <div className="h-3 w-20 bg-muted rounded"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">
                {searchTerm ? '没有找到匹配的对话记录' : '暂无对话记录'}
              </h3>
              <p className="text-sm">
                {searchTerm
                  ? '尝试修改搜索条件或清空搜索框'
                  : '当有用户与机器人对话时，记录会显示在这里'
                }
              </p>
              {searchTerm && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setSearchTerm('')}
                >
                  清空搜索
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-3 mb-6">
                {conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className="p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-2">
                        {/* Header with badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">
                            用户 {conversation.user_id}
                          </span>
                          {conversation.model_name && (
                            <Badge variant="outline" className="text-xs">
                              {conversation.model_name}
                            </Badge>
                          )}
                          <Badge variant={conversation.ai_response ? "default" : "secondary"}>
                            {conversation.ai_response ? "已响应" : "未响应"}
                          </Badge>
                        </div>

                        {/* Messages */}
                        <div className="space-y-1">
                          <p className="text-sm">
                            <strong className="text-muted-foreground">问:</strong>
                            <span className="ml-1">{conversation.user_message}</span>
                          </p>
                          {conversation.ai_response && (
                            <p className="text-sm">
                              <strong className="text-muted-foreground">答:</strong>
                              <span className="ml-1 line-clamp-2">{conversation.ai_response}</span>
                            </p>
                          )}
                        </div>

                        {/* Metadata */}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>
                            {new Date(conversation.timestamp).toLocaleString('zh-CN', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit'
                            })}
                          </span>
                          {conversation.response_time && (
                            <span>响应时间: {conversation.response_time}ms</span>
                          )}
                          {conversation.id && (
                            <span>ID: {conversation.id.slice(-8)}</span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 ml-4">
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
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    显示第 {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, totalConversations)} 条，
                    共 {totalConversations} 条记录
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1 || conversationsLoading}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      上一页
                    </Button>

                    <div className="flex items-center gap-1">
                      {/* Show page numbers */}
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }

                        return (
                          <Button
                            key={pageNum}
                            variant={currentPage === pageNum ? "default" : "outline"}
                            size="sm"
                            className="w-8 h-8 p-0"
                            onClick={() => handlePageChange(pageNum)}
                            disabled={conversationsLoading}
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages || conversationsLoading}
                    >
                      下一页
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};