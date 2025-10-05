/**
 * ToolRegistryService 单元测试
 */

import { ToolRegistryService } from '../tool-registry-service';
import { DatabaseManager } from '../database';
import { LLMTool, ToolSearchParams, ToolContext } from '../../types';

// Mock DatabaseManager
jest.mock('../database');
jest.mock('../logging-service', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('ToolRegistryService', () => {
  let toolRegistry: ToolRegistryService;
  let mockDatabase: jest.Mocked<DatabaseManager>;
  let mockConnection: any;

  beforeEach(() => {
    // 创建 mock connection
    mockConnection = {
      query: jest.fn(),
      release: jest.fn()
    };

    // 创建 mock database
    mockDatabase = {
      getConnection: jest.fn().mockResolvedValue(mockConnection)
    } as any;

    toolRegistry = new ToolRegistryService(mockDatabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('search', () => {
    it('should search tools by query', async () => {
      const mockTools = [
        {
          method_id: 'test_tool_1',
          name: 'Test Tool 1',
          description: 'A test tool for searching',
          params_schema: JSON.stringify({ type: 'object' }),
          side_effect: false,
          expect_response: true
        }
      ];

      mockConnection.query.mockResolvedValue([mockTools]);

      const params: ToolSearchParams = {
        query: 'test',
        max_results: 5
      };

      const result = await toolRegistry.search(params);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].method_id).toBe('test_tool_1');
      expect(result.total).toBe(1);

      // 验证 SQL 查询
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining(['%test%', '%test%', 5])
      );
    });

    it('should filter by category', async () => {
      mockConnection.query.mockResolvedValue([[]]);

      await toolRegistry.search({
        query: 'test',
        category: 'system'
      });

      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('category = ?'),
        expect.arrayContaining(['system'])
      );
    });

    it('should filter by side_effect', async () => {
      mockConnection.query.mockResolvedValue([[]]);

      await toolRegistry.search({
        query: 'test',
        side_effect: true
      });

      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('side_effect = ?'),
        expect.arrayContaining([true])
      );
    });

    it('should filter by tags', async () => {
      mockConnection.query.mockResolvedValue([[]]);

      await toolRegistry.search({
        query: 'test',
        tags: ['admin', 'user']
      });

      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('JSON_CONTAINS'),
        expect.arrayContaining(['"admin"', '"user"'])
      );
    });

    it('should handle empty results', async () => {
      mockConnection.query.mockResolvedValue([[]]);

      const result = await toolRegistry.search({ query: 'nonexistent' });

      expect(result.tools).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should handle database errors', async () => {
      mockConnection.query.mockRejectedValue(new Error('Database error'));

      await expect(
        toolRegistry.search({ query: 'test' })
      ).rejects.toThrow('Database error');
    });
  });

  describe('invoke', () => {
    const mockTool: any = {
      id: 1,
      method_id: 'test_tool',
      name: 'Test Tool',
      description: 'A test tool',
      params_schema: { type: 'object' },
      enabled: true,
      timeout_ms: 5000,
      side_effect: false,
      expect_response: true
    };

    beforeEach(() => {
      // Mock getTool
      mockConnection.query.mockResolvedValueOnce([[mockTool]]);
    });

    it('should invoke tool with executor', async () => {
      const mockExecutor = jest.fn().mockResolvedValue({
        success: true,
        data: { result: 'success' }
      });

      toolRegistry.registerExecutor('test_tool', mockExecutor);

      // Mock updateStats and logExecution queries
      mockConnection.query
        .mockResolvedValueOnce([[mockTool]]) // getTool
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // updateStats
        .mockResolvedValueOnce([{ insertId: 1 }]); // logExecution

      const result = await toolRegistry.invoke(
        'test_tool',
        { param: 'value' },
        'trace-123',
        'job-456'
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: 'success' });
      expect(mockExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          trace_id: 'trace-123',
          job_id: 'job-456',
          arguments: { param: 'value' }
        })
      );
    });

    it('should return error if tool not found', async () => {
      mockConnection.query.mockReset().mockResolvedValue([[]]);

      const result = await toolRegistry.invoke(
        'nonexistent',
        {},
        'trace-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error if tool is disabled', async () => {
      const disabledTool = { ...mockTool, enabled: false };
      mockConnection.query.mockReset().mockResolvedValue([[disabledTool]]);

      const result = await toolRegistry.invoke(
        'test_tool',
        {},
        'trace-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should return error if no executor registered', async () => {
      mockConnection.query
        .mockResolvedValueOnce([[mockTool]]);

      const result = await toolRegistry.invoke(
        'test_tool',
        {},
        'trace-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No executor');
    });

    it('should handle executor errors', async () => {
      const mockExecutor = jest.fn().mockRejectedValue(
        new Error('Executor error')
      );

      toolRegistry.registerExecutor('test_tool', mockExecutor);

      mockConnection.query
        .mockResolvedValueOnce([[mockTool]]) // getTool
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // updateStats (fail)

      const result = await toolRegistry.invoke(
        'test_tool',
        {},
        'trace-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Executor error');
    });

    it('should handle timeout', async () => {
      const slowExecutor = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 10000))
      );

      const fastTool = { ...mockTool, timeout_ms: 100 };
      mockConnection.query
        .mockResolvedValueOnce([[fastTool]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      toolRegistry.registerExecutor('test_tool', slowExecutor);

      const result = await toolRegistry.invoke(
        'test_tool',
        {},
        'trace-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    }, 10000);
  });

  describe('upsertTool', () => {
    it('should insert new tool', async () => {
      mockConnection.query.mockResolvedValue([{ insertId: 1 }]);

      const tool: Omit<LLMTool, 'id' | 'created_at' | 'updated_at'> = {
        method_id: 'new_tool',
        name: 'New Tool',
        description: 'A new tool',
        params_schema: { type: 'object' },
        side_effect: false,
        expect_response: true,
        timeout_ms: 5000,
        enabled: true,
        version: '1.0.0',
        total_calls: 0,
        success_calls: 0,
        failed_calls: 0
      };

      const id = await toolRegistry.upsertTool(tool);

      expect(id).toBe(1);
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO llm_tools'),
        expect.arrayContaining([
          'new_tool',
          'New Tool',
          'A new tool'
        ])
      );
    });

    it('should update existing tool', async () => {
      mockConnection.query.mockResolvedValue([{ insertId: 0 }]);

      const tool: Omit<LLMTool, 'id' | 'created_at' | 'updated_at'> = {
        method_id: 'existing_tool',
        name: 'Updated Tool',
        description: 'Updated description',
        params_schema: { type: 'object' },
        side_effect: false,
        expect_response: true,
        timeout_ms: 5000,
        enabled: true,
        version: '1.1.0',
        total_calls: 0,
        success_calls: 0,
        failed_calls: 0
      };

      await toolRegistry.upsertTool(tool);

      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE'),
        expect.any(Array)
      );
    });
  });

  describe('getEnabledTools', () => {
    it('should return all enabled tools', async () => {
      const mockTools = [
        {
          id: 1,
          method_id: 'tool_1',
          name: 'Tool 1',
          description: 'First tool',
          params_schema: JSON.stringify({ type: 'object' }),
          enabled: true,
          side_effect: false,
          expect_response: true,
          timeout_ms: 5000,
          version: '1.0.0',
          total_calls: 10,
          success_calls: 8,
          failed_calls: 2,
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      mockConnection.query.mockResolvedValue([mockTools]);

      const tools = await toolRegistry.getEnabledTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].method_id).toBe('tool_1');
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE enabled = true')
      );
    });

    it('should handle empty results', async () => {
      mockConnection.query.mockResolvedValue([[]]);

      const tools = await toolRegistry.getEnabledTools();

      expect(tools).toHaveLength(0);
    });

    it('should handle database errors gracefully', async () => {
      mockConnection.query.mockRejectedValue(new Error('Database error'));

      const tools = await toolRegistry.getEnabledTools();

      expect(tools).toHaveLength(0);
    });
  });

  describe('registerExecutor', () => {
    it('should register executor', () => {
      const mockExecutor = jest.fn();

      toolRegistry.registerExecutor('test_tool', mockExecutor);

      // Verify by invoking
      expect(() => {
        toolRegistry.registerExecutor('test_tool', mockExecutor);
      }).not.toThrow();
    });
  });
});
