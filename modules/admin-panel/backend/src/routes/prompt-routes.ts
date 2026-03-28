import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';
import * as crypto from 'crypto';

type AgentTypeDescriptor = {
  value: string;
  label: string;
  description: string;
};

const BASE_AGENT_TYPES: AgentTypeDescriptor[] = [
  {
    value: 'chat_bot',
    label: '聊天主链',
    description: '面向常规对话和主回复链路的提示词。'
  },
  {
    value: 'intent_analyzer',
    label: '意图分析',
    description: '解析用户意图、分类和上游决策的提示词。'
  },
  {
    value: 'requirement_processor',
    label: '需求处理',
    description: '将自然语言需求加工为结构化结果的提示词。'
  },
  {
    value: 'persona_chat',
    label: '人格对话',
    description: '面向人格态、角色态聊天的提示词。'
  },
  {
    value: 'tool_system',
    label: 'Tool 契约系统',
    description: '结构化 tool prompts 与契约型配置。'
  },
  {
    value: 'custom',
    label: '自定义',
    description: '不属于标准链路的自定义 prompt 类型。'
  }
];

// 创建Prompt管理相关路由
export function createPromptRoutes(
  database: DatabaseManager,
  logger: winston.Logger
) {
  const router = express.Router();
  const providerServiceBaseUrl = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';

  router.get('/agent-types', async (_req, res) => {
    try {
      const rows = await database.executeQuery<{ agent_type: string | null }>(
        `
          SELECT DISTINCT agent_type
          FROM agent_prompts
          WHERE agent_type IS NOT NULL
            AND agent_type != ''
          ORDER BY agent_type ASC
        `
      );

      const seen = new Set(BASE_AGENT_TYPES.map((item) => item.value));
      const merged = [...BASE_AGENT_TYPES];

      for (const row of rows) {
        const agentType = row.agent_type?.trim();
        if (!agentType || seen.has(agentType)) {
          continue;
        }

        seen.add(agentType);
        merged.push({
          value: agentType,
          label: agentType,
          description: '数据库中已有的扩展 prompt 类型。'
        });
      }

      res.json({
        success: true,
        data: merged,
        total: merged.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch agent types', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch agent types',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  const clearProviderConfigCache = async (agentType?: string) => {
    if (!providerServiceBaseUrl) {
      return;
    }

    try {
      await fetch(`${providerServiceBaseUrl}/api/internal/config-cache/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(agentType ? { agentType } : {})
      });
    } catch (error: any) {
      logger.warn('Failed to clear provider-service configuration cache', {
        agentType,
        error: error?.message || error
      });
    }
  };

  // 获取所有Prompt模板
  router.get('/prompts', async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
      const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
      const offset = (page - 1) * limit;
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const agentType = typeof req.query.agent_type === 'string' ? req.query.agent_type.trim() : '';

      const whereClauses: string[] = [];
      const params: any[] = [];

      if (search.length > 0) {
        whereClauses.push('(prompt_name LIKE ? OR description LIKE ? OR agent_type LIKE ?)');
        const likeValue = `%${search}%`;
        params.push(likeValue, likeValue, likeValue);
      }

      if (agentType.length > 0) {
        whereClauses.push('agent_type = ?');
        params.push(agentType);
      }

      const whereSql = whereClauses.length > 0
        ? `WHERE ${whereClauses.join(' AND ')}`
        : '';

      const totalRows = await database.executeQuery<{ total: number }>(
        `SELECT COUNT(*) AS total FROM agent_prompts ${whereSql}`,
        params
      );
      const total = Number(totalRows[0]?.total || 0);

      const prompts = await database.executeQuery(
        `SELECT
          id, prompt_name, agent_type, description, system_instructions,
          user_prompt_template, context_variables, model_config,
          is_active, created_at, updated_at, version,
          model_name, advanced_config
        FROM agent_prompts
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
        params
      );

      res.json({
        success: true,
        data: prompts,
        total,
        page,
        limit,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch prompts', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch prompts',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取特定Prompt详情
  router.get('/prompts/:id', async (req, res) => {
    try {
      const promptId = req.params.id;

      const prompt = await database.executeQuery(
        'SELECT * FROM agent_prompts WHERE id = ?',
        [promptId]
      );

      if (prompt.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Prompt not found',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: prompt[0],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch prompt', { error, promptId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch prompt',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Prompt调试API - 调用Gemini API进行测试

  // 创建新Prompt
  router.post('/prompts', async (req, res) => {
    try {
      const {
        agent_type,
        prompt_name,
        system_instructions,
        user_prompt_template,
        context_variables,
        model_config,
        advanced_config,
        model_name,
        description,
        is_active,
        created_by
      } = req.body;

      if (!prompt_name || !system_instructions) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: prompt_name and system_instructions',
          timestamp: new Date().toISOString()
        });
      }

      // Generate UUID for the id field
      const promptId = crypto.randomUUID();

      // 将system_instructions数组转换为JSON字符串
      const systemInstructionsStr = Array.isArray(system_instructions)
        ? JSON.stringify(system_instructions)
        : JSON.stringify([system_instructions]);

      const result = await database.executeInsert(
        `INSERT INTO agent_prompts (
          id, agent_type, prompt_name, system_instructions, user_prompt_template,
          context_variables, model_config, advanced_config, model_name,
          description, is_active, created_by, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          promptId,
          agent_type || 'chat_bot',
          prompt_name,
          systemInstructionsStr,
          user_prompt_template || null,
          context_variables ? JSON.stringify(context_variables) : null,
          model_config ? JSON.stringify(model_config) : null,
          advanced_config ? JSON.stringify(advanced_config) : null,
          typeof model_name === 'string' && model_name.trim().length > 0 ? model_name.trim() : null,
          description || null,
          is_active ? 1 : 0,
          created_by || 'admin',
          1
        ]
      );

      res.json({
        success: true,
        data: {
          id: promptId,
          prompt_name,
          agent_type: agent_type || 'chat_bot',
          model_name: typeof model_name === 'string' && model_name.trim().length > 0 ? model_name.trim() : null
        },
        message: 'Prompt created successfully',
        timestamp: new Date().toISOString()
      });

      await clearProviderConfigCache(agent_type || 'chat_bot');

    } catch (error) {
      logger.error('Failed to create prompt', { error, body: req.body });
      res.status(500).json({
        success: false,
        error: 'Failed to create prompt',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 更新Prompt
  router.put('/prompts/:id', async (req, res) => {
    try {
      const promptId = req.params.id;
      const {
        agent_type,
        prompt_name,
        system_instructions,
        user_prompt_template,
        context_variables,
        model_config,
        advanced_config,
        model_name,
        description,
        is_active
      } = req.body;

      if (!prompt_name || !system_instructions) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: prompt_name and system_instructions',
          timestamp: new Date().toISOString()
        });
      }

      // 检查Prompt是否存在
      const existingPrompt = await database.executeQuery<{ id: string; agent_type: string | null }>(
        'SELECT id, agent_type FROM agent_prompts WHERE id = ?',
        [promptId]
      );

      if (existingPrompt.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Prompt not found',
          timestamp: new Date().toISOString()
        });
      }

      // 将system_instructions数组转换为JSON字符串
      const systemInstructionsStr = Array.isArray(system_instructions)
        ? JSON.stringify(system_instructions)
        : JSON.stringify([system_instructions]);

      await database.executeUpdate(
        `UPDATE agent_prompts SET
          agent_type = ?, prompt_name = ?, system_instructions = ?,
          user_prompt_template = ?, context_variables = ?, model_config = ?,
          advanced_config = ?, model_name = ?, description = ?, is_active = ?,
          updated_at = NOW()
        WHERE id = ?`,
        [
          agent_type || 'chat_bot',
          prompt_name,
          systemInstructionsStr,
          user_prompt_template || null,
          context_variables ? JSON.stringify(context_variables) : null,
          model_config ? JSON.stringify(model_config) : null,
          advanced_config ? JSON.stringify(advanced_config) : null,
          typeof model_name === 'string' && model_name.trim().length > 0 ? model_name.trim() : null,
          description || null,
          is_active ? 1 : 0,
          promptId
        ]
      );

      res.json({
        success: true,
        data: {
          id: promptId,
          prompt_name,
          agent_type: agent_type || 'chat_bot',
          model_name: typeof model_name === 'string' && model_name.trim().length > 0 ? model_name.trim() : null
        },
        message: 'Prompt updated successfully',
        timestamp: new Date().toISOString()
      });

      const previousAgentType = existingPrompt[0]?.agent_type || undefined;
      const nextAgentType = agent_type || previousAgentType;
      await clearProviderConfigCache(previousAgentType);
      if (nextAgentType && nextAgentType !== previousAgentType) {
        await clearProviderConfigCache(nextAgentType);
      }

    } catch (error) {
      logger.error('Failed to update prompt', { error, promptId: req.params.id, body: req.body });
      res.status(500).json({
        success: false,
        error: 'Failed to update prompt',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 删除Prompt
  router.delete('/prompts/:id', async (req, res) => {
    try {
      const promptId = req.params.id;

      // 检查Prompt是否存在
      const existingPrompt = await database.executeQuery<{
        id: string;
        prompt_name: string;
        agent_type: string | null;
      }>(
        'SELECT id, prompt_name, agent_type FROM agent_prompts WHERE id = ?',
        [promptId]
      );

      if (existingPrompt.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Prompt not found',
          timestamp: new Date().toISOString()
        });
      }

      // 执行删除
      const result = await database.executeUpdate(
        'DELETE FROM agent_prompts WHERE id = ?',
        [promptId]
      );

      if (result === 0) {
        return res.status(400).json({
          success: false,
          error: 'Failed to delete prompt',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: `Prompt "${existingPrompt[0].prompt_name}" deleted successfully`,
        timestamp: new Date().toISOString()
      });

      await clearProviderConfigCache(existingPrompt[0].agent_type || undefined);

    } catch (error) {
      logger.error('Failed to delete prompt', { error, promptId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to delete prompt',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // ==================== Debug Sessions API ==================== //

  // 获取特定Prompt的调试历史
  router.get('/prompts/:promptId/debug-sessions', async (req, res) => {
    try {
      const promptId = req.params.promptId;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      // 检查Prompt是否存在
      const prompt = await database.executeQuery(
        'SELECT id FROM agent_prompts WHERE id = ?',
        [promptId]
      );

      if (prompt.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Prompt not found',
          timestamp: new Date().toISOString()
        });
      }

      // 获取调试会话列表
      const sessions = await database.executeQuery<{
        id: string;
        session_name: string;
        input_count: number;
        created_at: string;
        updated_at: string;
        message_count: number;
      }>(
        `SELECT id, session_name, input_count, created_at, updated_at,
                COALESCE(jsonb_array_length(COALESCE(messages, '[]'::jsonb)), 0) as message_count
         FROM prompt_debug_sessions
         WHERE prompt_id = ?
         ORDER BY updated_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        [promptId]
      );

      // 获取总数
      const totalResult = await database.executeQuery<{ total: number }>(
        'SELECT COUNT(*) as total FROM prompt_debug_sessions WHERE prompt_id = ?',
        [promptId]
      );
      const total = totalResult[0]?.total || 0;

      // 为每个会话计算消息总数
      const sessionsWithMessageCount = sessions.map(session => ({
        id: session.id,
        session_name: session.session_name,
        input_count: session.input_count,
        message_count: session.message_count,
        created_at: session.created_at,
        updated_at: session.updated_at
      }));

      res.json({
        success: true,
        data: {
          sessions: sessionsWithMessageCount,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch debug sessions', { error, promptId: req.params.promptId });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch debug sessions',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 创建新的调试会话
  router.post('/prompts/:promptId/debug-sessions', async (req, res) => {
    try {
      const promptId = req.params.promptId;
      const { session_name, messages = [] } = req.body;

      // 🔍 Debug logging
      logger.info('Save debug session called', {
        promptId,
        session_name,
        session_name_type: typeof session_name,
        session_name_trimmed: session_name?.trim(),
        messages_count: Array.isArray(messages) ? messages.length : 0
      });

      // 检查Prompt是否存在
      const prompt = await database.executeQuery(
        'SELECT id FROM agent_prompts WHERE id = ?',
        [promptId]
      );

      if (prompt.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Prompt not found',
          timestamp: new Date().toISOString()
        });
      }

      const sessionId = crypto.randomUUID();
      const inputCount = Array.isArray(messages) ? messages.filter((msg: any) => msg.role === 'user').length : 0;

      // 创建调试会话
      await database.executeInsert(
        `INSERT INTO prompt_debug_sessions (id, prompt_id, session_name, messages, input_count)
         VALUES (?, ?, ?, ?, ?)`,
        [
          sessionId,
          promptId,
          session_name !== undefined && session_name !== null && session_name.trim() !== ''
            ? session_name.trim()
            : `Debug Session ${new Date().toLocaleString()}`,
          JSON.stringify(messages),
          inputCount
        ]
      );

      res.json({
        success: true,
        data: {
          id: sessionId,
          prompt_id: promptId,
          session_name: session_name !== undefined && session_name !== null && session_name.trim() !== ''
            ? session_name.trim()
            : `Debug Session ${new Date().toLocaleString()}`,
          input_count: inputCount
        },
        message: 'Debug session created successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to create debug session', { error, promptId: req.params.promptId, body: req.body });
      res.status(500).json({
        success: false,
        error: 'Failed to create debug session',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取特定调试会话详情
  router.get('/debug-sessions/:sessionId', async (req, res) => {
    try {
      const sessionId = req.params.sessionId;

      const session = await database.executeQuery<{
        id: string;
        prompt_id: string;
        session_name: string;
        messages: string;
        input_count: number;
        created_at: string;
        updated_at: string;
      }>(
        'SELECT * FROM prompt_debug_sessions WHERE id = ?',
        [sessionId]
      );

      if (session.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Debug session not found',
          timestamp: new Date().toISOString()
        });
      }

      const sessionData = session[0];

      // 处理messages字段 - PG JSONB/驱动会直接返回对象
      let messages = [];

      // 简化处理逻辑：数据库驱动已经自动解析JSON字段
      if (Array.isArray(sessionData.messages)) {
        // 驱动已经将JSON解析为数组，直接使用
        messages = sessionData.messages;
        logger.info('Messages loaded successfully', {
          sessionId,
          messageCount: messages.length,
          messagesType: 'array'
        });
      } else if (sessionData.messages === null || sessionData.messages === undefined) {
        // 处理null/undefined情况
        messages = [];
        logger.info('Messages field is null/undefined', { sessionId });
      } else {
        // 其他情况记录详细信息
        logger.warn('Unexpected messages data structure', {
          sessionId,
          messagesType: typeof sessionData.messages,
          messagesIsArray: Array.isArray(sessionData.messages),
          messagesValue: sessionData.messages
        });

        // 尝试其他处理方式
        try {
          if (typeof sessionData.messages === 'string') {
            messages = JSON.parse(sessionData.messages);
          } else if (typeof sessionData.messages === 'object') {
            messages = [sessionData.messages];
          } else {
            messages = [];
          }
        } catch (parseError) {
          logger.error('Failed to parse messages', {
            sessionId,
            parseError: parseError instanceof Error ? parseError.message : String(parseError)
          });
          messages = [];
        }
      }

      res.json({
        success: true,
        data: {
          ...sessionData,
          messages
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch debug session', { error, sessionId: req.params.sessionId });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch debug session',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 更新调试会话
  router.put('/debug-sessions/:sessionId', async (req, res) => {
    try {
      const sessionId = req.params.sessionId;
      const { session_name, messages } = req.body;

      // 检查会话是否存在
      const existingSession = await database.executeQuery(
        'SELECT id FROM prompt_debug_sessions WHERE id = ?',
        [sessionId]
      );

      if (existingSession.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Debug session not found',
          timestamp: new Date().toISOString()
        });
      }

      const inputCount = Array.isArray(messages) ? messages.filter((msg: any) => msg.role === 'user').length : 0;

      // 更新会话
      await database.executeUpdate(
        `UPDATE prompt_debug_sessions
         SET session_name = ?, messages = ?, input_count = ?, updated_at = NOW()
         WHERE id = ?`,
        [session_name, JSON.stringify(messages), inputCount, sessionId]
      );

      res.json({
        success: true,
        message: 'Debug session updated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to update debug session', { error, sessionId: req.params.sessionId, body: req.body });
      res.status(500).json({
        success: false,
        error: 'Failed to update debug session',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 删除调试会话
  router.delete('/debug-sessions/:sessionId', async (req, res) => {
    try {
      const sessionId = req.params.sessionId;

      // 检查会话是否存在
      const existingSession = await database.executeQuery<{
        id: string;
        session_name: string;
      }>(
        'SELECT id, session_name FROM prompt_debug_sessions WHERE id = ?',
        [sessionId]
      );

      if (existingSession.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Debug session not found',
          timestamp: new Date().toISOString()
        });
      }

      // 删除会话
      const result = await database.executeUpdate(
        'DELETE FROM prompt_debug_sessions WHERE id = ?',
        [sessionId]
      );

      if (result === 0) {
        return res.status(400).json({
          success: false,
          error: 'Failed to delete debug session',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: `Debug session "${existingSession[0].session_name}" deleted successfully`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to delete debug session', { error, sessionId: req.params.sessionId });
      res.status(500).json({
        success: false,
        error: 'Failed to delete debug session',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createPromptRoutes;
