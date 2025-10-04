import { useQuery } from '@tanstack/react-query';
import { LLMFlowResponse, ConversationTimelineData, TimelineNode, ENGINE_NAMES, LLMCallRecord, ProcessingEvent } from '../types';

type MessageInputType = NonNullable<LLMFlowResponse['message_input']>;
type MessageOutputType = NonNullable<LLMFlowResponse['message_output']>;

const SAFE_STATUS: Array<LLMCallRecord['output']['status']> = ['SUCCESS', 'ERROR', 'TIMEOUT', 'SKIPPED'];

const safeJsonParse = <T>(value: any): T | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (err) {
      console.warn('🔥 TIMELINE WARN: Failed to parse JSON field', { value, err });
      return undefined;
    }
  }

  if (typeof value === 'object') {
    return value as T;
  }

  return undefined;
};

const toNumber = (value: any, fallback = 0): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeStatus = (status: any): LLMCallRecord['output']['status'] => {
  const upper = (status ?? '').toString().toUpperCase();
  if (SAFE_STATUS.includes(upper as LLMCallRecord['output']['status'])) {
    return upper as LLMCallRecord['output']['status'];
  }
  return upper.includes('SUCCESS') ? 'SUCCESS' : 'ERROR';
};

const isModernCallChain = (chain: any): chain is LLMCallRecord[] => {
  return Array.isArray(chain) && chain.length > 0 && chain.every(call => call && typeof call === 'object' && call.input && call.output);
};

const buildLegacyMessageInput = (flow: LLMFlowResponse): MessageInputType => {
  if (flow.message_input) {
    return flow.message_input;
  }

  const conversation: any = (flow as any).conversation || {};
  const rawRequest = safeJsonParse<any>(conversation.raw_request);
  const timestampFromConversation = conversation.timestamp ? new Date(conversation.timestamp).toISOString() : undefined;
  const timestampFromRequest = rawRequest?.time ? new Date(rawRequest.time * 1000).toISOString() : undefined;
  const queuedAt = timestampFromRequest || timestampFromConversation || new Date().toISOString();
  const processedAt = timestampFromConversation || timestampFromRequest || queuedAt;

  return {
    user_id: conversation.user_id ?? rawRequest?.user_id ?? 0,
    message: conversation.user_message ?? rawRequest?.message ?? rawRequest?.raw_message ?? '',
    message_type: rawRequest?.message_type ?? 'private',
    group_id: rawRequest?.group_id,
    message_id: rawRequest?.message_id,
    source: 'api_simulation',
    queued_at: queuedAt,
    processed_at: processedAt,
    partition_key: String(conversation.user_id ?? rawRequest?.user_id ?? 'legacy'),
    priority: 'MEDIUM'
  };
};

const buildLegacyMessageOutput = (
  flow: LLMFlowResponse,
  modelFallback?: string
): MessageOutputType => {
  if (flow.message_output) {
    return flow.message_output;
  }

  const conversation: any = (flow as any).conversation || {};
  const responseText: string = conversation.ai_response ?? '';
  const timestampIso = conversation.timestamp ? new Date(conversation.timestamp).toISOString() : new Date().toISOString();
  const responseTime = toNumber(conversation.response_time, 0);
  const normalizedStatus = (conversation.status ?? '').toString().toLowerCase();
  const deliveryStatus = normalizedStatus === 'completed'
    ? 'sent'
    : normalizedStatus === 'failed'
      ? 'failed'
      : 'pending';

  return {
    content: responseText,
    response_time_ms: responseTime,
    model_used: conversation.model_name || modelFallback || 'unknown',
    delivery_method: 'http_api',
    delivery_status: deliveryStatus as MessageOutputType['delivery_status'],
    timestamp: timestampIso,
    character_count: responseText.length,
    delivery_latency_ms: undefined
  };
};

