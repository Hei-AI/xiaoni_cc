import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

export const config: AppConfig = {
  database: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    database: process.env.MYSQL_DATABASE || 'qqbot_db',
    user: process.env.MYSQL_USER || 'qqbot_user',
    password: process.env.MYSQL_PASSWORD || 'qqbot_password',
    charset: 'utf8mb4',
    timezone: '+08:00'
  },
  
  websocket: {
    host: process.env.WEBSOCKET_HOST || '127.0.0.1',
    port: parseInt(process.env.WEBSOCKET_PORT || '3001', 10),
    access_token: process.env.WEBSOCKET_ACCESS_TOKEN || 'w@123456',
    get uri() {
      return `ws://${this.host}:${this.port}?access_token=${this.access_token}`;
    }
  },
  
  http_server: {
    host: process.env.HTTP_HOST || '0.0.0.0',
    port: parseInt(process.env.HTTP_PORT || '8080', 10)
  },
  
  ai: {
    gemini_api_keys: (process.env.GEMINI_API_KEYS || '').split(',').filter(key => key.trim()),
    model_name: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    authorized_user_id: parseInt(process.env.AUTHORIZED_USER_ID || '85178516', 10),
    bot_qq_number: parseInt(process.env.BOT_QQ_NUMBER || '1129974489', 10)
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file_prefix: process.env.LOG_FILE_PREFIX || 'qqbot'
  }
};

export default config;