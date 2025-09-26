import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';
import * as crypto from 'crypto';

// 创建Prompt管理相关路由
export function createPromptRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  // 获取所有Prompt模板
  router.get('/prompts', async (req, res) => {
    try {
      const prompts = await database.executeQuery(
        `SELECT
          id, prompt_name, agent_type, description, system_instructions,
          user_prompt_template, context_variables, model_config,
          is_active, created_at, updated_at, version,
          model_name, allowed_token_ids, advanced_config
        FROM agent_prompts
        ORDER BY created_at DESC`
      );

      res.json({
        success: true,
        data: prompts,
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
  router.post('/prompts/debug', async (req, res) => {
    try {
      const { promptId, messages, userInput } = req.body;

      if (!promptId || !userInput) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: promptId and userInput',
          timestamp: new Date().toISOString()
        });
      }

      // 获取Prompt配置
      const prompt = await database.executeQuery(
        'SELECT * FROM agent_prompts WHERE id = ? AND is_active = true',
        [promptId]
      );

      if (prompt.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Prompt not found or inactive',
          timestamp: new Date().toISOString()
        });
      }

      const promptConfig = prompt[0] as any;
      const modelName = promptConfig.model_name || 'gemini-2.5-flash';

      // 获取系统指令
      const systemInstructions = promptConfig.system_instructions || 'You are a helpful AI assistant.';

      // 构建对话历史
      const conversationHistory = [];

      // 添加历史消息（如果有）
      if (messages && Array.isArray(messages)) {
        messages.forEach((msg: any) => {
          if (msg.role === 'user') {
            conversationHistory.push({
              role: 'user',
              parts: [{ text: msg.content }]
            });
          } else if (msg.role === 'assistant') {
            conversationHistory.push({
              role: 'model',
              parts: [{ text: msg.content }]
            });
          }
        });
      }

      // 添加当前用户输入
      conversationHistory.push({
        role: 'user',
        parts: [{ text: userInput }]
      });

      // 获取可用的Token
      const availableTokens = await database.executeQuery<{
        id: number;
        token: string;
        project_name: string;
        model_blacklist: string | null;
        daily_used: number;
        daily_limit: number;
      }>(
        `SELECT id, token, project_name, model_blacklist, daily_used, daily_limit
         FROM api_tokens
         WHERE (blacklisted_until IS NULL OR blacklisted_until <= NOW())
           AND daily_used < daily_limit
         ORDER BY priority ASC, (daily_used / daily_limit) ASC, weight DESC
         LIMIT 1`
      );

      if (availableTokens.length === 0) {
        return res.status(503).json({
          success: false,
          error: 'No available API tokens',
          timestamp: new Date().toISOString()
        });
      }

      const apiToken = availableTokens[0].token;

      // 构建Gemini API请求体
      const requestBody = {
        contents: conversationHistory,
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: -1,
            includeThoughts: true
          },
          ...(promptConfig.model_config || {}),
          temperature: promptConfig.model_config?.temperature || 1.0,
          topK: promptConfig.model_config?.topK || 40,
          topP: promptConfig.model_config?.topP || 0.95,
          maxOutputTokens: promptConfig.model_config?.maxOutputTokens || 65536
        },
        safetySettings: promptConfig.advanced_config?.safetySettings || [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ],
        system_instruction: {
          parts: [
            {
              text: Array.isArray(systemInstructions)
                ? systemInstructions.join('\n')
                : systemInstructions
            }
          ]
        }
      };

      // 调用Gemini API
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiToken}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Gemini API error', {
          status: response.status,
          statusText: response.statusText,
          response: errorText,
          promptId,
          modelName
        });

        return res.status(response.status).json({
          success: false,
          error: `Gemini API error: ${response.statusText}`,
          details: errorText,
          timestamp: new Date().toISOString()
        });
      }

      const apiResult = await response.json() as any;

      // 更新Token使用统计
      await database.executeUpdate(
        'UPDATE api_tokens SET daily_used = daily_used + 1, total_used = total_used + 1, last_used = NOW() WHERE id = ?',
        [availableTokens[0].id]
      );

      // 提取响应内容
      const aiResponse = apiResult.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
      const thinkingContent = apiResult.candidates?.[0]?.content?.parts?.find((part: any) => part.thought)?.thought || null;

      res.json({
        success: true,
        response: aiResponse,
        thinking: thinkingContent,
        model: modelName,
        token_used: {
          id: availableTokens[0].id,
          project_name: availableTokens[0].project_name
        },
        usage: apiResult.usageMetadata || null,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Prompt debug failed', { error, promptId: req.body.promptId });
      res.status(500).json({
        success: false,
        error: 'Failed to execute prompt debug',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

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
          model_name || 'gemini-2.5-flash',
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
          model_name: model_name || 'gemini-2.5-flash'
        },
        message: 'Prompt created successfully',
        timestamp: new Date().toISOString()
      });

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
      const existingPrompt = await database.executeQuery(
        'SELECT id FROM agent_prompts WHERE id = ?',
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
          model_name || 'gemini-2.5-flash',
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
          model_name: model_name || 'gemini-2.5-flash'
        },
        message: 'Prompt updated successfully',
        timestamp: new Date().toISOString()
      });

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
      }>(
        'SELECT id, prompt_name FROM agent_prompts WHERE id = ?',
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
      }>(
        `SELECT id, session_name, input_count, created_at, updated_at
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

      res.json({
        success: true,
        data: {
          sessions,
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
          session_name || `Debug Session ${new Date().toLocaleString()}`,
          JSON.stringify(messages),
          inputCount
        ]
      );

      res.json({
        success: true,
        data: {
          id: sessionId,
          prompt_id: promptId,
          session_name: session_name || `Debug Session ${new Date().toLocaleString()}`,
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

      // 解析JSON消息
      let messages = [];
      try {
        messages = JSON.parse(sessionData.messages);
      } catch (parseError) {
        logger.warn('Failed to parse session messages', { sessionId, parseError });
        messages = [];
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