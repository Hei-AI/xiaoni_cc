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