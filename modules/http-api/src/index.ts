import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import winston from 'winston';
import axios from 'axios';

config();

const app = express();
const PORT = process.env.HTTP_PORT || 8080;

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
      filename: `${process.env.LOG_DIR || './resources/logs'}/http-api.log` 
    })
  ]
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'qq-bot-http-api',
    timestamp: new Date().toISOString()
  });
});

// HTTP API Gateway - 专注于QQ Bot业务功能

// API routes
app.get('/api/status', (req, res) => {
  res.json({
    service: 'HTTP API Gateway',
    status: 'running',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// QQ Bot业务功能区域 - 统一外部API访问点

// Send private message endpoint (proxies to QQBot Core)
app.post('/api/send_private', async (req, res) => {
  const { user_id, message } = req.body;
  
  if (!user_id || !message) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: user_id, message',
      timestamp: new Date().toISOString()
    });
  }

  logger.info(`HTTP API Gateway: 发送私聊消息请求`, { user_id, messageLength: message.length });
  
  try {
    // Forward request to QQBot Core internal API
    const response = await axios.post('http://localhost:8081/api/internal/send_private', {
      user_id,
      message
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HTTP-API-Gateway'
      }
    });
    
    res.json({
      success: true,
      message: 'Private message sent successfully via gateway',
      user_id: user_id,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Failed to send private message via gateway', { 
      error: error.message, 
      user_id, 
      messageLength: message.length 
    });
    
    // Handle different types of errors
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'QQBot Core service unavailable',
        timestamp: new Date().toISOString()
      });
    } else if (error.response?.status) {
      res.status(error.response.status).json({
        success: false,
        error: error.response.data?.error || 'Unknown error from QQBot Core',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Gateway internal error',
        timestamp: new Date().toISOString()
      });
    }
  }
});

// Send group message endpoint (proxies to QQBot Core)
app.post('/api/send_group', async (req, res) => {
  const { group_id, message } = req.body;
  
  if (!group_id || !message) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: group_id, message',
      timestamp: new Date().toISOString()
    });
  }

  logger.info(`HTTP API Gateway: 发送群聊消息请求`, { group_id, messageLength: message.length });
  
  try {
    // Forward request to QQBot Core internal API
    const response = await axios.post('http://localhost:8081/api/internal/send_group', {
      group_id,
      message
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HTTP-API-Gateway'
      }
    });
    
    res.json({
      success: true,
      message: 'Group message sent successfully via gateway',
      group_id: group_id,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Failed to send group message via gateway', { 
      error: error.message, 
      group_id, 
      messageLength: message.length 
    });
    
    // Handle different types of errors
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'QQBot Core service unavailable',
        timestamp: new Date().toISOString()
      });
    } else if (error.response?.status) {
      res.status(error.response.status).json({
        success: false,
        error: error.response.data?.error || 'Unknown error from QQBot Core',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Gateway internal error',
        timestamp: new Date().toISOString()
      });
    }
  }
});

// Bot status endpoint (aggregates information from QQBot Core)
app.get('/api/bot/status', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8081/api/status', {
      timeout: 5000
    });
    
    res.json({
      success: true,
      gateway_status: 'healthy',
      qqbot_core: response.data,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.warn('Failed to get QQBot Core status', { error: error.message });
    
    res.status(503).json({
      success: false,
      gateway_status: 'healthy',
      qqbot_core: 'unavailable',
      error: 'QQBot Core service unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  logger.info(`HTTP API Gateway started on port ${PORT}`);
});