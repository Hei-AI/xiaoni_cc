import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import {
  MessageSquare,
  RefreshCw,
  Bot,
  Wifi,
  Clock,
  CheckCircle,
  Send,
  Brain,
  Users,
  Search,
  XCircle
} from 'lucide-react';
import { TimelineEvent, ConversationTimelineData, ENGINE_NAMES } from '../types';

// 统一事件接口
interface UnifiedEvent {
  id: string;
  timestamp: number;
  displayTime: string;
  displayDate: string;
  type: 'processing' | 'llm' | 'websocket';
  side: 'left' | 'right'; // 显示在时间线的左侧还是右侧
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  size: 'small' | 'medium' | 'large';
  status: 'success' | 'error' | 'pending';
  duration_ms?: number;
  metadata?: any;

  // LLM特有字段
  model_name?: string;
  agent_type?: string;
  tokens?: number;
  cost?: number;

  // Processing特有字段
  event_phase?: 'start' | 'end' | 'instant';
  event_type?: string;
  event_name?: string;
}

interface UnifiedTimelineProps {
  data: ConversationTimelineData;
}

// 事件配置
const EVENT_CONFIGS = {
  // Conversation Events (左侧) - 对话开始事件
  'conversation/conversation_started': {
    icon: <MessageSquare className="h-4 w-4" />,
    title: '对话开始',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    size: 'medium' as const,
    side: 'left' as const
  },
  'queue/group_message_consumed': {
    icon: <Users className="h-4 w-4" />,
    title: '群消息消费',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    size: 'medium' as const,
    side: 'left' as const
  },

  // Processing Events (左侧)
  'processing/private_message_handling': {
    icon: <MessageSquare className="h-4 w-4" />,
    title: '开始处理',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    size: 'medium' as const,
    side: 'left' as const
  },
  'processing/context_building': {
    icon: <RefreshCw className="h-4 w-4" />,
    title: '上下文构建',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    size: 'small' as const,
    side: 'left' as const
  },
  'processing/context_build_completed': {
    icon: <CheckCircle className="h-4 w-4" />,
    title: '上下文完成',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    size: 'small' as const,
    side: 'left' as const
  },
  'engine/decision_engine_v2': {
    icon: <Brain className="h-4 w-4" />,
    title: '决策引擎启动',
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
    size: 'medium' as const,
    side: 'left' as const
  },
  'engine/decision_engine_completed': {
    icon: <CheckCircle className="h-4 w-4" />,
    title: '决策完成',
    color: 'text-purple-500',
    bgColor: 'bg-purple-50',
    size: 'small' as const,
    side: 'left' as const
  },

  // LLM Events (右侧)
  'llm_user_relationship_analyzer': {
    icon: <Users className="h-4 w-4" />,
    title: '用户关系分析',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-100',
    size: 'large' as const,
    side: 'right' as const
  },
  'llm_attention_analyzer': {
    icon: <Brain className="h-4 w-4" />,
    title: '注意力分析',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-100',
    size: 'large' as const,
    side: 'right' as const
  },
  'llm_intent_analyzer': {
    icon: <Search className="h-4 w-4" />,
    title: '意图分析',
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
    size: 'large' as const,
    side: 'right' as const
  },
  'llm_chat_bot': {
    icon: <Bot className="h-4 w-4" />,
    title: '对话生成',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
    size: 'large' as const,
    side: 'right' as const
  },

  // Conversation Events - 响应发送和结束事件
  'conversation/response_sent': {
    icon: <Send className="h-4 w-4" />,
    title: '响应发送',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    size: 'medium' as const,
    side: 'right' as const
  },
  'conversation/conversation_ended': {
    icon: <XCircle className="h-4 w-4" />,
    title: '对话结束',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    size: 'medium' as const,
    side: 'right' as const
  },

  // LLM API调用事件 (MESSAGE_FLOW_API规范)
  'llm/api_call': {
    icon: <Brain className="h-4 w-4" />,
    title: 'LLM调用',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    size: 'medium' as const,
    side: 'left' as const
  },

  // Legacy WebSocket Events (保留兼容性)
  'websocket_in': {
    icon: <Wifi className="h-4 w-4" />,
    title: 'WebSocket接收',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    size: 'medium' as const,
    side: 'left' as const
  },
  'websocket_out': {
    icon: <Send className="h-4 w-4" />,
    title: 'WebSocket发送',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    size: 'medium' as const,
    side: 'right' as const
  }
};

