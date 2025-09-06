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

    // Send private message endpoint
    this.app.post('/api/send_private', async (req: Request, res: Response) => {
      const { user_id, message } = req.body;
      
      if (!user_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: user_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info(`API请求发送私聊消息: ${user_id} - ${message}`);
      
      try {
        if (!this.services.websocketClient) {
          throw new Error('WebSocket client not available');
        }

        if (!this.services.websocketClient.isConnected()) {
          throw new Error('WebSocket client not connected');
        }

        await this.services.websocketClient.sendPrivateMessage(user_id, message);
        
        res.json({
          success: true,
          message: 'Private message sent successfully',
          user_id: user_id,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.moduleLogger.error('Failed to send private message', { error, user_id, message });
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Send group message endpoint
    this.app.post('/api/send_group', async (req: Request, res: Response) => {
      const { group_id, message } = req.body;
      
      if (!group_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: group_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info(`API请求发送群聊消息: ${group_id} - ${message}`);
      
      try {
        if (!this.services.websocketClient) {
          throw new Error('WebSocket client not available');
        }

        if (!this.services.websocketClient.isConnected()) {
          throw new Error('WebSocket client not connected');
        }

        await this.services.websocketClient.sendGroupMessage(group_id, message);
        
        res.json({
          success: true,
          message: 'Group message sent successfully',
          group_id: group_id,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.moduleLogger.error('Failed to send group message', { error, group_id, message });
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });
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