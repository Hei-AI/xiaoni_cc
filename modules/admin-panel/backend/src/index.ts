import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import winston from 'winston';
import { DatabaseManager } from './services/database';
import simpleQueueRoutes from './routes/simple-queue-monitor';
import queueMonitorRoutes from './routes/queue-monitor';
import { createDebugRoutes } from './routes/debug-routes';
import { createTokenRoutes } from './routes/token-management';
import { createConversationRoutes } from './routes/conversation-routes';
import { createLogRoutes } from './routes/log-routes';
import { createStatusRoutes } from './routes/status-routes';
import { createPromptRoutes } from './routes/prompt-routes';
import { createChatRoutes } from './routes/chat-routes';
import { createAgentRoutes } from './routes/agent-routes';
import { createTrafficMonitorRoutes } from './routes/traffic-monitor-routes';
import { createPlaygroundRoutes } from './routes/playground-routes';
import { TrafficLogWatcher, DEFAULT_WATCHER_CONFIG } from './services/traffic-log-watcher';

// Load environment variables
config();

const app = express();
const PORT = parseInt(process.env.HTTP_PORT || '9080', 10);

// Configure logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Database connection
let database: DatabaseManager;

async function initializeDatabase() {
  try {
    database = new DatabaseManager({
      host: process.env.DB_HOST || 'qqbot-mysql',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'qqbot_user',
      password: process.env.DB_PASSWORD || 'qqbot_password',
      database: process.env.DB_NAME || 'qqbot_db',
      charset: 'utf8mb4',
      timezone: process.env.DB_TIMEZONE || 'Z'
    }, logger);

    // Test connection instead of calling initialize()
    const isHealthy = await database.testConnection();
    if (isHealthy) {
      logger.info('✅ Database connection established successfully');
      return true;
    } else {
      logger.error('❌ Database connection test failed');
      return false;
    }
  } catch (error) {
    logger.error('❌ Failed to initialize database:', error);
    return false;
  }
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // 简化CSP，生产环境需要配置
}));

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3003',
    'http://127.0.0.1:3003',
    'http://qqbot-admin-frontend:3003'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 路由将在数据库初始化后设置

// Start server
async function startServer() {
  const dbInitialized = await initializeDatabase();

  if (!dbInitialized) {
    logger.error('🔴 Failed to initialize database. Server cannot start.');
    process.exit(1);
  }

  // 🔥 模块化路由 - 数据库初始化后设置所有功能模块
  try {
    logger.info('🔧 Registering status routes...');
    logger.info('🔍 createStatusRoutes type:', typeof createStatusRoutes);
    const statusRouter = createStatusRoutes(database, logger);
    logger.info('🔍 Status router created:', typeof statusRouter);
    app.use('/api', statusRouter);         // Health, status, dashboard
  } catch (error) {
    logger.error('❌ Failed to register status routes:', error);
  }
  logger.info('🔧 Registering conversation routes...');
  const conversationRouter = createConversationRoutes(database, logger);
  logger.info('🔍 Conversation router created:', typeof conversationRouter);
  app.use('/api', conversationRouter);   // Conversations, timeline
  logger.info('🔧 Registering log routes...');
  app.use('/api', createLogRoutes(database, logger));           // Log queries
  logger.info('🔧 Registering prompt routes...');
  app.use('/api', createPromptRoutes(database, logger));        // Prompt management
  logger.info('🔧 Registering debug routes...');
  app.use('/api', createDebugRoutes(database, logger));         // Debug endpoints
  logger.info('🔧 Registering token routes...');
  app.use('/api', createTokenRoutes(database, logger));         // Token management
  logger.info('🔧 Registering chat routes...');
  app.use('/api', createChatRoutes(database, logger));          // Group & private chats
  logger.info('🔧 Registering agent routes...');
  app.use('/api', createAgentRoutes(database, logger));         // Agent types
  logger.info('🔧 Registering traffic monitor routes...');
  app.use('/api', createTrafficMonitorRoutes(database, logger)); // HTTP traffic monitoring
  logger.info('🔧 Registering playground routes...');
  app.use('/api', createPlaygroundRoutes(database, logger));     // Playground cases & runs

  // 现有的专用路由
  logger.info('🔧 Registering simple-queue routes...');
  app.use('/api/simple-queue', simpleQueueRoutes);
  logger.info('🔧 Registering queue-monitor routes...');
  app.use('/api/queue-monitor', queueMonitorRoutes);

  logger.info('✅ All routes registered successfully');

  // 启动流量日志监听服务
  logger.info('🔧 Starting traffic log watcher...');
  const logWatcher = new TrafficLogWatcher(database, logger, DEFAULT_WATCHER_CONFIG);
  await logWatcher.start();
  logger.info('✅ Traffic log watcher started successfully');

  // Error handling middleware (must be AFTER routes)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(`Unhandled error: ${err.message}`, {
      stack: err.stack,
      url: req.url,
      method: req.method
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  });

  // 404 handler (must be LAST)
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      requested_url: req.originalUrl,
      timestamp: new Date().toISOString()
    });
  });

  app.listen(PORT, () => {
    logger.info(`🚀 Admin Panel Backend Server running on port ${PORT}`);
    logger.info(`🔗 Health check: http://localhost:${PORT}/api/health`);
    logger.info(`🎛️  Admin API: http://localhost:${PORT}/api/`);
  });
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  logger.info('🔄 Shutting down server...');
  if (database) {
    await database.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🔄 Shutting down server...');
  if (database) {
    await database.close();
  }
  process.exit(0);
});

startServer().catch(error => {
  logger.error('💥 Failed to start server:', error);
  process.exit(1);
});

export default app;