const DEFAULT_CONFIG = {
  icon: <Clock className="h-4 w-4" />,
  title: '未知事件',
  color: 'text-gray-600',
  bgColor: 'bg-gray-100',
  size: 'small' as const,
  side: 'left' as const
};

export const UnifiedTimeline: React.FC<UnifiedTimelineProps> = ({
  data
}) => {
  const { timeline_events: timelineEvents, timeline_nodes: timelineNodes } = data;
  const traceId = data.trace_id || data.websocket_input?.message_id?.toString();

  // 获取消息内容信息
  const messageInput = data.message_input || data.websocket_input;
  const messageOutput = data.message_output || data.websocket_output;
  // 合并和处理所有事件
  const processEvents = (): UnifiedEvent[] => {
    const events: UnifiedEvent[] = [];

    // 根据现有数据构造完整的生命周期事件
    const baseTime = messageInput?.queued_at ? new Date(messageInput.queued_at).getTime() : Date.now();
    let eventSequence = 0;

    // 1. 队列消费开始事件
    if (messageInput) {
      const queueTime = new Date(messageInput.queued_at || baseTime);
      events.push({
        id: `queue_consume_${eventSequence++}`,
        timestamp: queueTime.getTime(),
        displayTime: queueTime.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) + '.' + queueTime.getMilliseconds().toString().padStart(3, '0'),
        displayDate: queueTime.toLocaleDateString('zh-CN'),
        type: 'processing',
        side: 'left',
        title: '消费队列数据',
        description: `来源: ${messageInput.source} | 优先级: ${messageInput.priority}`,
        icon: React.createElement(Users, { className: "h-4 w-4" }),
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
        size: 'medium',
        status: 'success',
        metadata: messageInput
      });
    }

    // 2. 消息原始输入事件（右侧）
    if (messageInput) {
      const inputTime = new Date((messageInput.queued_at || baseTime) + 100);
      events.push({
        id: `message_input_${eventSequence++}`,
        timestamp: inputTime.getTime(),
        displayTime: inputTime.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) + '.' + inputTime.getMilliseconds().toString().padStart(3, '0'),
        displayDate: inputTime.toLocaleDateString('zh-CN'),
        type: 'websocket',
        side: 'right',
        title: '消息原始输入',
        description: `用户${messageInput.user_id}: ${messageInput.message?.substring(0, 30) || ''}${messageInput.message && messageInput.message.length > 30 ? '...' : ''}`,
        icon: React.createElement(MessageSquare, { className: "h-4 w-4" }),
        color: 'text-green-600',
        bgColor: 'bg-green-100',
        size: 'medium',
        status: 'success',
        metadata: messageInput
      });
    }

    // 3. 基于LLM调用链补充业务事件
    if (data.llm_call_chain && data.llm_call_chain.length > 0) {
      data.llm_call_chain.forEach((call, callIndex) => {
        const startTime = new Date(call.input.timestamp);
        const endTime = new Date(call.output.timestamp);
        const agentType = call.agent_type;
        const agentName = ENGINE_NAMES[agentType] || agentType;

        // LLM调用开始事件（左侧）
        events.push({
          id: `llm_start_${callIndex}`,
          timestamp: startTime.getTime(),
          displayTime: startTime.toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }) + '.' + startTime.getMilliseconds().toString().padStart(3, '0'),
          displayDate: startTime.toLocaleDateString('zh-CN'),
          type: 'processing',
          side: 'left',
          title: `开始${agentName}调用`,
          description: `模型: ${call.input.model_name}`,
          icon: React.createElement(Brain, { className: "h-4 w-4" }),
          color: 'text-purple-600',
          bgColor: 'bg-purple-100',
          size: 'medium',
          status: 'success',
          metadata: call
        });

        // LLM原始输入事件（右侧）
        events.push({
          id: `llm_input_${callIndex}`,
          timestamp: startTime.getTime() + 50,
          displayTime: new Date(startTime.getTime() + 50).toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }) + '.' + new Date(startTime.getTime() + 50).getMilliseconds().toString().padStart(3, '0'),
          displayDate: startTime.toLocaleDateString('zh-CN'),
          type: 'llm',
          side: 'right',
          title: 'LLM原始输入',
          description: `Prompt: ${call.input.input_prompt?.substring(0, 40) || ''}...`,
          icon: React.createElement(MessageSquare, { className: "h-4 w-4" }),
          color: 'text-cyan-600',
          bgColor: 'bg-cyan-100',
          size: 'large',
          status: 'success',
          metadata: call.input,
          model_name: call.input.model_name,
          agent_type: agentType
        });

        // LLM原始输出事件（右侧）
        events.push({
          id: `llm_output_${callIndex}`,
          timestamp: endTime.getTime() - 50,
          displayTime: new Date(endTime.getTime() - 50).toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }) + '.' + new Date(endTime.getTime() - 50).getMilliseconds().toString().padStart(3, '0'),
          displayDate: endTime.toLocaleDateString('zh-CN'),
          type: 'llm',
          side: 'right',
          title: 'LLM原始输出',
          description: `响应: ${call.output.processed_response?.substring(0, 40) || ''}...`,
          icon: React.createElement(Bot, { className: "h-4 w-4" }),
          color: 'text-orange-600',
          bgColor: 'bg-orange-100',
          size: 'large',
          status: call.output.status === 'SUCCESS' ? 'success' : 'error',
          metadata: call.output,
          model_name: call.input.model_name,
          agent_type: agentType,
          tokens: call.output.token_usage?.total_tokens,
          cost: call.output.cost_estimate
        });

        // LLM调用完成事件（左侧）
        events.push({
          id: `llm_end_${callIndex}`,
          timestamp: endTime.getTime(),
          displayTime: endTime.toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }) + '.' + endTime.getMilliseconds().toString().padStart(3, '0'),
          displayDate: endTime.toLocaleDateString('zh-CN'),
          type: 'processing',
          side: 'left',
          title: `完成${agentName}调用`,
          description: `耗时: ${call.output.performance?.api_call_time_ms || 0}ms`,
          icon: React.createElement(CheckCircle, { className: "h-4 w-4" }),
          color: 'text-green-600',
          bgColor: 'bg-green-100',
          size: 'medium',
          status: call.output.status === 'SUCCESS' ? 'success' : 'error',
          duration_ms: call.output.performance?.api_call_time_ms,
          metadata: call
        });
      });
    }

    // 4. 响应发送事件
    if (messageOutput) {
      const outputTime = new Date(messageOutput.timestamp);
      events.push({
        id: `response_send_${eventSequence++}`,
        timestamp: outputTime.getTime(),
        displayTime: outputTime.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) + '.' + outputTime.getMilliseconds().toString().padStart(3, '0'),
        displayDate: outputTime.toLocaleDateString('zh-CN'),
        type: 'websocket',
        side: 'right',
        title: '响应发送',
        description: `发送状态: ${(messageOutput as any)?.delivery_status || '未知'}`,
        icon: React.createElement(Send, { className: "h-4 w-4" }),
        color: 'text-green-600',
        bgColor: 'bg-green-100',
        size: 'medium',
        status: 'success',
        metadata: messageOutput
      });
    }

    // 5. 处理原有的 timeline_events (处理事件)
    timelineEvents.forEach((event, index) => {
      const eventKey = `${event.event_type}/${event.event_name}`;
      const config = (EVENT_CONFIGS as Record<string, any>)[eventKey] || DEFAULT_CONFIG;
      const eventTime = new Date(event.event_time);

      events.push({
        id: `processing_${index}`,
        timestamp: eventTime.getTime(),
        displayTime: eventTime.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) + '.' + eventTime.getMilliseconds().toString().padStart(3, '0'),
        displayDate: eventTime.toLocaleDateString('zh-CN'),
        type: 'processing',
        side: config.side,
        title: config.title,
        description: getProcessingDescription(event),
        icon: config.icon,
        color: config.color,
        bgColor: config.bgColor,
        size: config.size,
        status: 'success',
        duration_ms: event.duration_ms,
        metadata: event.metadata,
        event_phase: event.event_phase,
        event_type: event.event_type,
        event_name: event.event_name
      });
    });

    // 6. 处理其他WebSocket事件（如果有的话）
    timelineNodes.forEach((node, index) => {
      // 跳过LLM调用，因为我们已经从llm_call_chain处理了
      if (node.type === 'llm_call') return;

      const eventTime = new Date(node.timestamp);
      const nodeKey = node.type;
      const config = (EVENT_CONFIGS as Record<string, any>)[nodeKey] || { ...DEFAULT_CONFIG, side: 'right' as const };

      events.push({
        id: `websocket_${index}`,
        timestamp: eventTime.getTime(),
        displayTime: eventTime.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) + '.' + eventTime.getMilliseconds().toString().padStart(3, '0'),
        displayDate: eventTime.toLocaleDateString('zh-CN'),
        type: 'websocket',
        side: config.side,
        title: node.title,
        description: node.summary || '',
        icon: config.icon,
        color: config.color,
        bgColor: config.bgColor,
        size: config.size,
        status: node.status === 'success' ? 'success' : 'error',
        duration_ms: node.duration_ms,
        metadata: node.data
      });
    });

    // 按时间排序
    return events.sort((a, b) => a.timestamp - b.timestamp);
  };

  function getProcessingDescription(event: TimelineEvent): string {
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


  // 获取节点大小样式
  const getNodeSize = (size: string) => {
    switch (size) {
      case 'small':
        return 'w-8 h-8';
      case 'medium':
        return 'w-10 h-10';
      case 'large':
        return 'w-12 h-12';
      default:
        return 'w-10 h-10';
    }
  };

  // 获取状态Badge样式
  const getStatusBadge = (event: UnifiedEvent) => {
    if (event.type === 'processing' && event.event_phase) {
      switch (event.event_phase) {
        case 'start':
          return <Badge variant="default" className="text-xs">开始</Badge>;
        case 'end':
          return <Badge variant="secondary" className="text-xs">完成</Badge>;
        case 'instant':
          return <Badge variant="outline" className="text-xs">瞬时</Badge>;
      }
    }

    if (event.status === 'error') {
      return <Badge variant="destructive" className="text-xs">错误</Badge>;
    }

    return <Badge variant="default" className="text-xs">成功</Badge>;
  };

  const unifiedEvents = processEvents();

  if (unifiedEvents.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            完整处理时间线
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
          完整处理时间线
          {traceId && (
            <Badge variant="outline" className="ml-2 font-mono text-xs">
              {traceId}
            </Badge>
          )}
        </CardTitle>
        <div className="text-sm text-muted-foreground mt-2">
          左侧：处理时间线 | 右侧：对话时间线
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* 垂直时间线容器 */}
          <div className="relative space-y-6">
            {/* 时间线主线 */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-border transform -translate-x-px"></div>

            {unifiedEvents.map((event) => (
              <div key={event.id} className="relative">
                {/* 时间标记 */}
                <div className="absolute left-1/2 transform -translate-x-1/2 -translate-y-1 bg-background px-2 text-xs text-muted-foreground border rounded">
                  {event.displayTime}
                </div>

                <div className="flex items-center pt-6">
                  {/* 左侧：处理时间线 */}
                  <div className="flex-1 pr-8">
                    {event.side === 'left' && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <div className="flex items-center justify-end cursor-pointer hover:bg-muted/50 rounded-lg p-3 transition-colors">
                            <div className="text-right mr-3">
                              <h4 className="font-medium text-sm">{event.title}</h4>
                              <p className="text-xs text-muted-foreground">{event.description}</p>
                              <div className="flex items-center justify-end gap-2 mt-1">
                                {getStatusBadge(event)}
                                {event.duration_ms && (
                                  <span className="text-xs text-muted-foreground">
                                    {event.duration_ms}ms
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className={`
                              ${getNodeSize(event.size)} rounded-full flex items-center justify-center
                              ${event.bgColor} ${event.color}
                              border-2 border-current
                              transition-all duration-200 hover:scale-110
                              shadow-sm
                            `}>
                              {event.icon}
                            </div>
                          </div>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                              {event.icon}
                              {event.title} - {event.description}
                            </DialogTitle>
                          </DialogHeader>
                          {/* 详细信息内容 */}
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="text-sm font-medium">事件类型</label>
                                <div className="text-sm text-muted-foreground">{event.type}</div>
                              </div>
                              <div>
                                <label className="text-sm font-medium">时间</label>
                                <div className="text-sm text-muted-foreground">
                                  {event.displayDate} {event.displayTime}
                                </div>
                              </div>
                            </div>
                            {event.metadata && (
                              <div>
                                <label className="text-sm font-medium">详细信息</label>
                                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-60 whitespace-pre-wrap break-words">
                                  {JSON.stringify(event.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>

                  {/* 中心节点 */}
                  <div className="relative z-10">
                    <div className="w-4 h-4 rounded-full bg-border border-2 border-background"></div>
                  </div>

                  {/* 右侧：对话时间线 */}
                  <div className="flex-1 pl-8">
                    {event.side === 'right' && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <div className="flex items-center cursor-pointer hover:bg-muted/50 rounded-lg p-3 transition-colors">
                            <div className={`
                              ${getNodeSize(event.size)} rounded-full flex items-center justify-center
                              ${event.bgColor} ${event.color}
                              border-2 border-current
                              transition-all duration-200 hover:scale-110
                              shadow-sm mr-3
                            `}>
                              {event.icon}
                            </div>
                            <div>
                              <h4 className="font-medium text-sm">{event.title}</h4>
                              <p className="text-xs text-muted-foreground">{event.description}</p>
                              <div className="flex items-center gap-2 mt-1">
                                {getStatusBadge(event)}
                                {event.type === 'llm' && (
                                  <>
                                    {event.model_name && (
                                      <span className="text-xs text-muted-foreground">
                                        {event.model_name}
                                      </span>
                                    )}
                                    {event.tokens && (
                                      <span className="text-xs text-muted-foreground">
                                        {event.tokens} tokens
                                      </span>
                                    )}
                                  </>
                                )}
                                {event.duration_ms && (
                                  <span className="text-xs text-muted-foreground">
                                    {event.duration_ms}ms
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </DialogTrigger>
                        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                              {event.icon}
                              {event.title} - {event.description}
                            </DialogTitle>
                          </DialogHeader>
                          {/* 详细信息内容 */}
                          <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="text-sm font-medium">事件类型</label>
                                <div className="text-sm text-muted-foreground">{event.type}</div>
                              </div>
                              <div>
                                <label className="text-sm font-medium">时间</label>
                                <div className="text-sm text-muted-foreground">
                                  {event.displayDate} {event.displayTime}
                                </div>
                              </div>
                            </div>

                            {/* LLM调用详细信息 */}
                            {event.type === 'llm' && event.metadata && (
                              <div className="space-y-6">
                                {/* 基础信息 */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                  {event.model_name && (
                                    <div>
                                      <label className="text-sm font-medium">模型</label>
                                      <div className="text-sm text-muted-foreground">{event.model_name}</div>
                                    </div>
                                  )}
                                  {event.agent_type && (
                                    <div>
                                      <label className="text-sm font-medium">Agent类型</label>
                                      <div className="text-sm text-muted-foreground">{event.agent_type}</div>
                                    </div>
                                  )}
                                  {event.tokens && (
                                    <div>
                                      <label className="text-sm font-medium">Token消耗</label>
                                      <div className="text-sm text-muted-foreground">{event.tokens} tokens</div>
                                    </div>
                                  )}
                                  {event.cost && (
                                    <div>
                                      <label className="text-sm font-medium">成本估算</label>
                                      <div className="text-sm text-muted-foreground">${event.cost}</div>
                                    </div>
                                  )}
                                </div>

                                {/* Prompt详情 */}
                                {event.metadata.input?.input_prompt && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">Prompt内容</label>
                                    <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
                                      <pre className="text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
                                        {event.metadata.input.input_prompt}
                                      </pre>
                                    </div>
                                  </div>
                                )}

                                {/* 模型配置 */}
                                {event.metadata.input?.model_config && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">模型配置</label>
                                    <div className="bg-gray-50 dark:bg-gray-950 p-4 rounded-lg">
                                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                        {Object.entries(event.metadata.input.model_config).map(([key, value]) => (
                                          <div key={key}>
                                            <span className="font-medium">{key}:</span>
                                            <span className="ml-2 text-muted-foreground">{String(value)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* AI回复 */}
                                {event.metadata.output?.processed_response && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">AI回复内容</label>
                                    <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
                                      <div className="text-sm max-h-40 overflow-y-auto">
                                        {event.metadata.output.processed_response}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Token使用详情 */}
                                {event.metadata.output?.token_usage && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">Token使用详情</label>
                                    <div className="bg-orange-50 dark:bg-orange-950 p-4 rounded-lg">
                                      <div className="grid grid-cols-3 gap-4 text-sm">
                                        <div>
                                          <span className="font-medium">输入:</span>
                                          <span className="ml-2 text-muted-foreground">
                                            {event.metadata.output.token_usage.input_tokens} tokens
                                          </span>
                                        </div>
                                        <div>
                                          <span className="font-medium">输出:</span>
                                          <span className="ml-2 text-muted-foreground">
                                            {event.metadata.output.token_usage.output_tokens} tokens
                                          </span>
                                        </div>
                                        <div>
                                          <span className="font-medium">总计:</span>
                                          <span className="ml-2 text-muted-foreground">
                                            {event.metadata.output.token_usage.total_tokens} tokens
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* 性能指标 */}
                                {event.metadata.output?.performance && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">性能指标</label>
                                    <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded-lg">
                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                        {Object.entries(event.metadata.output.performance).map(([key, value]) => (
                                          <div key={key}>
                                            <span className="font-medium">{key}:</span>
                                            <span className="ml-2 text-muted-foreground">
                                              {typeof value === 'number' ? `${value}ms` : String(value)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* 原始响应 */}
                                {event.metadata.output?.raw_response && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">原始API响应</label>
                                    <div className="bg-gray-50 dark:bg-gray-950 p-4 rounded-lg">
                                      <pre className="text-xs overflow-auto max-h-40 whitespace-pre-wrap break-words">
                                        {typeof event.metadata.output.raw_response === 'string'
                                          ? event.metadata.output.raw_response
                                          : JSON.stringify(event.metadata.output.raw_response, null, 2)}
                                      </pre>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 处理事件详细信息 */}
                            {event.type === 'processing' && event.metadata && (
                              <div>
                                <label className="text-sm font-medium mb-2 block">处理事件详情</label>
                                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-40 whitespace-pre-wrap break-words">
                                  {JSON.stringify(event.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 统计信息 */}
        <Separator className="my-6" />
        <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
          <div>
            <h5 className="font-medium text-foreground mb-2">处理事件 (左侧)</h5>
            <div className="space-y-1">
              <div>总数: {unifiedEvents.filter(e => e.side === 'left').length}</div>
              <div>处理: {unifiedEvents.filter(e => e.type === 'processing').length}</div>
              <div>WebSocket: {unifiedEvents.filter(e => e.type === 'websocket' && e.side === 'left').length}</div>
            </div>
          </div>
          <div>
            <h5 className="font-medium text-foreground mb-2">对话事件 (右侧)</h5>
            <div className="space-y-1">
              <div>总数: {unifiedEvents.filter(e => e.side === 'right').length}</div>
              <div>LLM调用: {unifiedEvents.filter(e => e.type === 'llm').length}</div>
              <div>WebSocket: {unifiedEvents.filter(e => e.type === 'websocket' && e.side === 'right').length}</div>
            </div>
          </div>
        </div>

        {unifiedEvents.length > 1 && (
          <div className="text-center text-sm text-muted-foreground mt-4">
            总耗时: {((unifiedEvents[unifiedEvents.length - 1].timestamp - unifiedEvents[0].timestamp) / 1000).toFixed(3)}s
          </div>
        )}
      </CardContent>
    </Card>
  );
};