/**
 * 简化版LLM配置管理API路由
 * 仅提供基本的数据库CRUD操作，移除AI Service依赖
 */

import express = require('express');
import { DatabaseManager } from '../services/database';

const router = express.Router();

// 初始化数据库服务
const dbConfig = {
  host: process.env.DB_HOST || 'qqbot-mysql',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'qqbot_user',
  password: process.env.DB_PASSWORD || 'qqbot_password',
  database: process.env.DB_NAME || 'qqbot_db',
  charset: 'utf8mb4',
  timezone: process.env.DB_TIMEZONE || 'Z'
};

const database = new DatabaseManager(dbConfig, console);

/**
 * 获取所有Agent Prompt配置列表
 * GET /api/llm-config/agents
 */
router.get('/agents', async (req, res) => {
  try {
    const query = `
      SELECT
        id, agent_type, prompt_name, model_name,
        config_version, last_config_update, is_active,
        description, created_at, updated_at
      FROM agent_prompts
      ORDER BY agent_type, prompt_name
    `;

    const agents = await database.executeQuery<any>(query);

    res.json({
      success: true,
      data: agents.map((agent: any) => ({
        id: agent.id,
        agentType: agent.agent_type,
        promptName: agent.prompt_name,
        modelName: agent.model_name,
        configVersion: agent.config_version,
        lastConfigUpdate: agent.last_config_update,
        isActive: agent.is_active,
        description: agent.description,
        createdAt: agent.created_at,
        updatedAt: agent.updated_at
      }))
    });

  } catch (error: any) {
    console.error('Failed to get agent list:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent list',
      message: error.message
    });
  }
});

/**
 * 获取特定Agent的完整配置
 * GET /api/llm-config/agents/:agentId
 */
router.get('/agents/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;

    const query = `
      SELECT
        id, agent_type, prompt_name, system_instructions,
        user_prompt_template, context_variables, model_name,
        model_config, advanced_config, config_version,
        last_config_update, is_active, version, created_by,
        created_at, updated_at, description
      FROM agent_prompts
      WHERE id = ? OR agent_type = ?
    `;

    const results = await database.executeQuery<any>(query, [agentId, agentId]);

    if (!results || results.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    const agent = results[0] as any;

    // 安全解析JSON字段
    let systemInstructions = [];
    let contextVariables = {};
    let modelConfig = {};
    let advancedConfig = {};

    try {
      systemInstructions = JSON.parse(agent.system_instructions || '[]');
    } catch (e) {
      console.warn('Failed to parse system_instructions for agent:', agentId);
    }

    try {
      contextVariables = JSON.parse(agent.context_variables || '{}');
    } catch (e) {
      console.warn('Failed to parse context_variables for agent:', agentId);
    }

    try {
      modelConfig = JSON.parse(agent.model_config || '{}');
    } catch (e) {
      console.warn('Failed to parse model_config for agent:', agentId);
    }

    try {
      advancedConfig = JSON.parse(agent.advanced_config || '{}');
    } catch (e) {
      console.warn('Failed to parse advanced_config for agent:', agentId);
    }

    const agentData = {
      id: agent.id,
      agentType: agent.agent_type,
      promptName: agent.prompt_name,
      systemInstructions,
      userPromptTemplate: agent.user_prompt_template,
      contextVariables,
      modelName: agent.model_name,
      modelConfig,
      advancedConfig,
      configVersion: agent.config_version,
      lastConfigUpdate: agent.last_config_update,
      isActive: agent.is_active,
      version: agent.version,
      createdBy: agent.created_by,
      createdAt: agent.created_at,
      updatedAt: agent.updated_at,
      description: agent.description
    };

    res.json({
      success: true,
      data: agentData
    });

  } catch (error: any) {
    console.error('Failed to get agent details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent details',
      message: error.message
    });
  }
});

/**
 * 更新Agent的高级配置
 * PUT /api/llm-config/agents/:agentId/advanced-config
 */
router.put('/agents/:agentId/advanced-config', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { advancedConfig, updatedBy = 'admin' } = req.body;

    if (!advancedConfig) {
      return res.status(400).json({
        success: false,
        error: 'advancedConfig is required'
      });
    }

    // 更新数据库
    const updateQuery = `
      UPDATE agent_prompts
      SET
        advanced_config = ?,
        config_version = config_version + 1,
        last_config_update = NOW(),
        updated_at = NOW()
      WHERE id = ? OR agent_type = ?
    `;

    const affectedRows = await database.executeUpdate(
      updateQuery,
      [JSON.stringify(advancedConfig), agentId, agentId]
    );

    if (affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    res.json({
      success: true,
      message: 'Advanced configuration updated successfully',
      data: {
        agentId,
        updatedBy,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('Failed to update advanced config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update advanced configuration',
      message: error.message
    });
  }
});

/**
 * 获取可用工具列表（简化版本）
 * GET /api/llm-config/tools
 */
router.get('/tools', async (req, res) => {
  try {
    // 返回预定义的工具列表
    const tools = [
      {
        name: 'sentiment_analysis',
        description: '情感分析工具',
        category: 'text_analysis',
        enabled: true
      },
      {
        name: 'keyword_extraction',
        description: '关键词提取工具',
        category: 'text_analysis',
        enabled: true
      },
      {
        name: 'web_search',
        description: '网络搜索工具',
        category: 'information',
        enabled: true
      },
      {
        name: 'weather_query',
        description: '天气查询工具',
        category: 'information',
        enabled: true
      },
      {
        name: 'time_query',
        description: '时间查询工具',
        category: 'utility',
        enabled: true
      },
      {
        name: 'calculation',
        description: '数学计算工具',
        category: 'utility',
        enabled: true
      },
      {
        name: 'text_translation',
        description: '文本翻译工具',
        category: 'text_processing',
        enabled: true
      }
    ];

    res.json({
      success: true,
      data: tools
    });

  } catch (error: any) {
    console.error('Failed to get tools:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get tools',
      message: error.message
    });
  }
});

/**
 * 简化的测试接口
 * POST /api/llm-config/agents/:agentId/test
 */
router.post('/agents/:agentId/test', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { testPrompt, userId = 12345 } = req.body;

    if (!testPrompt) {
      return res.status(400).json({
        success: false,
        error: 'testPrompt is required'
      });
    }

    // 简化的测试响应，不实际调用LLM
    const traceId = `test_${agentId}_${Date.now()}`;

    res.json({
      success: true,
      data: {
        traceId,
        response: {
          content: `这是一个模拟响应。原始输入: "${testPrompt}"。此功能需要QQBot Core服务支持完整的LLM调用。`,
          thoughts: '模拟的思考过程...',
          functionCalls: [],
          metrics: {
            inputTokens: testPrompt.length,
            outputTokens: 50,
            processingTimeMs: 100
          }
        },
        agentId,
        userId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('Failed to test agent:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test agent',
      message: error.message
    });
  }
});

export default router;
