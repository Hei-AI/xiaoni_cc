import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import {
  MessageSquare,
  RefreshCw,
  Zap,
  Bot,
  Wifi,
  Clock,
  CheckCircle
} from 'lucide-react';
import { formatDateOnly, formatTimeOnly } from '@/lib/utils';

// 时间线事件类型定义
interface TimelineEvent {
  event_type: string;
  event_name: string;
  event_phase: 'start' | 'end' | 'instant';
  event_time: string;
  duration_ms?: number;
  metadata?: any;
}

// 处理后的时间线事件
interface ProcessedTimelineEvent extends TimelineEvent {
  timestamp: number;
  displayTime: string;
  displayDate: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  title: string;
  description: string;
}

// 事件配置映射
const EVENT_CONFIG: Record<string, {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  title: string;
}> = {
  'processing/private_message_handling': {
    icon: <MessageSquare className="h-4 w-4" />,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    title: '消息接收'
  },
  'processing/context_building': {
    icon: <RefreshCw className="h-4 w-4" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    title: '上下文构建'
  },
  'processing/context_build_completed': {
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    title: '上下文完成'
  },
  'engine/decision_engine_v2': {
    icon: <Zap className="h-4 w-4" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
    title: '决策引擎'
  },
  'engine/decision_engine_completed': {
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-purple-500',
    bgColor: 'bg-purple-50',
    title: '决策完成'
  },
  'llm/gemini_api_call': {
    icon: <Bot className="h-4 w-4" />,
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
    title: 'LLM调用'
  },
  'llm/gemini_api_completed': {
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-orange-500',
    bgColor: 'bg-orange-50',
    title: 'LLM完成'
  },
  'websocket/message_received': {
    icon: <Wifi className="h-4 w-4" />,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    title: 'WebSocket'
  }
};

const DEFAULT_EVENT_CONFIG = {
  icon: <Clock className="h-4 w-4" />,
  color: 'text-gray-600',
  bgColor: 'bg-gray-100',
  title: '未知事件'
};

interface ProcessingTimelineProps {
  events: TimelineEvent[];
  traceId?: string;
}

export const ProcessingTimeline: React.FC<ProcessingTimelineProps> = ({
  events,
  traceId
}) => {
  // const [selectedEvent, setSelectedEvent] = useState<ProcessedTimelineEvent | null>(null);

  // 处理时间线数据
  const processedEvents: ProcessedTimelineEvent[] = events.map(event => {
    const eventKey = `${event.event_type}/${event.event_name}`;
    const config = EVENT_CONFIG[eventKey] || DEFAULT_EVENT_CONFIG;
    const eventTime = new Date(event.event_time);

    return {
      ...event,
      timestamp: eventTime.getTime(),
      displayTime: formatTimeOnly(eventTime, { withMilliseconds: true }),
      displayDate: formatDateOnly(eventTime),
      icon: config.icon,
      color: config.color,
      bgColor: config.bgColor,
      title: config.title,
      description: getEventDescription(event)
    };
  }).sort((a, b) => a.timestamp - b.timestamp);

  // 获取事件描述
  function getEventDescription(event: TimelineEvent): string {
    switch (event.event_phase) {
      case 'start':
        return '开始处理';
      case 'end':
        return `完成 (耗时: ${event.duration_ms}ms)`;
      case 'instant':
        return '瞬时事件';
      default:
        return event.event_phase || '未知阶段';
    }
  }

  // 获取阶段Badge样式
  const getPhaseBadgeVariant = (phase: string) => {
    switch (phase) {
      case 'start':
        return 'default';
      case 'end':
        return 'secondary';
      case 'instant':
        return 'outline';
      default:
        return 'outline';
    }
  };

  if (!events || events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            处理时间线
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            暂无时间线数据
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          处理时间线
          {traceId && (
            <Badge variant="outline" className="ml-2 font-mono text-xs">
              {traceId}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="w-full">
          <div className="relative">
            {/* 时间线容器 */}
            <div className="flex items-center gap-1 pb-4 min-w-max">
              {processedEvents.map((event, index) => (
                <React.Fragment key={`${event.event_type}-${event.event_name}-${index}`}>
                  {/* 事件节点 */}
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="ghost"
                        className="flex flex-col items-center gap-2 p-3 h-auto min-w-[120px] hover:bg-muted"
                        // onClick={() => setSelectedEvent(event)}
                      >
                        {/* 图标节点 */}
                        <div className={`
                          w-10 h-10 rounded-full flex items-center justify-center
                          ${event.bgColor} ${event.color}
                          border-2 border-current
                          transition-all duration-200 hover:scale-110
                        `}>
                          {event.icon}
                        </div>

                        {/* 事件标题 */}
                        <div className="text-xs font-medium text-center">
                          {event.title}
                        </div>

                        {/* 时间显示 */}
                        <div className="text-xs text-muted-foreground">
                          {event.displayTime}
                        </div>

                        {/* 阶段标识 */}
                        <Badge
                          variant={getPhaseBadgeVariant(event.event_phase)}
                          className="text-xs"
                        >
                          {event.event_phase}
                        </Badge>
                      </Button>
                    </DialogTrigger>

                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          {event.icon}
                          {event.title} - {event.description}
                        </DialogTitle>
                      </DialogHeader>

                      <div className="space-y-4">
                        {/* 基本信息 */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-sm font-medium">事件类型</label>
                            <div className="text-sm text-muted-foreground">
                              {event.event_type}
                            </div>
                          </div>
                          <div>
                            <label className="text-sm font-medium">事件名称</label>
                            <div className="text-sm text-muted-foreground">
                              {event.event_name}
                            </div>
                          </div>
                          <div>
                            <label className="text-sm font-medium">时间</label>
                            <div className="text-sm text-muted-foreground">
                              {event.displayDate} {event.displayTime}
                            </div>
                          </div>
                          <div>
                            <label className="text-sm font-medium">阶段</label>
                            <Badge variant={getPhaseBadgeVariant(event.event_phase)}>
                              {event.event_phase}
                            </Badge>
                          </div>
                        </div>

                        {/* 耗时信息 */}
                        {event.duration_ms && (
                          <div>
                            <label className="text-sm font-medium">耗时</label>
                            <div className="text-sm text-muted-foreground">
                              {event.duration_ms} 毫秒
                            </div>
                          </div>
                        )}

                        {/* 元数据 */}
                        {event.metadata && (
                          <div>
                            <label className="text-sm font-medium">元数据</label>
                            <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
                              {JSON.stringify(event.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>

                  {/* 连接线 */}
                  {index < processedEvents.length - 1 && (
                    <div className="flex-1 h-px bg-border min-w-[40px] mx-2" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </ScrollArea>

        {/* 统计信息 */}
        <Separator className="my-4" />
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {processedEvents.length} 个处理节点</span>
          {processedEvents.length > 1 && (
            <span>
              总耗时: {((processedEvents[processedEvents.length - 1].timestamp - processedEvents[0].timestamp) / 1000).toFixed(3)}s
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
