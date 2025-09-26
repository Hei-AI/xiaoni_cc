/**
 * 预定义工具库 - 避免需要编写代码的复杂性
 * 通过key选择的方式使用预定义的Gemini Function Tools
 */

export interface PredefinedTool {
  key: string;
  name: string;
  description: string;
  category: 'utility' | 'search' | 'analysis' | 'data' | 'communication';
  functionDeclaration: {
    name: string;
    description: string;
    parameters: any;
  };
  // 工具处理函数 (可选，用于实际执行)
  handler?: (args: any) => Promise<any>;
}

// 🔧 预定义工具库
export const PREDEFINED_TOOLS: Record<string, PredefinedTool> = {
  // 🔍 搜索类工具
  'web_search': {
    key: 'web_search',
    name: 'Web搜索',
    description: '搜索互联网信息',
    category: 'search',
    functionDeclaration: {
      name: 'search_web',
      description: '搜索互联网获取最新信息',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词'
          },
          language: {
            type: 'string',
            enum: ['zh', 'en'],
            description: '搜索语言',
            default: 'zh'
          }
        },
        required: ['query']
      }
    },
    handler: async (args) => {
      // 实际搜索实现 - 可以集成各种搜索API
      return { result: `搜索结果: ${args.query}` };
    }
  },

  'weather_query': {
    key: 'weather_query',
    name: '天气查询',
    description: '获取指定城市的天气信息',
    category: 'utility',
    functionDeclaration: {
      name: 'get_weather',
      description: '获取指定城市的当前天气和预报',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称，如"北京"、"上海"'
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: '温度单位',
            default: 'celsius'
          },
          days: {
            type: 'integer',
            minimum: 1,
            maximum: 7,
            description: '预报天数',
            default: 1
          }
        },
        required: ['city']
      }
    },
    handler: async (args) => {
      // 天气API集成实现
      return {
        city: args.city,
        temperature: '22°C',
        condition: '晴朗',
        forecast: '未来3天晴朗'
      };
    }
  },

  // 🧮 数据分析工具
  'sentiment_analysis': {
    key: 'sentiment_analysis',
    name: '情感分析',
    description: '分析文本的情感倾向',
    category: 'analysis',
    functionDeclaration: {
      name: 'analyze_sentiment',
      description: '分析给定文本的情感倾向和强度',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要分析的文本内容'
          },
          language: {
            type: 'string',
            enum: ['zh', 'en'],
            description: '文本语言',
            default: 'zh'
          }
        },
        required: ['text']
      }
    },
    handler: async (args) => {
      // 情感分析实现
      return {
        sentiment: 'positive',
        confidence: 0.85,
        emotions: ['joy', 'satisfaction']
      };
    }
  },

  'keyword_extraction': {
    key: 'keyword_extraction',
    name: '关键词提取',
    description: '从文本中提取关键词',
    category: 'analysis',
    functionDeclaration: {
      name: 'extract_keywords',
      description: '从给定文本中提取重要关键词',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要分析的文本内容'
          },
          max_keywords: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: '最多返回的关键词数量',
            default: 5
          }
        },
        required: ['text']
      }
    },
    handler: async (args) => {
      // 关键词提取实现
      return {
        keywords: ['AI', '机器学习', '自然语言处理'],
        scores: [0.9, 0.8, 0.7]
      };
    }
  },

  // 📊 数据处理工具
  'json_validator': {
    key: 'json_validator',
    name: 'JSON验证',
    description: '验证JSON格式和结构',
    category: 'data',
    functionDeclaration: {
      name: 'validate_json',
      description: '验证JSON字符串的格式和结构',
      parameters: {
        type: 'object',
        properties: {
          json_string: {
            type: 'string',
            description: '要验证的JSON字符串'
          },
          schema: {
            type: 'object',
            description: 'JSON Schema (可选)',
            default: {}
          }
        },
        required: ['json_string']
      }
    },
    handler: async (args) => {
      try {
        const parsed = JSON.parse(args.json_string);
        return { valid: true, parsed, errors: [] };
      } catch (error) {
        return { valid: false, errors: [error.message] };
      }
    }
  },

  'url_parser': {
    key: 'url_parser',
    name: 'URL解析',
    description: '解析和验证URL',
    category: 'utility',
    functionDeclaration: {
      name: 'parse_url',
      description: '解析URL并提取各个组成部分',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要解析的URL'
          },
          validate: {
            type: 'boolean',
            description: '是否验证URL有效性',
            default: true
          }
        },
        required: ['url']
      }
    },
    handler: async (args) => {
      try {
        const url = new URL(args.url);
        return {
          protocol: url.protocol,
          host: url.host,
          pathname: url.pathname,
          search: url.search,
          valid: true
        };
      } catch (error) {
        return { valid: false, error: error.message };
      }
    }
  },

  // 💬 通信工具
  'message_formatter': {
    key: 'message_formatter',
    name: '消息格式化',
    description: '格式化消息内容',
    category: 'communication',
    functionDeclaration: {
      name: 'format_message',
      description: '根据指定格式和样式格式化消息',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '原始消息内容'
          },
          format: {
            type: 'string',
            enum: ['markdown', 'html', 'plain', 'json'],
            description: '目标格式',
            default: 'plain'
          },
          style: {
            type: 'string',
            enum: ['formal', 'casual', 'technical', 'friendly'],
            description: '消息风格',
            default: 'friendly'
          }
        },
        required: ['content']
      }
    },
    handler: async (args) => {
      // 消息格式化实现
      return {
        formatted: args.content,
        format: args.format,
        style: args.style
      };
    }
  }
};

