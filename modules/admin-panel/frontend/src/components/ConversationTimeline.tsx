import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Progress } from './ui/progress';
import { Separator } from './ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Textarea } from './ui/textarea';
import { 
  Clock, 
  MessageSquare, 
  Brain, 
  Send, 
  ChevronDown, 
  ChevronRight,
  Download,
  Share2,
  Eye,
  AlertCircle,
  CheckCircle,
  Loader2
} from 'lucide-react';
import { TimelineNode, ConversationTimelineData, STATUS_COLORS } from '../types';
import { cn } from '../lib/utils';

// 格式化JSON显示，处理换行符
const formatJSONForDisplay = (data: any): string => {
  if (data === null || data === undefined) {
    return '';
  }

  let jsonString = JSON.stringify(data, null, 2);

  // 处理转义的换行符，将\\n转换为实际换行
  jsonString = jsonString.replace(/\\n/g, '\n');

  // 处理其他常见的转义字符
  jsonString = jsonString.replace(/\\t/g, '\t');
  jsonString = jsonString.replace(/\\r/g, '\r');

  return jsonString;
};

// 自动调整高度的Textarea组件
const AutoResizeTextarea: React.FC<{
  value: string;
  className?: string;
  minHeight?: number;
  maxHeight?: number;
}> = ({ value, className, minHeight = 120, maxHeight = 400 }) => {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // 重置高度以获取准确的scrollHeight
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;

      // 应用高度限制
      const finalHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
      textarea.style.height = `${finalHeight}px`;
    }
  }, [value, minHeight, maxHeight]);

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      readOnly
      className={cn("font-mono text-xs resize-none overflow-y-auto", className)}
      style={{ minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }}
    />
  );
};

interface ConversationTimelineProps {
  data: ConversationTimelineData;
  isLoading?: boolean;
}

export const ConversationTimeline: React.FC<ConversationTimelineProps> = ({ 
  data, 
  isLoading = false 
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  
  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">加载时间线数据中...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            对话时间线 - ID: {data.conversation_id.slice(0, 8)}...
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-sm">
              总耗时: {data.timeline_summary.total_duration}ms
            </Badge>
            <Badge variant="outline" className="text-sm text-green-600">
              ¥{data.timeline_summary.total_cost}
            </Badge>
          </div>
        </CardTitle>
        <div className="text-sm text-muted-foreground">
          Token使用: {data.timeline_summary.total_tokens} | 成功率: {data.timeline_summary.success_rate}%
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          {/* 时间线节点 */}
          {data.timeline_nodes.map((node, index) => (
            <TimelineNodeComponent
              key={node.id}
              node={node}
              isExpanded={expandedNodes.has(node.id)}
              onToggle={() => toggleNode(node.id)}
              isLast={index === data.timeline_nodes.length - 1}
            />
          ))}
          
          <Separator className="my-6" />
          
          {/* 底部操作栏 */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              导出数据
            </Button>
            <Button variant="outline" size="sm">
              <Share2 className="h-4 w-4 mr-2" />
              分享链接
            </Button>
            <Button variant="outline" size="sm">
              <Eye className="h-4 w-4 mr-2" />
              查看原始对话
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// 时间线节点组件
const TimelineNodeComponent: React.FC<{
  node: TimelineNode;
  isExpanded: boolean;
  onToggle: () => void;
  isLast: boolean;
}> = ({ node, isExpanded, onToggle, isLast }) => {
  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'websocket_in': return <MessageSquare className="h-4 w-4" />;
      case 'llm_call': return <Brain className="h-4 w-4" />;
      case 'websocket_out': return <Send className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };
  
  const getStatusColor = (status: string) => {
    return STATUS_COLORS[status] || 'bg-gray-500';
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-3 w-3" />;
      case 'error': return <AlertCircle className="h-3 w-3" />;
      default: return <Loader2 className="h-3 w-3 animate-spin" />;
    }
  };

  return (
    <div className="relative">
      {/* 时间线连接线 */}
      {!isLast && (
        <div className="absolute left-4 top-8 w-0.5 h-full bg-border" />
      )}
      
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <div className="flex items-start gap-3">
          {/* 时间线节点圆点 */}
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-white relative z-10",
            getStatusColor(node.status)
          )}>
            {getNodeIcon(node.type)}
          </div>
          
          {/* 节点内容 */}
          <Card className="flex-1">
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-accent">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-medium">
                      {node.timestamp.toLocaleTimeString('zh-CN', { 
                        hour12: false 
                      })} {node.title}
                    </CardTitle>
                    {node.duration_ms !== undefined && node.duration_ms > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {node.duration_ms}ms
                      </Badge>
                    )}
                    {getStatusIcon(node.status)}
                  </div>
                  {isExpanded ? 
                    <ChevronDown className="h-4 w-4" /> : 
                    <ChevronRight className="h-4 w-4" />
                  }
                </div>
                
                {/* 节点摘要信息 */}
                <div className="text-sm text-muted-foreground">
                  {node.summary}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <CardContent className="pt-0">
                {node.type === 'llm_call' ? (
                  <LLMDetailTabs node={node} />
                ) : (
                  <MessageDetailTabs node={node} />
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </div>
      </Collapsible>
    </div>
  );
};

// LLM详情标签页
const LLMDetailTabs: React.FC<{ node: TimelineNode }> = ({ node }) => (
  <Tabs defaultValue="overview" className="w-full">
    <TabsList className="grid grid-cols-3 w-full">
      <TabsTrigger value="overview">概览</TabsTrigger>
      <TabsTrigger value="input">输入</TabsTrigger>
      <TabsTrigger value="output">输出</TabsTrigger>
    </TabsList>
    
    <TabsContent value="overview" className="space-y-3">
      <LLMOverview data={node.data} />
    </TabsContent>
    
    <TabsContent value="input" className="space-y-3">
      <AutoResizeTextarea
        value={formatJSONForDisplay(node.data.input)}
        minHeight={120}
        maxHeight={400}
      />
    </TabsContent>

    <TabsContent value="output" className="space-y-3">
      <AutoResizeTextarea
        value={formatJSONForDisplay(node.data.output)}
        minHeight={120}
        maxHeight={400}
      />
    </TabsContent>
  </Tabs>
);

// 消息详情标签页
const MessageDetailTabs: React.FC<{ node: TimelineNode }> = ({ node }) => (
  <div className="max-h-96 overflow-y-auto">
    <pre className="text-xs bg-muted p-3 rounded-md whitespace-pre-wrap">
      {formatJSONForDisplay(node.data.input || node.data.output)}
    </pre>
  </div>
);

// LLM概览组件
const LLMOverview: React.FC<{ data: any }> = ({ data }) => {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground">模型信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm">模型:</span>
            <Badge variant="secondary">{data.model_name}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Token使用:</span>
            <span className="text-sm font-mono">{data.prompt_tokens}/{data.completion_tokens}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">成本:</span>
            <span className="text-sm font-mono text-green-600">¥{data.cost}</span>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground">性能指标</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm">响应时间:</span>
            <Badge variant="outline">{data.response_time_ms}ms</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">状态:</span>
            <Badge variant={data.success ? "default" : "destructive"}>
              {data.success ? "成功" : "失败"}
            </Badge>
          </div>
          {data.confidence !== undefined && (
            <>
              <Progress value={data.confidence * 100} className="w-full" />
              <span className="text-xs text-muted-foreground">置信度: {Math.round(data.confidence * 100)}%</span>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};