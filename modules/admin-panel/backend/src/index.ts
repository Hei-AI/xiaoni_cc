import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import winston from 'winston';
import { DatabaseManager } from './services/database';

// Load environment variables
config();

const app = express();
const PORT = parseInt(process.env.HTTP_PORT || '9080', 10);

// Configure logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: `${process.env.LOG_DIR || './resources/logs'}/admin-backend.log` 
    })
  ]
});

// Initialize database
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'qqbot_user',
  password: process.env.DB_PASSWORD || 'qqbot_password',
  database: process.env.DB_NAME || 'qqbot_db',
  charset: 'utf8mb4',
  timezone: '+08:00'
};

const database = new DatabaseManager(dbConfig, logger);

// Middleware
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim())
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'qq-bot-admin-backend',
    timestamp: new Date().toISOString()
  });
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    service: 'Admin Panel Backend',
    status: 'running',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Dashboard stats endpoint
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const stats = await database.getDashboardStats();
    res.json({
      ...stats,
      uptime: '2d 14h 32m', // 可以后续实现实际uptime计算
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get dashboard stats', { error });
    res.status(500).json({
      error: 'Failed to get dashboard stats',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// System logs endpoint
app.get('/api/logs', (req, res) => {
  const mockLogs = [
    { level: 'info', message: 'QQBot Core启动成功', timestamp: new Date().toISOString() },
    { level: 'info', message: 'WebSocket连接建立', timestamp: new Date().toISOString() },
    { level: 'info', message: 'AI服务初始化完成', timestamp: new Date().toISOString() }
  ];
  
  res.json({
    logs: mockLogs,
    total: mockLogs.length,
    timestamp: new Date().toISOString()
  });
});

// Database connection test endpoint
app.get('/api/database/test', async (req, res) => {
  try {
    const isConnected = await database.testConnection();
    res.json({
      status: isConnected ? 'connected' : 'disconnected',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'qqbot_db',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Database connection test failed', { error });
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Token Management API endpoints
app.get('/api/tokens', async (req, res) => {
  try {
    const tokens = await database.executeQuery(`
      SELECT 
        id, project_name, project_id, is_active, is_healthy,
        daily_limit, daily_used, total_used, 
        last_used, last_health_check, error_count, last_error_time,
        priority, weight, blacklisted_until, blacklist_reason,
        created_at, updated_at
      FROM api_tokens 
      ORDER BY priority ASC, created_at DESC
    `);
    
    res.json({
      success: true,
      data: tokens,
      total: tokens.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get tokens', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get tokens',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Token状态查询接口 - 管理端专用
app.get('/api/tokens', async (req, res) => {
  try {
    const tokens = await database.executeQuery(`
      SELECT 
        id,
        LEFT(token, 20) as token_preview,
        project_name,
        blacklisted_until,
        daily_used,
        daily_limit,
        error_count,
        last_error,
        last_error_time,
        last_used,
        created_at,
        updated_at
      FROM api_tokens
      ORDER BY id
    `);
    
    const now = new Date();
    const processedTokens = tokens.map((token: any) => {
      const blacklistTime = token.blacklisted_until ? new Date(token.blacklisted_until) : null;
      let status = 'available';
      
      if (blacklistTime) {
        if (blacklistTime >= new Date('2030-01-01')) {
          status = 'permanently_disabled';
        } else if (blacklistTime > now) {
          status = 'temporarily_disabled';
        } else {
          status = 'recovered';
        }
      }
      
      return {
        ...token,
        status,
        is_available: !blacklistTime || blacklistTime <= now,
        usage_percentage: Math.round((token.daily_used / token.daily_limit) * 100),
        recovery_time: blacklistTime && blacklistTime > now ? blacklistTime : null
      };
    });
    
    res.json({
      success: true,
      data: processedTokens,
      total: processedTokens.length,
      summary: {
        total: processedTokens.length,
        available: processedTokens.filter((t: any) => t.is_available && t.daily_used < t.daily_limit).length,
        temporarily_disabled: processedTokens.filter((t: any) => t.status === 'temporarily_disabled').length,
        permanently_disabled: processedTokens.filter((t: any) => t.status === 'permanently_disabled').length,
        recovered: processedTokens.filter((t: any) => t.status === 'recovered').length
      }
    });
  } catch (error) {
    logger.error('Failed to get tokens', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve tokens'
    });
  }
});

// 永久禁用Token接口
app.post('/api/tokens/:id/disable', async (req, res) => {
  try {
    const tokenId = parseInt(req.params.id);
    
    await database.executeUpdate(`
      UPDATE api_tokens 
      SET blacklisted_until = '2030-12-31 23:59:59',
          last_error = '[管理员] 手动永久禁用',
          last_error_time = NOW()
      WHERE id = ?
    `, [tokenId]);
    
    logger.info(`Token ID ${tokenId} permanently disabled by admin`);
    res.json({
      success: true,
      message: `Token ID ${tokenId} has been permanently disabled`
    });
  } catch (error) {
    logger.error('Failed to disable token', { error, tokenId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to disable token'
    });
  }
});

// 启用Token接口
app.post('/api/tokens/:id/enable', async (req, res) => {
  try {
    const tokenId = parseInt(req.params.id);
    
    await database.executeUpdate(`
      UPDATE api_tokens 
      SET blacklisted_until = NULL,
          last_error = NULL,
          last_error_time = NULL
      WHERE id = ?
    `, [tokenId]);
    
    logger.info(`Token ID ${tokenId} enabled by admin`);
    res.json({
      success: true,
      message: `Token ID ${tokenId} has been enabled`
    });
  } catch (error) {
    logger.error('Failed to enable token', { error, tokenId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to enable token'
    });
  }
});

// Token health check test endpoint - 测试版本(无需数据库)
app.post('/api/tokens/health-check-test', async (req, res) => {
  try {
    logger.info('Starting real token health check test...');
    
    // 测试用的模拟Token数据
    const testTokens = [
      {
        id: 1,
        token: 'invalid_test_token_12345',
        project_name: 'Test Project 1'
      },
      {
        id: 2, 
        token: 'another_invalid_test_token_67890',
        project_name: 'Test Project 2'
      }
    ];
    
    logger.info(`Found ${testTokens.length} test tokens to check`);
    
    let healthyCount = 0;
    const axios = require('axios');
    
    // 并行检查所有Token
    const checkPromises = testTokens.map(async (tokenData: any) => {
      try {
        const startTime = Date.now();
        
        // 发送测试请求到Gemini API
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
          {
            contents: [{
              parts: [{
                text: "Test health check - respond with 'OK'"
              }]
            }]
          },
          {
            headers: {
              'X-goog-api-key': tokenData.token,
              'Content-Type': 'application/json'
            },
            timeout: 10000  // 10秒超时
          }
        );
        
        const responseTime = Date.now() - startTime;
        
        if (response.status === 200 && response.data.candidates) {
          logger.info(`Token ${tokenData.project_name} is healthy (${responseTime}ms)`);
          healthyCount++;
          return { id: tokenData.id, healthy: true };
        }
      } catch (error: any) {
        // Token不健康，记录错误
        const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
        
        logger.warn(`Token ${tokenData.project_name} failed health check: ${errorMessage}`);
        return { id: tokenData.id, healthy: false, error: errorMessage };
      }
    });
    
    const results = await Promise.allSettled(checkPromises);
    const totalChecked = results.length;
    
    logger.info(`Health check test completed: ${healthyCount}/${totalChecked} tokens healthy`);
    
    res.json({
      success: true,
      message: 'Real health check test completed (using fake tokens)',
      summary: {
        totalTokens: totalChecked,
        healthyTokens: healthyCount,
        failedTokens: totalChecked - healthyCount,
        healthyRate: totalChecked > 0 ? (healthyCount / totalChecked * 100).toFixed(1) + '%' : '0%'
      },
      results: results.map(result => result.status === 'fulfilled' ? result.value : { error: 'Promise rejected' }),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Token health check test failed', { error });
    res.status(500).json({
      success: false,
      error: 'Token health check test failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Token health check endpoint - 真实的健康检查 (主动检测)
app.post('/api/tokens/health-check', async (req, res) => {
  try {
    // 获取请求参数中的模型ID，默认为gemini-2.5-flash
    const modelId = req.body.model_id || req.query.model_id || 'gemini-2.5-flash';
    
    logger.info('Starting real token health check...', { modelId });
    
    // 获取所有Token (移除is_active依赖)
    const tokens = await database.executeQuery(`
      SELECT id, token, project_name FROM api_tokens 
      WHERE (blacklisted_until IS NULL OR blacklisted_until < '2030-01-01')
      ORDER BY id
    `);
    
    logger.info(`Found ${tokens.length} active tokens to check for model ${modelId}`);
    
    let healthyCount = 0;
    const axios = require('axios');
    
    // 并行检查所有Token
    const checkPromises = tokens.map(async (tokenData: any) => {
      try {
        const startTime = Date.now();
        
        // 发送测试请求到Gemini API (使用指定的模型ID)
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
          {
            contents: [{
              parts: [{
                text: "Test health check - respond with 'OK'"
              }]
            }]
          },
          {
            headers: {
              'X-goog-api-key': tokenData.token,
              'Content-Type': 'application/json'
            },
            timeout: 10000  // 10秒超时
          }
        );
        
        const responseTime = Date.now() - startTime;
        
        if (response.status === 200 && response.data.candidates) {
          // Token健康，清除黑名单状态
          await database.executeUpdate(`
            UPDATE api_tokens SET 
              blacklisted_until = NULL,
              error_count = 0,
              last_error = NULL,
              last_error_time = NULL
            WHERE id = ?
          `, [tokenData.id]);
          
          logger.info(`Token ${tokenData.project_name} is healthy (${responseTime}ms)`);
          healthyCount++;
          return { id: tokenData.id, healthy: true };
        }
      } catch (error: any) {
        // Token不健康，根据错误类型决定处理方式
        let errorMessage = '';
        let shouldBlacklist = false;
        
        if (error.response) {
          const status = error.response.status;
          const statusText = error.response.statusText;
          errorMessage = `[主动检查] HTTP ${status}: ${statusText}`;
          
          // 429/403/401 错误临时黑名单5分钟
          if (status === 429 || status === 403 || status === 401) {
            shouldBlacklist = true;
          }
        } else {
          errorMessage = `[主动检查] ${error.message || 'Unknown error'}`;
        }
        
        if (shouldBlacklist) {
          // 临时黑名单5分钟
          await database.executeUpdate(`
            UPDATE api_tokens SET 
              blacklisted_until = DATE_ADD(NOW(), INTERVAL 5 MINUTE),
              error_count = error_count + 1,
              last_error = ?,
              last_error_time = NOW()
            WHERE id = ?
          `, [errorMessage, tokenData.id]);
          
          logger.warn(`Token ${tokenData.project_name} temporarily blacklisted (5min): ${errorMessage}`);
        } else {
          // 只记录错误，不黑名单
          await database.executeUpdate(`
            UPDATE api_tokens SET 
              error_count = error_count + 1,
              last_error = ?,
              last_error_time = NOW()
            WHERE id = ?
          `, [errorMessage, tokenData.id]);
          
          logger.warn(`Token ${tokenData.project_name} error recorded: ${errorMessage}`);
        }
        
        logger.warn(`Token ${tokenData.project_name} failed health check: ${errorMessage}`);
        return { id: tokenData.id, healthy: false, error: errorMessage };
      }
    });
    
    const results = await Promise.allSettled(checkPromises);
    const totalChecked = results.length;
    
    logger.info(`Health check completed: ${healthyCount}/${totalChecked} tokens healthy`);
    
    res.json({
      success: true,
      message: 'Real health check completed',
      model_id: modelId,
      summary: {
        totalTokens: totalChecked,
        healthyTokens: healthyCount,
        failedTokens: totalChecked - healthyCount,
        healthyRate: totalChecked > 0 ? (healthyCount / totalChecked * 100).toFixed(1) + '%' : '0%'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Token health check failed', { error });
    res.status(500).json({
      success: false,
      error: 'Token health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Token force reset endpoint - 强制重置DB状态(仅用于紧急情况)
app.post('/api/tokens/force-reset', async (req, res) => {
  try {
    logger.warn('Force resetting token database states (emergency use only)...');
    
    const result = await database.executeUpdate(`
      UPDATE api_tokens SET 
        is_healthy = TRUE,
        error_count = 0,
        last_error = NULL,
        last_error_time = NULL,
        last_health_check = NOW(),
        blacklisted_until = NULL,
        blacklist_reason = NULL
      WHERE is_active = TRUE
    `);
    
    logger.warn('Token force reset completed', { affectedTokens: result });
    
    res.json({
      success: true,
      message: 'Force reset completed (emergency use only)',
      warning: 'This only resets database states, not real token validity',
      affectedTokens: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Token force reset failed', { error });
    res.status(500).json({
      success: false,
      error: 'Token force reset failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Token statistics endpoint
app.get('/api/tokens/stats', async (req, res) => {
  try {
    const stats = await database.executeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_healthy = TRUE THEN 1 ELSE 0 END) as healthy,
        SUM(CASE WHEN blacklisted_until > NOW() THEN 1 ELSE 0 END) as blacklisted,
        SUM(CASE WHEN daily_used >= daily_limit THEN 1 ELSE 0 END) as over_daily_limit
      FROM api_tokens
    `);
    
    const recentLogs = await database.executeQuery(`
      SELECT tl.*, at.project_name 
      FROM api_token_logs tl
      JOIN api_tokens at ON tl.token_id = at.id
      ORDER BY tl.created_at DESC 
      LIMIT 10
    `);
    
    res.json({
      success: true,
      data: {
        summary: stats[0] || {},
        recentLogs: recentLogs || []
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get token stats', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get token stats',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Conversations API endpoints
app.get('/api/conversations', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const userId = req.query.user_id as string;
    const search = req.query.search as string;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;

    const result = await database.getConversations({
      limit,
      offset,
      userId,
      search
    });

    res.json({
      success: true,
      data: result.data,
      total: result.total,
      page,
      limit,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get conversations', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get conversations',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Get single conversation
app.get('/api/conversations/:id', async (req, res) => {
  try {
    const conversationId = req.params.id;
    
    const conversation = await database.getConversationById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: conversation,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get conversation', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get conversation',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Requirements API endpoints
app.get('/api/requirements', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;

    const result = await database.getRequirements({
      limit,
      offset,
      status
    });

    res.json({
      success: true,
      data: result.data,
      total: result.total,
      page,
      limit,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get requirements', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get requirements',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Sessions API endpoints
app.get('/api/sessions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const userId = req.query.user_id as string;

    const result = await database.getSessions({
      limit,
      offset: 0, // 简化版本不支持分页
      status,
      userId
    });

    res.json({
      success: true,
      data: result.data,
      total: result.total,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get sessions', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get sessions',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// ============= 日志查询 API 端点 =============

// WebSocket通信日志查询
app.get('/api/logs/websocket', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const traceId = req.query.trace_id as string;
    const direction = req.query.direction as string; // IN, OUT
    const messageType = req.query.message_type as string;
    const status = req.query.status as string;
    const userId = req.query.user_id as string;
    const groupId = req.query.group_id as string;

    let whereConditions: string[] = [];
    let queryParams: any[] = [];

    if (traceId) {
      whereConditions.push('trace_id = ?');
      queryParams.push(traceId);
    }
    if (direction) {
      whereConditions.push('direction = ?');
      queryParams.push(direction);
    }
    if (messageType) {
      whereConditions.push('message_type = ?');
      queryParams.push(messageType);
    }
    if (status) {
      whereConditions.push('status = ?');
      queryParams.push(status);
    }
    if (userId) {
      whereConditions.push('user_id = ?');
      queryParams.push(parseInt(userId));
    }
    if (groupId) {
      whereConditions.push('group_id = ?');
      queryParams.push(parseInt(groupId));
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Debug logging
    logger.info('WebSocket logs query debug', { 
      whereClause, 
      queryParams: queryParams.map((p, i) => `${i}: ${p} (${typeof p})`),
      limit: `${limit} (${typeof limit})`,
      offset: `${offset} (${typeof offset})`
    });

    // 获取总数 - 简化查询先测试
    let total = 0;
    let logs = [];
    
    try {
      if (whereConditions.length === 0) {
        // 无条件查询 - 直接拼接LIMIT和OFFSET到SQL中避免参数绑定问题
        const countResult = await database.executeQuery<{total: number}>('SELECT COUNT(*) as total FROM websocket_logs', []);
        total = countResult[0]?.total || 0;
        
        const dataQuery = `SELECT id, trace_id, direction, message_type, status, timestamp FROM websocket_logs ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`;
        logs = await database.executeQuery(dataQuery, []);
      } else {
        // 有条件查询 - 直接拼接LIMIT和OFFSET避免参数绑定问题
        const countQuery = `SELECT COUNT(*) as total FROM websocket_logs ${whereClause}`;
        logger.info('Executing count query', { query: countQuery, params: queryParams });
        const countResult = await database.executeQuery<{total: number}>(countQuery, [...queryParams]);
        total = countResult[0]?.total || 0;

        const dataQuery = `SELECT id, trace_id, direction, message_type, status, timestamp FROM websocket_logs ${whereClause} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`;
        logger.info('Executing data query', { query: dataQuery, params: queryParams });
        logs = await database.executeQuery(dataQuery, [...queryParams]);
      }
    } catch (error) {
      logger.error('Database query error details', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        whereConditions,
        queryParams,
        limit,
        offset
      });
      throw error;
    }

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get WebSocket logs', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get WebSocket logs',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// LLM调用日志查询
app.get('/api/logs/llm', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const traceId = req.query.trace_id as string;
    const agentType = req.query.agent_type as string;
    const modelName = req.query.model_name as string;
    const success = req.query.success as string;
    const userId = req.query.user_id as string;

    let whereConditions: string[] = [];
    let queryParams: any[] = [];

    if (traceId) {
      whereConditions.push('trace_id = ?');
      queryParams.push(traceId);
    }
    if (agentType) {
      whereConditions.push('agent_type = ?');
      queryParams.push(agentType);
    }
    if (modelName) {
      whereConditions.push('model_name = ?');
      queryParams.push(modelName);
    }
    if (success !== undefined) {
      whereConditions.push('success = ?');
      queryParams.push(success === 'true');
    }
    if (userId) {
      whereConditions.push('user_id = ?');
      queryParams.push(parseInt(userId));
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 获取总数
    const countQuery = `SELECT COUNT(*) as total FROM llm_call_logs ${whereClause}`;
    const countResult = await database.executeQuery<{total: number}>(countQuery, [...queryParams]);
    const total = countResult[0]?.total || 0;

    // 获取数据 - 直接拼接LIMIT和OFFSET避免参数绑定问题
    const dataQuery = `
      SELECT 
        id, trace_id, user_id, call_sequence, model_name, agent_type, 
        input_prompt, model_config, processed_response,
        api_call_time_ms, processing_time_ms, input_tokens, output_tokens,
        status, error_message, error_code, timestamp
      FROM llm_call_logs 
      ${whereClause}
      ORDER BY timestamp DESC 
      LIMIT ${limit} OFFSET ${offset}
    `;
    
    const logs = await database.executeQuery(dataQuery, [...queryParams]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get LLM logs', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get LLM logs',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 会话链路追踪查询
app.get('/api/logs/sessions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const traceId = req.query.trace_id as string;
    const sessionId = req.query.session_id as string;
    const status = req.query.status as string;
    const userId = req.query.user_id as string;

    let whereConditions: string[] = [];
    let queryParams: any[] = [];

    if (traceId) {
      whereConditions.push('trace_id = ?');
      queryParams.push(traceId);
    }
    if (sessionId) {
      whereConditions.push('session_id = ?');
      queryParams.push(sessionId);
    }
    if (status) {
      whereConditions.push('status = ?');
      queryParams.push(status);
    }
    if (userId) {
      whereConditions.push('user_id = ?');
      queryParams.push(parseInt(userId));
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 获取总数
    const countQuery = `SELECT COUNT(*) as total FROM session_traces ${whereClause}`;
    const countResult = await database.executeQuery<{total: number}>(countQuery, [...queryParams]);
    const total = countResult[0]?.total || 0;

    // 获取数据 - 直接拼接LIMIT和OFFSET避免参数绑定问题
    const dataQuery = `
      SELECT 
        id, trace_id, session_id, user_id, group_id, trigger_message_id,
        trigger_event_type, decision_result, context_result, persona_result,
        llm_calls_count, websocket_messages_count, total_processing_time_ms,
        final_response, status, error_message, created_at, start_time, end_time
      FROM session_traces 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT ${limit} OFFSET ${offset}
    `;
    
    const logs = await database.executeQuery(dataQuery, [...queryParams]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get session traces', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get session traces',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 统计数据查询
app.get('/api/logs/statistics', async (req, res) => {
  try {
    const timeRange = req.query.time_range as string || '24h'; // 1h, 24h, 7d, 30d
    const traceId = req.query.trace_id as string;

    let websocketTimeCondition = '';
    let llmTimeCondition = '';
    let sessionTimeCondition = '';
    
    switch (timeRange) {
      case '1h':
        websocketTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)";
        llmTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)";
        sessionTimeCondition = "AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)";
        break;
      case '24h':
        websocketTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)";
        llmTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)";
        sessionTimeCondition = "AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)";
        break;
      case '7d':
        websocketTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
        llmTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
        sessionTimeCondition = "AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
        break;
      case '30d':
        websocketTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
        llmTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
        sessionTimeCondition = "AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
        break;
      default:
        websocketTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)";
        llmTimeCondition = "AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)";
        sessionTimeCondition = "AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)";
    }

    // WebSocket统计
    const websocketStats = await database.executeQuery(`
      SELECT 
        COUNT(*) as total_messages,
        SUM(CASE WHEN direction = 'IN' THEN 1 ELSE 0 END) as incoming_messages,
        SUM(CASE WHEN direction = 'OUT' THEN 1 ELSE 0 END) as outgoing_messages,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successful_messages,
        SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as failed_messages,
        AVG(processing_time_ms) as avg_processing_time,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT group_id) as unique_groups
      FROM websocket_logs 
      WHERE 1=1 ${websocketTimeCondition}
      ${traceId ? 'AND trace_id = ?' : ''}
    `, traceId ? [traceId] : []);

    // LLM调用统计
    const llmStats = await database.executeQuery(`
      SELECT 
        COUNT(*) as total_calls,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successful_calls,
        SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as failed_calls,
        AVG(api_call_time_ms) as avg_response_time,
        COUNT(DISTINCT agent_type) as unique_agent_types,
        COUNT(DISTINCT user_id) as unique_users,
        SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) as total_tokens_used
      FROM llm_call_logs 
      WHERE 1=1 ${llmTimeCondition}
      ${traceId ? 'AND trace_id = ?' : ''}
    `, traceId ? [traceId] : []);

    // 会话统计
    const sessionStats = await database.executeQuery<{
      total_sessions: number;
      completed_sessions: number;
      failed_sessions: number;
      avg_session_time: number;
      avg_llm_calls_per_session: number;
      unique_users: number;
    }>(`
      SELECT 
        COUNT(*) as total_sessions,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_sessions,
        SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as failed_sessions,
        AVG(total_processing_time_ms) as avg_session_time,
        AVG(llm_calls_count) as avg_llm_calls_per_session,
        COUNT(DISTINCT user_id) as unique_users
      FROM session_traces 
      WHERE 1=1 ${sessionTimeCondition}
      ${traceId ? 'AND trace_id = ?' : ''}
    `, traceId ? [traceId] : []);

    res.json({
      success: true,
      data: {
        time_range: timeRange,
        websocket: websocketStats[0] || {},
        llm: llmStats[0] || {},
        sessions: sessionStats[0] || {}
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get logs statistics', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get logs statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 根据TraceID获取完整链路
app.get('/api/logs/trace/:traceId', async (req, res) => {
  try {
    const traceId = req.params.traceId;

    // 并行查询所有相关日志
    const [websocketLogs, llmLogs, sessionTrace] = await Promise.all([
      database.executeQuery(`
        SELECT * FROM websocket_logs 
        WHERE trace_id = ? 
        ORDER BY timestamp ASC
      `, [traceId]),
      
      database.executeQuery(`
        SELECT * FROM llm_call_logs 
        WHERE trace_id = ? 
        ORDER BY call_sequence ASC, timestamp ASC
      `, [traceId]),
      
      database.executeQuery<{
        id: string;
        trace_id: string;
        user_id: number;
        session_id: string;
        status: string;
        llm_calls_count: number;
        websocket_events_count: number;
        total_processing_time_ms: number;
        created_at: Date;
      }>(`
        SELECT * FROM session_traces 
        WHERE trace_id = ? 
        ORDER BY created_at ASC
      `, [traceId])
    ]);

    if (websocketLogs.length === 0 && llmLogs.length === 0 && sessionTrace.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Trace not found',
        message: `No logs found for trace ID: ${traceId}`,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: {
        trace_id: traceId,
        websocket_logs: websocketLogs,
        llm_logs: llmLogs,
        session_trace: sessionTrace[0] || null,
        summary: {
          websocket_events: websocketLogs.length,
          llm_calls: llmLogs.length,
          has_session_trace: sessionTrace.length > 0,
          total_processing_time_ms: sessionTrace[0]?.total_processing_time_ms || 0
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get trace details', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get trace details',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// ============= 群聊和私聊管理 API 端点 =============

// 获取所有群聊设置
app.get('/api/groups', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const is_enabled = req.query.is_enabled as string;
    const auto_reply_enabled = req.query.auto_reply_enabled as string;
    const receive_events = req.query.receive_events as string;

    let whereConditions: string[] = [];
    let queryParams: any[] = [];

    if (search) {
      whereConditions.push('(group_name LIKE ? OR group_id LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }
    
    if (is_enabled !== undefined) {
      whereConditions.push('is_enabled = ?');
      queryParams.push(is_enabled === 'true');
    }
    
    if (auto_reply_enabled !== undefined) {
      whereConditions.push('auto_reply_enabled = ?');
      queryParams.push(auto_reply_enabled === 'true');
    }
    
    if (receive_events !== undefined) {
      whereConditions.push('receive_events = ?');
      queryParams.push(receive_events === 'true');
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 获取总数
    const countQuery = `SELECT COUNT(*) as total FROM group_chat_settings ${whereClause}`;
    const countResult = await database.executeQuery<{total: number}>(countQuery, [...queryParams]);
    const total = countResult[0]?.total || 0;

    // 获取数据
    const dataQuery = `
      SELECT 
        id, group_id, group_name, is_enabled, auto_reply_enabled, receive_events,
        welcome_message, admin_user_id, created_at, updated_at, last_activity
      FROM group_chat_settings 
      ${whereClause}
      ORDER BY updated_at DESC 
      LIMIT ${limit} OFFSET ${offset}
    `;
    
    const groups = await database.executeQuery(dataQuery, [...queryParams]);

    res.json({
      success: true,
      data: groups,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get groups', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get groups',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 更新单个群聊设置
app.put('/api/groups/:id', async (req, res) => {
  try {
    const groupId = req.params.id;
    const { is_enabled, auto_reply_enabled, receive_events, welcome_message, group_name } = req.body;

    let updateFields: string[] = [];
    let queryParams: any[] = [];

    if (is_enabled !== undefined) {
      updateFields.push('is_enabled = ?');
      queryParams.push(is_enabled);
    }
    
    if (auto_reply_enabled !== undefined) {
      updateFields.push('auto_reply_enabled = ?');
      queryParams.push(auto_reply_enabled);
    }
    
    if (receive_events !== undefined) {
      updateFields.push('receive_events = ?');
      queryParams.push(receive_events);
    }
    
    if (welcome_message !== undefined) {
      updateFields.push('welcome_message = ?');
      queryParams.push(welcome_message);
    }
    
    if (group_name !== undefined) {
      updateFields.push('group_name = ?');
      queryParams.push(group_name);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
        timestamp: new Date().toISOString()
      });
    }

    updateFields.push('updated_at = NOW()');
    queryParams.push(groupId);

    const updateQuery = `
      UPDATE group_chat_settings 
      SET ${updateFields.join(', ')}
      WHERE group_id = ?
    `;

    const result = await database.executeUpdate(updateQuery, queryParams);

    if (result === 0) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
        timestamp: new Date().toISOString()
      });
    }

    logger.info(`Group ${groupId} settings updated`, { updateFields, queryParams });
    
    res.json({
      success: true,
      message: `Group ${groupId} updated successfully`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to update group', { error, groupId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to update group',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 批量更新群聊设置
app.post('/api/groups/batch', async (req, res) => {
  try {
    const { group_ids, is_enabled, auto_reply_enabled, receive_events } = req.body;

    if (!Array.isArray(group_ids) || group_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'group_ids must be a non-empty array',
        timestamp: new Date().toISOString()
      });
    }

    // 直接使用SQL批量更新（更简单可靠）
    const placeholders = group_ids.map(() => '?').join(',');
    
    let updateFields: string[] = [];
    let queryParams: any[] = [];

    if (is_enabled !== undefined) {
      updateFields.push('is_enabled = ?');
      queryParams.push(is_enabled);
    }
    
    if (auto_reply_enabled !== undefined) {
      updateFields.push('auto_reply_enabled = ?');
      queryParams.push(auto_reply_enabled);
    }
    
    if (receive_events !== undefined) {
      updateFields.push('receive_events = ?');
      queryParams.push(receive_events);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
        timestamp: new Date().toISOString()
      });
    }

    updateFields.push('updated_at = NOW()');
    queryParams.push(...group_ids);

    const updateQuery = `
      UPDATE group_chat_settings 
      SET ${updateFields.join(', ')}
      WHERE group_id IN (${placeholders})
    `;

    const result = await database.executeUpdate(updateQuery, queryParams);

    logger.info(`Batch updated ${group_ids.length} groups`, { 
      group_ids, is_enabled, auto_reply_enabled, receive_events 
    });

    res.json({
      success: true,
      message: `Batch updated ${group_ids.length} groups`,
      updated_count: group_ids.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to batch update groups', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to batch update groups',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 批量删除群聊设置 - 必须在单个删除之前定义
app.delete('/api/groups/batch', async (req, res) => {
  try {
    const { group_ids } = req.body;

    if (!Array.isArray(group_ids) || group_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'group_ids must be a non-empty array',
        timestamp: new Date().toISOString()
      });
    }

    const placeholders = group_ids.map(() => '?').join(',');
    const deleteQuery = `DELETE FROM group_chat_settings WHERE group_id IN (${placeholders})`;
    
    const result = await database.executeUpdate(deleteQuery, group_ids);

    logger.info(`Batch deleted ${result} groups`, { group_ids });

    res.json({
      success: true,
      message: `Batch deleted ${result} groups`,
      deleted_count: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to batch delete groups', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to batch delete groups',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 删除单个群聊设置 - 必须在批量删除之后定义
app.delete('/api/groups/:id', async (req, res) => {
  try {
    const groupId = req.params.id;

    const result = await database.executeUpdate(
      'DELETE FROM group_chat_settings WHERE group_id = ?',
      [groupId]
    );

    if (result === 0) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
        timestamp: new Date().toISOString()
      });
    }

    logger.info(`Deleted group ${groupId}`);

    res.json({
      success: true,
      message: `Group ${groupId} deleted successfully`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to delete group', { error, groupId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to delete group',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});


// 批量更新私聊设置
app.post('/api/private-chats/batch', async (req, res) => {
  try {
    const { user_ids, is_enabled, auto_reply_enabled } = req.body;

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'user_ids must be a non-empty array',
        timestamp: new Date().toISOString()
      });
    }

    // 直接使用SQL批量更新（更简单可靠）
    const placeholders = user_ids.map(() => '?').join(',');
    
    let updateFields: string[] = [];
    let queryParams: any[] = [];

    if (is_enabled !== undefined) {
      updateFields.push('is_enabled = ?');
      queryParams.push(is_enabled);
    }
    
    if (auto_reply_enabled !== undefined) {
      updateFields.push('auto_reply_enabled = ?');
      queryParams.push(auto_reply_enabled);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
        timestamp: new Date().toISOString()
      });
    }

    updateFields.push('updated_at = NOW()');
    queryParams.push(...user_ids);

    const updateQuery = `
      UPDATE private_chat_settings 
      SET ${updateFields.join(', ')}
      WHERE user_id IN (${placeholders})
    `;

    const result = await database.executeUpdate(updateQuery, queryParams);

    logger.info(`Batch updated ${user_ids.length} private chats`, { 
      user_ids, is_enabled, auto_reply_enabled 
    });

    res.json({
      success: true,
      message: `Batch updated ${user_ids.length} private chats`,
      updated_count: user_ids.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to batch update private chats', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to batch update private chats',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 批量删除私聊设置 - 必须在单个删除之前定义
app.delete('/api/private-chats/batch', async (req, res) => {
  try {
    const { user_ids } = req.body;

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'user_ids must be a non-empty array',
        timestamp: new Date().toISOString()
      });
    }

    // 确保所有ID都是数字类型
    const numericUserIds = user_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

    if (numericUserIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid user IDs provided',
        timestamp: new Date().toISOString()
      });
    }

    let totalConversationsDeleted = 0;
    let totalSettingsDeleted = 0;
    let totalLogsDeleted = 0;

    // 批量删除每个用户的数据
    for (const userId of numericUserIds) {
      try {
        // 删除对话记录
        const conversationsResult = await database.executeUpdate(
          'DELETE FROM conversations WHERE user_id = ?',
          [userId]
        );
        totalConversationsDeleted += conversationsResult || 0;

        // 删除用户设置
        const settingsResult = await database.executeUpdate(
          'DELETE FROM private_chat_settings WHERE user_id = ?',
          [userId]
        );
        totalSettingsDeleted += settingsResult || 0;

        // 删除WebSocket日志
        const logsResult = await database.executeUpdate(
          'DELETE FROM websocket_logs WHERE user_id = ?',
          [userId]
        );
        totalLogsDeleted += logsResult || 0;
      } catch (error) {
        logger.error(`Failed to delete data for user ${userId}`, { error });
      }
    }

    logger.info(`Batch deleted private chats`, { 
      user_ids: numericUserIds,
      conversations: totalConversationsDeleted,
      settings: totalSettingsDeleted,
      logs: totalLogsDeleted
    });

    res.json({
      success: true,
      message: `Batch deleted ${numericUserIds.length} users successfully`,
      details: {
        users_processed: numericUserIds.length,
        conversations_deleted: totalConversationsDeleted,
        settings_deleted: totalSettingsDeleted,
        logs_deleted: totalLogsDeleted
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to batch delete private chats', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to batch delete private chats',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 删除单个私聊设置 - 必须在批量删除之后定义
app.delete('/api/private-chats/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id); // 转换为数字类型

    // 先检查用户是否有对话记录（主要数据源）
    const existingConversations = await database.executeQuery(
      'SELECT COUNT(*) as count FROM conversations WHERE user_id = ?',
      [userId]
    );

    const conversationCount = (existingConversations[0] as any)?.count || 0;

    if (conversationCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Private chat not found',
        timestamp: new Date().toISOString()
      });
    }

    // 删除相关的对话记录
    const deleteResult = await database.executeUpdate(
      'DELETE FROM conversations WHERE user_id = ?',
      [userId]
    );

    // 删除用户设置（如果存在）
    await database.executeUpdate(
      'DELETE FROM private_chat_settings WHERE user_id = ?',
      [userId]
    );

    // 删除相关的WebSocket日志
    await database.executeUpdate(
      'DELETE FROM websocket_logs WHERE user_id = ?',
      [userId]
    );

    logger.info(`Deleted private chat ${userId}: ${deleteResult} conversations and related data`);

    res.json({
      success: true,
      message: `Private chat ${userId} deleted successfully (${conversationCount} conversations removed)`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to delete private chat', { error, userId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to delete private chat',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 获取控制概览统计
app.get('/api/control/overview', async (req, res) => {
  try {
    const overview = await database.executeQuery(`
      SELECT * FROM bot_control_overview
    `);

    res.json({
      success: true,
      data: overview,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get control overview', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get control overview',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// ============= AI Prompt 管理功能 =============

// 获取所有AI Prompt配置
app.get('/api/prompts', async (req, res) => {
  try {
    const prompts = await database.executeQuery(`
      SELECT id, agent_type, prompt_name, system_instructions, user_prompt_template, 
             context_variables, model_config, model_name, allowed_token_ids, 
             is_active, version, description, created_by, created_at, updated_at
      FROM agent_prompts 
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      data: prompts,
      total: prompts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get prompts', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get prompts',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 获取单个Prompt
app.get('/api/prompts/:id', async (req, res) => {
  try {
    const promptId = req.params.id;
    const prompts = await database.executeQuery(`
      SELECT * FROM agent_prompts WHERE id = ?
    `, [promptId]);

    if (prompts.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: prompts[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get prompt', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get prompt',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 创建新Prompt
app.post('/api/prompts', async (req, res) => {
  try {
    const { 
      agent_type, prompt_name, system_instructions, user_prompt_template,
      context_variables, model_config, model_name, allowed_token_ids, 
      is_active, description, created_by 
    } = req.body;

    if (!agent_type || !prompt_name || !system_instructions) {
      return res.status(400).json({
        success: false,
        error: 'agent_type, prompt_name, and system_instructions are required',
        timestamp: new Date().toISOString()
      });
    }

    // Generate UUID for id
    const id = 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    const result = await database.executeUpdate(`
      INSERT INTO agent_prompts 
      (id, agent_type, prompt_name, system_instructions, user_prompt_template,
       context_variables, model_config, model_name, allowed_token_ids, 
       is_active, description, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      id, agent_type, prompt_name, system_instructions, user_prompt_template || null,
      context_variables ? JSON.stringify(context_variables) : null,
      model_config ? JSON.stringify(model_config) : null,
      model_name || 'gemini-2.5-flash',
      allowed_token_ids ? JSON.stringify(allowed_token_ids) : null,
      is_active !== undefined ? is_active : true,
      description || null, created_by || 'system'
    ]);

    logger.info('Created new prompt', { prompt_name, agent_type });

    res.json({
      success: true,
      message: 'Prompt created successfully',
      id: result, // 假设executeUpdate返回插入的ID
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to create prompt', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to create prompt',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 更新Prompt
app.put('/api/prompts/:id', async (req, res) => {
  try {
    const promptId = req.params.id;
    const { 
      agent_type, prompt_name, system_instructions, user_prompt_template,
      context_variables, model_config, model_name, allowed_token_ids, 
      is_active, description 
    } = req.body;

    let updateFields: string[] = [];
    let queryParams: any[] = [];

    if (agent_type !== undefined) {
      updateFields.push('agent_type = ?');
      queryParams.push(agent_type);
    }
    if (prompt_name !== undefined) {
      updateFields.push('prompt_name = ?');
      queryParams.push(prompt_name);
    }
    if (system_instructions !== undefined) {
      updateFields.push('system_instructions = ?');
      queryParams.push(system_instructions);
    }
    if (user_prompt_template !== undefined) {
      updateFields.push('user_prompt_template = ?');
      queryParams.push(user_prompt_template);
    }
    if (context_variables !== undefined) {
      updateFields.push('context_variables = ?');
      queryParams.push(context_variables ? JSON.stringify(context_variables) : null);
    }
    if (model_config !== undefined) {
      updateFields.push('model_config = ?');
      queryParams.push(model_config ? JSON.stringify(model_config) : null);
    }
    if (model_name !== undefined) {
      updateFields.push('model_name = ?');
      queryParams.push(model_name);
    }
    if (allowed_token_ids !== undefined) {
      updateFields.push('allowed_token_ids = ?');
      queryParams.push(allowed_token_ids ? JSON.stringify(allowed_token_ids) : null);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      queryParams.push(is_active);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      queryParams.push(description);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
        timestamp: new Date().toISOString()
      });
    }

    updateFields.push('updated_at = NOW()');
    queryParams.push(promptId);

    const updateQuery = `
      UPDATE agent_prompts 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `;

    const result = await database.executeUpdate(updateQuery, queryParams);

    if (result === 0) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found',
        timestamp: new Date().toISOString()
      });
    }

    logger.info(`Updated prompt ${promptId}`, { updateFields: updateFields.length });

    res.json({
      success: true,
      message: `Prompt ${promptId} updated successfully`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to update prompt', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to update prompt',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 删除Prompt
app.delete('/api/prompts/:id', async (req, res) => {
  try {
    const promptId = req.params.id;

    const result = await database.executeUpdate(
      'DELETE FROM agent_prompts WHERE id = ?',
      [promptId]
    );

    if (result === 0) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found',
        timestamp: new Date().toISOString()
      });
    }

    logger.info(`Deleted prompt ${promptId}`);

    res.json({
      success: true,
      message: `Prompt ${promptId} deleted successfully`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to delete prompt', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to delete prompt',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// ============= NapCat API 集成同步功能 =============

// NapCat API 基础配置
const NAPCAT_API_BASE = process.env.NAPCAT_API_BASE || 'http://localhost:3001';
const NAPCAT_ACCESS_TOKEN = process.env.NAPCAT_ACCESS_TOKEN || process.env.WEBSOCKET_ACCESS_TOKEN;

// 同步群聊信息
app.post('/api/sync/groups', async (req, res) => {
  try {
    logger.info('Starting group sync from NapCat API');
    
    // 获取群列表
    const groupListResponse = await fetch(`${NAPCAT_API_BASE}/get_group_list`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NAPCAT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!groupListResponse.ok) {
      throw new Error(`NapCat API error: ${groupListResponse.statusText}`);
    }

    const groupListData = await groupListResponse.json() as { data?: any[] };
    const groups = groupListData.data || [];
    
    logger.info(`Found ${groups.length} groups from NapCat`);

    let syncedCount = 0;
    let updatedCount = 0;

    for (const group of groups) {
      try {
        // 检查群聊是否已存在
        const existingGroups = await database.executeQuery(
          'SELECT id, group_name FROM group_chat_settings WHERE group_id = ?',
          [group.group_id]
        );

        if (existingGroups.length > 0) {
          // 更新现有群聊信息
          await database.executeUpdate(`
            UPDATE group_chat_settings 
            SET group_name = ?, updated_at = NOW()
            WHERE group_id = ?
          `, [group.group_name || group.group_id.toString(), group.group_id]);
          updatedCount++;
        } else {
          // 插入新群聊
          await database.executeUpdate(`
            INSERT INTO group_chat_settings 
            (group_id, group_name, is_enabled, auto_reply_enabled, receive_events, created_at, updated_at)
            VALUES (?, ?, TRUE, TRUE, TRUE, NOW(), NOW())
          `, [group.group_id, group.group_name || group.group_id.toString()]);
          syncedCount++;
        }
      } catch (groupError) {
        logger.warn(`Failed to sync group ${group.group_id}`, { error: groupError });
      }
    }

    logger.info(`Group sync completed: ${syncedCount} new, ${updatedCount} updated`);

    res.json({
      success: true,
      message: 'Group sync completed',
      summary: {
        totalGroups: groups.length,
        newGroups: syncedCount,
        updatedGroups: updatedCount
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Group sync failed', { error });
    res.status(500).json({
      success: false,
      error: 'Group sync failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 同步好友/私聊信息
app.post('/api/sync/private-chats', async (req, res) => {
  try {
    logger.info('Starting private chat sync from NapCat API');
    
    // 获取好友列表
    const friendListResponse = await fetch(`${NAPCAT_API_BASE}/get_friend_list`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NAPCAT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!friendListResponse.ok) {
      throw new Error(`NapCat API error: ${friendListResponse.statusText}`);
    }

    const friendListData = await friendListResponse.json() as { data?: any[] };
    const friends = friendListData.data || [];
    
    logger.info(`Found ${friends.length} friends from NapCat`);

    let syncedCount = 0;
    let updatedCount = 0;

    for (const friend of friends) {
      try {
        // 检查私聊用户是否已存在
        const existingUsers = await database.executeQuery(
          'SELECT id, username FROM private_chat_settings WHERE user_id = ?',
          [friend.user_id]
        );

        if (existingUsers.length > 0) {
          // 更新现有用户信息
          await database.executeUpdate(`
            UPDATE private_chat_settings 
            SET username = ?, updated_at = NOW()
            WHERE user_id = ?
          `, [friend.nickname || friend.user_id.toString(), friend.user_id]);
          updatedCount++;
        } else {
          // 插入新用户
          await database.executeUpdate(`
            INSERT INTO private_chat_settings 
            (user_id, username, is_enabled, auto_reply_enabled, created_at, updated_at)
            VALUES (?, ?, TRUE, TRUE, NOW(), NOW())
          `, [friend.user_id, friend.nickname || friend.user_id.toString()]);
          syncedCount++;
        }
      } catch (friendError) {
        logger.warn(`Failed to sync friend ${friend.user_id}`, { error: friendError });
      }
    }

    logger.info(`Private chat sync completed: ${syncedCount} new, ${updatedCount} updated`);

    res.json({
      success: true,
      message: 'Private chat sync completed',
      summary: {
        totalFriends: friends.length,
        newFriends: syncedCount,
        updatedFriends: updatedCount
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Private chat sync failed', { error });
    res.status(500).json({
      success: false,
      error: 'Private chat sync failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 获取NapCat连接状态
app.get('/api/napcat/status', async (req, res) => {
  try {
    // 测试NapCat连接
    const statusResponse = await fetch(`${NAPCAT_API_BASE}/get_login_info`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NAPCAT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    } as RequestInit & { timeout?: number });

    if (statusResponse.ok) {
      const loginInfo = await statusResponse.json() as { data?: any };
      res.json({
        success: true,
        status: 'connected',
        napcat_url: NAPCAT_API_BASE,
        login_info: loginInfo.data || {},
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error(`NapCat not available: ${statusResponse.statusText}`);
    }
  } catch (error) {
    logger.warn('NapCat status check failed', { error });
    res.json({
      success: false,
      status: 'disconnected',
      napcat_url: NAPCAT_API_BASE,
      error: error instanceof Error ? error.message : 'Connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

// ============== DEBUG ENDPOINTS ==============
// Debug conversation LLM flow - 迁移自QQBot Core
app.get('/api/debug/conversation/:conversationId/llm-flow', async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    if (!database) {
      return res.status(500).json({
        success: false,
        error: 'Database service not available',
        timestamp: new Date().toISOString()
      });
    }

    // 获取对话基本信息
    const conversationQuery = `SELECT * FROM conversations WHERE id = ?`;
    const conversations = await database.executeQuery(conversationQuery, [conversationId]);
    
    if (conversations.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
        timestamp: new Date().toISOString()
      });
    }

    const conversation = conversations[0] as any;
    
    // 安全JSON解析函数
    const safeJsonParse = (jsonString: string | null): any => {
      if (!jsonString) return null;
      try {
        return JSON.parse(jsonString);
      } catch (error) {
        logger.warn('Failed to parse JSON', { jsonString, error });
        return null;
      }
    };
    
    // 获取数据库中的LLM追踪数据 - 直接根据conversation_id查询
    logger.info('Fetching LLM traces for conversation', { conversationId });
    const llmTraces = await database.executeQuery(
      `SELECT * FROM llm_call_traces WHERE conversation_id = ? ORDER BY call_sequence ASC`, 
      [conversationId]
    );
    logger.info('Found LLM traces', { conversationId, traceCount: llmTraces.length });

    res.json({
      conversation_id: conversationId,
      websocket_input: safeJsonParse(conversation.raw_request) || {},
      websocket_output: {
        content: conversation.ai_response,
        response_time_ms: conversation.response_time,
        model: conversation.model_name,
        timestamp: conversation.timestamp instanceof Date ? conversation.timestamp.toISOString() : new Date(conversation.timestamp).toISOString()
      },
      llm_trace: llmTraces.map((trace: any) => ({
        llm_raw_input: {
          engine_type: trace.engine_type,
          call_sequence: trace.call_sequence,
          model_name: trace.model_name,
          timestamp: trace.timestamp instanceof Date ? trace.timestamp.toISOString() : new Date(trace.timestamp).toISOString(),
          gemini_request: safeJsonParse(trace.request)
        },
        llm_raw_output: {
          prompt_tokens: trace.prompt_tokens,
          completion_tokens: trace.completion_tokens,
          total_tokens: trace.total_tokens,
          response_time_ms: trace.response_time,
          success: trace.success,
          gemini_response: safeJsonParse(trace.response)
        }
      }))
    });

  } catch (error) {
    logger.error('Failed to fetch LLM flow', { error, conversationId: req.params.conversationId });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Configuration endpoints
app.get('/api/config', (req, res) => {
  res.json({
    bot: {
      qq_number: process.env.BOT_QQ_NUMBER || '1129974489',
      ai_model: 'gemini-2.0-flash-exp',
      authorized_users: [85178516]
    },
    websocket: {
      host: process.env.WEBSOCKET_HOST || '127.0.0.1',
      port: process.env.WEBSOCKET_PORT || 3001,
      status: 'connected'
    },
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      name: process.env.DB_NAME || 'qqbot_db',
      status: 'connected'
    },
    timestamp: new Date().toISOString()
  });
});

// ============= 对话监控系统 API 端点 (Phase 1) =============

// 获取私聊用户列表（基于对话记录）
app.get('/api/conversation-monitoring/private-chats', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const timeRange = req.query.timeRange as string;
    const status = req.query.status as string;

    let whereConditions: string[] = [];
    let queryParams: any[] = [];

    // 基础查询：从conversations表获取有对话记录的用户
    let timeCondition = '';
    if (timeRange === 'today') {
      timeCondition = 'AND DATE(c.timestamp) = CURDATE()';
    } else if (timeRange === 'week') {
      timeCondition = 'AND c.timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
    } else if (timeRange === 'month') {
      timeCondition = 'AND c.timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    }

    // 搜索条件
    if (search) {
      whereConditions.push('(pcs.username LIKE ? OR c.user_id LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.length > 0 ? `AND ${whereConditions.join(' AND ')}` : '';

    // 获取总数
    const countQuery = `
      SELECT COUNT(DISTINCT c.user_id) as total
      FROM conversations c
      LEFT JOIN private_chat_settings pcs ON c.user_id = pcs.user_id
      WHERE c.user_id IS NOT NULL ${timeCondition} ${whereClause}
    `;
    const countResult = await database.executeQuery<{total: number}>(countQuery, queryParams);
    const total = countResult[0]?.total || 0;

    // 获取用户列表
    const dataQuery = `
      SELECT 
        c.user_id,
        COALESCE(pcs.username, CONCAT('用户', c.user_id)) as nickname,
        MAX(c.timestamp) as last_conversation_time,
        COUNT(c.id) as total_conversations,
        SUM(CASE WHEN c.status = 'completed' AND c.ai_response IS NOT NULL THEN 1 ELSE 0 END) as successful_replies,
        SUM(CASE WHEN c.status = 'failed' OR c.ai_response IS NULL THEN 1 ELSE 0 END) as failed_replies,
        COALESCE(pcs.is_enabled, TRUE) as is_enabled,
        COALESCE(pcs.auto_reply_enabled, TRUE) as auto_reply_enabled,
        pcs.user_notes
      FROM conversations c
      LEFT JOIN private_chat_settings pcs ON c.user_id = pcs.user_id
      WHERE c.user_id IS NOT NULL ${timeCondition} ${whereClause}
      GROUP BY c.user_id, pcs.username, pcs.is_enabled, pcs.auto_reply_enabled, pcs.user_notes
      ORDER BY MAX(c.timestamp) DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    
    const users = await database.executeQuery(dataQuery, queryParams);

    // 计算状态
    const processedUsers = users.map((user: any) => {
      const successRate = user.total_conversations > 0 ? 
        (user.successful_replies / user.total_conversations * 100).toFixed(1) : '0.0';
      
      let chatStatus = 'success';
      if (!user.is_enabled) {
        chatStatus = 'disabled';
      } else if (user.failed_replies > user.successful_replies) {
        chatStatus = 'failed';
      } else if (user.total_conversations === 0) {
        chatStatus = 'inactive';
      }

      return {
        ...user,
        success_rate: successRate,
        status: chatStatus
      };
    });

    res.json({
      success: true,
      data: processedUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get private chats', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get private chats',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 获取单个用户的对话详情
app.get('/api/conversation-monitoring/private-chats/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const startTime = req.query.startTime as string;
    const endTime = req.query.endTime as string;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID',
        timestamp: new Date().toISOString()
      });
    }

    let whereConditions: string[] = ['user_id = ?'];
    let queryParams: any[] = [userId];

    // 时间范围过滤
    if (startTime) {
      whereConditions.push('timestamp >= ?');
      queryParams.push(startTime);
    }
    if (endTime) {
      whereConditions.push('timestamp <= ?');
      queryParams.push(endTime);
    }

    // 内容搜索
    if (search) {
      whereConditions.push('(user_message LIKE ? OR ai_response LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // 获取总数
    const countQuery = `SELECT COUNT(*) as total FROM conversations WHERE ${whereClause}`;
    const countResult = await database.executeQuery<{total: number}>(countQuery, queryParams);
    const total = countResult[0]?.total || 0;

    // 获取对话列表
    const conversationsQuery = `
      SELECT 
        id as conversation_id,
        trace_id,
        user_message,
        ai_response,
        timestamp,
        response_time,
        status,
        error_message,
        model_name,
        message_id,
        raw_request,
        raw_response
      FROM conversations 
      WHERE ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    
    const conversations = await database.executeQuery(conversationsQuery, queryParams);

    // 获取用户设置
    const userSettings = await database.executeQuery(
      'SELECT * FROM private_chat_settings WHERE user_id = ?',
      [userId]
    );

    res.json({
      success: true,
      data: {
        user_id: userId,
        settings: userSettings[0] || { is_enabled: true, auto_reply_enabled: true },
        conversations: conversations
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get user conversations', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get user conversations',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 更新用户私聊设置
app.put('/api/conversation-monitoring/private-chats/:userId/settings', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const { is_enabled, auto_reply_enabled, nickname, notes } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID',
        timestamp: new Date().toISOString()
      });
    }

    // 检查用户是否存在设置记录
    const existingSettings = await database.executeQuery(
      'SELECT user_id FROM private_chat_settings WHERE user_id = ?',
      [userId]
    );

    let query: string;
    let params: any[];

    if (existingSettings.length > 0) {
      // 更新现有记录
      query = `
        UPDATE private_chat_settings 
        SET is_enabled = ?, auto_reply_enabled = ?, nickname = ?, notes = ?, updated_at = NOW()
        WHERE user_id = ?
      `;
      params = [is_enabled, auto_reply_enabled, nickname, notes, userId];
    } else {
      // 插入新记录
      query = `
        INSERT INTO private_chat_settings (user_id, is_enabled, auto_reply_enabled, nickname, notes)
        VALUES (?, ?, ?, ?, ?)
      `;
      params = [userId, is_enabled, auto_reply_enabled, nickname, notes];
    }

    await database.executeUpdate(query, params);

    logger.info(`Updated private chat settings for user ${userId}`, {
      is_enabled, auto_reply_enabled, nickname
    });

    res.json({
      success: true,
      message: 'Private chat settings updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to update private chat settings', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to update private chat settings',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 重试用户的失败对话
app.post('/api/conversation-monitoring/private-chats/:userId/retry/:conversationId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const conversationId = req.params.conversationId;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID',
        timestamp: new Date().toISOString()
      });
    }

    // 获取原始对话记录
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

    // TODO: 这里应该调用QQBot Core的重试接口
    // 目前只是标记为处理中状态
    await database.executeUpdate(
      'UPDATE conversations SET status = ?, updated_at = NOW() WHERE id = ?',
      ['processing', conversationId]
    );

    logger.info(`Retry requested for conversation ${conversationId} by user ${userId}`);

    res.json({
      success: true,
      message: 'Retry request submitted successfully',
      conversation_id: conversationId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to retry conversation', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retry conversation',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`, { 
    stack: err.stack, 
    url: req.url, 
    method: req.method 
  });
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler - MOVED TO END OF FILE

// =================== 私聊管理 API ===================

// 获取私聊用户列表
app.get('/api/private-chats', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const timeRange = req.query.timeRange as string || 'all';
    const status = req.query.status as string;

    let timeCondition = '';
    let timeParams: any[] = [];

    // 处理时间范围
    switch (timeRange) {
      case 'today':
        timeCondition = 'AND DATE(c.timestamp) = CURDATE()';
        break;
      case 'week':
        timeCondition = 'AND c.timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case 'month':
        timeCondition = 'AND c.timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
    }

    let searchCondition = '';
    let searchParams: any[] = [];
    if (search) {
      searchCondition = 'AND (CAST(c.user_id AS CHAR) LIKE ? OR c.user_message LIKE ? OR c.ai_response LIKE ?)';
      const searchTerm = `%${search}%`;
      searchParams = [searchTerm, searchTerm, searchTerm];
    }

    let statusCondition = '';
    let statusParams: any[] = [];
    if (status && status !== 'all') {
      switch (status) {
        case 'success':
          statusCondition = 'AND latest_status = "completed" AND latest_ai_response IS NOT NULL';
          break;
        case 'failed':
          statusCondition = 'AND (latest_status = "failed" OR latest_ai_response IS NULL)';
          break;
        case 'disabled':
          statusCondition = 'AND IFNULL(pcs.is_enabled, 1) = 0';
          break;
      }
    }

    // 查询用户列表和统计信息
    const usersQuery = `
      SELECT 
        c.user_id,
        COUNT(c.id) as total_conversations,
        MAX(c.timestamp) as last_conversation_time,
        COUNT(CASE WHEN c.ai_response IS NOT NULL AND c.status = 'completed' THEN 1 END) as successful_replies,
        COUNT(CASE WHEN c.ai_response IS NULL OR c.status = 'failed' THEN 1 END) as failed_replies,
        (SELECT status FROM conversations WHERE user_id = c.user_id ORDER BY timestamp DESC LIMIT 1) as latest_status,
        (SELECT ai_response FROM conversations WHERE user_id = c.user_id ORDER BY timestamp DESC LIMIT 1) as latest_ai_response,
        AVG(c.response_time) as avg_response_time,
        IFNULL(pcs.is_enabled, 1) as is_enabled,
        IFNULL(pcs.auto_reply_enabled, 1) as auto_reply_enabled,
        pcs.username as nickname
      FROM conversations c
      LEFT JOIN private_chat_settings pcs ON c.user_id = pcs.user_id
      WHERE 1=1 ${timeCondition} ${searchCondition} ${statusCondition}
      GROUP BY c.user_id, pcs.is_enabled, pcs.auto_reply_enabled, pcs.username
      ORDER BY last_conversation_time DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT c.user_id) as total
      FROM conversations c
      LEFT JOIN private_chat_settings pcs ON c.user_id = pcs.user_id
      WHERE 1=1 ${timeCondition} ${searchCondition} ${statusCondition}
    `;

    const queryParams = [...timeParams, ...searchParams, ...statusParams];
    
    const [users, countResult] = await Promise.all([
      database.executeQuery(usersQuery, queryParams),
      database.executeQuery<{total: number}>(countQuery, queryParams)
    ]);

    const total = countResult[0]?.total || 0;

    // 处理用户数据，添加状态
    const processedUsers = users.map((user: any) => {
      let status = 'success';
      if (!user.is_enabled) {
        status = 'disabled';
      } else if (!user.latest_ai_response || user.latest_status === 'failed') {
        status = 'failed';
      } else if (user.latest_status === 'processing') {
        status = 'processing';
      }

      const successRate = user.total_conversations > 0 
        ? Math.round((user.successful_replies / user.total_conversations) * 100) 
        : 0;

      return {
        user_id: user.user_id,
        nickname: user.nickname || `用户${user.user_id}`,
        last_conversation_time: user.last_conversation_time,
        status,
        total_conversations: user.total_conversations,
        successful_replies: user.successful_replies,
        failed_replies: user.failed_replies,
        success_rate: successRate,
        avg_response_time: user.avg_response_time,
        is_enabled: user.is_enabled,
        auto_reply_enabled: user.auto_reply_enabled
      };
    });

    res.json({
      success: true,
      data: processedUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get private chats', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get private chats',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 获取特定用户的对话详情
app.get('/api/private-chats/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const startTime = req.query.startTime as string;
    const endTime = req.query.endTime as string;

    let whereConditions = ['c.user_id = ?'];
    let queryParams: any[] = [parseInt(userId)];

    if (search) {
      whereConditions.push('(c.user_message LIKE ? OR c.ai_response LIKE ?)');
      const searchTerm = `%${search}%`;
      queryParams.push(searchTerm, searchTerm);
    }

    if (startTime) {
      whereConditions.push('c.timestamp >= ?');
      queryParams.push(new Date(startTime));
    }

    if (endTime) {
      whereConditions.push('c.timestamp <= ?');
      queryParams.push(new Date(endTime));
    }

    const whereClause = whereConditions.join(' AND ');

    // 获取对话列表
    const conversationsQuery = `
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
    `;

    // 获取总数
    const countQuery = `SELECT COUNT(*) as total FROM conversations c WHERE ${whereClause}`;

    // 获取用户设置
    const userSettingsQuery = `
      SELECT 
        user_id,
        username as nickname,
        is_enabled,
        auto_reply_enabled,
        welcome_message,
        user_notes,
        last_activity
      FROM private_chat_settings 
      WHERE user_id = ?
    `;

    const [conversations, countResult, userSettings] = await Promise.all([
      database.executeQuery(conversationsQuery, queryParams),
      database.executeQuery<{total: number}>(countQuery, queryParams),
      database.executeQuery(userSettingsQuery, [parseInt(userId)])
    ]);

    const total = countResult[0]?.total || 0;

    // 今日统计
    const todayStatsQuery = `
      SELECT 
        COUNT(*) as today_conversations,
        COUNT(CASE WHEN ai_response IS NOT NULL AND status = 'completed' THEN 1 END) as today_success,
        COUNT(CASE WHEN ai_response IS NULL OR status = 'failed' THEN 1 END) as today_failed
      FROM conversations 
      WHERE user_id = ? AND DATE(timestamp) = CURDATE()
    `;

    const todayStats = await database.executeQuery(todayStatsQuery, [parseInt(userId)]);

    res.json({
      success: true,
      data: {
        user_id: parseInt(userId),
        user_settings: userSettings[0] || {
          user_id: parseInt(userId),
          nickname: `用户${userId}`,
          is_enabled: true,
          auto_reply_enabled: true,
          welcome_message: null,
          user_notes: null,
          last_activity: null
        },
        today_stats: todayStats[0] || {
          today_conversations: 0,
          today_success: 0,
          today_failed: 0
        },
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
    logger.error('Failed to get private chat details', { error, userId: req.params.userId });
    res.status(500).json({
      success: false,
      error: 'Failed to get private chat details',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 获取对话链路追踪详情
app.get('/api/private-chats/:userId/trace/:traceId', async (req, res) => {
  try {
    const { userId, traceId } = req.params;

    // 获取对话基本信息
    const conversationQuery = `
      SELECT 
        id, trace_id, user_id, user_message, ai_response, 
        timestamp, response_time, status, error_reason, model_name
      FROM conversations 
      WHERE user_id = ? AND trace_id = ?
    `;

    // 获取处理链路详情
    const traceQuery = `
      SELECT 
        id, trace_id, step_name, step_order, status,
        start_time, end_time, duration_ms, 
        input_data, output_data, error_message, metadata
      FROM processing_traces 
      WHERE trace_id = ?
      ORDER BY step_order ASC, start_time ASC
    `;

    const [conversationResult, traceSteps] = await Promise.all([
      database.executeQuery(conversationQuery, [parseInt(userId), traceId]),
      database.executeQuery(traceQuery, [traceId])
    ]);

    if (conversationResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
        timestamp: new Date().toISOString()
      });
    }

    const conversation = conversationResult[0];

    res.json({
      success: true,
      data: {
        conversation,
        trace_steps: traceSteps,
        summary: {
          total_steps: traceSteps.length,
          successful_steps: traceSteps.filter((step: any) => step.status === 'success').length,
          failed_steps: traceSteps.filter((step: any) => step.status === 'failed').length,
          total_duration: traceSteps.reduce((sum: number, step: any) => sum + (step.duration_ms || 0), 0)
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get trace details', { error, userId: req.params.userId, traceId: req.params.traceId });
    res.status(500).json({
      success: false,
      error: 'Failed to get trace details',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 更新用户设置
app.put('/api/private-chats/:userId/settings', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const { is_enabled, auto_reply_enabled, nickname, notes } = req.body;

    // 检查用户设置是否已存在
    const existingQuery = 'SELECT user_id FROM private_chat_settings WHERE user_id = ?';
    const existing = await database.executeQuery(existingQuery, [userId]);

    let query: string;
    let params: any[];

    if (existing.length > 0) {
      // 更新现有设置
      query = `
        UPDATE private_chat_settings 
        SET is_enabled = ?, auto_reply_enabled = ?, username = ?, user_notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `;
      params = [is_enabled, auto_reply_enabled, nickname, notes, userId];
    } else {
      // 创建新设置
      query = `
        INSERT INTO private_chat_settings (user_id, is_enabled, auto_reply_enabled, username, user_notes)
        VALUES (?, ?, ?, ?, ?)
      `;
      params = [userId, is_enabled, auto_reply_enabled, nickname, notes];
    }

    await database.executeUpdate(query, params);

    res.json({
      success: true,
      message: 'User settings updated successfully',
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

// =================== 群聊管理 API ===================

// 获取群聊列表
app.get('/api/group-chats', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const sortBy = req.query.sortBy as string || 'recent';

    let whereConditions: string[] = [];
    let queryParams: any[] = [];
    let orderBy = 'gcs.updated_at DESC'; // 默认按最近更新排序

    // 搜索条件
    if (search) {
      whereConditions.push('(gcs.group_name LIKE ? OR gcs.group_id LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    // 状态筛选
    if (status === 'enabled') {
      whereConditions.push('gcs.is_enabled = TRUE');
    } else if (status === 'disabled') {
      whereConditions.push('gcs.is_enabled = FALSE');
    }

    // 排序方式
    if (sortBy === 'name') {
      orderBy = 'COALESCE(gcs.group_name, CONCAT("群", gcs.group_id)) ASC';
    } else if (sortBy === 'activity') {
      orderBy = 'gcs.last_activity DESC';
    }

    // 获取总数
    const countQuery = `SELECT COUNT(*) as total FROM group_chat_settings gcs ${whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''}`;
    
    const countResult = await database.executeQuery<{total: number}>(countQuery, queryParams);
    const total = countResult[0]?.total || 0;

    // 获取群聊列表 - 由于conversations表没有group_id，我们基于group_chat_settings提供基础数据
    const dataQuery = `
      SELECT 
        gcs.group_id,
        COALESCE(gcs.group_name, CONCAT('群', gcs.group_id)) as group_name,
        gcs.last_activity as last_conversation_time,
        0 as total_conversations,
        0 as successful_replies,
        0 as failed_replies,
        100 as success_rate,
        0 as avg_response_time,
        1 as activity_level,
        gcs.is_enabled,
        gcs.auto_reply_enabled,
        gcs.admin_user_id,
        gcs.welcome_message,
        gcs.created_at,
        gcs.updated_at
      FROM group_chat_settings gcs
      ${whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const groups = await database.executeQuery(dataQuery, queryParams);

    // 处理数据，确定状态
    const processedGroups = groups.map((group: any) => {
      let status = 'success';
      if (!group.is_enabled) {
        status = 'disabled';
      } else if (group.success_rate < 50) {
        status = 'failed';
      } else if (group.activity_level === 1) {
        status = 'inactive';
      }

      return {
        ...group,
        status,
        last_conversation_time: group.last_conversation_time ? new Date(group.last_conversation_time).toISOString() : null
      };
    });

    res.json({
      success: true,
      data: processedGroups,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get group chats', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get group chats',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 获取特定群聊的对话详情
app.get('/api/group-chats/:groupId', async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const startTime = req.query.startTime as string;
    const endTime = req.query.endTime as string;
    const showAll = req.query.showAll === 'true'; // 显示所有消息还是只显示@机器人的

    // 由于conversations表没有group_id字段，暂时返回空的对话列表
    // 在实际应用中，需要添加group_id字段或建立关联机制
    const conversations: any[] = [];
    const total = 0;

    // 获取群聊设置
    const groupSettingsQuery = `
      SELECT 
        group_id,
        group_name,
        is_enabled,
        auto_reply_enabled,
        welcome_message,
        admin_user_id,
        last_activity
      FROM group_chat_settings 
      WHERE group_id = ?
    `;

    // 获取今日统计 - 暂时返回模拟数据
    const todayStats = [{
      today_conversations: 0,
      today_success: 0,
      today_failed: 0
    }];

    const groupSettings = await database.executeQuery(groupSettingsQuery, [parseInt(groupId)]);

    res.json({
      success: true,
      data: {
        group_id: parseInt(groupId),
        group_settings: groupSettings[0] || {
          group_id: parseInt(groupId),
          group_name: `群${groupId}`,
          is_enabled: 1,
          auto_reply_enabled: 1,
          welcome_message: null,
          admin_user_id: null,
          last_activity: null
        },
        today_stats: todayStats[0] || {
          today_conversations: 0,
          today_success: 0,
          today_failed: 0
        },
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
    logger.error('Failed to get group chat details', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get group chat details',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 更新群聊设置
app.put('/api/group-chats/:groupId/settings', async (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId);
    const {
      is_enabled,
      auto_reply_enabled,
      group_name,
      welcome_message,
      admin_user_id
    } = req.body;

    // 构建更新字段
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (typeof is_enabled === 'boolean') {
      updateFields.push('is_enabled = ?');
      updateValues.push(is_enabled);
    }

    if (typeof auto_reply_enabled === 'boolean') {
      updateFields.push('auto_reply_enabled = ?');
      updateValues.push(auto_reply_enabled);
    }

    if (group_name !== undefined) {
      updateFields.push('group_name = ?');
      updateValues.push(group_name);
    }

    if (welcome_message !== undefined) {
      updateFields.push('welcome_message = ?');
      updateValues.push(welcome_message);
    }

    if (admin_user_id !== undefined) {
      updateFields.push('admin_user_id = ?');
      updateValues.push(admin_user_id);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update',
        timestamp: new Date().toISOString()
      });
    }

    updateFields.push('updated_at = NOW()');
    updateValues.push(groupId);

    // 先尝试更新，如果没有记录则插入
    const updateQuery = `
      UPDATE group_chat_settings 
      SET ${updateFields.join(', ')}
      WHERE group_id = ?
    `;

    const updateResult = await database.executeUpdate(updateQuery, updateValues);

    // 如果没有更新任何行，说明记录不存在，需要插入
    if (updateResult === 0) {
      const insertQuery = `
        INSERT INTO group_chat_settings (group_id, is_enabled, auto_reply_enabled, group_name, welcome_message, admin_user_id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        is_enabled = COALESCE(VALUES(is_enabled), is_enabled),
        auto_reply_enabled = COALESCE(VALUES(auto_reply_enabled), auto_reply_enabled),
        group_name = COALESCE(VALUES(group_name), group_name),
        welcome_message = COALESCE(VALUES(welcome_message), welcome_message),
        admin_user_id = COALESCE(VALUES(admin_user_id), admin_user_id),
        updated_at = NOW()
      `;

      await database.executeUpdate(insertQuery, [
        groupId,
        is_enabled ?? true,
        auto_reply_enabled ?? true,
        group_name ?? null,
        welcome_message ?? null,
        admin_user_id ?? null
      ]);
    }

    res.json({
      success: true,
      message: 'Group chat settings updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to update group chat settings', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to update group chat settings',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// =================== Prompt 管理 API ===================

// 获取所有 Prompt 配置
app.get('/api/prompts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const agent_type = req.query.agent_type as string;

    let whereConditions: string[] = [];
    let queryParams: any[] = [];

    // 搜索条件
    if (search) {
      whereConditions.push('(prompt_name LIKE ? OR description LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    // 按类型筛选
    if (agent_type) {
      whereConditions.push('agent_type = ?');
      queryParams.push(agent_type);
    }

    // 获取总数
    const countQuery = `SELECT COUNT(*) as total FROM agent_prompts ${whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''}`;
    const countResult = await database.executeQuery<{total: number}>(countQuery, queryParams);
    const total = countResult[0]?.total || 0;

    // 获取 prompt 列表
    const dataQuery = `
      SELECT 
        id,
        agent_type,
        prompt_name,
        system_instructions,
        user_prompt_template,
        context_variables,
        model_config,
        is_active,
        version,
        created_by,
        created_at,
        updated_at,
        description
      FROM agent_prompts
      ${whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''}
      ORDER BY agent_type ASC, prompt_name ASC, version DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const prompts = await database.executeQuery(dataQuery, queryParams);

    res.json({
      success: true,
      data: prompts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get prompts', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get prompts',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 获取单个 Prompt 详情
app.get('/api/prompts/:id', async (req, res) => {
  try {
    const promptId = req.params.id;
    
    const prompt = await database.executeQuery(
      'SELECT * FROM agent_prompts WHERE id = ?',
      [promptId]
    );

    if (!prompt || prompt.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: prompt[0],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get prompt details', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get prompt details',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 创建新 Prompt
app.post('/api/prompts', async (req, res) => {
  try {
    const {
      agent_type,
      prompt_name,
      system_instructions,
      user_prompt_template,
      context_variables,
      model_config,
      description,
      created_by
    } = req.body;

    // 验证必填字段
    if (!agent_type || !prompt_name || !system_instructions || !created_by) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'agent_type, prompt_name, system_instructions, and created_by are required',
        timestamp: new Date().toISOString()
      });
    }

    // 生成新的UUID
    const { v4: uuidv4 } = require('uuid');
    const promptId = uuidv4();

    // 插入新 prompt
    await database.executeUpdate(`
      INSERT INTO agent_prompts (
        id, agent_type, prompt_name, system_instructions, 
        user_prompt_template, context_variables, model_config, 
        description, created_by, is_active, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, 1)
    `, [
      promptId,
      agent_type,
      prompt_name,
      JSON.stringify(system_instructions),
      user_prompt_template || null,
      context_variables ? JSON.stringify(context_variables) : null,
      model_config ? JSON.stringify(model_config) : null,
      description || null,
      created_by
    ]);

    res.json({
      success: true,
      data: { 
        id: promptId,
        message: 'Prompt created successfully' 
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to create prompt', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to create prompt',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 更新 Prompt
app.put('/api/prompts/:id', async (req, res) => {
  try {
    const promptId = req.params.id;
    const {
      agent_type,
      prompt_name,
      system_instructions,
      user_prompt_template,
      context_variables,
      model_config,
      description,
      is_active
    } = req.body;

    // 检查 prompt 是否存在
    const existingPrompt = await database.executeQuery(
      'SELECT id FROM agent_prompts WHERE id = ?',
      [promptId]
    );

    if (!existingPrompt || existingPrompt.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found',
        timestamp: new Date().toISOString()
      });
    }

    // 更新 prompt
    await database.executeUpdate(`
      UPDATE agent_prompts SET
        agent_type = COALESCE(?, agent_type),
        prompt_name = COALESCE(?, prompt_name),
        system_instructions = COALESCE(?, system_instructions),
        user_prompt_template = COALESCE(?, user_prompt_template),
        context_variables = COALESCE(?, context_variables),
        model_config = COALESCE(?, model_config),
        description = COALESCE(?, description),
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      agent_type,
      prompt_name,
      system_instructions ? JSON.stringify(system_instructions) : null,
      user_prompt_template,
      context_variables ? JSON.stringify(context_variables) : null,
      model_config ? JSON.stringify(model_config) : null,
      description,
      is_active,
      promptId
    ]);

    res.json({
      success: true,
      data: { 
        id: promptId,
        message: 'Prompt updated successfully' 
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to update prompt', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to update prompt',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 删除 Prompt
app.delete('/api/prompts/:id', async (req, res) => {
  try {
    const promptId = req.params.id;

    // 检查 prompt 是否存在
    const existingPrompt = await database.executeQuery(
      'SELECT id FROM agent_prompts WHERE id = ?',
      [promptId]
    );

    if (!existingPrompt || existingPrompt.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Prompt not found',
        timestamp: new Date().toISOString()
      });
    }

    // 删除 prompt
    await database.executeUpdate(
      'DELETE FROM agent_prompts WHERE id = ?',
      [promptId]
    );

    res.json({
      success: true,
      data: { 
        id: promptId,
        message: 'Prompt deleted successfully' 
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to delete prompt', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to delete prompt',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// 获取 Agent 类型列表
app.get('/api/agent-types', (req, res) => {
  const agentTypes = [
    { value: 'chat_bot', label: '聊天机器人', description: '处理日常对话交互的AI机器人' },
    { value: 'intent_analyzer', label: '意图分析器', description: '分析用户消息意图的专业模型' },
    { value: 'requirement_processor', label: '需求处理器', description: '处理复杂技术需求的AI助手' },
    { value: 'custom', label: '自定义', description: '用户自定义的特殊功能AI' }
  ];

  res.json({
    success: true,
    data: agentTypes,
    timestamp: new Date().toISOString()
  });
});

// 404 handler - Must be LAST route definition
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Admin Backend服务已启动 - http://0.0.0.0:${PORT}`);
  console.log(`Admin Backend service running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  server.close(async () => {
    await database.close();
    logger.info('Admin Backend server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  server.close(async () => {
    await database.close();
    logger.info('Admin Backend server closed');
    process.exit(0);
  });
});

export default app;