// 🔧 工具管理器
export class ToolManager {
  /**
   * 根据key获取工具定义
   */
  static getToolByKey(key: string): PredefinedTool | null {
    return PREDEFINED_TOOLS[key] || null;
  }

  /**
   * 获取所有工具列表
   */
  static getAllTools(): PredefinedTool[] {
    return Object.values(PREDEFINED_TOOLS);
  }

  /**
   * 根据类别获取工具
   */
  static getToolsByCategory(category: string): PredefinedTool[] {
    return Object.values(PREDEFINED_TOOLS).filter(tool => tool.category === category);
  }

  /**
   * 根据keys获取工具的FunctionDeclaration数组
   */
  static getToolDeclarations(toolKeys: string[]): any[] {
    return toolKeys
      .map(key => PREDEFINED_TOOLS[key]?.functionDeclaration)
      .filter(Boolean);
  }

  /**
   * 执行工具函数
   */
  static async executeToolFunction(toolKey: string, args: any): Promise<any> {
    const tool = PREDEFINED_TOOLS[toolKey];
    if (!tool || !tool.handler) {
      throw new Error(`Tool ${toolKey} not found or no handler available`);
    }

    return await tool.handler(args);
  }

  /**
   * 验证工具配置
   */
  static validateToolConfig(toolKeys: string[]): { valid: boolean; errors: string[]; validTools: string[] } {
    const errors: string[] = [];
    const validTools: string[] = [];

    for (const key of toolKeys) {
      if (PREDEFINED_TOOLS[key]) {
        validTools.push(key);
      } else {
        errors.push(`Unknown tool key: ${key}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      validTools
    };
  }
}

// 🎯 工具配置简化接口
export interface SimplifiedToolConfig {
  enabled: boolean;
  selectedTools: string[]; // 使用key选择工具
  mode: 'AUTO' | 'ANY' | 'NONE';
  allowedTools?: string[]; // 限制可调用的工具
}

// 📋 工具分类常量
export const TOOL_CATEGORIES = {
  UTILITY: 'utility',
  SEARCH: 'search',
  ANALYSIS: 'analysis',
  DATA: 'data',
  COMMUNICATION: 'communication'
} as const;

// 🔍 工具搜索和过滤
export class ToolSearcher {
  static searchTools(query: string): PredefinedTool[] {
    const lowercaseQuery = query.toLowerCase();
    return Object.values(PREDEFINED_TOOLS).filter(tool =>
      tool.name.toLowerCase().includes(lowercaseQuery) ||
      tool.description.toLowerCase().includes(lowercaseQuery) ||
      tool.key.toLowerCase().includes(lowercaseQuery)
    );
  }

  static getRecommendedTools(agentType: string): string[] {
    const recommendations: Record<string, string[]> = {
      'chat_bot': ['weather_query', 'web_search', 'message_formatter'],
      'intent_analyzer': ['sentiment_analysis', 'keyword_extraction'],
      'requirement_processor': ['json_validator', 'url_parser'],
      'persona_chat': ['sentiment_analysis', 'message_formatter']
    };

    return recommendations[agentType] || [];
  }
}