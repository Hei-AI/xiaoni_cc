import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

// 创建Agent类型管理相关路由
export function createAgentRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  // 获取可用的Agent类型
  router.get('/agent-types', async (req, res) => {
    try {
      // 从agent_prompts表获取可用的agent类型
      const agentTypes = await database.executeQuery(`
        SELECT
          id, prompt_name as agent_name, agent_type, system_instructions,
          model_name, model_config, context_variables,
          allowed_token_ids, is_active, created_at, updated_at
        FROM agent_prompts
        WHERE is_active = 1
        ORDER BY prompt_name ASC
      `);

      // 处理allowed_token_ids JSON字段
      const processedAgentTypes = agentTypes.map((agent: any) => {
        let allowedTokenIds: number[] = [];
        try {
          allowedTokenIds = agent.allowed_token_ids ? JSON.parse(agent.allowed_token_ids) : [];
        } catch (e) {
          logger.warn(`Invalid allowed_token_ids JSON for agent ${agent.id}`, { allowed_token_ids: agent.allowed_token_ids });
        }

        return {
          ...agent,
          allowed_token_ids: allowedTokenIds,
          token_count: allowedTokenIds.length
        };
      });

      // 获取Agent使用统计
      const usageStats = await database.executeQuery(`
        SELECT
          model_name,
          COUNT(*) as usage_count,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_calls,
          AVG(processing_time_ms) as avg_processing_time
        FROM llm_call_logs
        WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY model_name
        ORDER BY usage_count DESC
      `);

      res.json({
        success: true,
        data: processedAgentTypes,
        total: processedAgentTypes.length,
        usage_stats: usageStats,
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
