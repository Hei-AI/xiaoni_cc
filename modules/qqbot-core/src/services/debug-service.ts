import { DatabaseManager } from './database';
import { QQMessage, ConversationData } from '../types';
import { logger } from '../utils/logger';

/**
 * 调试跟踪记录接口
 */
export interface DebugTraceEntry {
  id: string;
  timestamp: Date;
  user_id: number;
  message_id?: number;
  trace_type: 'user_input' | 'llm_call' | 'context_build' | 'decision' | 'response' | 'error';
  content: any;
  metadata?: Record<string, any>;
}

/**
 * 完整对话调试信息
 */
export interface ConversationDebugInfo {
  conversation_id: string;
  user_id: number;
  start_time: Date;
  end_time?: Date;
  original_message: QQMessage;
  traces: DebugTraceEntry[];
  llm_calls: Array<{
    agent_type: string;
    prompt: string;
    response: string;
    token_usage?: any;
    response_time: number;
  }>;
  context_info: {
    history_count: number;
    context_summary: string;
    user_info?: any;
    group_info?: any;
  };
  decision_info: {
    should_respond: boolean;
    confidence: number;
    reason: string;
  };
  final_response?: string;
  error_info?: any;
}

/**
 * 调试服务 - 用于跟踪和诊断对话处理过程
 */
export class DebugService {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('debug-service');
  
  // 内存中的跟踪记录缓存 (最近100条)
  private traceCache = new Map<string, DebugTraceEntry[]>();
  private conversationCache = new Map<string, ConversationDebugInfo>();
  
  constructor(database: DatabaseManager) {
    this.database = database;
  }

  /**
   * 开始新的对话调试跟踪
   */
  public startConversationTrace(conversationId: string, originalMessage: QQMessage): void {
    const debugInfo: ConversationDebugInfo = {
      conversation_id: conversationId,
      user_id: originalMessage.user_id,
      start_time: new Date(),
      original_message: originalMessage,
      traces: [],
      llm_calls: [],
      context_info: {
        history_count: 0,
        context_summary: ''
      },
      decision_info: {
        should_respond: false,
        confidence: 0,
        reason: ''
      }
    };
    
    this.conversationCache.set(conversationId, debugInfo);
    
    // 记录用户输入
    this.addTrace(conversationId, {
      id: `${conversationId}_input`,
      timestamp: new Date(),
      user_id: originalMessage.user_id,
      message_id: originalMessage.message_id,
      trace_type: 'user_input',
      content: {
        raw_message: originalMessage.raw_message,
        message: originalMessage.message,
        message_type: originalMessage.message_type,
        group_id: originalMessage.group_id,
        sender: originalMessage.sender
      }
    });
  }

  /**
   * 添加调试跟踪条目
   */
  public addTrace(conversationId: string, trace: DebugTraceEntry): void {
    const debugInfo = this.conversationCache.get(conversationId);
    if (!debugInfo) {
      this.moduleLogger.warn('Conversation not found for trace', { conversationId });
      return;
    }
    
    debugInfo.traces.push(trace);
    
    // 更新相应的调试信息
    switch (trace.trace_type) {
      case 'context_build':
        debugInfo.context_info = { ...debugInfo.context_info, ...trace.content };
        break;
      case 'decision':
        debugInfo.decision_info = trace.content;
        break;
      case 'response':
        debugInfo.final_response = trace.content.response;
        debugInfo.end_time = new Date();
        break;
      case 'error':
        debugInfo.error_info = trace.content;
        debugInfo.end_time = new Date();
        break;
    }
    
    this.moduleLogger.debug('Added trace entry', {
      conversationId,
      traceType: trace.trace_type,
      timestamp: trace.timestamp
    });
  }

