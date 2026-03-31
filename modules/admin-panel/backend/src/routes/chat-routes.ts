import express from 'express';
import { getEast8StartOfDay, serializeTimestampForStorage } from '@qq-bot/persistence';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

// Type interfaces for database query results
interface PrivateChatSettingRow {
  user_id: number;
  username: string | null;
  is_enabled: number;
  auto_reply_enabled: number;
  transcript_compact_offset: number | null;
  welcome_message: string | null;
  user_notes: string | null;
  agent_prompt_id: string | null;
  last_activity: string | null;
}

interface GroupChatSettingRow {
  group_id: number;
  group_name: string | null;
  is_enabled: number;
  auto_reply_enabled: number;
  transcript_compact_offset: number | null;
  welcome_message: string | null;
  admin_user_id: number | null;
  agent_prompt_id: string | null;
  last_activity: string | null;
}

// 创建聊天管理相关路由
export function createChatRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  const hasAgentPromptBinding = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().length > 0;

  router.post('/group-chats', async (req, res) => {
    try {
      const groupId = Number(req.body?.group_id);
      const groupName = typeof req.body?.group_name === 'string' ? req.body.group_name.trim() : '';

      if (!Number.isFinite(groupId) || groupId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid group ID',
          timestamp: new Date().toISOString()
        });
      }

      const success = await database.upsertGroupChatSettings(groupId, {
        group_name: groupName || null,
        is_enabled: 1,
        auto_reply_enabled: 0
      });
      const groupSettings = await database.getGroupChatSettingById(groupId);

      res.status(success ? 201 : 200).json({
        success: true,
        message: 'Group created successfully',
        data: groupSettings || {
          group_id: groupId,
          group_name: groupName || null,
          is_enabled: 1,
          auto_reply_enabled: 0
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to create group chat settings', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to create group settings',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

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
        whereConditions.push('g.is_enabled = 1 AND g.auto_reply_enabled = 1');
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
          g.transcript_compact_offset,
          g.welcome_message,
          g.admin_user_id,
          g.agent_prompt_id,
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
            WHEN g.is_enabled = 1 THEN 'receiving_only'
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
      let whereConditions = ['1=1'];
      let queryParams: any[] = [];

      if (search) {
        whereConditions.push('(pcs.username LIKE ? OR targets.user_id LIKE ?)');
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      if (is_enabled !== undefined) {
        whereConditions.push('COALESCE(pcs.is_enabled, 1) = ?');
        queryParams.push(is_enabled === 'true' ? 1 : 0);
      }

      if (auto_reply_enabled !== undefined) {
        whereConditions.push('COALESCE(pcs.auto_reply_enabled, 0) = ?');
        queryParams.push(auto_reply_enabled === 'true' ? 1 : 0);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取私聊用户列表和统计数据
      const privateChatUsers = await database.executeQuery(`
        SELECT
          targets.user_id,
          COALESCE(pcs.username, CONCAT('用户', targets.user_id)) as nickname,
          stats.last_conversation_time,
          CASE
            WHEN COALESCE(stats.successful_replies, 0) > 0 THEN 'success'
            WHEN COALESCE(stats.failed_replies, 0) > 0 THEN 'failed'
            ELSE 'pending'
          END as status,
          COALESCE(stats.total_conversations, 0) as total_conversations,
          COALESCE(stats.successful_replies, 0) as successful_replies,
          COALESCE(stats.failed_replies, 0) as failed_replies,
          CASE
            WHEN COALESCE(stats.total_conversations, 0) = 0 THEN 0
            ELSE ROUND(COALESCE(stats.successful_replies, 0) * 100.0 / stats.total_conversations, 1)
          END as success_rate,
          CASE
            WHEN stats.avg_response_time IS NULL THEN '0ms'
            ELSE CONCAT(ROUND(stats.avg_response_time), 'ms')
          END as avg_response_time,
          COALESCE(pcs.is_enabled, 1) as is_enabled,
          COALESCE(pcs.auto_reply_enabled, 0) as auto_reply_enabled,
          COALESCE(pcs.transcript_compact_offset, 6) as transcript_compact_offset,
          pcs.user_notes,
          pcs.agent_prompt_id
        FROM (
          SELECT user_id FROM private_chat_settings
          UNION
          SELECT DISTINCT user_id FROM conversations WHERE group_id IS NULL
        ) targets
        LEFT JOIN private_chat_settings pcs ON targets.user_id = pcs.user_id
        LEFT JOIN (
          SELECT
            user_id,
            MAX(timestamp) as last_conversation_time,
            COUNT(*) as total_conversations,
            COUNT(CASE WHEN status = 'completed' AND ai_response IS NOT NULL AND ai_response != '' THEN 1 END) as successful_replies,
            COUNT(CASE WHEN status = 'failed' OR ai_response IS NULL OR ai_response = '' THEN 1 END) as failed_replies,
            AVG(CASE WHEN response_time > 0 THEN response_time ELSE NULL END) as avg_response_time
          FROM conversations
          WHERE group_id IS NULL
          GROUP BY user_id
        ) stats ON targets.user_id = stats.user_id
        WHERE ${whereClause}
        ORDER BY COALESCE(stats.last_conversation_time, pcs.updated_at, pcs.created_at) DESC, targets.user_id DESC
        LIMIT ${limit} OFFSET ${offset}
      `, queryParams);

      // 获取总用户数
      const totalUsersResult = await database.executeQuery<{ total: number }>(`
        SELECT COUNT(*) as total
        FROM (
          SELECT user_id FROM private_chat_settings
          UNION
          SELECT DISTINCT user_id FROM conversations WHERE group_id IS NULL
        ) targets
        LEFT JOIN private_chat_settings pcs ON targets.user_id = pcs.user_id
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
        queryParams.push(serializeTimestampForStorage(startTime) || startTime);
      }

      if (endTime) {
        whereConditions.push('c.timestamp <= ?');
        queryParams.push(serializeTimestampForStorage(endTime) || endTime);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取用户设置
      const userSettingsRows = await database.executeQuery<PrivateChatSettingRow>(`
        SELECT user_id, username, is_enabled, auto_reply_enabled, welcome_message, user_notes,
               transcript_compact_offset, agent_prompt_id, last_activity
        FROM private_chat_settings
        WHERE user_id = ?
      `, [userId]);

      const userSettingRow = userSettingsRows[0];
      const userSettings = {
        user_id: userId,
        nickname: userSettingRow?.username || `用户${userId}`,
        is_enabled: userSettingRow?.is_enabled ?? 1,
        auto_reply_enabled: userSettingRow?.auto_reply_enabled ?? 0,
        transcript_compact_offset: userSettingRow?.transcript_compact_offset ?? 6,
        welcome_message: userSettingRow?.welcome_message || null,
        user_notes: userSettingRow?.user_notes || null,
        agent_prompt_id: userSettingRow?.agent_prompt_id || null,
        last_activity: userSettingRow?.last_activity || null
      };

      // 获取今日统计
      const todayStart = serializeTimestampForStorage(getEast8StartOfDay()) || '1970-01-01 00:00:00.000';
      const todayStats = await database.executeQuery(`
        SELECT
          COUNT(*) as today_conversations,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as today_success,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as today_failed
        FROM conversations
        WHERE user_id = ? AND timestamp >= ?
      `, [userId, todayStart]);

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
        LIMIT ${limit} OFFSET ${offset}
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

  router.post('/private-chats', async (req, res) => {
    try {
      const userId = Number(req.body?.user_id);
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';

      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID',
          timestamp: new Date().toISOString()
        });
      }

      const success = await database.upsertPrivateChatSettings(userId, {
        username: username || null,
        is_enabled: 1,
        auto_reply_enabled: 0
      });
      const settings = await database.getPrivateChatSettingById(userId);

      res.status(success ? 201 : 200).json({
        success: true,
        message: 'Private chat created successfully',
        data: settings || {
          user_id: userId,
          username: username || null,
          is_enabled: 1,
          auto_reply_enabled: 0
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to create private chat settings', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to create private chat settings',
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
      const updates = req.body as Record<string, any>;

      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID',
          timestamp: new Date().toISOString()
        });
      }

      const allowedFields = new Set([
        'username',
        'is_enabled',
        'auto_reply_enabled',
        'transcript_compact_offset',
        'welcome_message',
        'user_notes',
        'agent_prompt_id'
      ]);
      const sanitizedUpdates: Record<string, any> = {};
      let validationError: string | null = null;

      Object.entries(updates || {}).forEach(([key, value]) => {
        if (!allowedFields.has(key) || value === undefined) {
          return;
        }

        if (key === 'is_enabled' || key === 'auto_reply_enabled') {
          sanitizedUpdates[key] = value ? 1 : 0;
          return;
        }

        if (key === 'transcript_compact_offset') {
          const numericValue = Number(value);
          if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 500) {
            validationError = 'transcript_compact_offset must be an integer between 0 and 500';
            return;
          }
          sanitizedUpdates[key] = numericValue;
          return;
        }

        sanitizedUpdates[key] = value;
      });

      if (validationError) {
        return res.status(400).json({
          success: false,
          error: validationError,
          timestamp: new Date().toISOString()
        });
      }

      if (Object.keys(sanitizedUpdates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid fields to update',
          timestamp: new Date().toISOString()
        });
      }

      const currentSettings = await database.getPrivateChatSettingById(userId);
      const nextAgentPromptId = Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'agent_prompt_id')
        ? sanitizedUpdates.agent_prompt_id
        : currentSettings?.agent_prompt_id;
      const nextAutoReplyEnabled = Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'auto_reply_enabled')
        ? sanitizedUpdates.auto_reply_enabled
        : currentSettings?.auto_reply_enabled ?? 0;

      if (nextAutoReplyEnabled === 1 && !hasAgentPromptBinding(nextAgentPromptId)) {
        return res.status(400).json({
          success: false,
          error: 'Cannot enable auto reply without an agent prompt binding',
          timestamp: new Date().toISOString()
        });
      }

      const success = await database.upsertPrivateChatSettings(userId, sanitizedUpdates);
      const updatedSettings = await database.getPrivateChatSettingById(userId);

      res.json({
        success,
        message: success ? 'User settings updated successfully' : 'User settings unchanged',
        data: updatedSettings ? { ...updatedSettings, user_id: userId } : { user_id: userId, ...sanitizedUpdates },
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
        queryParams.push(serializeTimestampForStorage(startTime) || startTime);
      }

      if (endTime) {
        whereConditions.push('c.timestamp <= ?');
        queryParams.push(serializeTimestampForStorage(endTime) || endTime);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取群聊设置
      const groupSettingsRows = await database.executeQuery<GroupChatSettingRow>(`
        SELECT group_id, group_name, is_enabled, auto_reply_enabled, welcome_message,
               transcript_compact_offset, admin_user_id, agent_prompt_id, last_activity
        FROM group_chat_settings
        WHERE group_id = ?
      `, [groupId]);

      const groupSettingsRow = groupSettingsRows[0];
      const groupSettings = {
        group_id: groupId,
        group_name: groupSettingsRow?.group_name || `群聊${groupId}`,
        is_enabled: groupSettingsRow?.is_enabled ?? 1,
        auto_reply_enabled: groupSettingsRow?.auto_reply_enabled ?? 0,
        transcript_compact_offset: groupSettingsRow?.transcript_compact_offset ?? 6,
        welcome_message: groupSettingsRow?.welcome_message || null,
        admin_user_id: groupSettingsRow?.admin_user_id || null,
        agent_prompt_id: groupSettingsRow?.agent_prompt_id || null,
        last_activity: groupSettingsRow?.last_activity || null
      };

      // 获取今日统计
      const todayStart = serializeTimestampForStorage(getEast8StartOfDay()) || '1970-01-01 00:00:00.000';
      const todayStats = await database.executeQuery(`
        SELECT
          COUNT(*) as today_conversations,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as today_success,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as today_failed
        FROM conversations
        WHERE group_id = ? AND timestamp >= ?
      `, [groupId, todayStart]);

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
        LIMIT ${limit} OFFSET ${offset}
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
      const updates = req.body as Record<string, any>;

      if (!groupId || isNaN(groupId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid group ID',
          timestamp: new Date().toISOString()
        });
      }

      const allowedFields = new Set([
        'group_name',
        'is_enabled',
        'auto_reply_enabled',
        'transcript_compact_offset',
        'welcome_message',
        'admin_user_id'
      ]);
      const sanitizedUpdates: Record<string, any> = {};
      let validationError: string | null = null;

      Object.entries(updates || {}).forEach(([key, value]) => {
        if (!allowedFields.has(key) || value === undefined) {
          return;
        }

        if (key === 'is_enabled' || key === 'auto_reply_enabled') {
          sanitizedUpdates[key] = value ? 1 : 0;
          return;
        }

        if (key === 'transcript_compact_offset') {
          const numericValue = Number(value);
          if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 500) {
            validationError = 'transcript_compact_offset must be an integer between 0 and 500';
            return;
          }
          sanitizedUpdates[key] = numericValue;
          return;
        }

        sanitizedUpdates[key] = value;
      });

      if (validationError) {
        return res.status(400).json({
          success: false,
          error: validationError,
          timestamp: new Date().toISOString()
        });
      }

      if (Object.keys(sanitizedUpdates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid fields to update',
          timestamp: new Date().toISOString()
        });
      }

      const currentSettings = await database.getGroupChatSettingById(groupId);
      const nextAgentPromptId = currentSettings?.agent_prompt_id;
      const nextAutoReplyEnabled = Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'auto_reply_enabled')
        ? sanitizedUpdates.auto_reply_enabled
        : currentSettings?.auto_reply_enabled ?? 0;

      if (nextAutoReplyEnabled === 1 && !hasAgentPromptBinding(nextAgentPromptId)) {
        return res.status(400).json({
          success: false,
          error: 'Cannot enable auto reply without an agent prompt binding',
          timestamp: new Date().toISOString()
        });
      }

      const success = await database.upsertGroupChatSettings(groupId, sanitizedUpdates);
      const updatedSettings = await database.getGroupChatSettingById(groupId);

      if (!success) {
        const hasMismatch = updatedSettings
          ? Object.entries(sanitizedUpdates).some(([key, value]) => {
              return (updatedSettings as Record<string, any>)[key] !== value;
            })
          : true;

        if (hasMismatch) {
          return res.status(500).json({
            success: false,
            error: 'Failed to update group settings',
            timestamp: new Date().toISOString()
          });
        }
      }

      res.json({
        success: true,
        message: success ? 'Group settings updated successfully' : 'Group settings unchanged',
        data: updatedSettings || { group_id: groupId, ...sanitizedUpdates },
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

  // 更新私聊用户的 Prompt 绑定
  router.put('/private-chats/:userId/prompt', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { prompt_id } = req.body;

      if (!userId || isNaN(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID',
          timestamp: new Date().toISOString()
        });
      }

      // prompt_id can be null (to unbind) or a valid UUID string
      const promptId = prompt_id === null ? null : String(prompt_id);

      // Validate prompt exists if not null
      if (promptId !== null) {
        const prompt = await database.getAgentPromptById(promptId);
        if (!prompt) {
          return res.status(404).json({
            success: false,
            error: 'Prompt not found',
            timestamp: new Date().toISOString()
          });
        }
      }

      const success = await database.updatePrivateChatPrompt(userId, promptId);

      if (success) {
        logger.info('Private chat prompt updated', { userId, promptId });
        res.json({
          success: true,
          message: 'Prompt binding updated successfully',
          data: { user_id: userId, agent_prompt_id: promptId },
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to update prompt binding',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Failed to update private chat prompt', { error, userId: req.params.userId });
      res.status(500).json({
        success: false,
        error: 'Failed to update prompt binding',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 更新群聊的 Prompt 绑定
  router.put('/group-chats/:groupId/prompt', async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId);
      const { prompt_id } = req.body;

      if (!groupId || isNaN(groupId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid group ID',
          timestamp: new Date().toISOString()
        });
      }

      // prompt_id can be null (to unbind) or a valid UUID string
      const promptId = prompt_id === null ? null : String(prompt_id);

      // Validate prompt exists if not null
      if (promptId !== null) {
        const prompt = await database.getAgentPromptById(promptId);
        if (!prompt) {
          return res.status(404).json({
            success: false,
            error: 'Prompt not found',
            timestamp: new Date().toISOString()
          });
        }
      }

      const success = await database.updateGroupChatPrompt(groupId, promptId);

      if (success) {
        logger.info('Group chat prompt updated', { groupId, promptId });
        res.json({
          success: true,
          message: 'Prompt binding updated successfully',
          data: { group_id: groupId, agent_prompt_id: promptId },
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to update prompt binding',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Failed to update group chat prompt', { error, groupId: req.params.groupId });
      res.status(500).json({
        success: false,
        error: 'Failed to update prompt binding',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createChatRoutes;
