import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

// 创建用户资料相关路由
export function createUserRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  // 获取用户资料信息
  router.get('/user-profiles/:userId', async (req, res) => {
    try {
      const userId = req.params.userId;

      if (!userId || isNaN(Number(userId))) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID',
          timestamp: new Date().toISOString()
        });
      }

      // 从private_chat_settings表获取用户信息
      const userProfile = await database.executeQuery<{
        user_id: number;
        username: string;
        is_enabled: boolean;
        auto_reply_enabled: boolean;
        welcome_message: string;
        user_notes: string;
        created_at: string;
        updated_at: string;
        last_activity: string;
      }>(
        `SELECT user_id, username, is_enabled, auto_reply_enabled, welcome_message,
                user_notes, created_at, updated_at, last_activity
         FROM private_chat_settings
         WHERE user_id = ?`,
        [userId]
      );

      if (userProfile.length === 0) {
        // 如果没有找到用户资料，创建一个默认的
        const defaultUsername = `用户${userId}`;

        await database.executeInsert(
          `INSERT INTO private_chat_settings (user_id, username, is_enabled, auto_reply_enabled)
           VALUES (?, ?, ?, ?)`,
          [userId, defaultUsername, true, true]
        );

        return res.json({
          success: true,
          data: {
            user_id: parseInt(userId),
            username: defaultUsername,
            display_name: defaultUsername,
            is_enabled: true,
            auto_reply_enabled: true,
            welcome_message: null,
            user_notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_activity: null
          },
          timestamp: new Date().toISOString()
        });
      }

      const profile = userProfile[0];
      const displayName = profile.username || `用户${userId}`;

      res.json({
        success: true,
        data: {
          user_id: profile.user_id,
          username: profile.username,
          display_name: displayName,
          is_enabled: profile.is_enabled,
          auto_reply_enabled: profile.auto_reply_enabled,
          welcome_message: profile.welcome_message,
          user_notes: profile.user_notes,
          created_at: profile.created_at,
          updated_at: profile.updated_at,
          last_activity: profile.last_activity
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch user profile', { error, userId: req.params.userId });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user profile',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 更新用户资料信息
  router.put('/user-profiles/:userId', async (req, res) => {
    try {
      const userId = req.params.userId;
      const { username, is_enabled, auto_reply_enabled, welcome_message, user_notes } = req.body;

      if (!userId || isNaN(Number(userId))) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user ID',
          timestamp: new Date().toISOString()
        });
      }

      // 检查用户是否存在
      const existingUser = await database.executeQuery(
        'SELECT user_id FROM private_chat_settings WHERE user_id = ?',
        [userId]
      );

      if (existingUser.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          timestamp: new Date().toISOString()
        });
      }

      // 更新用户信息
      const result = await database.executeUpdate(
        `UPDATE private_chat_settings
         SET username = ?, is_enabled = ?, auto_reply_enabled = ?,
             welcome_message = ?, user_notes = ?, updated_at = NOW()
         WHERE user_id = ?`,
        [username, is_enabled ? 1 : 0, auto_reply_enabled ? 1 : 0, welcome_message, user_notes, userId]
      );

      if (result === 0) {
        return res.status(400).json({
          success: false,
          error: 'Failed to update user profile',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: 'User profile updated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to update user profile', { error, userId: req.params.userId });
      res.status(500).json({
        success: false,
        error: 'Failed to update user profile',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 批量获取用户资料信息（用于列表页面）
  router.post('/user-profiles/batch', async (req, res) => {
    try {
      const { userIds } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user IDs array',
          timestamp: new Date().toISOString()
        });
      }

      // 验证所有ID都是数字
      const validIds = userIds.filter(id => !isNaN(Number(id)));
      if (validIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid user IDs provided',
          timestamp: new Date().toISOString()
        });
      }

      const placeholders = validIds.map(() => '?').join(',');
      const userProfiles = await database.executeQuery<{
        user_id: number;
        username: string;
        is_enabled: boolean;
        auto_reply_enabled: boolean;
        last_activity: string;
      }>(
        `SELECT user_id, username, is_enabled, auto_reply_enabled, last_activity
         FROM private_chat_settings
         WHERE user_id IN (${placeholders})`,
        validIds
      );

      // 创建用户资料映射
      const profileMap: Record<string, any> = {};
      userProfiles.forEach(profile => {
        profileMap[profile.user_id.toString()] = {
          user_id: profile.user_id,
          username: profile.username,
          display_name: profile.username || `用户${profile.user_id}`,
          is_enabled: profile.is_enabled,
          auto_reply_enabled: profile.auto_reply_enabled,
          last_activity: profile.last_activity
        };
      });

      // 为没有资料的用户创建默认信息
      validIds.forEach(userId => {
        if (!profileMap[userId.toString()]) {
          profileMap[userId.toString()] = {
            user_id: parseInt(userId),
            username: null,
            display_name: `用户${userId}`,
            is_enabled: true,
            auto_reply_enabled: true,
            last_activity: null
          };
        }
      });

      res.json({
        success: true,
        data: profileMap,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to batch fetch user profiles', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to batch fetch user profiles',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createUserRoutes;