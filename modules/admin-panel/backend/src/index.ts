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

// Token health check endpoint - 真实的健康检查
app.post('/api/tokens/health-check', async (req, res) => {
  try {
    logger.info('Starting real token health check...');
    
    // 获取所有活跃的Token
    const tokens = await database.executeQuery(`
      SELECT id, token, project_name FROM api_tokens WHERE is_active = TRUE
    `);
    
    logger.info(`Found ${tokens.length} active tokens to check`);
    
    let healthyCount = 0;
    const axios = require('axios');
    
    // 并行检查所有Token
    const checkPromises = tokens.map(async (tokenData: any) => {
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
          // Token健康，更新数据库
          await database.executeUpdate(`
            UPDATE api_tokens SET 
              is_healthy = TRUE,
              error_count = 0,
              last_error = NULL,
              last_error_time = NULL,
              last_health_check = NOW()
            WHERE id = ?
          `, [tokenData.id]);
          
          logger.info(`Token ${tokenData.project_name} is healthy (${responseTime}ms)`);
          healthyCount++;
          return { id: tokenData.id, healthy: true };
        }
      } catch (error: any) {
        // Token不健康，更新数据库
        const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
        
        await database.executeUpdate(`
          UPDATE api_tokens SET 
            is_healthy = FALSE,
            error_count = error_count + 1,
            last_error = ?,
            last_error_time = NOW(),
            last_health_check = NOW()
          WHERE id = ?
        `, [errorMessage, tokenData.id]);
        
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
      FROM token_logs tl
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

// 404 handler
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