const normalizeLegacyLlmCallChain = (
  calls: any[] = [],
  fallbackTimestamp?: string
): LLMCallRecord[] => {
  return calls.map((rawCall, index) => {
    const parsedModelConfig = safeJsonParse<any>(rawCall?.model_config) ?? {};
    const parsedTokenUsage = safeJsonParse<any>(rawCall?.token_usage) ?? {};

    const promptTokens = toNumber(parsedTokenUsage.input_tokens ?? rawCall?.input_tokens, 0);
    const completionTokens = toNumber(parsedTokenUsage.output_tokens ?? rawCall?.output_tokens, 0);
    const totalTokens = toNumber(parsedTokenUsage.total_tokens, promptTokens + completionTokens);

    const apiCallTimeMs = toNumber(rawCall?.api_call_time_ms, toNumber(rawCall?.processing_time_ms, 0));
    const processingTimeMs = toNumber(rawCall?.processing_time_ms, apiCallTimeMs);
    const queueWaitMs = toNumber(rawCall?.queue_wait_time_ms, 0);
    const rawCostEstimate = rawCall?.cost_estimate;
    const numericCostEstimate = rawCostEstimate !== undefined && rawCostEstimate !== null ? Number(rawCostEstimate) : undefined;
    const costEstimate = numericCostEstimate !== undefined && Number.isFinite(numericCostEstimate) ? numericCostEstimate : undefined;
    const timestampIso = rawCall?.timestamp || fallbackTimestamp || new Date().toISOString();
    const status = normalizeStatus(rawCall?.status);

    return {
      sequence: rawCall?.call_sequence ?? index + 1,
      stage: rawCall?.stage || 'legacy_llm_pipeline',
      agent_type: rawCall?.agent_type || 'unknown',
      purpose: rawCall?.purpose || rawCall?.prompt_template || rawCall?.tool_name || 'legacy_llm_call',
      input: {
        model_name: rawCall?.model_name || 'unknown',
        model_provider: rawCall?.model_provider || 'unknown',
        prompt_template: rawCall?.prompt_template || 'legacy',
        input_prompt: rawCall?.input_prompt || '',
        model_config: typeof parsedModelConfig === 'object' && parsedModelConfig !== null ? parsedModelConfig : {},
        context_summary: rawCall?.context_summary,
        timestamp: timestampIso
      },
      output: {
        status,
        raw_response: rawCall?.raw_response,
        processed_response: rawCall?.processed_response,
        token_usage: {
          input_tokens: promptTokens,
          output_tokens: completionTokens,
          total_tokens: totalTokens
        },
        performance: {
          api_call_time_ms: apiCallTimeMs,
          processing_time_ms: processingTimeMs,
          queue_wait_time_ms: queueWaitMs
        },
        cost_estimate: costEstimate,
        error_info: rawCall?.error_message
          ? {
              error_message: rawCall.error_message,
              error_code: rawCall.error_code ?? 'LEGACY_ERROR',
              retry_count: toNumber(rawCall.retry_count, 0)
            }
          : undefined,
        timestamp: timestampIso
      }
    };
  });
};

const normalizeCallChain = (flow: LLMFlowResponse, fallbackTimestamp?: string): LLMCallRecord[] => {
  if (isModernCallChain((flow as any).llm_call_chain)) {
    return (flow as any).llm_call_chain as LLMCallRecord[];
  }

  if (Array.isArray((flow as any).llm_calls) && (flow as any).llm_calls.length > 0) {
    return normalizeLegacyLlmCallChain((flow as any).llm_calls, fallbackTimestamp);
  }

  return [];
};

// Helper function to calculate cost (rough estimation)
const calculateCost = (trace: any): number => {
  const promptTokens = trace.input_tokens || trace.prompt_tokens || 0;
  const completionTokens = trace.output_tokens || trace.completion_tokens || 0;

  // Rough pricing: $0.001 per 1000 tokens for prompt, $0.002 per 1000 tokens for completion
  const promptCost = (promptTokens / 1000) * 0.001;
  const completionCost = (completionTokens / 1000) * 0.002;

  return Math.round((promptCost + completionCost) * 1000) / 1000; // Round to 3 decimal places
};

// Helper function to extract confidence from response
const extractConfidence = (response: any): number => {
  // Try to extract confidence from response, default to 0.8
  if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
    // Look for confidence patterns in the text
    const text = response.candidates[0].content.parts[0].text;
    const confidenceMatch = text.match(/confidence[:\s]*(\d+\.?\d*)/i);
    if (confidenceMatch) {
      return parseFloat(confidenceMatch[1]);
    }
  }
  return 0.8; // Default confidence
};

