import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

// 创建对话管理相关路由
export function createConversationRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  // 获取对话列表
  router.get('/conversations', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(1, Math.min(200, parseInt(req.query.limit as string) || 20));
      const offset = (page - 1) * limit;

      logger.info('Query params debug', { page, limit, offset, types: [typeof page, typeof limit, typeof offset] });

      const conversations = await database.executeQuery(
        `SELECT id, user_id, user_message, ai_response, timestamp, response_time, model_name, status, trace_id
         FROM conversations
         ORDER BY timestamp DESC
         LIMIT ${offset}, ${limit}`
      );

      const totalCount = await database.executeQuery<{ total: number }>('SELECT COUNT(*) as total FROM conversations');
      const total = totalCount[0]?.total || 0;

      res.json({
        success: true,
        data: conversations,
        total,
        page,
        limit,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch conversations', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch conversations',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取特定对话详情
  router.get('/conversations/:id', async (req, res) => {
    try {
      const conversationId = req.params.id;

      const conversation = await database.executeQuery(
        'SELECT * FROM conversations WHERE id = ?',
        [conversationId]
      );

      if (conversation.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: conversation[0],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch conversation', { error, conversationId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch conversation',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取对话的时间线数据
  router.get('/conversations/:conversationId/timeline', async (req, res) => {
    try {
      const { conversationId } = req.params;

      // 获取对话基本信息
      const conversation = await database.executeQuery(
        'SELECT * FROM conversations WHERE id = ?',
        [conversationId]
      );

      if (conversation.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
          timestamp: new Date().toISOString()
        });
      }

      const conv = conversation[0] as any;
      const traceId = conv.trace_id;

      // 获取LLM调用链
      let llmCallChain: any[] = [];
      try {
        llmCallChain = await database.executeQuery(
          `SELECT
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
           FROM llm_call_logs l
           INNER JOIN (
             SELECT id, timestamp, call_sequence
             FROM llm_call_logs
             WHERE conversation_id = ?
             UNION DISTINCT
             SELECT id, timestamp, call_sequence
             FROM llm_call_logs
             WHERE trace_id = ?
           ) matched ON matched.id = l.id
           ORDER BY matched.timestamp ASC, matched.call_sequence ASC, matched.id ASC`,
          [conversationId, traceId]
        );
      } catch (error) {
        logger.warn('Failed to fetch LLM call chain', { error });
        llmCallChain = [];
      }

      // 获取WebSocket日志
      let websocketLogs: any[] = [];
      try {
        websocketLogs = await database.executeQuery(
          `SELECT * FROM websocket_logs WHERE trace_id = ? ORDER BY timestamp ASC`,
          [traceId]
        );
      } catch (error) {
        logger.warn('Failed to fetch websocket logs', { error });
        websocketLogs = [];
      }

      // 获取时间线事件
      let timelineEvents: any[] = [];
      try {
        timelineEvents = await database.executeQuery(
          `SELECT * FROM timeline_events WHERE trace_id = ? ORDER BY event_time ASC`,
          [traceId]
        );
      } catch (error) {
        logger.warn('Failed to fetch timeline events', { error });
        timelineEvents = [];
      }

      // 构建完整的时间线响应
      const response = {
        conversation_id: conversationId,
        trace_id: traceId,
        conversation: conv,
        llm_call_chain: llmCallChain,
        websocket_logs: websocketLogs,
        timeline_events: timelineEvents,
        summary: {
          total_llm_calls: llmCallChain.length,
          total_websocket_events: websocketLogs.length,
          total_timeline_events: timelineEvents.length,
          conversation_status: conv.status,
          model_used: conv.model_name,
          response_time_ms: conv.response_time
        }
      };

      res.json(response);

    } catch (error) {
      logger.error('Failed to fetch conversation timeline', { error, conversationId: req.params.conversationId });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch conversation timeline',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createConversationRoutes;
