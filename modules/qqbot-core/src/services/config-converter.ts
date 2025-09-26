/**
 * 🔄 简化配置转换器 - 单向AgentPromptData→UnifiedConfig转换
 * 移除双系统复杂性，仅保留必要的数据转换功能
 */

import { UnifiedLLMConfig, LLMConfigCategory } from '../types/llm-config-unified';
import { AgentPromptData } from '../types';
import { logger } from '../utils/logger';

export class ConfigConverter {
  private moduleLogger = logger.createModuleLogger('config-converter');

  /**
   * 从AgentPromptData转换为统一配置
   */
  public convertToUnified(agentPrompt: AgentPromptData): UnifiedLLMConfig {
    this.moduleLogger.debug('Converting AgentPromptData to UnifiedLLMConfig', {
      id: agentPrompt.id,
      agentType: agentPrompt.agent_type,
      promptName: agentPrompt.prompt_name
    });

    const now = new Date();

    return {
      id: agentPrompt.id.toString(),
      name: agentPrompt.prompt_name,
      description: agentPrompt.description || `${agentPrompt.agent_type} configuration`,
      category: this.mapAgentTypeToCategory(agentPrompt.agent_type),

      model: {
        name: agentPrompt.model_name || 'gemini-2.5-flash',
        provider: 'google',
        allowedTokenIds: agentPrompt.allowed_token_ids || []
      },

      generation: {
        temperature: this.extractModelConfigValue(agentPrompt.model_config, 'temperature', 0.7),
        topK: this.extractModelConfigValue(agentPrompt.model_config, 'topK', 40),
        topP: this.extractModelConfigValue(agentPrompt.model_config, 'topP', 0.95),
        maxOutputTokens: this.extractModelConfigValue(agentPrompt.model_config, 'maxOutputTokens', 2048),
        stopSequences: this.extractModelConfigValue(agentPrompt.model_config, 'stopSequences', [])
      },

      safety: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
      ],

      tools: this.extractToolsConfig(agentPrompt.advanced_config),

      context: {
        systemInstruction: this.extractSystemInstructions(agentPrompt.system_instructions),
        maxContextLength: 32000,
        historyWindowSize: 20
      },

      performance: {
        timeout: 30000,
        retry: {
          maxRetries: 3,
          retryDelayMs: 1000,
          exponentialBackoff: true
        }
      },

      version: {
        version: agentPrompt.config_version || 'v1.0.0',
        createdAt: agentPrompt.created_at || now,
        updatedAt: agentPrompt.updated_at || now,
        createdBy: agentPrompt.created_by || 'system',
        isActive: agentPrompt.is_active !== false
      }
    };
  }

  /**
   * 批量转换多个配置
   */
  public convertMultiple(agentPrompts: AgentPromptData[]): UnifiedLLMConfig[] {
    return agentPrompts.map(prompt => this.convertToUnified(prompt));
  }

  /**
   * 验证转换结果
   */
  public validateConversion(unified: UnifiedLLMConfig): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 必需字段检查
    if (!unified.id) errors.push('Missing required field: id');
    if (!unified.name) errors.push('Missing required field: name');
    if (!unified.model.name) errors.push('Missing required field: model.name');
    if (!unified.category) errors.push('Missing required field: category');

    // 数值范围检查
    if (unified.generation.temperature !== undefined && (unified.generation.temperature < 0 || unified.generation.temperature > 2)) {
      warnings.push('Temperature should be between 0 and 2');
    }

    if (unified.generation.topP !== undefined && (unified.generation.topP < 0 || unified.generation.topP > 1)) {
      warnings.push('TopP should be between 0 and 1');
    }

    if (unified.generation.maxOutputTokens !== undefined && (unified.generation.maxOutputTokens < 1 || unified.generation.maxOutputTokens > 8192)) {
      warnings.push('MaxOutputTokens should be between 1 and 8192');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  private mapAgentTypeToCategory(agentType: string): LLMConfigCategory {
    const mapping: Record<string, LLMConfigCategory> = {
      'chat_bot': 'chat_bot',
      'decision_engine': 'decision_engine',
      'persona_engine': 'persona_chat',
      'context_engine': 'custom',
      'intent_analyzer': 'intent_analyzer',
      'requirement_processor': 'requirement_processor'
    };

    return mapping[agentType] || 'custom';
  }

  private extractModelConfigValue(modelConfig: any, key: string, defaultValue: any): any {
    if (!modelConfig) return defaultValue;

    try {
      const config = typeof modelConfig === 'string' ? JSON.parse(modelConfig) : modelConfig;
      return config[key] ?? defaultValue;
    } catch (error) {
      this.moduleLogger.warn('Failed to parse model config', { error, key });
      return defaultValue;
    }
  }

  private extractSystemInstructions(instructions: any): string {
    if (!instructions) return '';

    try {
      if (typeof instructions === 'string') {
        // 尝试解析JSON格式
        try {
          const parsed = JSON.parse(instructions);
          return Array.isArray(parsed) ? parsed.join('\n') : String(parsed);
        } catch {
          // 如果不是JSON，直接返回字符串
          return instructions;
        }
      }

      if (Array.isArray(instructions)) {
        return instructions.join('\n');
      }

      return String(instructions);
    } catch (error) {
      this.moduleLogger.warn('Failed to extract system instructions', { error });
      return '';
    }
  }

  private extractToolsConfig(advancedConfig: any): any {
    if (!advancedConfig) {
      return {
        functionCalling: { enabled: false },
        predefinedTools: { enabledTools: [], callingMode: 'AUTO' }
      };
    }

    try {
      const config = typeof advancedConfig === 'string' ? JSON.parse(advancedConfig) : advancedConfig;
      return config.toolsConfig || {
        functionCalling: { enabled: false },
        predefinedTools: { enabledTools: [], callingMode: 'AUTO' }
      };
    } catch (error) {
      this.moduleLogger.warn('Failed to extract tools config', { error });
      return {
        functionCalling: { enabled: false },
        predefinedTools: { enabledTools: [], callingMode: 'AUTO' }
      };
    }
  }
}

export default ConfigConverter;