// Build timeline nodes from LLM flow data
const buildTimelineNodes = (llmFlowData: LLMFlowResponse): TimelineNode[] => {
  const nodes: TimelineNode[] = [];

  // 🔥 优先使用新的 llm_call_chain 结构 (MESSAGE_FLOW_API规范)
  const llmCalls = llmFlowData.llm_call_chain || [];

  if (llmCalls.length > 0) {
    // 使用新的扁平化 llm_call_chain 结构
    llmCalls.forEach((call, index) => {
      const agentType = call.agent_type || 'unknown';
      const title = ENGINE_NAMES[agentType] || `${agentType}`;
      const isSuccess = call.output.status === 'SUCCESS';

      // 从新的结构中获取处理时间
      const processingTime = call.output.performance.processing_time_ms || call.output.performance.api_call_time_ms || 0;

      // 从新的结构中获取token信息
      const totalTokens = call.output.token_usage.total_tokens || 0;

      nodes.push({
        id: `llm_${index}`,
        timestamp: new Date(call.input.timestamp),
        type: 'llm_call',
        title: title,
        duration_ms: processingTime,
        status: isSuccess ? 'success' : 'error',
        summary: `模型: ${call.input.model_name} | 耗时: ${processingTime}ms`,
        data: {
          input: call.input,
          output: call.output,
          model_name: call.input.model_name,
          agent_type: agentType,
          prompt_tokens: call.output.token_usage.input_tokens || 0,
          completion_tokens: call.output.token_usage.output_tokens || 0,
          total_tokens: totalTokens,
          processing_time_ms: processingTime,
          api_call_time_ms: call.output.performance.api_call_time_ms || 0,
          success: isSuccess,
          status: call.output.status,
          error_message: call.output.error_info?.error_message,
          cost: call.output.cost_estimate || calculateCost(call.output),
          confidence: extractConfidence(call.output.raw_response)
        }
      });
    });
  } else if (llmFlowData.llm_calls && Array.isArray(llmFlowData.llm_calls) && llmFlowData.llm_calls.length > 0) {
    // 兼容 admin-backend 旧接口返回的 llm_call_logs 结构
    llmFlowData.llm_calls.forEach((rawCall: any, index: number) => {
      const agentType = rawCall.agent_type || 'unknown';
      const title = ENGINE_NAMES[agentType] || agentType;
      const isSuccess = (rawCall.status || 'SUCCESS').toUpperCase() === 'SUCCESS';

      const processingTime = rawCall.processing_time_ms || rawCall.api_call_time_ms || 0;
      const promptTokens = rawCall.input_tokens || 0;
      const completionTokens = rawCall.output_tokens || 0;
      const totalTokens = promptTokens + completionTokens;

      let modelConfig: any = undefined;
      try {
        modelConfig = rawCall.model_config ? JSON.parse(rawCall.model_config) : undefined;
      } catch (err) {
        modelConfig = rawCall.model_config;
      }

      const nodeTimestamp = rawCall.timestamp ? new Date(rawCall.timestamp) : new Date();

      nodes.push({
        id: `legacy_llm_${index}`,
        timestamp: nodeTimestamp,
        type: 'llm_call',
        title,
        duration_ms: processingTime,
        status: isSuccess ? 'success' : 'error',
        summary: `模型: ${rawCall.model_name || 'unknown'} | 耗时: ${processingTime}ms`,
        data: {
          input: {
            model_name: rawCall.model_name,
            model_provider: rawCall.model_provider,
            prompt_template: rawCall.prompt_template,
            input_prompt: rawCall.input_prompt,
            model_config: modelConfig,
            context_summary: rawCall.context_summary,
            timestamp: rawCall.timestamp
          },
          output: {
            status: rawCall.status,
            raw_response: rawCall.raw_response,
            processed_response: rawCall.processed_response,
            error_info: rawCall.error_message ? { error_message: rawCall.error_message, error_code: rawCall.error_code } : undefined,
            token_usage: {
              input_tokens: promptTokens,
              output_tokens: completionTokens,
              total_tokens: totalTokens
            },
            performance: {
              api_call_time_ms: rawCall.api_call_time_ms || 0,
              processing_time_ms: processingTime
            },
            cost_estimate: rawCall.cost_estimate,
            timestamp: rawCall.timestamp
          },
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          processing_time_ms: processingTime,
          api_call_time_ms: rawCall.api_call_time_ms || 0,
          success: isSuccess,
          status: rawCall.status,
          error_message: rawCall.error_message,
          cost: rawCall.cost_estimate || calculateCost({ input_tokens: promptTokens, completion_tokens: completionTokens }),
          confidence: extractConfidence({ candidates: [{ content: { parts: [{ text: rawCall.processed_response || rawCall.raw_response }] } }] })
        }
      });
    });

  } else if (llmFlowData.llm_trace && Array.isArray(llmFlowData.llm_trace)) {
    // 回退到旧的 llm_trace 结构 (向后兼容)
    llmFlowData.llm_trace.forEach((trace, index) => {
      const agentType = trace.llm_raw_input.agent_type || 'unknown';
      const title = ENGINE_NAMES[agentType] || `${agentType}`;
      const isSuccess = trace.llm_raw_output.status === 'SUCCESS';

      const processingTime = trace.llm_raw_output.processing_time_ms || trace.llm_raw_output.api_call_time_ms || 0;
      const totalTokens = trace.llm_raw_output.total_tokens || 0;

      nodes.push({
        id: `llm_${index}`,
        timestamp: new Date(trace.llm_raw_input.timestamp),
        type: 'llm_call',
        title: title,
        duration_ms: processingTime,
        status: isSuccess ? 'success' : 'error',
        summary: `模型: ${trace.llm_raw_input.model_name} | 耗时: ${processingTime}ms`,
        data: {
          input: trace.llm_raw_input,
          output: trace.llm_raw_output,
          model_name: trace.llm_raw_input.model_name,
          agent_type: agentType,
          prompt_tokens: trace.llm_raw_output.input_tokens || 0,
          completion_tokens: trace.llm_raw_output.output_tokens || 0,
          total_tokens: totalTokens,
          processing_time_ms: processingTime,
          api_call_time_ms: trace.llm_raw_output.api_call_time_ms || 0,
          success: isSuccess,
          status: trace.llm_raw_output.status,
          error_message: trace.llm_raw_output.error_message,
          cost: calculateCost(trace.llm_raw_output),
          confidence: extractConfidence(trace.llm_raw_output.raw_response)
        }
      });
    });
  }

  // 🔥 防御性排序：处理时间戳异常和确保稳定排序
  return nodes.sort((a, b) => {
    const timeDiff = a.timestamp.getTime() - b.timestamp.getTime();
    if (timeDiff !== 0) return timeDiff;

    // 时间戳相同时，按照ID排序确保稳定性
    return a.id.localeCompare(b.id);
  });
};

