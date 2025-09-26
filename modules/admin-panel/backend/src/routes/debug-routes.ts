import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

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
               model_name, raw_request, raw_response, status, trace_id
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
        SELECT *
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

      // 构建完整响应数据
      const responseData = {
        conversation_id: conversationId,
        trace_id: traceId,
        conversation: conversation,
        llm_calls: llmCalls,
        timeline_events: timelineEvents,
        websocket_logs: websocketLogs,
        flow_summary: {
          total_events: timelineEvents.length,
          total_llm_calls: llmCalls.length,
          total_websocket_events: websocketLogs.length,
          data_completeness: {
            conversation_record: 'complete',
            llm_call_logs: llmCalls.length > 0 ? 'complete' : 'missing',
            timeline_events: timelineEvents.length > 0 ? 'complete' : 'missing',
            websocket_logs: websocketLogs.length > 0 ? 'complete' : 'missing'
          }
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

  // 🔥 新的简化Debug prompt endpoint - 使用Bot Core内部接口
  router.post('/debug/prompt-v2', async (req, res) => {
    try {
      const {
        systemPrompt = '',     // 系统提示词
        userInput,            // 用户输入
        parameters = {},
        model = 'gemini-2.5-flash',
        conversation_id
      } = req.body;

      // 参数验证
      if (!userInput || typeof userInput !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'userInput is required and must be a string',
          timestamp: new Date().toISOString()
        });
      }

      logger.info('Debug Prompt V2 called', {
        hasSystemPrompt: !!systemPrompt,
        userInputLength: userInput.length,
        model,
        conversation_id
      });

      // 🔥 调用Bot Core的内部LLM调试接口
      const internalApiResponse = await fetch('http://localhost:8081/api/internal/llm/debug', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemPrompt,
          userInput,
          parameters,
          model,
          conversation_id
        })
      });

      if (!internalApiResponse.ok) {
        const errorText = await internalApiResponse.text();
        logger.error('Bot Core internal API failed', {
          status: internalApiResponse.status,
          statusText: internalApiResponse.statusText,
          response: errorText
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
        conversation_id
      });

      res.json({
        success: true,
        response: apiResult.response,
        token_used: apiResult.token_used,
        model: apiResult.model,
        performance: apiResult.performance,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Debug Prompt V2 failed', { error });
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