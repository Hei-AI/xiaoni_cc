import winston from 'winston';
import path from 'path';
import fs from 'fs';

class Logger {
  private loggers: Map<string, winston.Logger> = new Map();
  private logDir = 'logs';

  constructor() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getLogger(module: string): winston.Logger {
    if (!this.loggers.has(module)) {
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.logDir, `${module}_${today}.log`);
      const winstonLogger = winston.createLogger({
        level: process.env.LOG_LEVEL || 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        ),
        transports: [
          new winston.transports.File({ filename: logFile }),
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
          })
        ]
      });
      this.loggers.set(module, winstonLogger);
    }

    return this.loggers.get(module)!;
  }

  createModuleLogger(module: string) {
    const current = this.getLogger(module);
    return {
      debug: (message: string, extra?: Record<string, unknown>) => current.debug(message, extra),
      info: (message: string, extra?: Record<string, unknown>) => current.info(message, extra),
      warn: (message: string, extra?: Record<string, unknown>) => current.warn(message, extra),
      error: (message: string, extra?: Record<string, unknown>) => current.error(message, extra)
    };
  }
}

export const logger = new Logger();
