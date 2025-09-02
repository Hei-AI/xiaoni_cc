// Session管理API处理器
// 这个文件包含HTTP服务器的Session管理相关方法

import { Request, Response } from 'express';
import { DatabaseManager } from './database';
import { logger } from '../utils/logger';

export class SessionApiHandlers {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('session-api-handlers');

  constructor(database: DatabaseManager) {
    this.database = database;
  }

  // Session管理API处理器
  async handleGetSessions(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.query.user_id ? parseInt(req.query.user_id as string) : undefined;
      const status = req.query.status as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      // 获取Session列表
      const sessions = await this.database.getSessions(userId, limit, status);
      res.json({ 
        success: true,
        data: sessions, 
        total: sessions.length 
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get sessions', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to get sessions',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async handleGetSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.id;
      const session = await this.database.getSessionById(sessionId);
      
      if (!session) {
        res.status(404).json({ 
          success: false,
          error: 'Session not found' 
        });
        return;
      }

      res.json({ 
        success: true,
        data: session 
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get session', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to get session',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async handleSwitchSessionService(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.id;
      const { service, reason } = req.body;

      if (!service) {
        res.status(400).json({ 
          success: false,
          error: 'Missing required parameter: service' 
        });
        return;
      }

      const success = await this.database.switchSessionService(sessionId, service, reason);
      
      if (success) {
        res.json({ 
          success: true, 
          message: 'Session service switched successfully' 
        });
      } else {
        res.status(404).json({ 
          success: false,
          error: 'Session not found or switch failed' 
        });
      }
    } catch (error) {
      this.moduleLogger.error('Failed to switch session service', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to switch session service',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async handleCleanupSessions(req: Request, res: Response): Promise<void> {
    try {
      const cleanedCount = await this.database.cleanupExpiredSessions();
      res.json({ 
        success: true,
        message: 'Sessions cleaned up successfully',
        cleaned_count: cleanedCount 
      });
    } catch (error) {
      this.moduleLogger.error('Failed to cleanup sessions', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to cleanup sessions',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}