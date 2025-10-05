/**
 * 静态工具定义
 * 这些工具在系统启动时加载,可以直接被 LLM 调用
 */

import { StaticTool, ToolContext, ToolResult } from '../types';
import { logger } from '../utils/logger';

const moduleLogger = logger.createModuleLogger('static-tools');

/**
 * 获取当前时间工具
 */
export const getCurrentTimeTool: StaticTool = {
  name: 'get_current_time',
  description: '获取当前的日期和时间信息',
  mode: 'returnable',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: '时区 (例如: Asia/Shanghai, UTC)',
        default: 'Asia/Shanghai'
      },
      format: {
        type: 'string',
        description: '时间格式 (iso, unix, readable)',
        enum: ['iso', 'unix', 'readable'],
        default: 'readable'
      }
    }
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    try {
      const { timezone = 'Asia/Shanghai', format = 'readable' } = ctx.arguments;
      const now = new Date();

      let timeString: string;
      switch (format) {
        case 'iso':
          timeString = now.toISOString();
          break;
        case 'unix':
          timeString = String(Math.floor(now.getTime() / 1000));
          break;
        case 'readable':
        default:
          timeString = now.toLocaleString('zh-CN', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
      }

      return {
        success: true,
        data: {
          current_time: timeString,
          timezone,
          format,
          day_of_week: now.toLocaleString('zh-CN', {
            timeZone: timezone,
            weekday: 'long'
          })
        }
      };
    } catch (error: any) {
      moduleLogger.error('[get_current_time] Error:', { error });
      return {
        success: false,
        error: error.message
      };
    }
  }
};

/**
 * 计算工具 (示例)
 */
export const calculateTool: StaticTool = {
  name: 'calculate',
  description: '执行简单的数学计算',
  mode: 'returnable',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式 (例如: 2 + 2, 10 * 5)'
      }
    },
    required: ['expression']
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    try {
      const { expression } = ctx.arguments;

      // 简单安全检查:只允许数字和基本运算符
      if (!/^[\d\s+\-*/.()]+$/.test(expression)) {
        return {
          success: false,
          error: 'Invalid expression: only numbers and operators (+, -, *, /, .) are allowed'
        };
      }

      // 使用 Function 构造函数求值 (注意:生产环境应使用更安全的方法)
      const result = eval(expression);

      return {
        success: true,
        data: {
          expression,
          result
        }
      };
    } catch (error: any) {
      moduleLogger.error('[calculate] Error:', { error });
      return {
        success: false,
        error: error.message
      };
    }
  }
};

/**
 * 记录备忘录工具 (fire-and-forget示例)
 */
export const logMemoTool: StaticTool = {
  name: 'log_memo',
  description: '记录一条备忘信息到日志中 (不返回结果)',
  mode: 'fire-and-forget',
  parameters: {
    type: 'object',
    properties: {
      memo: {
        type: 'string',
        description: '备忘内容'
      },
      priority: {
        type: 'string',
        description: '优先级',
        enum: ['low', 'medium', 'high'],
        default: 'medium'
      }
    },
    required: ['memo']
  },
  handler: async (ctx: ToolContext): Promise<ToolResult> => {
    try {
      const { memo, priority = 'medium' } = ctx.arguments;

      // 记录到日志
      moduleLogger.info(`[MEMO] [${priority.toUpperCase()}] ${memo}`, {
        trace_id: ctx.trace_id,
        user_id: ctx.user_id,
        source_key: ctx.source_key
      });

      return {
        success: true,
        side_effects: [`Logged memo with priority: ${priority}`]
      };
    } catch (error: any) {
      moduleLogger.error('[log_memo] Error:', { error });
      return {
        success: false,
        error: error.message
      };
    }
  }
};

/**
 * 汇总所有静态工具
 */
export const STATIC_TOOLS: StaticTool[] = [
  getCurrentTimeTool,
  calculateTool,
  logMemoTool
];

/**
 * 根据名称获取静态工具
 */
export function getStaticTool(name: string): StaticTool | undefined {
  return STATIC_TOOLS.find(tool => tool.name === name);
}
