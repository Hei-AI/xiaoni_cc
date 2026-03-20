/**
 * FunctionCallDispatcher 单元测试
 */

import { FunctionCallDispatcher } from '../function-call-dispatcher';
import { ToolRegistryService } from '../tool-registry-service';
import { StaticTool, GeminiFunctionCall } from '../../types';

// Mock ToolRegistryService
jest.mock('../tool-registry-service');
jest.mock('../logging-service', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('FunctionCallDispatcher', () => {
  let dispatcher: FunctionCallDispatcher;
  let mockToolRegistry: jest.Mocked<ToolRegistryService>;
  let mockConnection: any;

  beforeEach(() => {
    // Mock connection for logging
    mockConnection = {
      query: jest.fn().mockResolvedValue([{ insertId: 1 }]),
      release: jest.fn()
    };

    mockToolRegistry = {
      search: jest.fn(),
      invoke: jest.fn(),
      upsertTool: jest.fn().mockResolvedValue(1),
      database: {
        pool: {
          getConnection: jest.fn().mockResolvedValue(mockConnection)
        }
      }
    } as any;

    dispatcher = new FunctionCallDispatcher(mockToolRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Static Tools', () => {
    const mockStaticTool: StaticTool = {
      name: 'test_static_tool',
      description: 'A test static tool',
      mode: 'returnable',
      parameters: {
        type: 'object',
        properties: {
          param1: { type: 'string' }
        }
      },
      handler: jest.fn().mockResolvedValue({
        success: true,
        data: { result: 'static tool result' }
      }),
      registryMetadata: {
        displayName: 'Test Static Tool',
        category: 'testing',
        tags: ['unit'],
        sideEffect: true,
        expectResponse: true,
        timeoutMs: 1234,
        enabled: true,
        requiredPermission: 'admin',
        version: '1.2.3',
        createdBy: 'tester',
        updatedBy: 'tester2'
      }
    };

    beforeEach(async () => {
      await dispatcher.registerStaticTool(mockStaticTool);
    });

    it('should register static tool', () => {
      const declarations = dispatcher.getStaticToolDeclarations();

      expect(declarations).toHaveLength(1);
      expect(declarations[0].name).toBe('test_static_tool');
      expect(mockToolRegistry.upsertTool).toHaveBeenCalledWith(
        expect.objectContaining({
          method_id: 'test_static_tool',
          name: 'Test Static Tool',
          description: 'A test static tool',
          params_schema: mockStaticTool.parameters,
          category: 'testing',
          tags: ['unit'],
          side_effect: true,
          expect_response: true,
          timeout_ms: 1234,
          enabled: true,
          required_permission: 'admin',
          version: '1.2.3',
          created_by: 'tester',
          updated_by: 'tester2'
        })
      );
    });

    it('should only sync static tool to local registry', async () => {
      mockToolRegistry.upsertTool.mockClear();

      await dispatcher.registerStaticTool(mockStaticTool);

      expect(mockToolRegistry.upsertTool).toHaveBeenCalledTimes(1);
      expect(mockToolRegistry.upsertTool).toHaveBeenCalledWith(
        expect.objectContaining({
          method_id: 'test_static_tool',
          name: 'Test Static Tool'
        })
      );
    });

    it('should dispatch to static tool (returnable)', async () => {
      const functionCall: GeminiFunctionCall = {
        name: 'test_static_tool',
        args: { param1: 'value1' }
      };

      const result = await dispatcher.dispatch(functionCall, {
        traceId: 'trace-123',
        sourceKey: 'user_123'
      });

      expect(result.kind).toBe('continue');
      expect(result.functionResponse).toBeDefined();
      expect(result.functionResponse?.name).toBe('test_static_tool');
      expect(result.functionResponse?.response.content).toEqual({
        result: 'static tool result'
      });

      expect(mockStaticTool.handler).toHaveBeenCalledWith(
        expect.objectContaining({
          trace_id: 'trace-123',
          source_key: 'user_123',
          arguments: { param1: 'value1' }
        })
      );
    });

    it('should dispatch to static tool (fire-and-forget)', async () => {
      const fireAndForgetTool: StaticTool = {
        ...mockStaticTool,
        name: 'fire_and_forget_tool',
        mode: 'fire-and-forget',
        handler: jest.fn().mockResolvedValue({
          success: true,
          side_effects: ['Executed successfully']
        })
      };

      await dispatcher.registerStaticTool(fireAndForgetTool);

      const functionCall: GeminiFunctionCall = {
        name: 'fire_and_forget_tool',
        args: {}
      };

      const result = await dispatcher.dispatch(functionCall, {
        traceId: 'trace-123',
        sourceKey: 'user_123'
      });

      expect(result.kind).toBe('complete');
      expect(result.outcome).toEqual(expect.objectContaining({
        kind: 'side_effect_only',
        toolName: 'fire_and_forget_tool'
      }));
    });

    it('should handle static tool errors', async () => {
      const errorTool: StaticTool = {
        ...mockStaticTool,
        name: 'error_tool',
        handler: jest.fn().mockResolvedValue({
          success: false,
          error: 'Tool execution failed'
        })
      };

      await dispatcher.registerStaticTool(errorTool);

      const functionCall: GeminiFunctionCall = {
        name: 'error_tool',
        args: {}
      };

      const result = await dispatcher.dispatch(functionCall, {
        traceId: 'trace-123',
        sourceKey: 'user_123'
      });

      expect(result.functionResponse?.response.content).toEqual({
        error: 'Tool execution failed'
      });
    });

    it('should continue for fire-and-forget tools explicitly marked as non-terminal', async () => {
      const continueTool: StaticTool = {
        ...mockStaticTool,
        name: 'save_meme_image',
        mode: 'fire-and-forget',
        loopBehavior: {
          completion: 'continue',
          outcomeKind: 'side_effect_only'
        },
        handler: jest.fn().mockResolvedValue({
          success: true,
          data: { status: 'stored', meme_id: 'meme-123' }
        })
      };

      await dispatcher.registerStaticTool(continueTool);

      const result = await dispatcher.dispatch({
        name: 'save_meme_image',
        args: { tags: ['test'] }
      }, {
        traceId: 'trace-123',
        sourceKey: 'user_123'
      });

      expect(result.kind).toBe('continue');
      expect(result.functionResponse?.response.content).toEqual({
        status: 'stored',
        meme_id: 'meme-123'
      });
    });
  });

  describe('search_tools', () => {
    it('should handle search_tools call', async () => {
      const mockSearchResult = {
        tools: [
          {
            method_id: 'dynamic_tool_1',
            name: 'Dynamic Tool 1',
            description: 'A dynamic tool',
            params_schema: { type: 'object' },
            side_effect: false,
            expect_response: true
          }
        ],
        total: 1
      };

      mockToolRegistry.search.mockResolvedValue(mockSearchResult);

      const functionCall: GeminiFunctionCall = {
        name: 'search_tools',
        args: {
          query: 'find tools',
          side_effect: false,
          max_results: 5
        }
      };

      const result = await dispatcher.dispatch(functionCall, {
        traceId: 'trace-123',
        sourceKey: 'user_123'
      });

      expect(result.kind).toBe('continue');
      expect(result.searchedTools).toHaveLength(1);
      expect(result.functionResponse?.name).toBe('search_tools');
      expect(result.functionResponse?.response.content.tools).toEqual(
        mockSearchResult.tools
      );

      expect(mockToolRegistry.search).toHaveBeenCalledWith({
        query: 'find tools',
        side_effect: false,
        max_results: 5
      });
    });

    it('should return empty result if no tools found', async () => {
      mockToolRegistry.search.mockResolvedValue({
        tools: [],
        total: 0
      });

      const functionCall: GeminiFunctionCall = {
        name: 'search_tools',
        args: {
          query: 'nonexistent',
          side_effect: false
        }
      };

      const result = await dispatcher.dispatch(functionCall, {
        traceId: 'trace-123',
        sourceKey: 'user_123'
      });

      expect(result.searchedTools).toHaveLength(0);
    });
  });

  describe('invoke', () => {
    it('should handle invoke call (expect_response=true)', async () => {
      mockToolRegistry.invoke.mockResolvedValue({
        success: true,
        data: { result: 'dynamic tool result' },
        duration_ms: 100
      });

      const functionCall: GeminiFunctionCall = {
        name: 'invoke',
        args: {
          method_id: 'dynamic_tool_1',
          arguments: { param: 'value' },
          expect_response: true
        }
      };

      const result = await dispatcher.dispatch(functionCall, {
        traceId: 'trace-123',
        jobId: 'job-456',
        sourceKey: 'user_123'
      });

      expect(result.kind).toBe('continue');
      expect(result.functionResponse?.name).toBe('invoke');
      expect(result.functionResponse?.response.content).toEqual({
        result: 'dynamic tool result'
      });

      expect(mockToolRegistry.invoke).toHaveBeenCalledWith(
        'dynamic_tool_1',
        { param: 'value' },
        'trace-123',
        'job-456'
      );
    });

    it('should handle invoke call (expect_response=false)', async () => {
      mockToolRegistry.invoke.mockResolvedValue({
        success: true,
        data: { result: 'done' },
        duration_ms: 50
      });

      const functionCall: GeminiFunctionCall = {
        name: 'invoke',
        args: {
          method_id: 'fire_tool',
          arguments: {},
          expect_response: false
        }
      };

    const result = await dispatcher.dispatch(functionCall, {
      traceId: 'trace-123',
      sourceKey: 'user_123'
    });

    expect(result.kind).toBe('complete');
    expect(result.outcome).toEqual(expect.objectContaining({
      kind: 'side_effect_only',
      toolName: 'invoke'
    }));
  });

    it('should handle invoke errors', async () => {
      mockToolRegistry.invoke.mockResolvedValue({
        success: false,
        error: 'Tool not found',
        duration_ms: 10
      });

      const functionCall: GeminiFunctionCall = {
        name: 'invoke',
        args: {
          method_id: 'nonexistent',
          arguments: {},
          expect_response: true
        }
      };

      const result = await dispatcher.dispatch(functionCall, {
        traceId: 'trace-123',
        sourceKey: 'user_123'
      });

      expect(result.functionResponse?.response.content).toEqual({
        error: 'Tool not found'
      });
    });
  });

  describe('Unknown Tool', () => {
    it('should return error for unknown tool', async () => {
      const functionCall: GeminiFunctionCall = {
        name: 'unknown_tool',
        args: {}
      };

      const result = await dispatcher.dispatch(functionCall, {
        traceId: 'trace-123',
        sourceKey: 'user_123'
      });

      expect(result.error).toContain('not found');
      expect(result.functionResponse?.response.content.error).toContain('not found');
    });
  });

  describe('Tool Declarations', () => {
    it('should get search_tools declaration', () => {
      const declaration = dispatcher.getSearchToolsDeclaration();

      expect(declaration.name).toBe('search_tools');
      expect(declaration.parameters.properties).toHaveProperty('query');
      expect(declaration.parameters.properties).toHaveProperty('side_effect');
      expect(declaration.parameters.required).toContain('query');
    });

    it('should get invoke declaration with searched tools', () => {
      const searchedTools = [
        {
          method_id: 'tool_1',
          name: 'Tool 1',
          description: 'First tool',
          params_schema: {},
          side_effect: false,
          expect_response: true
        },
        {
          method_id: 'tool_2',
          name: 'Tool 2',
          description: 'Second tool',
          params_schema: {},
          side_effect: true,
          expect_response: false
        }
      ];

      const declaration = dispatcher.getInvokeDeclaration(searchedTools);

      expect(declaration.name).toBe('invoke');
      expect(declaration.description).toContain('tool_1');
      expect(declaration.description).toContain('tool_2');
      expect(declaration.parameters.properties.method_id.enum).toEqual([
        'tool_1',
        'tool_2'
      ]);
    });
  });

  describe('Error Handling', () => {
    it('should handle dispatcher exceptions', async () => {
      const errorTool: StaticTool = {
        name: 'exception_tool',
        description: 'Throws exception',
        mode: 'returnable',
        parameters: { type: 'object' },
        handler: jest.fn().mockRejectedValue(new Error('Handler exception'))
      };

      await dispatcher.registerStaticTool(errorTool);

      const functionCall: GeminiFunctionCall = {
        name: 'exception_tool',
        args: {}
      };

      const result = await dispatcher.dispatch(functionCall, {
        traceId: 'trace-123',
        sourceKey: 'user_123'
      });

      expect(result.kind).toBe('fail');
      expect(result.error).toBeDefined();
    });
  });
});
