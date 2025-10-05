/**
 * 静态工具集成测试
 */

import { STATIC_TOOLS, getStaticTool } from '../../tools/static-tools';
import { ToolContext } from '../../types';

jest.mock('../../services/logging-service', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Static Tools', () => {
  describe('STATIC_TOOLS', () => {
    it('should export array of static tools', () => {
      expect(Array.isArray(STATIC_TOOLS)).toBe(true);
      expect(STATIC_TOOLS.length).toBeGreaterThan(0);
    });

    it('should have required properties', () => {
      STATIC_TOOLS.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('mode');
        expect(tool).toHaveProperty('parameters');
        expect(tool).toHaveProperty('handler');
        expect(typeof tool.handler).toBe('function');
      });
    });
  });

  describe('getStaticTool', () => {
    it('should find tool by name', () => {
      const tool = getStaticTool('get_current_time');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('get_current_time');
    });

    it('should return undefined for unknown tool', () => {
      const tool = getStaticTool('nonexistent_tool');
      expect(tool).toBeUndefined();
    });
  });

  describe('get_current_time', () => {
    const tool = getStaticTool('get_current_time')!;

    const createContext = (args: any): ToolContext => ({
      trace_id: 'test-trace',
      source_key: 'user_123',
      arguments: args
    });

    it('should return current time in readable format', async () => {
      const result = await tool.handler(createContext({ format: 'readable' }));

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('current_time');
      expect(result.data).toHaveProperty('timezone');
      expect(result.data).toHaveProperty('day_of_week');
      expect(typeof result.data.current_time).toBe('string');
    });

    it('should return time in ISO format', async () => {
      const result = await tool.handler(createContext({ format: 'iso' }));

      expect(result.success).toBe(true);
      expect(result.data.current_time).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
    });

    it('should return time in unix format', async () => {
      const result = await tool.handler(createContext({ format: 'unix' }));

      expect(result.success).toBe(true);
      const timestamp = parseInt(result.data.current_time);
      expect(timestamp).toBeGreaterThan(1700000000); // After 2023
      expect(timestamp).toBeLessThan(2000000000); // Before 2033
    });

    it('should use default format if not specified', async () => {
      const result = await tool.handler(createContext({}));

      expect(result.success).toBe(true);
      expect(result.data.format).toBe('readable');
    });

    it('should handle different timezones', async () => {
      const result = await tool.handler(
        createContext({ timezone: 'America/New_York' })
      );

      expect(result.success).toBe(true);
      expect(result.data.timezone).toBe('America/New_York');
    });

    it('should be returnable mode', () => {
      expect(tool.mode).toBe('returnable');
    });
  });

  describe('calculate', () => {
    const tool = getStaticTool('calculate')!;

    const createContext = (expression: string): ToolContext => ({
      trace_id: 'test-trace',
      source_key: 'user_123',
      arguments: { expression }
    });

    it('should perform basic addition', async () => {
      const result = await tool.handler(createContext('2 + 2'));

      expect(result.success).toBe(true);
      expect(result.data.result).toBe(4);
      expect(result.data.expression).toBe('2 + 2');
    });

    it('should perform basic subtraction', async () => {
      const result = await tool.handler(createContext('10 - 5'));

      expect(result.success).toBe(true);
      expect(result.data.result).toBe(5);
    });

    it('should perform multiplication', async () => {
      const result = await tool.handler(createContext('3 * 4'));

      expect(result.success).toBe(true);
      expect(result.data.result).toBe(12);
    });

    it('should perform division', async () => {
      const result = await tool.handler(createContext('15 / 3'));

      expect(result.success).toBe(true);
      expect(result.data.result).toBe(5);
    });

    it('should handle complex expressions', async () => {
      const result = await tool.handler(createContext('(2 + 3) * 4'));

      expect(result.success).toBe(true);
      expect(result.data.result).toBe(20);
    });

    it('should handle decimal numbers', async () => {
      const result = await tool.handler(createContext('3.14 * 2'));

      expect(result.success).toBe(true);
      expect(result.data.result).toBeCloseTo(6.28);
    });

    it('should reject invalid expressions', async () => {
      const result = await tool.handler(createContext('alert("xss")'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid expression');
    });

    it('should reject expressions with letters', async () => {
      const result = await tool.handler(createContext('2 + x'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid expression');
    });

    it('should be returnable mode', () => {
      expect(tool.mode).toBe('returnable');
    });
  });

  describe('log_memo', () => {
    const tool = getStaticTool('log_memo')!;

    const createContext = (args: any): ToolContext => ({
      trace_id: 'test-trace',
      source_key: 'user_123',
      user_id: 123,
      arguments: args
    });

    it('should log memo with default priority', async () => {
      const result = await tool.handler(
        createContext({ memo: 'Test memo' })
      );

      expect(result.success).toBe(true);
      expect(result.side_effects).toHaveLength(1);
      expect(result.side_effects![0]).toContain('medium');
    });

    it('should log memo with high priority', async () => {
      const result = await tool.handler(
        createContext({ memo: 'Important memo', priority: 'high' })
      );

      expect(result.success).toBe(true);
      expect(result.side_effects![0]).toContain('high');
    });

    it('should log memo with low priority', async () => {
      const result = await tool.handler(
        createContext({ memo: 'Low priority memo', priority: 'low' })
      );

      expect(result.success).toBe(true);
      expect(result.side_effects![0]).toContain('low');
    });

    it('should be fire-and-forget mode', () => {
      expect(tool.mode).toBe('fire-and-forget');
    });

    it('should have required memo parameter', () => {
      expect(tool.parameters.required).toContain('memo');
    });
  });

  describe('Tool Parameters', () => {
    it('get_current_time should have proper parameter schema', () => {
      const tool = getStaticTool('get_current_time')!;

      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toHaveProperty('timezone');
      expect(tool.parameters.properties).toHaveProperty('format');
      expect(tool.parameters.properties.format.enum).toEqual([
        'iso',
        'unix',
        'readable'
      ]);
    });

    it('calculate should have proper parameter schema', () => {
      const tool = getStaticTool('calculate')!;

      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toHaveProperty('expression');
      expect(tool.parameters.required).toContain('expression');
    });

    it('log_memo should have proper parameter schema', () => {
      const tool = getStaticTool('log_memo')!;

      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toHaveProperty('memo');
      expect(tool.parameters.properties).toHaveProperty('priority');
      expect(tool.parameters.properties.priority.enum).toEqual([
        'low',
        'medium',
        'high'
      ]);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully', async () => {
      const tool = getStaticTool('calculate')!;
      const context: ToolContext = {
        trace_id: 'test-trace',
        source_key: 'user_123',
        arguments: { expression: '1/0' }
      };

      const result = await tool.handler(context);

      // Division by zero returns Infinity, which is valid in JavaScript
      expect(result.success).toBe(true);
      expect(result.data.result).toBe(Infinity);
    });
  });
});
