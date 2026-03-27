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
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const whereClauses: string[] = [];
      const params: Array<string | number> = [];

      if (search) {
        const pattern = `%${search}%`;
        whereClauses.push(
          `(CAST(id AS TEXT) ILIKE ? OR CAST(user_id AS TEXT) ILIKE ? OR COALESCE(user_message, '') ILIKE ? OR COALESCE(ai_response, '') ILIKE ? OR COALESCE(trace_id, '') ILIKE ?)`
        );
        params.push(pattern, pattern, pattern, pattern, pattern);
      }

      const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const conversations = await database.executeQuery(
        `SELECT id, user_id, user_message, ai_response, timestamp, response_time, model_name, status, trace_id
         FROM conversations
         ${whereClause}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      const totalCount = await database.executeQuery<{ total: number }>(
        `SELECT COUNT(*) as total FROM conversations ${whereClause}`,
        params
      );
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

  return router;
}

export default createConversationRoutes;