  /**
   * 记录LLM调用信息
   */
  public recordLLMCall(
    conversationId: string, 
    agentType: string, 
    prompt: string, 
    response: string, 
    responseTime: number,
    tokenUsage?: any
  ): void {
    const debugInfo = this.conversationCache.get(conversationId);
    if (!debugInfo) {
      this.moduleLogger.warn('Conversation not found for LLM call', { conversationId });
      return;
    }
    
    debugInfo.llm_calls.push({
      agent_type: agentType,
      prompt: prompt.substring(0, 1000) + (prompt.length > 1000 ? '...' : ''),
      response,
      token_usage: tokenUsage,
      response_time: responseTime
    });
    
    // 同时添加到traces中
    this.addTrace(conversationId, {
      id: `${conversationId}_llm_${agentType}_${Date.now()}`,
      timestamp: new Date(),
      user_id: debugInfo.user_id,
      trace_type: 'llm_call',
      content: {
        agent_type: agentType,
        prompt_preview: prompt.substring(0, 200),
        response_preview: response.substring(0, 200),
        response_time: responseTime,
        token_usage: tokenUsage
      }
    });
  }

  /**
   * 获取对话的完整调试信息
   */
  public getConversationDebugInfo(conversationId: string): ConversationDebugInfo | null {
    return this.conversationCache.get(conversationId) || null;
  }

  /**
   * 获取用户最近的调试信息列表
   */
  public getRecentDebugInfo(userId: number, limit: number = 10): ConversationDebugInfo[] {
    const userConversations = Array.from(this.conversationCache.values())
      .filter(info => info.user_id === userId)
      .sort((a, b) => b.start_time.getTime() - a.start_time.getTime())
      .slice(0, limit);
    
    return userConversations;
  }

