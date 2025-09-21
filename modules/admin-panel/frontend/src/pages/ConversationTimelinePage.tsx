import React, { useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { UnifiedTimeline } from '../components/UnifiedTimeline';
import { DebugPromptModal } from '../components/DebugPromptModal';
import { useConversationTimeline } from '../hooks/useConversationTimeline';
import { 
  ArrowLeft, 
  RefreshCw, 
  AlertCircle,
  Loader2,
  Play,
  Pause,
  Bug
} from 'lucide-react';

export const ConversationTimelinePage: React.FC = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  
  if (!conversationId) {
    return <Navigate to="/dashboard" replace />;
  }
  
  const { 
    data: timelineData, 
    isLoading, 
    error, 
    refetch,
    isRefetching 
  } = useConversationTimeline(conversationId, autoRefreshEnabled);

  const handleRefresh = () => {
    refetch();
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回
          </Button>
          <div>
            <h1 className="text-2xl font-bold">对话时间线分析</h1>
            <p className="text-muted-foreground">
              对话ID: {conversationId}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant={autoRefreshEnabled ? "default" : "outline"}
            size="sm" 
            onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
            className={autoRefreshEnabled ? "bg-green-600 hover:bg-green-700" : ""}
          >
            {autoRefreshEnabled ? (
              <>
                <Pause className="h-4 w-4 mr-2" />
                停止自动刷新
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                开启自动刷新
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            手动刷新
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsDebugModalOpen(true)}
            className="bg-purple-50 hover:bg-purple-100 border-purple-200"
          >
            <Bug className="h-4 w-4 mr-2" />
            调试Prompt
          </Button>
          {timelineData && (
            <Badge variant="secondary">
              {timelineData.timeline_nodes.length + timelineData.timeline_events.length} 个事件
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

      {/* Unified Timeline Content */}
      {timelineData && (
        <UnifiedTimeline
          data={timelineData}
        />
      )}

      {/* Auto-refresh Status */}
      <Card className={autoRefreshEnabled ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <p className={`text-xs ${autoRefreshEnabled ? 'text-green-600' : 'text-gray-600'}`}>
              {autoRefreshEnabled ? (
                <>
                  🔄 自动刷新已开启 - 每30秒更新一次
                </>
              ) : (
                <>
                  ⏸️ 自动刷新已暂停 - 仅手动刷新
                </>
              )}
            </p>
            {import.meta.env.DEV && (
              <p className="text-xs text-blue-600">
                开发模式 | API: /api/debug/conversation/{conversationId}/llm-flow
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Debug Prompt Modal */}
      <DebugPromptModal
        isOpen={isDebugModalOpen}
        onClose={() => setIsDebugModalOpen(false)}
        conversationId={conversationId}
      />
    </div>
  );
};