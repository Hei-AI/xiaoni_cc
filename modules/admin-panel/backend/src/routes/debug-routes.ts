import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

// QQBot Core服务地址配置 (支持容器间通信)
const QQBOT_CORE_URL = process.env.QQBOT_CORE_URL || 'http://qqbot-core:8081';

// 🔥 上下文变量处理和模板替换功能
function processContextVariables(
  template: string,
  contextVariables: any = {},
  runtimeVariables: any = {}
): string {
  if (!template || typeof template !== 'string') {
    return template || '';
  }

  let processedTemplate = template;

  // 🔥 合并上下文变量和运行时变量
  const allVariables = {
    ...contextVariables,
    ...runtimeVariables
  };

  // 🔥 替换 {{variable}} 格式的变量
  processedTemplate = processedTemplate.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (allVariables.hasOwnProperty(varName)) {
      const value = allVariables[varName];
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
    return match; // 保留未找到的变量
  });

  // 🔥 替换 ${variable} 格式的变量
  processedTemplate = processedTemplate.replace(/\$\{(\w+)\}/g, (match, varName) => {
    if (allVariables.hasOwnProperty(varName)) {
      const value = allVariables[varName];
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
    return match; // 保留未找到的变量
  });

  // 🔥 处理动态日期时间变量
  processedTemplate = processedTemplate.replace(/\{\{now\.(\w+)\}\}/g, (match, format) => {
    const now = new Date();
    switch (format) {
      case 'iso': return now.toISOString();
      case 'date': return now.toDateString();
      case 'time': return now.toTimeString();
      case 'locale': return now.toLocaleString('zh-CN');
      default: return now.toISOString();
    }
  });

  return processedTemplate;
}

function parseJsonField<T>(value: any, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }
  if (typeof value === 'object') {
    return value as T;
  }
  return fallback;
}

function buildMessageInput(conversation: any) {
  const rawRequest = parseJsonField<any>(conversation.raw_request, {});
  const timestampFromConversation = conversation.timestamp ? new Date(conversation.timestamp).toISOString() : undefined;
  const timestampFromRequest = rawRequest?.time ? new Date(rawRequest.time * 1000).toISOString() : undefined;
  const queuedAt = timestampFromRequest || timestampFromConversation || new Date().toISOString();
  const processedAt = timestampFromConversation || timestampFromRequest || queuedAt;

  return {
    user_id: conversation.user_id ?? rawRequest.user_id ?? 0,
    message: conversation.user_message ?? rawRequest.message ?? rawRequest.raw_message ?? '',
    message_type: rawRequest.message_type ?? 'private',
    group_id: rawRequest.group_id,
    message_id: rawRequest.message_id,
    source: 'api_simulation' as const,
    queued_at: queuedAt,
    processed_at: processedAt,
    partition_key: String(conversation.user_id ?? rawRequest.user_id ?? conversation.id),
    priority: 'MEDIUM' as const
  };
}

function buildMessageOutput(conversation: any) {
  const responseText = conversation.ai_response ?? '';
  const timestampIso = conversation.timestamp ? new Date(conversation.timestamp).toISOString() : new Date().toISOString();
  const responseTime = Number.isFinite(Number(conversation.response_time)) ? Number(conversation.response_time) : 0;
  const normalizedStatus = (conversation.status ?? '').toString().toLowerCase();
  const deliveryStatus = normalizedStatus === 'completed'
    ? 'sent'
    : normalizedStatus === 'failed'
      ? 'failed'
      : 'pending';

  return {
    content: responseText,
    response_time_ms: responseTime,
    model_used: conversation.model_name || 'unknown',
    delivery_method: 'http_api' as const,
    delivery_status: deliveryStatus as 'sent' | 'failed' | 'pending',
    timestamp: timestampIso,
    character_count: responseText.length
  };
}

function normalizeProcessingEvents(events: any[]) {
  return events.map((event) => ({
    event_id: String(event.id),
    event_type: event.event_type,
    event_name: event.event_name,
    event_phase: event.event_phase,
    event_time: event.event_time,
    duration_ms: event.duration_ms ?? undefined,
    metadata: {
      component: event.component || event.event_type,
      details: parseJsonField<any>(event.metadata, {}),
      performance_metrics: parseJsonField<any>(event.performance_metrics, undefined)
    }
  }));
}