// Calculate timeline summary (with new API flow_summary support)
const calculateTimelineSummary = (nodes: TimelineNode[], flowSummary?: any) => {
  // 🔥 优先使用新API提供的flow_summary数据
  if (flowSummary) {
    return {
      total_duration: flowSummary.total_processing_time_ms || flowSummary.llm_processing_time_ms || 0,
      total_cost: flowSummary.total_cost_estimate || 0,
      total_tokens: flowSummary.total_tokens_used || 0,
      success_rate: flowSummary.success_rate || 0,
      efficiency_score: flowSummary.efficiency_score || 0,
      // 新增字段
      queue_wait_time: flowSummary.queue_wait_time_ms || 0,
      bottleneck_stage: flowSummary.bottleneck_stage
    };
  }

  // 回退到客户端计算 (向后兼容)
  const llmNodes = nodes.filter(node => node.type === 'llm_call');

  const totalDuration = llmNodes.reduce((sum, node) => sum + (node.duration_ms || 0), 0);
  const totalCost = llmNodes.reduce((sum, node) => sum + (node.data.cost || 0), 0);
  const totalTokens = llmNodes.reduce((sum, node) => {
    const promptTokens = node.data.prompt_tokens || node.data.input_tokens || 0;
    const completionTokens = node.data.completion_tokens || node.data.output_tokens || 0;
    return sum + promptTokens + completionTokens;
  }, 0);
  const successCount = llmNodes.filter(node => node.status === 'success').length;
  const successRate = llmNodes.length > 0 ? (successCount / llmNodes.length) * 100 : 100;

  return {
    total_duration: totalDuration,
    total_cost: Math.round(totalCost * 1000) / 1000,
    total_tokens: totalTokens,
    success_rate: Math.round(successRate * 10) / 10,
    efficiency_score: 80, // 默认值
    queue_wait_time: 0,
    bottleneck_stage: undefined
  };
};

