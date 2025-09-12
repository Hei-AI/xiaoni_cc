import express, { Express, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';

interface HttpServerConfig {
  port?: number;
  host?: string;
}

interface HttpServerServices {
  database?: any;
  websocketClient?: any;
  debugService?: any;
  qqBot?: any;
}

class HttpServer {
  private app: Express;
  private server: any;
  private moduleLogger = logger.createModuleLogger('http-server');
  private config: HttpServerConfig;
  private services: HttpServerServices;

  constructor(serverConfig?: HttpServerConfig, services?: HttpServerServices) {
    this.config = serverConfig || {};
    this.services = services || {};
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        service: 'qq-bot-core',
        timestamp: new Date().toISOString()
      });
    });

    // Status endpoint
    this.app.get('/api/status', (req: Request, res: Response) => {
      res.json({
        service: 'QQBot Core Service',
        status: 'running',
        port: this.config.port || config.http_server.port || 8081,
        timestamp: new Date().toISOString()
      });
    });

    // NOTE: Business API endpoints (send_private, send_group) have been moved to HTTP API Gateway
    // This improves separation of concerns - Core focuses on bot logic, Gateway handles external APIs

    // Internal API endpoints for HTTP Gateway communication
    this.app.post('/api/internal/send_private', async (req: Request, res: Response) => {
      const { user_id, message } = req.body;
      
      if (!user_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: user_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info(`Internal API: 发送私聊消息`, { user_id, messageLength: message.length });
      
      try {
        if (this.services.websocketClient) {
          await this.services.websocketClient.sendPrivateMessage(user_id, message);
          res.json({
            success: true,
            message: 'Private message sent successfully',
            user_id: user_id,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(503).json({
            success: false,
            error: 'WebSocket client not available',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error: any) {
        this.moduleLogger.error('Failed to send private message', { error: error.message, user_id });
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    this.app.post('/api/internal/send_group', async (req: Request, res: Response) => {
      const { group_id, message } = req.body;
      
      if (!group_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: group_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info(`Internal API: 发送群聊消息`, { group_id, messageLength: message.length });
      
      try {
        if (this.services.websocketClient) {
          await this.services.websocketClient.sendGroupMessage(group_id, message);
          res.json({
            success: true,
            message: 'Group message sent successfully',
            group_id: group_id,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(503).json({
            success: false,
            error: 'WebSocket client not available',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error: any) {
        this.moduleLogger.error('Failed to send group message', { error: error.message, group_id });
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // NOTE: Debug and test endpoints have been moved to Admin Panel Backend
    // This separation improves module responsibility and security
    // For debugging features, use Admin Panel at port 9080

  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = this.config.port || config.http_server.port || 8081;
      const host = this.config.host || config.http_server.host || '0.0.0.0';

      this.server = this.app.listen(port, host, () => {
        this.moduleLogger.info(`HTTP服务器已启动 - ${host}:${port}`);
        resolve();
      });

      this.server.on('error', (error: any) => {
        this.moduleLogger.error(`HTTP服务器启动失败: ${error.message}`);
        reject(error);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.moduleLogger.info('HTTP服务器已关闭');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getApp(): Express {
    return this.app;
  }

}

export default HttpServer;