// 创建调试相关路由
export function createDebugRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();


  // LLM Flow 调试接口
  router.get('/debug/conversation/:conversationId/llm-flow', async (req, res) => {
    try {
      const conversationId = req.params.conversationId;
      logger.info('🔍 DEBUG ROUTES: LLM Flow API called', { conversationId, timestamp: new Date().toISOString() });

      if (!conversationId) {
        return res.status(400).json({
          success: false,
          error: 'Conversation ID is required',
          timestamp: new Date().toISOString()
        });
      }

      // 获取对话基本信息
      const conversationQuery = `
        SELECT id, user_id, user_message, ai_response, timestamp, response_time,
               model_name, raw_request, status, trace_id
        FROM conversations
        WHERE id = ?
      `;

      const conversations = await database.executeQuery(conversationQuery, [conversationId]);

      if (!conversations || conversations.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Conversation not found: ${conversationId}`,
          timestamp: new Date().toISOString()
        });
      }

      const conversation = conversations[0] as any;
      const traceId = conversation.trace_id;

      // 获取LLM调用记录
      const llmCallsQuery = `
        SELECT
          id,
          conversation_id,
          trace_id,
          call_sequence,
          agent_type,
          model_name,
          model_provider,
          prompt_template,
          canonical_request,
          wire_request,
          request_format_version,
          wire_provider_format,
          input_tokens,
          canonical_response,
          wire_response,
          processed_response,
          output_tokens,
          api_call_time_ms,
          processing_time_ms,
          timestamp,
          status,
          error_message,
          error_code,
          cost_estimate,
          token_usage
        FROM llm_call_logs
        WHERE trace_id = ? OR conversation_id = ?
        ORDER BY timestamp ASC
      `;
      const llmCalls = await database.executeQuery(llmCallsQuery, [traceId, conversationId]);

      // 获取时间线事件
      let timelineEvents: any[] = [];
      try {
        timelineEvents = await database.executeQuery(
          `SELECT * FROM timeline_events WHERE trace_id = ? ORDER BY event_time ASC`,
          [traceId]
        );
      } catch (timelineError) {
        logger.warn('Failed to fetch timeline events', {
          error: timelineError instanceof Error ? timelineError.message : String(timelineError),
          traceId
        });
        timelineEvents = [];
      }

      // 获取WebSocket日志
      let websocketLogs: any[] = [];
      try {
        websocketLogs = await database.executeQuery(
          `SELECT * FROM websocket_logs WHERE trace_id = ? ORDER BY timestamp ASC`,
          [traceId]
        );
      } catch (wsError) {
        logger.warn('Failed to fetch websocket logs', {
          error: wsError instanceof Error ? wsError.message : String(wsError),
          traceId
        });
        websocketLogs = [];
      }

      const messageInput = buildMessageInput(conversation);
      const messageOutput = buildMessageOutput(conversation);
      const processingEvents = normalizeProcessingEvents(timelineEvents);

      const responseData = {
        conversation_id: conversationId,
        trace_id: traceId,
        message_input: messageInput,
        message_output: messageOutput,
        llm_call_chain: llmCalls,
        processing_events: processingEvents,
        flow_summary: {
          total_processing_time_ms: Number(conversation.response_time) || 0,
          queue_wait_time_ms: 0,
          llm_processing_time_ms: llmCalls.reduce((sum: number, call: any) => sum + (Number(call.processing_time_ms) || 0), 0),
          total_llm_calls: llmCalls.length,
          successful_calls: llmCalls.filter((call: any) => call.status === 'SUCCESS').length,
          failed_calls: llmCalls.filter((call: any) => call.status === 'ERROR').length,
          skipped_calls: llmCalls.filter((call: any) => call.status === 'SKIPPED').length,
          total_tokens_used: llmCalls.reduce((sum: number, call: any) => {
            const usage = parseJsonField<any>(call.token_usage, {});
            return sum + Number(usage.total_tokens ?? 0);
          }, 0),
          total_cost_estimate: llmCalls.reduce((sum: number, call: any) => sum + (Number(call.cost_estimate) || 0), 0),
          success_rate: llmCalls.length > 0
            ? (llmCalls.filter((call: any) => call.status === 'SUCCESS').length / llmCalls.length) * 100
            : 100,
          efficiency_score: 0
        },
        debug_info: {
          data_completeness: {
            conversation_record: 'complete',
            llm_call_logs: llmCalls.length > 0 ? 'complete' : 'missing',
            queue_logs: websocketLogs.length > 0 ? 'complete' : 'missing',
            processing_events: processingEvents.length > 0 ? 'complete' : 'missing'
          },
          missing_data_reasons: [],
          architecture_notes: [
            'LLM 调用展示基于 canonical_request/wire_request 和 canonical_response/wire_response 双视图'
          ],
          performance_warnings: [],
          recommendations: []
        }
      };

      res.json(responseData);

    } catch (error) {
      logger.error('Failed to get LLM flow data', { error, conversationId: req.params.conversationId });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve LLM flow data',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 🔥 增强的Debug prompt endpoint - 支持完整prompt配置和多轮对话
  router.post('/debug/prompt-v2', async (req, res) => {
    try {
      const {
        prompt_id,            // 🔥 新增: Prompt ID用于加载完整配置
        messages = [],        // 🔥 新增: 多轮对话历史
        systemPrompt,         // 向后兼容
        userInput,           // 向后兼容
        parameters = {},
        model,
        conversation_id
      } = req.body;

      // 参数验证
      if (!prompt_id && !userInput) {
        return res.status(400).json({
          success: false,
          error: 'Either prompt_id with messages or userInput is required',
          timestamp: new Date().toISOString()
        });
      }

      let promptConfig: any = null;
      let finalSystemPrompt = systemPrompt || '';
      let finalMessages = messages;
      let finalModel = model || 'gemini-2.5-flash';
      let finalParameters = parameters;

      // 🔥 如果提供了prompt_id，从数据库加载完整配置
      if (prompt_id) {
        try {
          const promptQuery = `
            SELECT id, agent_type, prompt_name, system_instructions,
                   user_prompt_template, context_variables, model_config,
                   advanced_config, model_name, allowed_token_ids, is_active
            FROM agent_prompts
            WHERE id = ? AND is_active = 1
          `;
          const promptResults = await database.executeQuery(promptQuery, [prompt_id]);

          if (!promptResults || promptResults.length === 0) {
            return res.status(404).json({
              success: false,
              error: `Prompt not found or inactive: ${prompt_id}`,
              timestamp: new Date().toISOString()
            });
          }

          promptConfig = promptResults[0];

          const parsedContextVariables = parseJsonField<Record<string, unknown>>(promptConfig.context_variables, {});
          const parsedModelConfig = parseJsonField<Record<string, unknown>>(promptConfig.model_config, {});
          const parsedAdvancedConfig = parseJsonField<Record<string, unknown>>(promptConfig.advanced_config, {});
          const parsedAllowedTokenIds = parseJsonField<any[]>(promptConfig.allowed_token_ids, []);

          promptConfig = {
            ...promptConfig,
            context_variables: parsedContextVariables,
            model_config: parsedModelConfig,
            advanced_config: parsedAdvancedConfig,
            allowed_token_ids: Array.isArray(parsedAllowedTokenIds) ? parsedAllowedTokenIds : []
          };

          // 🔥 加载完整的系统指令
          let rawSystemPrompt = Array.isArray(promptConfig.system_instructions)
            ? promptConfig.system_instructions.join('\n')
            : promptConfig.system_instructions || '';

          // 🔥 处理上下文变量和模板替换
          finalSystemPrompt = processContextVariables(rawSystemPrompt, promptConfig.context_variables, {
            conversation_id: conversation_id || prompt_id,
            timestamp: new Date().toISOString(),
            model: promptConfig.model_name || model || 'gemini-2.5-flash'
          });

          // 🔥 使用prompt配置的模型
          finalModel = promptConfig.model_name || model || 'gemini-2.5-flash';

          // 🔥 合并配置参数
          finalParameters = {
            ...parameters,
            model_config: promptConfig.model_config,
            advanced_config: promptConfig.advanced_config,
            context_variables: promptConfig.context_variables,
            allowed_token_ids: promptConfig.allowed_token_ids
          };

          logger.info('Loaded prompt configuration', {
            prompt_id,
            prompt_name: promptConfig.prompt_name,
            model: finalModel,
            hasAdvancedConfig: !!promptConfig.advanced_config,
            hasContextVariables: !!promptConfig.context_variables,
            allowedTokenIds: promptConfig.allowed_token_ids
          });

        } catch (dbError) {
          logger.error('Failed to load prompt configuration', { error: dbError, prompt_id });
          return res.status(500).json({
            success: false,
            error: 'Failed to load prompt configuration',
            timestamp: new Date().toISOString()
          });
        }
      }

      // 🔥 向后兼容：如果没有messages但有userInput，构造简单消息
      if (!messages.length && userInput) {
        finalMessages = [{ role: 'user', content: userInput }];
      }

      // 🔥 处理用户消息模板替换（如果配置了user_prompt_template）
      if (promptConfig && promptConfig.user_prompt_template) {
        finalMessages = finalMessages.map((msg: any) => {
          if (msg.role === 'user') {
            const templateContext = {
              user_input: msg.content,
              conversation_id: conversation_id || prompt_id,
              timestamp: new Date().toISOString()
            };
            const processedContent = processContextVariables(
              promptConfig.user_prompt_template,
              promptConfig.context_variables,
              templateContext
            );
            return { ...msg, content: processedContent };
          }
          return msg;
        });
      }

      logger.info('Debug Prompt V2 called with enhanced config', {
        prompt_id,
        hasSystemPrompt: !!finalSystemPrompt,
        messageCount: finalMessages.length,
        model: finalModel,
        conversation_id,
        hasAdvancedConfig: !!finalParameters.advanced_config
      });

      // 🔥 调用Bot Core的内部LLM调试接口，传递完整配置
      const internalApiPayload = {
        systemPrompt: finalSystemPrompt,
        messages: finalMessages,        // 🔥 传递多轮对话
        parameters: finalParameters,    // 🔥 传递完整配置
        model: finalModel,
        conversation_id: conversation_id || prompt_id
      };

      const internalApiResponse = await fetch(`${QQBOT_CORE_URL}/api/internal/llm/debug`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(internalApiPayload)
      });

      if (!internalApiResponse.ok) {
        const errorText = await internalApiResponse.text();
        logger.error('Bot Core internal API failed', {
          status: internalApiResponse.status,
          statusText: internalApiResponse.statusText,
          response: errorText,
          payload: internalApiPayload
        });

        return res.status(internalApiResponse.status).json({
          success: false,
          error: `Bot Core API failed: ${internalApiResponse.statusText}`,
          details: errorText,
          timestamp: new Date().toISOString()
        });
      }

      const apiResult = await internalApiResponse.json() as any;

      logger.info('Debug Prompt V2 succeeded via Bot Core', {
        hasResponse: !!apiResult.response,
        model: apiResult.model,
        conversation_id: conversation_id || prompt_id,
        prompt_id
      });

      res.json({
        success: true,
        response: apiResult.response,
        thinking: apiResult.thinking,           // 🔥 支持思考过程
        token_used: apiResult.token_used,
        model: apiResult.model,
        performance: apiResult.performance,
        prompt_config: promptConfig ? {         // 🔥 返回使用的配置信息
          prompt_name: promptConfig.prompt_name,
          agent_type: promptConfig.agent_type,
          model_name: promptConfig.model_name
        } : null,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Debug Prompt V2 failed', { error, prompt_id: req.body.prompt_id });
      res.status(500).json({
        success: false,
        error: 'Failed to execute debug prompt via Bot Core',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createDebugRoutes;
