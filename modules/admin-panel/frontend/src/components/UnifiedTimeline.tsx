import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
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
  XCircle,
  Play
} from 'lucide-react';
import { TimelineEvent, ConversationTimelineData, ENGINE_NAMES } from '../types';
import { DebugPromptModal } from './DebugPromptModal';
import { usePromptTemplates, separatePromptContent } from '../hooks/usePromptTemplates';

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
    title: '私聊消息处理',
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

  // WebSocket Events
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

const stringifyPayload = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const extractTextPreview = (value: unknown): string => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => extractTextPreview(item)).filter(Boolean).join('\n');
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  const record = value as Record<string, any>;
  if (typeof record.output_text === 'string') {
    return record.output_text;
  }
  if (typeof record.text === 'string') {
    return record.text;
  }
  if (typeof record.instructions === 'string') {
    return record.instructions;
  }
  if (Array.isArray(record.content)) {
    return extractTextPreview(record.content);
  }
  if (Array.isArray(record.input)) {
    return extractTextPreview(record.input);
  }

  return '';
};

export const UnifiedTimeline: React.FC<UnifiedTimelineProps> = ({
  data
}) => {
  const { timeline_events: timelineEvents, timeline_nodes: timelineNodes } = data;
  const traceId = data.trace_id || data.websocket_input?.message_id?.toString();

  // 🔥 获取Prompt模板数据
  const { data: promptTemplates = [] } = usePromptTemplates();

  // 🔥 重放调试状态管理
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [debugData, setDebugData] = useState<{
    systemPrompt: string;
    userInput: string;
    model: string;
    parameters: string;
    conversationId: string;
  } | null>(null);

  // 获取消息内容信息
  const messageInput = data.message_input;
  const messageOutput = data.message_output;

  // 🔥 处理LLM重放调试
  const handleLLMReplay = (event: UnifiedEvent) => {
    if (event.type !== 'llm' || !event.metadata) return;

    const promptTemplate = event.metadata.input?.prompt_template || 'enhanced_chat';

    // 🔥 分离System Prompt和User Input
    const mixedPrompt = event.metadata.input?.canonical_request
      || event.metadata.input?.wire_request
      || '';
    const { systemPrompt, userInput } = separatePromptContent(
      promptTemplates,
      promptTemplate,
      mixedPrompt
    );

    const model = event.model_name || 'gemini-2.5-flash';
    const parameters = stringifyPayload(event.metadata.input?.canonical_request || event.metadata.input?.wire_request || {});
    const conversationId = data.conversation_id || '';

    console.log('🔥 LLM Replay Debug Data (Separated):', {
      promptTemplate,
      systemPrompt: systemPrompt.substring(0, 100) + '...',
      userInput: userInput.substring(0, 100) + '...',
      model,
      parameters,
      conversationId
    });

    setDebugData({
      systemPrompt,
      userInput,
      model,
      parameters,
      conversationId
    });
    setDebugModalOpen(true);
  };
  // 合并和处理所有事件
  const processEvents = (): UnifiedEvent[] => {
    const events: UnifiedEvent[] = [];

    // 🔥 时间戳验证和修复逻辑
    const validateAndFixTimestamps = () => {
      // 安全解析时间戳，避免Invalid Date
      const safeParseDate = (dateStr: string | undefined | null): number => {
        if (!dateStr) return Date.now();
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
      };

      const inputTime = safeParseDate(messageInput?.queued_at);
      const processedTime = safeParseDate(messageInput?.processed_at);
      const outputTime = safeParseDate(messageOutput?.timestamp);

      // 🔥 修复逻辑时间顺序：确保队列消费 → 处理 → 输出的合理顺序
      let fixedInputTime = inputTime;
      let fixedProcessedTime = processedTime;
      let fixedOutputTime = outputTime;

      // 如果处理时间早于输入时间，修复为输入时间 + 100ms
      if (processedTime <= inputTime) {
        console.warn('🔥 TIMELINE FIX: processed_at 早于或等于 queued_at，已修复时间顺序');
        fixedProcessedTime = inputTime + 100;
      }

      // 如果输出时间早于处理时间，修复为处理时间 + 1000ms
      if (outputTime <= fixedProcessedTime) {
        console.warn('🔥 TIMELINE FIX: output timestamp 早于 processed_at，已修复时间顺序');
        fixedOutputTime = fixedProcessedTime + 1000;
      }

      console.log('🔥 TIMELINE DEBUG:', {
        originalInput: messageInput?.queued_at,
        originalProcessed: messageInput?.processed_at,
        originalOutput: messageOutput?.timestamp,
        fixedInput: new Date(fixedInputTime).toISOString(),
        fixedProcessed: new Date(fixedProcessedTime).toISOString(),
        fixedOutput: new Date(fixedOutputTime).toISOString()
      });

      return {
        baseTime: fixedInputTime,
        processedTime: fixedProcessedTime,
        outputTime: fixedOutputTime
      };
    };

    const timeStamps = validateAndFixTimestamps();
    const baseTime = timeStamps.baseTime;
    let eventSequence = 0;
    let currentTime = baseTime; // 维护当前逻辑时间，确保递增顺序

    // 工具函数：格式化时间显示
    const formatTimeDisplay = (timestamp: number) => {
      const date = new Date(timestamp);
      return {
        displayTime: date.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }) + '.' + date.getMilliseconds().toString().padStart(3, '0'),
        displayDate: date.toLocaleDateString('zh-CN')
      };
    };

    // 1. 队列消费开始事件
    if (messageInput) {
      const queueTime = currentTime; // 使用修复后的baseTime
      currentTime += 50; // 递增50ms，确保顺序

      const timeDisplay = formatTimeDisplay(queueTime);
      events.push({
        id: `queue_consume_${eventSequence++}`,
        timestamp: queueTime,
        displayTime: timeDisplay.displayTime,
        displayDate: timeDisplay.displayDate,
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
      const inputTime = currentTime;
      currentTime += 50; // 递增50ms

      const timeDisplay = formatTimeDisplay(inputTime);
      events.push({
        id: `message_input_${eventSequence++}`,
        timestamp: inputTime,
        displayTime: timeDisplay.displayTime,
        displayDate: timeDisplay.displayDate,
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

    // 3. 基于LLM调用链补充业务事件（按逻辑顺序重新生成时间戳）
    if (data.llm_call_chain && data.llm_call_chain.length > 0) {
      data.llm_call_chain.forEach((call, callIndex) => {
        const agentType = call.agent_type;
        const agentName = ENGINE_NAMES[agentType] || agentType;

        // 🔥 使用逻辑时间顺序，而不是原始时间戳
        const llmStartTime = currentTime;
        currentTime += 100; // 每个LLM调用间隔100ms

        const llmInputTime = currentTime;
        currentTime += 50;

        // 从原始性能数据计算实际处理时长
        const processingDuration = call.output.performance?.api_call_time_ms || 6774;
        currentTime += processingDuration; // 加上实际处理时长

        const llmOutputTime = currentTime;
        currentTime += 50;

        const llmEndTime = currentTime;
        currentTime += 100;

        // LLM调用开始事件（左侧）
        const startTimeDisplay = formatTimeDisplay(llmStartTime);
        events.push({
          id: `llm_start_${callIndex}`,
          timestamp: llmStartTime,
          displayTime: startTimeDisplay.displayTime,
          displayDate: startTimeDisplay.displayDate,
          type: 'processing',
          side: 'left',
          title: `开始${agentName}调用`,
          description: `模型: ${call.input.model_name}`,
          icon: React.createElement(Brain, { className: "h-4 w-4" }),
          color: 'text-purple-600',
          bgColor: 'bg-purple-100',
          size: 'medium',
          status: 'success',
          metadata: { ...call, _phase: 'start', _start_time: llmStartTime }
        });

        // LLM原始输入事件（右侧）
        const inputTimeDisplay = formatTimeDisplay(llmInputTime);
        const canonicalRequest = call.input?.canonical_request;
        const wireRequest = call.input?.wire_request;
        const inputPrompt = extractTextPreview(canonicalRequest) || extractTextPreview(wireRequest) || '';
        events.push({
          id: `llm_input_${callIndex}`,
          timestamp: llmInputTime,
          displayTime: inputTimeDisplay.displayTime,
          displayDate: inputTimeDisplay.displayDate,
          type: 'llm',
          side: 'right',
          title: 'LLM原始输入',
          description: inputPrompt ? `Prompt: ${inputPrompt.substring(0, 40)}...` : '暂无输入内容',
          icon: React.createElement(MessageSquare, { className: "h-4 w-4" }),
          color: 'text-cyan-600',
          bgColor: 'bg-cyan-100',
          size: 'large',
          status: 'success',
          metadata: {
            _phase: 'input',
            input: call.input || {},
            output: call.output || {}
          },
          model_name: call.input.model_name,
          agent_type: agentType
        });

        // LLM原始输出事件（右侧）
        const outputTimeDisplay = formatTimeDisplay(llmOutputTime);
        const outputResponse = call.output?.processed_response
          || extractTextPreview(call.output?.canonical_response)
          || extractTextPreview(call.output?.wire_response)
          || '';
        events.push({
          id: `llm_output_${callIndex}`,
          timestamp: llmOutputTime,
          displayTime: outputTimeDisplay.displayTime,
          displayDate: outputTimeDisplay.displayDate,
          type: 'llm',
          side: 'right',
          title: 'LLM原始输出',
          description: outputResponse ? `响应: ${outputResponse.substring(0, 40)}...` : '暂无输出内容',
          icon: React.createElement(Bot, { className: "h-4 w-4" }),
          color: 'text-orange-600',
          bgColor: 'bg-orange-100',
          size: 'large',
          status: call.output.status === 'SUCCESS' ? 'success' : 'error',
          metadata: {
            _phase: 'output',
            input: call.input || {},
            output: call.output || {}
          },
          model_name: call.input.model_name,
          agent_type: agentType,
          tokens: call.output.token_usage?.total_tokens,
          cost: call.output.cost_estimate
        });

        // LLM调用完成事件（左侧）
        const endTimeDisplay = formatTimeDisplay(llmEndTime);
        events.push({
          id: `llm_end_${callIndex}`,
          timestamp: llmEndTime,
          displayTime: endTimeDisplay.displayTime,
          displayDate: endTimeDisplay.displayDate,
          type: 'processing',
          side: 'left',
          title: `完成${agentName}调用`,
          description: `耗时: ${processingDuration}ms`,
          icon: React.createElement(CheckCircle, { className: "h-4 w-4" }),
          color: 'text-green-600',
          bgColor: 'bg-green-100',
          size: 'medium',
          status: call.output.status === 'SUCCESS' ? 'success' : 'error',
          duration_ms: processingDuration,
          metadata: { ...call, _phase: 'complete', _end_time: llmEndTime, _duration: processingDuration }
        });
      });
    }

    // 4. 响应发送事件（使用逻辑时间顺序）
    if (messageOutput) {
      const outputTime = currentTime; // 使用逻辑顺序时间，确保在所有处理事件之后
      currentTime += 100;

      const timeDisplay = formatTimeDisplay(outputTime);
      events.push({
        id: `response_send_${eventSequence++}`,
        timestamp: outputTime,
        displayTime: timeDisplay.displayTime,
        displayDate: timeDisplay.displayDate,
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

    // 5. 处理原有的 timeline_events (处理事件) - 🔥 重要：不重复添加，避免时间混乱
    // 注意：由于我们已经从llm_call_chain重新生成了LLM相关事件，这里跳过可能重复的处理事件
    timelineEvents.forEach((event, index) => {
      // 🔥 跳过LLM API调用事件，避免重复（已在第3步处理）
      if (event.event_type === 'llm' && event.event_name === 'api_call') {
        console.log('🔥 TIMELINE SKIP: 跳过重复的LLM API调用事件', event);
        return;
      }

      const eventKey = `${event.event_type}/${event.event_name}`;
      const config = (EVENT_CONFIGS as Record<string, any>)[eventKey] || DEFAULT_CONFIG;

      // 🔥 使用逻辑时间顺序，在已处理事件之后添加
      const eventTime = currentTime;
      currentTime += 50;

      const timeDisplay = formatTimeDisplay(eventTime);
      events.push({
        id: `processing_${index}`,
        timestamp: eventTime,
        displayTime: timeDisplay.displayTime,
        displayDate: timeDisplay.displayDate,
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

    // 6. 处理其他WebSocket事件（如果有的话）- 🔥 跳过已处理的LLM调用
    timelineNodes.forEach((node, index) => {
      // 跳过LLM调用，因为我们已经从llm_call_chain处理了
      if (node.type === 'llm_call') {
        console.log('🔥 TIMELINE SKIP: 跳过重复的LLM调用节点', node);
        return;
      }

      const nodeKey = node.type;
      const config = (EVENT_CONFIGS as Record<string, any>)[nodeKey] || { ...DEFAULT_CONFIG, side: 'right' as const };

      // 🔥 使用逻辑时间顺序
      const eventTime = currentTime;
      currentTime += 50;

      const timeDisplay = formatTimeDisplay(eventTime);
      events.push({
        id: `websocket_${index}`,
        timestamp: eventTime,
        displayTime: timeDisplay.displayTime,
        displayDate: timeDisplay.displayDate,
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

    // 🔥 最终排序：由于使用了逻辑时间顺序生成，应该已经是正确顺序
    const sortedEvents = events.sort((a, b) => {
      // 主要按时间戳排序（现在应该是正确的逻辑顺序）
      const timeDiff = a.timestamp - b.timestamp;
      if (timeDiff !== 0) return timeDiff;

      // 时间戳相同时的稳定排序：左侧事件优先
      if (a.side !== b.side) {
        return a.side === 'left' ? -1 : 1;
      }

      // 同一侧同时间的事件按类型排序：processing -> llm -> websocket
      const typeOrder = { processing: 1, llm: 2, websocket: 3 };
      return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
    });

    // 🔥 调试信息：输出修复后的时间线顺序
    console.log('🔥 TIMELINE FINAL:', {
      totalEvents: sortedEvents.length,
      timeRange: sortedEvents.length > 0 ? {
        start: new Date(sortedEvents[0].timestamp).toISOString(),
        end: new Date(sortedEvents[sortedEvents.length - 1].timestamp).toISOString(),
        durationMs: sortedEvents[sortedEvents.length - 1].timestamp - sortedEvents[0].timestamp
      } : null,
      eventTypes: sortedEvents.reduce((acc: Record<string, number>, event) => {
        acc[event.type] = (acc[event.type] || 0) + 1;
        return acc;
      }, {}),
      firstFewEvents: sortedEvents.slice(0, 5).map(e => ({
        time: e.displayTime,
        title: e.title,
        side: e.side
      }))
    });

    return sortedEvents;
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
    <>
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
                                {/* 基础信息和重放调试按钮 */}
                                <div className="space-y-4">
                                  <div className="flex justify-between items-center">
                                    <h5 className="text-sm font-medium">LLM调用信息</h5>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleLLMReplay(event)}
                                      className="flex items-center gap-2"
                                    >
                                      <Play className="h-4 w-4" />
                                      重放调试
                                    </Button>
                                  </div>
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
                                </div>

                                {/* Canonical 视图 */}
                                {event.metadata.input?.canonical_request && (() => {
                                  const promptTemplate = event.metadata.input?.prompt_template || 'enhanced_chat';
                                  const requestPayload = event.metadata.input.canonical_request;
                                  const { systemPrompt, userInput } = separatePromptContent(
                                    promptTemplates,
                                    promptTemplate,
                                    requestPayload
                                  );

                                  return (
                                    <div className="space-y-4">
                                      <div className="flex items-center gap-2">
                                        <Badge variant="secondary">Canonical View</Badge>
                                      </div>
                                      <div>
                                        <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                                          <Brain className="h-4 w-4 text-purple-600" />
                                          System Prompt
                                          <Badge variant="outline" className="text-xs">{promptTemplate}</Badge>
                                        </label>
                                        <div className="bg-purple-50 dark:bg-purple-950/50 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
                                          <div className="text-xs max-h-40 overflow-y-auto whitespace-pre-line break-words text-purple-900 dark:text-purple-100">
                                            {systemPrompt || '未找到系统提示词模板'}
                                          </div>
                                        </div>
                                      </div>
                                      <div>
                                        <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                                          <MessageSquare className="h-4 w-4 text-blue-600" />
                                          User Input & Context
                                        </label>
                                        <div className="bg-blue-50 dark:bg-blue-950/50 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                                          <div className="text-xs max-h-40 overflow-y-auto whitespace-pre-line break-words text-blue-900 dark:text-blue-100">
                                            {userInput.split('\\n').join('\n')}
                                          </div>
                                        </div>
                                      </div>
                                      {event.metadata.input?.canonical_request && (
                                        <div>
                                          <label className="text-sm font-medium mb-2 block">Canonical Request</label>
                                          <div className="bg-gray-50 dark:bg-gray-950 p-4 rounded-lg">
                                            <pre className="text-xs overflow-auto max-h-40 whitespace-pre-wrap break-words">
                                              {stringifyPayload(event.metadata.input.canonical_request)}
                                            </pre>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* Wire 视图 */}
                                {event.metadata.input?.wire_request && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">Wire Request</label>
                                    <div className="bg-gray-50 dark:bg-gray-950 p-4 rounded-lg">
                                      <pre className="text-xs overflow-auto max-h-40 whitespace-pre-wrap break-words">
                                        {stringifyPayload(event.metadata.input.wire_request)}
                                      </pre>
                                    </div>
                                    {event.metadata.input?.wire_provider_format && (
                                      <div className="text-xs text-muted-foreground mt-2">
                                        provider format: {event.metadata.input.wire_provider_format}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* AI回复 */}
                                {(event.metadata.output?.processed_response || event.metadata.output?.canonical_response || event.metadata.output?.wire_response) && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">AI回复内容</label>
                                    <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
                                      <div className="text-sm max-h-40 overflow-y-auto whitespace-pre-line break-words">
                                        {String(
                                          event.metadata.output?.processed_response
                                          || event.metadata.output?.canonical_response?.output_text
                                          || extractTextPreview(event.metadata.output?.wire_response)
                                          || ''
                                        ).split('\\n').join('\n')}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Token使用详情 */}
                                {event.metadata.output?.token_usage && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">Token使用详情</label>
                                    <div className="bg-orange-50 dark:bg-orange-950 p-4 rounded-lg">
                                      <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3 xl:grid-cols-5">
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
                                        {typeof event.metadata.output?.usage_details?.cached_input_tokens !== 'undefined' && (
                                          <div>
                                            <span className="font-medium">Cached Input:</span>
                                            <span className="ml-2 text-muted-foreground">
                                              {event.metadata.output.usage_details.cached_input_tokens} tokens
                                            </span>
                                          </div>
                                        )}
                                        {typeof event.metadata.output?.usage_details?.reasoning_tokens !== 'undefined' && (
                                          <div>
                                            <span className="font-medium">Reasoning:</span>
                                            <span className="ml-2 text-muted-foreground">
                                              {event.metadata.output.usage_details.reasoning_tokens} tokens
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {event.metadata.output?.context_policy && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">上下文策略</label>
                                    <div className="bg-sky-50 dark:bg-sky-950 p-4 rounded-lg">
                                      <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 xl:grid-cols-5">
                                        {typeof event.metadata.output.context_policy.context_window_tokens !== 'undefined' && (
                                          <div>
                                            <span className="font-medium">Context Window:</span>
                                            <span className="ml-2 text-muted-foreground">
                                              {event.metadata.output.context_policy.context_window_tokens}
                                            </span>
                                          </div>
                                        )}
                                        {typeof event.metadata.output.context_policy.soft_trigger_tokens !== 'undefined' && (
                                          <div>
                                            <span className="font-medium">Soft Trigger:</span>
                                            <span className="ml-2 text-muted-foreground">
                                              {event.metadata.output.context_policy.soft_trigger_tokens}
                                            </span>
                                          </div>
                                        )}
                                        {typeof event.metadata.output.context_policy.hard_ceiling_tokens !== 'undefined' && (
                                          <div>
                                            <span className="font-medium">Hard Ceiling:</span>
                                            <span className="ml-2 text-muted-foreground">
                                              {event.metadata.output.context_policy.hard_ceiling_tokens}
                                            </span>
                                          </div>
                                        )}
                                        {typeof event.metadata.output.context_policy.reply_budget_tokens !== 'undefined' && (
                                          <div>
                                            <span className="font-medium">Reply Budget:</span>
                                            <span className="ml-2 text-muted-foreground">
                                              {event.metadata.output.context_policy.reply_budget_tokens}
                                            </span>
                                          </div>
                                        )}
                                        {event.metadata.output.context_policy.source && (
                                          <div>
                                            <span className="font-medium">Source:</span>
                                            <span className="ml-2 text-muted-foreground">
                                              {event.metadata.output.context_policy.source}
                                            </span>
                                          </div>
                                        )}
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

                                {/* Canonical 响应 */}
                                {event.metadata.output?.canonical_response && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">Canonical Response</label>
                                    <div className="bg-gray-50 dark:bg-gray-950 p-4 rounded-lg">
                                      <pre className="text-xs overflow-auto max-h-40 whitespace-pre-wrap break-words">
                                        {stringifyPayload(event.metadata.output.canonical_response)}
                                      </pre>
                                    </div>
                                  </div>
                                )}

                                {/* 原始响应 */}
                                {event.metadata.output?.wire_response && (
                                  <div>
                                    <label className="text-sm font-medium mb-2 block">Wire Response</label>
                                    <div className="bg-gray-50 dark:bg-gray-950 p-4 rounded-lg">
                                      <pre className="text-xs overflow-auto max-h-40 whitespace-pre-wrap break-words">
                                        {stringifyPayload(event.metadata.output.wire_response)}
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

    {/* 🔥 LLM重放调试弹窗 */}
    {debugData && (
      <DebugPromptModal
        isOpen={debugModalOpen}
        onClose={() => {
          setDebugModalOpen(false);
          setDebugData(null);
        }}
        conversationId={debugData.conversationId}
        initialData={{
          systemPrompt: debugData.systemPrompt,
          userInput: debugData.userInput,
          parameters: debugData.parameters,
          model: debugData.model
        }}
      />
    )}
    </>
  );
};
