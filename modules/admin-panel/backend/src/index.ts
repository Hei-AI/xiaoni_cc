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