/**
 * LLM配置管理API路由
 * 支持实时调整Agent Prompt的高级LLM参数
 */

import express from 'express';
import { DatabaseManager } from '../services/database';

const router = express.Router();

// 初始化数据库服务
const dbConfig = {
  host: process.env.DB_HOST || 'qqbot-mysql',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'qqbot_user',
  password: process.env.DB_PASSWORD || 'qqbot_password',
  database: process.env.DB_NAME || 'qqbot_db',
  charset: 'utf8mb4'
};

const database = new DatabaseManager(dbConfig);

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

    const agents = await database.executeQuery(query);

    res.json({
      success: true,
      data: agents.map(agent => ({
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
      WHERE id = ?
    `;

    const results = await database.executeQuery(query, [agentId]);

    if (!results || results.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    const agent = results[0];
    const agentData = {
      id: agent.id,
      agentType: agent.agent_type,
      promptName: agent.prompt_name,
      systemInstructions: JSON.parse(agent.system_instructions || '[]'),
      userPromptTemplate: agent.user_prompt_template,
      contextVariables: JSON.parse(agent.context_variables || '{}'),
      modelName: agent.model_name,
      modelConfig: JSON.parse(agent.model_config || '{}'),
      advancedConfig: JSON.parse(agent.advanced_config || '{}'),
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
    console.error('Failed to get agent config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent config',
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
    const { advancedConfig, updatedBy = 'admin_panel' } = req.body;

    if (!advancedConfig) {
      return res.status(400).json({
        success: false,
        error: 'Advanced config is required'
      });
    }

    // 使用AI Service的更新方法（包含验证逻辑）
    const success = await aiService.updateAgentAdvancedConfig(
      agentId,
      advancedConfig,
      updatedBy
    );

    if (success) {
      res.json({
        success: true,
        message: 'Advanced config updated successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to update advanced config'
      });
    }

  } catch (error: any) {
    console.error('Failed to update advanced config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update advanced config',
      message: error.message
    });
  }
});

/**
 * 获取可用的预定义工具列表
 * GET /api/llm-config/tools
 */
router.get('/tools', async (req, res) => {
  try {
    const tools = aiService.getAvailableTools();

    res.json({
      success: true,
      data: tools
    });

  } catch (error: any) {
    console.error('Failed to get available tools:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get available tools',
      message: error.message
    });
  }
});

/**
 * 根据Agent类型获取推荐工具
 * GET /api/llm-config/tools/recommended/:agentType
 */
router.get('/tools/recommended/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const recommendedTools = aiService.getRecommendedToolsForAgent(agentType);

    res.json({
      success: true,
      data: {
        agentType,
        recommendedTools
      }
    });

  } catch (error: any) {
    console.error('Failed to get recommended tools:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommended tools',
      message: error.message
    });
  }
});

/**
 * 测试Agent配置
 * POST /api/llm-config/agents/:agentId/test
 */
router.post('/agents/:agentId/test', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { testPrompt = '请简单介绍一下自己', userId = 0 } = req.body;

    const traceId = `test_${agentId}_${Date.now()}`;

    // 使用Agent配置进行测试调用
    const response = await aiService.callWithAgentPrompt(
      testPrompt,
      agentId,
      traceId,
      userId
    );

    res.json({
      success: true,
      data: {
        traceId,
        testPrompt,
        response: {
          content: response.content,
          thoughts: response.thoughts,
          functionCalls: response.functionCalls,
          metrics: response.metrics,
          configUsed: response.usedConfig
        }
      }
    });

  } catch (error: any) {
    console.error('Failed to test agent config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test agent config',
      message: error.message
    });
  }
});

/**
 * 获取模型能力信息
 * GET /api/llm-config/models/:modelName/capabilities
 */
router.get('/models/:modelName/capabilities', async (req, res) => {
  try {
    const { modelName } = req.params;
    const capabilities = await aiService.getModelCapabilities(modelName);

    res.json({
      success: true,
      data: {
        modelName,
        capabilities
      }
    });

  } catch (error: any) {
    console.error('Failed to get model capabilities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get model capabilities',
      message: error.message
    });
  }
});

/**
 * 获取配置模板
 * GET /api/llm-config/templates
 */
router.get('/templates', async (req, res) => {
  try {
    const templates = {
      basic: {
        name: '基础配置',
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 1000
        },
        thinkingConfig: {
          thinkingBudget: 0,
          includeThoughts: false
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ],
        toolsConfig: {
          enabled: false,
          selectedTools: [],
          mode: 'NONE'
        }
      },
      thinking: {
        name: '思考模式',
        generationConfig: {
          temperature: 0.3,
          topP: 0.8,
          topK: 20,
          maxOutputTokens: 1500
        },
        thinkingConfig: {
          thinkingBudget: 1000,
          includeThoughts: true
        }
      },
      structured: {
        name: '结构化输出',
        generationConfig: {
          temperature: 0.1,
          topP: 0.7,
          topK: 10,
          maxOutputTokens: 500,
          responseMimeType: 'application/json'
        },
        structuredOutputConfig: {
          enabled: true,
          jsonSchema: {
            type: 'object',
            properties: {
              result: { type: 'string' },
              confidence: { type: 'number' }
            }
          }
        }
      },
      tools_enabled: {
        name: '工具增强',
        generationConfig: {
          temperature: 0.6,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 1200
        },
        toolsConfig: {
          enabled: true,
          selectedTools: ['web_search', 'sentiment_analysis'],
          mode: 'AUTO'
        }
      }
    };

    res.json({
      success: true,
      data: templates
    });

  } catch (error: any) {
    console.error('Failed to get templates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get templates',
      message: error.message
    });
  }
});

/**
 * 批量更新配置
 * POST /api/llm-config/agents/batch-update
 */
router.post('/agents/batch-update', async (req, res) => {
  try {
    const { updates, updatedBy = 'admin_panel' } = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        error: 'Updates must be an array'
      });
    }

    const results = [];

    for (const update of updates) {
      try {
        const success = await aiService.updateAgentAdvancedConfig(
          update.agentId,
          update.advancedConfig,
          updatedBy
        );
        results.push({
          agentId: update.agentId,
          success,
          error: null
        });
      } catch (error: any) {
        results.push({
          agentId: update.agentId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      data: {
        totalUpdates: updates.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      }
    });

  } catch (error: any) {
    console.error('Failed to batch update configs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to batch update configs',
      message: error.message
    });
  }
});

export default router;