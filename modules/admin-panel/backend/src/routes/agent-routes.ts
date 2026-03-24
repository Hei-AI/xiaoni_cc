import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

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
    description: '关系洞察、虚拟行走 planner、反馈判定等结构化 tool prompts。'
  },
  {
    value: 'custom',
    label: '自定义',
    description: '不属于标准链路的自定义 prompt 类型。'
  }
];

export function createAgentRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

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

      const seen = new Set(BASE_AGENT_TYPES.map(item => item.value));
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

  return router;
}

export default createAgentRoutes;
