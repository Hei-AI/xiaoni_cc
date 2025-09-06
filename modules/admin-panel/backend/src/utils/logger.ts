// 简化的日志工具，用于Admin Backend
import winston from 'winston';

interface ModuleLogger {
  info: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  debug: (message: string, meta?: any) => void;
}

class Logger {
  private winstonLogger: winston.Logger;

  constructor() {
    this.winstonLogger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new winston.transports.File({ 
          filename: `${process.env.LOG_DIR || './resources/logs'}/admin-backend.log` 
        })
      ]
    });
  }

  createModuleLogger(moduleName: string): ModuleLogger {
    return {
      info: (message: string, meta?: any) => {
        this.winstonLogger.info(`[${moduleName}] ${message}`, meta);
      },
      error: (message: string, meta?: any) => {
        this.winstonLogger.error(`[${moduleName}] ${message}`, meta);
      },
      warn: (message: string, meta?: any) => {
        this.winstonLogger.warn(`[${moduleName}] ${message}`, meta);
      },
      debug: (message: string, meta?: any) => {
        this.winstonLogger.debug(`[${moduleName}] ${message}`, meta);
      }
    };
  }

  info(message: string, meta?: any) {
    this.winstonLogger.info(message, meta);
  }

  error(message: string, meta?: any) {
    this.winstonLogger.error(message, meta);
  }

  warn(message: string, meta?: any) {
    this.winstonLogger.warn(message, meta);
  }

  debug(message: string, meta?: any) {
    this.winstonLogger.debug(message, meta);
  }
}

export const logger = new Logger();