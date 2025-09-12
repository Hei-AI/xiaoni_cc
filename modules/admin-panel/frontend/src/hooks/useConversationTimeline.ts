import { useQuery } from '@tanstack/react-query';
import { LLMFlowResponse, ConversationTimelineData, TimelineNode, ENGINE_NAMES } from '../types';

// Helper function to calculate cost (rough estimation)
const calculateCost = (trace: any): number => {
  const promptTokens = trace.prompt_tokens || 0;
  const completionTokens = trace.completion_tokens || 0;
  
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
  
  // 1. WebSocket input node
  const inputTimestamp = new Date(llmFlowData.websocket_output.timestamp);
  nodes.push({
    id: 'websocket_in',
    timestamp: new Date(inputTimestamp.getTime() - llmFlowData.websocket_output.response_time_ms),
    type: 'websocket_in',
    title: 'WebSocket消息接收',
    duration_ms: 0,
    status: 'success',
    summary: `用户: ${llmFlowData.websocket_input.raw_message || llmFlowData.websocket_input.message || ''}`,
    data: {
      input: llmFlowData.websocket_input,
      output: null
    }
  });
  
  // 2. LLM call nodes
  llmFlowData.llm_trace.forEach((trace, index) => {
    const engineType = trace.llm_raw_input.engine_type;
    const title = ENGINE_NAMES[engineType] || 'LLM调用';
    
    nodes.push({
      id: `llm_${index}`,
      timestamp: new Date(trace.llm_raw_input.timestamp),
      type: 'llm_call',
      title: title,
      duration_ms: trace.llm_raw_output.response_time_ms,
      status: trace.llm_raw_output.success ? 'success' : 'error',
      summary: `模型: ${trace.llm_raw_input.model_name} | Token: ${trace.llm_raw_output.total_tokens}`,
      data: {
        input: trace.llm_raw_input.gemini_request,
        output: trace.llm_raw_output.gemini_response,
        model_name: trace.llm_raw_input.model_name,
        prompt_tokens: trace.llm_raw_output.prompt_tokens,
        completion_tokens: trace.llm_raw_output.completion_tokens,
        response_time_ms: trace.llm_raw_output.response_time_ms,
        success: trace.llm_raw_output.success,
        cost: calculateCost(trace.llm_raw_output),
        confidence: extractConfidence(trace.llm_raw_output.gemini_response)
      }
    });
  });
  
  // 3. WebSocket output node
  nodes.push({
    id: 'websocket_out',
    timestamp: new Date(llmFlowData.websocket_output.timestamp),
    type: 'websocket_out', 
    title: 'WebSocket响应发送',
    duration_ms: 0,
    status: 'success',
    summary: `回复: ${llmFlowData.websocket_output.content?.substring(0, 50) || ''}...`,
    data: {
      input: null,
      output: llmFlowData.websocket_output
    }
  });
  
  return nodes.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
};

// Calculate timeline summary
const calculateTimelineSummary = (nodes: TimelineNode[]) => {
  const llmNodes = nodes.filter(node => node.type === 'llm_call');
  
  const totalDuration = llmNodes.reduce((sum, node) => sum + (node.duration_ms || 0), 0);
  const totalCost = llmNodes.reduce((sum, node) => sum + (node.data.cost || 0), 0);
  const totalTokens = llmNodes.reduce((sum, node) => 
    sum + (node.data.prompt_tokens || 0) + (node.data.completion_tokens || 0), 0
  );
  const successCount = llmNodes.filter(node => node.status === 'success').length;
  const successRate = llmNodes.length > 0 ? (successCount / llmNodes.length) * 100 : 100;
  
  return {
    total_duration: totalDuration,
    total_cost: Math.round(totalCost * 1000) / 1000,
    total_tokens: totalTokens,
    success_rate: Math.round(successRate * 10) / 10
  };
};

export const useConversationTimeline = (conversationId: string) => {
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
      const timelineSummary = calculateTimelineSummary(timelineNodes);
      
      return {
        conversation_id: conversationId,
        websocket_input: llmFlowData.websocket_input,
        websocket_output: llmFlowData.websocket_output,
        llm_traces: llmFlowData.llm_trace,
        timeline_nodes: timelineNodes,
        timeline_summary: timelineSummary
      };
    },
    refetchInterval: 30000, // Refetch every 30 seconds
    enabled: !!conversationId, // Only run query if conversationId exists
  });
};