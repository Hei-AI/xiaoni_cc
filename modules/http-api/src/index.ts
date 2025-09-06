import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import winston from 'winston';

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

// API routes
app.get('/api/status', (req, res) => {
  res.json({
    service: 'HTTP API Gateway',
    status: 'running',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  logger.info(`HTTP API Gateway started on port ${PORT}`);
});