  /**
   * 清理过期的调试信息 (超过1小时的)
   */
  public cleanupExpiredDebugInfo(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let cleanedCount = 0;
    
    for (const [conversationId, debugInfo] of this.conversationCache.entries()) {
      if (debugInfo.start_time < oneHourAgo) {
        this.conversationCache.delete(conversationId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.moduleLogger.info('Cleaned up expired debug info', { count: cleanedCount });
    }
  }

  /**
   * 导出调试信息为JSON格式 (用于排错)
   */
  public exportDebugInfo(conversationId: string): string | null {
    const debugInfo = this.getConversationDebugInfo(conversationId);
    if (!debugInfo) {
      return null;
    }
    
    return JSON.stringify(debugInfo, null, 2);
  }

  /**
   * 获取系统调试统计信息
   */
  public getDebugStats(): {
    active_conversations: number;
    total_traces: number;
    total_llm_calls: number;
    cache_size_mb: number;
  } {
    let totalTraces = 0;
    let totalLLMCalls = 0;
    
    for (const debugInfo of this.conversationCache.values()) {
      totalTraces += debugInfo.traces.length;
      totalLLMCalls += debugInfo.llm_calls.length;
    }
    
    // 估算缓存大小
    const cacheJson = JSON.stringify(Array.from(this.conversationCache.values()));
    const cacheSizeMB = Buffer.byteLength(cacheJson, 'utf8') / (1024 * 1024);
    
    return {
      active_conversations: this.conversationCache.size,
      total_traces: totalTraces,
      total_llm_calls: totalLLMCalls,
      cache_size_mb: Math.round(cacheSizeMB * 100) / 100
    };
  }

  /**
   * 搜索包含特定关键词的调试信息
   */
  public searchDebugInfo(keyword: string, limit: number = 20): ConversationDebugInfo[] {
    const results: ConversationDebugInfo[] = [];
    const lowercaseKeyword = keyword.toLowerCase();

    for (const debugInfo of this.conversationCache.values()) {
      // 搜索原始消息
      if (debugInfo.original_message.raw_message?.toLowerCase().includes(lowercaseKeyword) ||
          debugInfo.final_response?.toLowerCase().includes(lowercaseKeyword)) {
        results.push(debugInfo);
        continue;
      }

      // 搜索跟踪记录
      for (const trace of debugInfo.traces) {
        const traceJson = JSON.stringify(trace.content).toLowerCase();
        if (traceJson.includes(lowercaseKeyword)) {
          results.push(debugInfo);
          break;
        }
      }

      if (results.length >= limit) {
        break;
      }
    }

    return results.sort((a, b) => b.start_time.getTime() - a.start_time.getTime());
  }

  /**
   * 查询批次处理记录（通过 batchId）
   */
  public async getConversationsByBatchId(batchId: string): Promise<ConversationData[]> {
    try {
      const query = `
        SELECT * FROM conversations
        WHERE batch_id = ?
        ORDER BY created_at ASC
      `;

      const conversations = await this.database.executeQuery<ConversationData>(query, [batchId]);

      this.moduleLogger.info('Retrieved conversations by batchId', {
        batchId,
        count: conversations.length
      });

      return conversations;
    } catch (error) {
      this.moduleLogger.error('Failed to get conversations by batchId', {
        error: error instanceof Error ? error.message : 'Unknown error',
        batchId
      });
      return [];
    }
  }

  /**
   * 获取批次处理统计信息
   */
  public async getBatchStats(sourceKey?: string, hours: number = 24): Promise<{
    total_batches: number;
    completed_batches: number;
    failed_batches: number;
    avg_processing_time: number;
    total_messages: number;
    batches_by_trigger: Record<string, number>;
  }> {
    try {
      const timeThreshold = new Date(Date.now() - hours * 60 * 60 * 1000);

      let query = `
        SELECT
          COUNT(*) as total_batches,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_batches,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_batches,
          AVG(processing_time) as avg_processing_time,
          SUM(message_count) as total_messages,
          trigger_type,
          COUNT(*) as count_by_trigger
        FROM conversation_batches
        WHERE created_at >= ?
      `;

      const params: any[] = [timeThreshold];

      if (sourceKey) {
        query += ` AND source_key = ?`;
        params.push(sourceKey);
      }

      query += ` GROUP BY trigger_type`;

      const results = await this.database.executeQuery<any>(query, params);

      // 聚合统计
      let total = 0;
      let completed = 0;
      let failed = 0;
      let totalMessages = 0;
      let totalProcessingTime = 0;
      let batchCount = 0;
      const batchesByTrigger: Record<string, number> = {};

      for (const row of results) {
        total += row.total_batches || 0;
        completed += row.completed_batches || 0;
        failed += row.failed_batches || 0;
        totalMessages += row.total_messages || 0;
        totalProcessingTime += (row.avg_processing_time || 0) * (row.count_by_trigger || 0);
        batchCount += row.count_by_trigger || 0;
        batchesByTrigger[row.trigger_type] = row.count_by_trigger || 0;
      }

      return {
        total_batches: total,
        completed_batches: completed,
        failed_batches: failed,
        avg_processing_time: batchCount > 0 ? Math.round(totalProcessingTime / batchCount) : 0,
        total_messages: totalMessages,
        batches_by_trigger: batchesByTrigger
      };
    } catch (error) {
      this.moduleLogger.error('Failed to get batch stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        total_batches: 0,
        completed_batches: 0,
        failed_batches: 0,
        avg_processing_time: 0,
        total_messages: 0,
        batches_by_trigger: {}
      };
    }
  }

  /**
   * 获取最近的批次记录
   */
  public async getRecentBatches(limit: number = 20, sourceKey?: string): Promise<any[]> {
    try {
      let query = `
        SELECT
          id,
          source_key,
          source_type,
          trigger_type,
          message_count,
          start_time,
          end_time,
          processing_time,
          status,
          error_message,
          created_at
        FROM conversation_batches
      `;

      const params: any[] = [];

      if (sourceKey) {
        query += ` WHERE source_key = ?`;
        params.push(sourceKey);
      }

      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      const batches = await this.database.executeQuery<any>(query, params);

      this.moduleLogger.info('Retrieved recent batches', {
        count: batches.length,
        sourceKey
      });

      return batches;
    } catch (error) {
      this.moduleLogger.error('Failed to get recent batches', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * 获取批次详情（包含关联的所有对话）
   */
  public async getBatchDetails(batchId: string): Promise<{
    batch: any;
    conversations: ConversationData[];
  } | null> {
    try {
      // 获取批次信息
      const batchQuery = `
        SELECT * FROM conversation_batches WHERE id = ?
      `;
      const batches = await this.database.executeQuery<any>(batchQuery, [batchId]);

      if (batches.length === 0) {
        return null;
      }

      // 获取关联的对话记录
      const conversations = await this.getConversationsByBatchId(batchId);

      return {
        batch: batches[0],
        conversations
      };
    } catch (error) {
      this.moduleLogger.error('Failed to get batch details', {
        error: error instanceof Error ? error.message : 'Unknown error',
        batchId
      });
      return null;
    }
  }
}
