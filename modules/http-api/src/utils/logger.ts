import winston from 'winston';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_DIR = process.env.LOG_DIR || './resources/logs';

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      level: LOG_LEVEL
    }),
    new winston.transports.File({
      filename: `${LOG_DIR}/http-api.log`,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});

export const createModuleLogger = (moduleName: string) => {
  return logger.child({ module: moduleName });
};
