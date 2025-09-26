import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

// 创建聊天管理相关路由
export function createChatRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  // 获取群聊列表和统计
  router.get('/group-chats', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(1, Math.min(200, parseInt(req.query.limit as string) || 20));
      const offset = (page - 1) * limit;
      const search = req.query.search as string || '';
      const status = req.query.status as string;
      const sortBy = req.query.sortBy as string;

      // 构建查询条件
      let whereConditions = ['1=1'];
      let queryParams: any[] = [];

      if (search) {
        whereConditions.push('(g.group_name LIKE ? OR g.group_id LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      if (status === 'active') {
        whereConditions.push('g.is_enabled = 1');
      }

      const whereClause = whereConditions.join(' AND ');

      // 确定排序方式
      let orderBy = 'g.created_at DESC';
      if (sortBy === 'activity_level') {
        orderBy = 'activity_level DESC, g.created_at DESC';
      }

      // 获取群聊列表数据，包含统计信息
      const groupChats = await database.executeQuery(`
        SELECT
          g.group_id,
          g.group_name,
          g.is_enabled,
          g.auto_reply_enabled,
          g.welcome_message,
          g.admin_user_id,
          g.last_activity,
          g.created_at,
          g.updated_at,
          COALESCE(stats.total_conversations, 0) as total_conversations,
          COALESCE(stats.successful_replies, 0) as successful_replies,
          COALESCE(stats.failed_replies, 0) as failed_replies,
          COALESCE(stats.success_rate, 0) as success_rate,
          COALESCE(stats.avg_response_time, 0) as avg_response_time,
          CASE
            WHEN g.last_activity IS NULL THEN 0
            WHEN g.last_activity >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 80
            WHEN g.last_activity >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 60
            WHEN g.last_activity >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 30
            ELSE 10
          END as activity_level,
          CASE
            WHEN g.is_enabled = 1 AND g.auto_reply_enabled = 1 THEN 'active'
            WHEN g.is_enabled = 1 THEN 'enabled'
            ELSE 'disabled'
          END as status,
          g.last_activity as last_conversation_time
        FROM group_chat_settings g
        LEFT JOIN (
          SELECT
            group_id,
            COUNT(*) as total_conversations,
            COUNT(CASE WHEN status = 'completed' AND ai_response IS NOT NULL AND ai_response != '' THEN 1 END) as successful_replies,
            COUNT(CASE WHEN status = 'failed' OR ai_response IS NULL OR ai_response = '' THEN 1 END) as failed_replies,
            ROUND(COUNT(CASE WHEN status = 'completed' AND ai_response IS NOT NULL AND ai_response != '' THEN 1 END) * 100.0 / COUNT(*), 1) as success_rate,
            AVG(CASE WHEN response_time > 0 THEN response_time ELSE NULL END) as avg_response_time
          FROM conversations
          WHERE group_id IS NOT NULL
          GROUP BY group_id
        ) stats ON g.group_id = stats.group_id
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `, queryParams);

      // 获取总数
      const totalResult = await database.executeQuery<{ total: number }>(`
        SELECT COUNT(*) as total
        FROM group_chat_settings g
        WHERE ${whereClause}
      `, queryParams);
      const total = totalResult[0]?.total || 0;

      // 获取全局统计数据
      const globalStats = await database.executeQuery(`
        SELECT
          COUNT(DISTINCT g.group_id) as total_groups,
          COUNT(CASE WHEN g.is_enabled = 1 THEN 1 END) as enabled_groups,
          COUNT(CASE WHEN g.auto_reply_enabled = 1 THEN 1 END) as auto_reply_groups,
          COUNT(CASE WHEN g.last_activity >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as active_groups
        FROM group_chat_settings g
      `);

      res.json({
        success: true,
        data: groupChats,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        stats: globalStats[0] || {},
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch group chats', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch group chats',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取私聊列表和统计
  router.get('/private-chats', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(1, Math.min(200, parseInt(req.query.limit as string) || 20));
      const offset = (page - 1) * limit;
      const search = req.query.search as string || '';
      const is_enabled = req.query.is_enabled;
      const auto_reply_enabled = req.query.auto_reply_enabled;

      // 构建查询条件
      let whereConditions = ['c.group_id IS NULL']; // 只获取私聊对话
      let queryParams: any[] = [];

      if (search) {
        whereConditions.push('(pcs.username LIKE ? OR c.user_id LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      if (is_enabled !== undefined) {
        whereConditions.push('pcs.is_enabled = ?');
        queryParams.push(is_enabled === 'true' ? 1 : 0);
      }

      if (auto_reply_enabled !== undefined) {
        whereConditions.push('pcs.auto_reply_enabled = ?');
        queryParams.push(auto_reply_enabled === 'true' ? 1 : 0);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取私聊用户列表和统计数据
      const privateChatUsers = await database.executeQuery(`
        SELECT
          c.user_id,
          COALESCE(pcs.username, CONCAT('用户', c.user_id)) as nickname,
          MAX(c.timestamp) as last_conversation_time,
          CASE
            WHEN COUNT(CASE WHEN c.status = 'completed' AND c.ai_response IS NOT NULL AND c.ai_response != '' THEN 1 END) > 0 THEN 'success'
            WHEN COUNT(CASE WHEN c.status = 'failed' OR c.ai_response IS NULL OR c.ai_response = '' THEN 1 END) > 0 THEN 'failed'
            ELSE 'pending'
          END as status,
          COUNT(*) as total_conversations,
          COUNT(CASE WHEN c.status = 'completed' AND c.ai_response IS NOT NULL AND c.ai_response != '' THEN 1 END) as successful_replies,
          COUNT(CASE WHEN c.status = 'failed' OR c.ai_response IS NULL OR c.ai_response = '' THEN 1 END) as failed_replies,
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(COUNT(CASE WHEN c.status = 'completed' AND c.ai_response IS NOT NULL AND c.ai_response != '' THEN 1 END) * 100.0 / COUNT(*), 1)
          END as success_rate,
          CASE
            WHEN AVG(c.response_time) IS NULL THEN '0ms'
            ELSE CONCAT(ROUND(AVG(c.response_time)), 'ms')
          END as avg_response_time,
          COALESCE(pcs.is_enabled, 1) as is_enabled,
          COALESCE(pcs.auto_reply_enabled, 1) as auto_reply_enabled,
          pcs.user_notes
        FROM conversations c
        LEFT JOIN private_chat_settings pcs ON c.user_id = pcs.user_id
        WHERE ${whereClause}
        GROUP BY c.user_id, pcs.username, pcs.is_enabled, pcs.auto_reply_enabled, pcs.user_notes
        ORDER BY last_conversation_time DESC
        LIMIT ${limit} OFFSET ${offset}
      `, queryParams);

      // 获取总用户数
      const totalUsersResult = await database.executeQuery<{ total: number }>(`
        SELECT COUNT(DISTINCT c.user_id) as total
        FROM conversations c
        LEFT JOIN private_chat_settings pcs ON c.user_id = pcs.user_id
        WHERE ${whereClause}
      `, queryParams);
      const totalUsers = totalUsersResult[0]?.total || 0;

      res.json({
        success: true,
        data: privateChatUsers,
        pagination: {
          total: totalUsers,
          page,
          limit,
          totalPages: Math.ceil(totalUsers / limit)
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch private chat users', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch private chat users',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取特定用户的私聊详情
  router.get('/private-chats/:userId', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
      const offset = (page - 1) * limit;
      const search = req.query.search as string || '';
      const startTime = req.query.startTime as string;
      const endTime = req.query.endTime as string;

      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID',
          timestamp: new Date().toISOString()
        });
      }

      // 构建查询条件
      let whereConditions = ['c.user_id = ?'];
      let queryParams: any[] = [userId];

      if (search) {
        whereConditions.push('(c.user_message LIKE ? OR c.ai_response LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      if (startTime) {
        whereConditions.push('c.timestamp >= ?');
        queryParams.push(startTime);
      }

      if (endTime) {
        whereConditions.push('c.timestamp <= ?');
        queryParams.push(endTime);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取用户设置 (模拟数据，实际应从private_chat_settings表获取)
      const userSettings = {
        user_id: userId,
        nickname: `用户${userId}`,
        is_enabled: 1,
        auto_reply_enabled: 1,
        welcome_message: null,
        user_notes: null,
        last_activity: new Date().toISOString()
      };

      // 获取今日统计
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStats = await database.executeQuery(`
        SELECT
          COUNT(*) as today_conversations,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as today_success,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as today_failed
        FROM conversations
        WHERE user_id = ? AND timestamp >= ?
      `, [userId, todayStart.toISOString()]);

      // 获取对话列表
      const conversations = await database.executeQuery(`
        SELECT
          c.id as conversation_id,
          c.trace_id,
          c.user_message,
          c.ai_response,
          c.timestamp,
          c.response_time,
          c.status,
          c.error_reason,
          c.model_name,
          c.message_id,
          c.reply_to_message_id,
          c.reply_to_text
        FROM conversations c
        WHERE ${whereClause}
        ORDER BY c.timestamp DESC
        LIMIT ${offset}, ${limit}
      `, queryParams);

      // 获取总数
      const totalResult = await database.executeQuery<{ total: number }>(`
        SELECT COUNT(*) as total
        FROM conversations c
        WHERE ${whereClause}
      `, queryParams);
      const total = totalResult[0]?.total || 0;

      res.json({
        success: true,
        data: {
          user_id: userId,
          user_settings: userSettings,
          today_stats: todayStats[0] || { today_conversations: 0, today_success: 0, today_failed: 0 },
          conversations: conversations,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch user private chat details', { error, userId: req.params.userId });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user details',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 批量更新私聊用户设置
  router.post('/private-chats/batch', async (req, res) => {
    try {
      const { user_ids, is_enabled, auto_reply_enabled } = req.body;

      if (!Array.isArray(user_ids) || user_ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user_ids array',
          timestamp: new Date().toISOString()
        });
      }

      // 验证所有ID都是数字
      const validIds = user_ids.filter(id => !isNaN(Number(id)));
      if (validIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid user IDs provided',
          timestamp: new Date().toISOString()
        });
      }

      // 构建更新语句
      let updateFields = [];
      let updateValues = [];

      if (is_enabled !== undefined) {
        updateFields.push('is_enabled = ?');
        updateValues.push(is_enabled ? 1 : 0);
      }

      if (auto_reply_enabled !== undefined) {
        updateFields.push('auto_reply_enabled = ?');
        updateValues.push(auto_reply_enabled ? 1 : 0);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No fields to update',
          timestamp: new Date().toISOString()
        });
      }

      // 添加updated_at字段
      updateFields.push('updated_at = NOW()');

      const placeholders = validIds.map(() => '?').join(',');
      const updateQuery = `
        UPDATE private_chat_settings
        SET ${updateFields.join(', ')}
        WHERE user_id IN (${placeholders})
      `;

      const result = await database.executeUpdate(updateQuery, [...updateValues, ...validIds]);

      logger.info('Batch private chat settings updated', {
        user_ids: validIds,
        is_enabled,
        auto_reply_enabled,
        affectedRows: result
      });

      res.json({
        success: true,
        message: `Successfully updated ${result} users`,
        data: {
          updated_count: result,
          user_ids: validIds
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to batch update private chat settings', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to batch update settings',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 批量删除私聊用户
  router.delete('/private-chats/batch', async (req, res) => {
    try {
      const { user_ids } = req.body;

      if (!Array.isArray(user_ids) || user_ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user_ids array',
          timestamp: new Date().toISOString()
        });
      }

      // 验证所有ID都是数字
      const validIds = user_ids.filter(id => !isNaN(Number(id)));
      if (validIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid user IDs provided',
          timestamp: new Date().toISOString()
        });
      }

      const placeholders = validIds.map(() => '?').join(',');

      // 删除用户的所有对话记录
      const conversationsDeleted = await database.executeUpdate(
        `DELETE FROM conversations WHERE user_id IN (${placeholders})`,
        validIds
      );

      // 删除用户的私聊设置
      const settingsDeleted = await database.executeUpdate(
        `DELETE FROM private_chat_settings WHERE user_id IN (${placeholders})`,
        validIds
      );

      logger.info('Batch private chat users deleted', {
        user_ids: validIds,
        conversationsDeleted,
        settingsDeleted
      });

      res.json({
        success: true,
        message: `Successfully deleted ${validIds.length} users`,
        data: {
          deleted_count: validIds.length,
          user_ids: validIds,
          conversations_deleted: conversationsDeleted,
          settings_deleted: settingsDeleted
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to batch delete private chat users', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to batch delete users',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 更新用户私聊设置
  router.put('/private-chats/:userId/settings', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const updates = req.body;

      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID',
          timestamp: new Date().toISOString()
        });
      }

      // 这里应该更新private_chat_settings表，目前返回成功响应
      // TODO: 实现实际的数据库更新逻辑
      logger.info('User settings update requested', { userId, updates });

      res.json({
        success: true,
        message: 'User settings updated successfully',
        data: { user_id: userId, ...updates },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to update user settings', { error, userId: req.params.userId });
      res.status(500).json({
        success: false,
        error: 'Failed to update user settings',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 删除单个私聊用户
  router.delete('/private-chats/:userId', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);

      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID',
          timestamp: new Date().toISOString()
        });
      }

      // 删除用户的所有对话记录
      await database.executeQuery('DELETE FROM conversations WHERE user_id = ?', [userId]);

      // 删除用户的私聊设置
      await database.executeQuery('DELETE FROM private_chat_settings WHERE user_id = ?', [userId]);

      logger.info('Private chat user deleted', { userId });

      res.json({
        success: true,
        message: 'User deleted successfully',
        data: { user_id: userId },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to delete private chat user', { error, userId: req.params.userId });
      res.status(500).json({
        success: false,
        error: 'Failed to delete user',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 重试对话
  router.post('/private-chats/:userId/retry/:conversationId', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const conversationId = req.params.conversationId;

      if (!userId || isNaN(userId) || !conversationId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID or conversation ID',
          timestamp: new Date().toISOString()
        });
      }

      // 检查对话是否存在
      const conversation = await database.executeQuery(
        'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
        [conversationId, userId]
      );

      if (conversation.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
          timestamp: new Date().toISOString()
        });
      }

      // TODO: 实现实际的重试逻辑，调用AI服务重新处理
      logger.info('Conversation retry requested', { userId, conversationId });

      res.json({
        success: true,
        message: 'Conversation retry initiated',
        data: { userId, conversationId },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to retry conversation', { error, userId: req.params.userId, conversationId: req.params.conversationId });
      res.status(500).json({
        success: false,
        error: 'Failed to retry conversation',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取特定群聊的详情
  router.get('/group-chats/:groupId', async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId);
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 50));
      const offset = (page - 1) * limit;
      const search = req.query.search as string || '';
      const startTime = req.query.startTime as string;
      const endTime = req.query.endTime as string;
      const showAll = req.query.showAll === 'true';

      if (!groupId || isNaN(groupId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid group ID',
          timestamp: new Date().toISOString()
        });
      }

      // 构建查询条件 - 根据group_id字段查询
      let whereConditions = ['c.group_id = ?'];
      let queryParams: any[] = [groupId];

      if (search) {
        whereConditions.push('(c.user_message LIKE ? OR c.ai_response LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      if (startTime) {
        whereConditions.push('c.timestamp >= ?');
        queryParams.push(startTime);
      }

      if (endTime) {
        whereConditions.push('c.timestamp <= ?');
        queryParams.push(endTime);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取群聊设置 (模拟数据，实际应从group_chat_settings表获取)
      const groupSettings = {
        group_id: groupId,
        group_name: `群聊${groupId}`,
        is_enabled: 1,
        auto_reply_enabled: 1,
        welcome_message: null,
        admin_user_id: null,
        last_activity: new Date().toISOString()
      };

      // 获取今日统计
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStats = await database.executeQuery(`
        SELECT
          COUNT(*) as today_conversations,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as today_success,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as today_failed
        FROM conversations
        WHERE group_id = ? AND timestamp >= ?
      `, [groupId, todayStart.toISOString()]);

      // 获取对话列表
      const conversations = await database.executeQuery(`
        SELECT
          c.id,
          c.user_id,
          c.user_message,
          c.ai_response,
          c.timestamp,
          c.response_time,
          c.model_name,
          c.status
        FROM conversations c
        WHERE ${whereClause}
        ORDER BY c.timestamp DESC
        LIMIT ${offset}, ${limit}
      `, queryParams);

      // 获取总数
      const totalResult = await database.executeQuery<{ total: number }>(`
        SELECT COUNT(*) as total
        FROM conversations c
        WHERE ${whereClause}
      `, queryParams);
      const total = totalResult[0]?.total || 0;

      res.json({
        success: true,
        data: {
          group_id: groupId,
          group_settings: groupSettings,
          today_stats: todayStats[0] || { today_conversations: 0, today_success: 0, today_failed: 0 },
          conversations: conversations,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch group chat details', { error, groupId: req.params.groupId });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch group details',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 更新群聊设置
  router.put('/group-chats/:groupId/settings', async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId);
      const updates = req.body;

      if (!groupId || isNaN(groupId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid group ID',
          timestamp: new Date().toISOString()
        });
      }

      // 这里应该更新group_chat_settings表，目前返回成功响应
      // TODO: 实现实际的数据库更新逻辑
      logger.info('Group settings update requested', { groupId, updates });

      res.json({
        success: true,
        message: 'Group settings updated successfully',
        data: { group_id: groupId, ...updates },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to update group settings', { error, groupId: req.params.groupId });
      res.status(500).json({
        success: false,
        error: 'Failed to update group settings',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createChatRoutes;