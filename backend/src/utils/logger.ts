import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { LogLevel } from '../types';

class Logger {
  private loggers: Map<string, winston.Logger> = new Map();
  private logDir: string = 'logs';

  constructor() {
    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getLogger(module: string): winston.Logger {
    if (!this.loggers.has(module)) {
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.logDir, `${module}_${today}.log`);

      const logger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        ),
        transports: [
          new winston.transports.File({ 
            filename: logFile
          }),
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
          })
        ]
      });

      this.loggers.set(module, logger);
    }

    return this.loggers.get(module)!;
  }

  public log(level: LogLevel, module: string, message: string, extra?: Record<string, any>): void {
    const logger = this.getLogger(module);
    const logData = {
      module,
      message,
      ...(extra && { extra })
    };

    logger.log(level, logData);
  }

  public debug(module: string, message: string, extra?: Record<string, any>): void {
    this.log('debug', module, message, extra);
  }

  public info(module: string, message: string, extra?: Record<string, any>): void {
    this.log('info', module, message, extra);
  }

  public warn(module: string, message: string, extra?: Record<string, any>): void {
    this.log('warn', module, message, extra);
  }

  public error(module: string, message: string, extra?: Record<string, any>): void {
    this.log('error', module, message, extra);
  }

  public createModuleLogger(module: string) {
    return {
      debug: (message: string, extra?: Record<string, any>) => this.debug(module, message, extra),
      info: (message: string, extra?: Record<string, any>) => this.info(module, message, extra),
      warn: (message: string, extra?: Record<string, any>) => this.warn(module, message, extra),
      error: (message: string, extra?: Record<string, any>) => this.error(module, message, extra)
    };
  }
}

export const logger = new Logger();
export default logger;