export const useConversationTimeline = (conversationId: string, autoRefreshEnabled: boolean = true) => {
  return useQuery({
    queryKey: ['conversationTimeline', conversationId],
    queryFn: async (): Promise<ConversationTimelineData> => {
      // Fetch LLM Flow data from QQBot Core API
      const response = await fetch(`/api/debug/conversation/${conversationId}/llm-flow`);

      if (!response.ok) {
        throw new Error(`Failed to fetch conversation timeline: ${response.statusText}`);
      }

      const llmFlowData: LLMFlowResponse = await response.json();

      const conversationMeta: any = (llmFlowData as any).conversation || {};
      const normalizedCallChain = normalizeCallChain(llmFlowData, conversationMeta.timestamp);
      const normalizedMessageInput = buildLegacyMessageInput(llmFlowData);
      const normalizedMessageOutput = buildLegacyMessageOutput(llmFlowData, normalizedCallChain[0]?.input?.model_name);
      const normalizedProcessingEvents: ProcessingEvent[] = Array.isArray(llmFlowData.processing_events) && llmFlowData.processing_events.length > 0
        ? llmFlowData.processing_events
        : (((llmFlowData as any).timeline_events ?? []) as ProcessingEvent[]);

      const normalizedFlowData: LLMFlowResponse = {
        ...llmFlowData,
        llm_call_chain: normalizedCallChain,
        message_input: normalizedMessageInput,
        message_output: normalizedMessageOutput,
        processing_events: normalizedProcessingEvents
      };

      // Build timeline nodes
      const timelineNodes = buildTimelineNodes(normalizedFlowData);
      const timelineSummary = calculateTimelineSummary(timelineNodes, normalizedFlowData.flow_summary);

      const queuedTimestampMs = Date.parse(normalizedMessageInput.queued_at);
      const websocketInput = normalizedFlowData.websocket_input ?? {
        ...normalizedMessageInput,
        raw_message: normalizedMessageInput.message,
        message_id: normalizedMessageInput.message_id ?? Date.now(),
        time: Number.isFinite(queuedTimestampMs) ? Math.floor(queuedTimestampMs / 1000) : Math.floor(Date.now() / 1000)
      };

      const websocketOutput = normalizedFlowData.websocket_output ?? {
        content: normalizedMessageOutput.content,
        response_time_ms: normalizedMessageOutput.response_time_ms,
        model: normalizedMessageOutput.model_used,
        timestamp: normalizedMessageOutput.timestamp
      };

      return {
        conversation_id: conversationId,
        trace_id: normalizedFlowData.trace_id,
        // 新规范数据
        message_input: normalizedMessageInput,
        message_output: normalizedMessageOutput,
        llm_call_chain: normalizedCallChain,
        processing_events: normalizedFlowData.processing_events || [],
        flow_summary: normalizedFlowData.flow_summary,
        debug_info: normalizedFlowData.debug_info,
        // 向后兼容数据
        websocket_input: websocketInput,
        websocket_output: websocketOutput,
        llm_traces: normalizedFlowData.llm_trace || [],
        timeline_nodes: timelineNodes,
        timeline_events: normalizedFlowData.timeline_events || normalizedFlowData.processing_events || [],
        timeline_summary: timelineSummary
      };
    },
    refetchInterval: autoRefreshEnabled ? 30000 : false, // Conditional auto-refresh
    enabled: !!conversationId, // Only run query if conversationId exists
  });
};
