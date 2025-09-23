import { useQuery } from '@tanstack/react-query';
import { LLMFlowResponse, ConversationTimelineData, TimelineNode, ENGINE_NAMES } from '../types';

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

  return nodes.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
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
      
      // Build timeline nodes
      const timelineNodes = buildTimelineNodes(llmFlowData);
      const timelineSummary = calculateTimelineSummary(timelineNodes, llmFlowData.flow_summary);

      return {
        conversation_id: conversationId,
        trace_id: llmFlowData.trace_id,
        // 新规范数据
        message_input: llmFlowData.message_input,
        message_output: llmFlowData.message_output,
        llm_call_chain: llmFlowData.llm_call_chain || [],
        processing_events: llmFlowData.processing_events || [],
        flow_summary: llmFlowData.flow_summary,
        debug_info: llmFlowData.debug_info,
        // 向后兼容数据
        websocket_input: llmFlowData.websocket_input || llmFlowData.message_input,
        websocket_output: llmFlowData.websocket_output || llmFlowData.message_output,
        llm_traces: llmFlowData.llm_trace || [],
        timeline_nodes: timelineNodes,
        timeline_events: llmFlowData.timeline_events || llmFlowData.processing_events || [],
        timeline_summary: timelineSummary
      };
    },
    refetchInterval: autoRefreshEnabled ? 30000 : false, // Conditional auto-refresh
    enabled: !!conversationId, // Only run query if conversationId exists
  });
};