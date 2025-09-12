import React from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ConversationTimeline } from '../components/ConversationTimeline';
import { useConversationTimeline } from '../hooks/useConversationTimeline';
import { 
  ArrowLeft, 
  RefreshCw, 
  AlertCircle,
  Loader2
} from 'lucide-react';

export const ConversationTimelinePage: React.FC = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  
  if (!conversationId) {
    return <Navigate to="/dashboard" replace />;
  }
  
  const { 
    data: timelineData, 
    isLoading, 
    error, 
    refetch,
    isRefetching 
  } = useConversationTimeline(conversationId);

  const handleRefresh = () => {
    refetch();
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">对话时间线分析</h1>
            <p className="text-muted-foreground">
              对话ID: {conversationId}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          {timelineData && (
            <Badge variant="secondary">
              {timelineData.timeline_nodes.length} 个节点
            </Badge>
          )}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              加载失败
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-600 text-sm">
              {error instanceof Error ? error.message : '获取对话时间线数据时发生错误'}
            </p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-3"
              onClick={handleRefresh}
            >
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && !timelineData && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                正在加载对话时间线...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline Content */}
      {timelineData && (
        <ConversationTimeline 
          data={timelineData}
          isLoading={isRefetching}
        />
      )}

      {/* Development Note */}
      {process.env.NODE_ENV === 'development' && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <p className="text-xs text-blue-600">
              开发模式: 数据每30秒自动刷新 | API端点: /api/debug/conversation/{conversationId}/llm-flow
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};