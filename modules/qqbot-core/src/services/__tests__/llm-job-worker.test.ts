/**
 * LLMJobWorker 集成测试
 */

import { LLMJobWorker, LLMJobWorkerConfig } from '../llm-job-worker';
import { DatabaseManager } from '../database';
import { FunctionCallDispatcher } from '../function-call-dispatcher';
import { AIService } from '../ai-service';
import { ToolRegistryService } from '../tool-registry-service';

jest.mock('../database');
jest.mock('../ai-service');
jest.mock('../tool-registry-service');
jest.mock('../../utils/logger', () => ({
  logger: {
    createModuleLogger: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }))
  }
}));

describe('LLMJobWorker', () => {
  let worker: LLMJobWorker;
  let mockDatabase: any;
  let mockDispatcher: any;
  let mockAIService: any;
  let mockConnection: any;

  beforeEach(() => {
    // Mock connection
    mockConnection = {
      query: jest.fn(),
      release: jest.fn()
    };

    // Mock database
    mockDatabase = {
      pool: {
        getConnection: jest.fn().mockResolvedValue(mockConnection)
      },
      updateConversationStatus: jest.fn().mockResolvedValue(true)
    };

    // Mock AI Service
    mockAIService = {
      generateContent: jest.fn()
    };

    // Mock tool registry
    const mockToolRegistry = {
      search: jest.fn(),
      invoke: jest.fn(),
      database: mockDatabase
    };

    // Mock dispatcher
    mockDispatcher = {
      dispatch: jest.fn(),
      getInvokeDeclaration: jest.fn(),
      getStaticToolDeclarations: jest.fn().mockReturnValue([]),
      getStaticToolDeclaration: jest.fn().mockReturnValue(undefined),
      getSearchToolsDeclaration: jest.fn().mockReturnValue(undefined)
    };

    worker = new LLMJobWorker(mockDatabase, mockDispatcher, mockAIService, {
      maxConcurrentJobs: 2,
      pollIntervalMs: 100,
      jobTimeoutMs: 5000,
      retryDelayMs: 1000
    });
  });

  afterEach(async () => {
    if (worker.getStats().isRunning) {
      await worker.stop();
    }
    jest.clearAllMocks();
  });

  describe('Lifecycle', () => {
    it('should start and stop worker', async () => {
      const startSpy = jest.fn();
      const stopSpy = jest.fn();

      worker.on('started', startSpy);
      worker.on('stopped', stopSpy);

      worker.start();
      expect(startSpy).toHaveBeenCalled();

      await worker.stop();
      expect(stopSpy).toHaveBeenCalled();
    });

    it('should not start twice', () => {
      worker.start();
      worker.start(); // Should log warning but not crash

      expect(worker.getStats().isRunning).toBe(true);
    });
  });

  describe('Job Creation', () => {
    it('should create a new job', async () => {
      mockConnection.query.mockResolvedValueOnce([{ insertId: 1 }]);

      const jobId = await worker.createJob({
        traceId: 'trace-123',
        sourceKey: 'user_123',
        sourceType: 'private',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hello' }]
          }
        ]
      });

      expect(jobId).toBeTruthy();
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO llm_jobs'),
        expect.arrayContaining(['trace-123', 'user_123', 'private'])
      );
    });

    it('should create job with tools and config', async () => {
      mockConnection.query.mockResolvedValueOnce([{ insertId: 1 }]);

      const tools = [{ name: 'test_tool', description: 'A test tool' }];
      const config = { temperature: 0.7 };

      await worker.createJob({
        traceId: 'trace-123',
        sourceKey: 'user_123',
        sourceType: 'private',
        contents: [],
        tools,
        config
      });

      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.any(String), // jobId
          'trace-123',
          'user_123',
          'private',
          expect.any(String), // contents_json
          JSON.stringify(tools),
          JSON.stringify(config)
        ])
      );
    });
  });

  describe('Job Retrieval', () => {
    it('should get job by id', async () => {
      const mockJob = {
        id: 'job-123',
        trace_id: 'trace-123',
        source_key: 'user_123',
        source_type: 'private',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: JSON.stringify([{ role: 'user', parts: [{ text: 'Hello' }] }]),
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date()
      };

      mockConnection.query.mockResolvedValueOnce([[mockJob]]);

      const job = await worker.getJob('job-123');

      expect(job).toBeTruthy();
      expect(job?.id).toBe('job-123');
      expect(job?.trace_id).toBe('trace-123');
      expect(Array.isArray(job?.contents_json)).toBe(true);
    });

    it('should return null for non-existent job', async () => {
      mockConnection.query.mockResolvedValueOnce([[]]);

      const job = await worker.getJob('nonexistent');

      expect(job).toBeNull();
    });
  });

  describe('Job Execution', () => {
    it('should process job with text response', async () => {
      const mockJob = {
        id: 'job-123',
        trace_id: 'trace-123',
        source_key: 'user_123',
        source_type: 'private',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        tools_json: null,
        config_json: null,
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { userId: 123 }
      };

      // Mock LLM response (text only, no function calls)
      const mockLLMResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello! How can I help you?' }]
            }
          }
        ]
      };

      mockAIService.generateContent.mockResolvedValueOnce(mockLLMResponse);
      mockConnection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // updateJobStatus
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // completeJob

      // Create spy for events
      const completedSpy = jest.fn();
      worker.on('job_completed', completedSpy);

      // Process job
      await (worker as any).processJob(mockJob);

      expect(mockAIService.generateContent).toHaveBeenCalled();
      expect(completedSpy).toHaveBeenCalledWith(expect.objectContaining({
        jobId: 'job-123',
        traceId: 'trace-123',
        finalResponse: 'Hello! How can I help you?',
        outcome: undefined,
        metadata: mockJob.metadata
      }));
    });

    it('should enforce static tool overrides before calling LLM', async () => {
      const mockJob = {
        id: 'job-override',
        trace_id: 'trace-static',
        source_key: 'group_1',
        source_type: 'group',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: [{ role: 'user', parts: [{ text: '发送表情包' }] }],
        tools_json: [
          {
            name: 'send_meme_image',
            description: 'Old description',
            parameters: {
              type: 'object',
              properties: {
                tags: { type: 'array' }
              },
              required: ['tags']
            }
          }
        ],
        config_json: null,
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { userId: 999 }
      };

      const staticSchema = {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
          user_perspectives: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                target_user_id: { type: 'integer' },
                based_on: { type: 'string' },
                comment: { type: 'string' }
              },
              required: ['target_user_id', 'based_on', 'comment']
            }
          }
        },
        required: ['tags', 'user_perspectives']
      };

      mockDispatcher.getStaticToolDeclaration.mockImplementation((name: string) => {
        if (name === 'send_meme_image') {
          return {
            name,
            description: 'Canonical meme sender',
            parameters: staticSchema
          };
        }
        return undefined;
      });

      const mockLLMResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'done' }]
            }
          }
        ]
      };

      mockAIService.generateContent.mockResolvedValueOnce(mockLLMResponse);
      mockConnection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await (worker as any).processJob(mockJob);

      const request = mockAIService.generateContent.mock.calls[0][0];
      expect(request.tools).toHaveLength(1);
      const declaration = request.tools[0];
      expect(declaration.description).toBe('Canonical meme sender');
      expect(declaration.parameters.required).toEqual(['tags', 'user_perspectives']);
      expect(
        declaration.parameters.properties.user_perspectives.items.required
      ).toEqual(['target_user_id', 'based_on', 'comment']);
    });

    it('should process job with function call', async () => {
      const mockJob = {
        id: 'job-123',
        trace_id: 'trace-123',
        source_key: 'user_123',
        source_type: 'private',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: [{ role: 'user', parts: [{ text: '帮我给朋友发一条消息' }] }],
        tools_json: [
          {
            name: 'send_private_chat_message',
            description: 'Send private message',
            parameters: { type: 'object' }
          }
        ],
        config_json: null,
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { userId: 123 }
      };

      // First LLM response with function call
      const mockLLMResponse1 = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'send_private_chat_message',
                    args: { user_id: 123456, message: '你好呀～' }
                  }
                }
              ]
            }
          }
        ]
      };

      // Second LLM response with text
      const mockLLMResponse2 = {
        candidates: [
          {
            content: {
              parts: [{ text: 'The current time is 10:30 AM' }]
            }
          }
        ]
      };

      mockAIService.generateContent
        .mockResolvedValueOnce(mockLLMResponse1)
        .mockResolvedValueOnce(mockLLMResponse2);

      // Mock dispatcher
      jest.spyOn(mockDispatcher, 'dispatch').mockResolvedValueOnce({
        kind: 'continue',
        functionResponse: {
          name: 'send_private_chat_message',
          response: {
            name: 'send_private_chat_message',
            content: {
              status: 'sent',
              user_id: 123456,
              message: '你好呀～'
            }
          }
        }
      });

      mockConnection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // updateJobStatus
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // updateJobTurn
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // completeJob

      const completedSpy = jest.fn();
      worker.on('job_completed', completedSpy);

      await (worker as any).processJob(mockJob);

      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        {
          name: 'send_private_chat_message',
          args: { user_id: 123456, message: '你好呀～' }
        },
        expect.objectContaining({ jobId: 'job-123' })
      );
      expect(completedSpy).toHaveBeenCalledWith(expect.objectContaining({
        jobId: 'job-123',
        traceId: 'trace-123',
        outcome: undefined,
        metadata: mockJob.metadata
      }));
    });

    it('should deduplicate config tools against runtime tools before calling LLM', async () => {
      const mockJob = {
        id: 'job-dedupe-tools',
        trace_id: 'trace-dedupe-tools',
        source_key: 'user_123',
        source_type: 'private',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        tools_json: [
          {
            name: 'send_private_chat_message',
            description: 'Runtime tool',
            parameters: { type: 'object', properties: { user_id: { type: 'integer' } } }
          }
        ],
        config_json: {
          tools: [
            {
              name: 'send_private_chat_message',
              description: 'Prompt tool',
              parameters: { type: 'object', properties: { message: { type: 'string' } } }
            }
          ]
        },
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { userId: 123 }
      };

      mockDispatcher.getStaticToolDeclaration.mockImplementation((name: string) => {
        if (name === 'send_private_chat_message') {
          return {
            name,
            description: 'Static override',
            parameters: {
              type: 'object',
              required: ['user_id', 'message'],
              properties: {
                user_id: { type: 'integer' },
                message: { type: 'string' }
              }
            }
          };
        }
        return undefined;
      });

      mockAIService.generateContent.mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [{ text: 'done' }]
            }
          }
        ]
      });
      mockConnection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await (worker as any).processJob(mockJob);

      const request = mockAIService.generateContent.mock.calls[0][0];
      expect(request.tools).toHaveLength(1);
      expect(request.tools[0].name).toBe('send_private_chat_message');
      expect(request.tools[0].description).toBe('Static override');
      expect(request.tools[0].parameters.required).toEqual(['user_id', 'message']);
    });

    it('should exclude group-only tools for private jobs', async () => {
      const mockJob = {
        id: 'job-private-tool-filter',
        trace_id: 'trace-private-tool-filter',
        source_key: 'user_123',
        source_type: 'private',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        tools_json: [
          {
            name: 'send_private_chat_message',
            description: 'Private tool',
            parameters: { type: 'object' }
          },
          {
            name: 'send_qq_group_message',
            description: 'Group tool',
            parameters: { type: 'object' }
          }
        ],
        config_json: {
          tools: [
            {
              name: 'send_qq_group_message',
              description: 'Group tool from config',
              parameters: { type: 'object' }
            }
          ]
        },
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { userId: 123 }
      };

      mockAIService.generateContent.mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [{ text: 'done' }]
            }
          }
        ]
      });
      mockConnection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await (worker as any).processJob(mockJob);

      const request = mockAIService.generateContent.mock.calls[0][0];
      expect(request.tools.map((tool: any) => tool.name)).toEqual(['send_private_chat_message']);
    });

    it('should schedule retry using database time to avoid timezone drift', async () => {
      const mockJob = {
        id: 'job-retry',
        trace_id: 'trace-retry',
        source_key: 'user_123',
        source_type: 'private',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        tools_json: null,
        config_json: null,
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { userId: 123 }
      };

      mockAIService.generateContent.mockRejectedValueOnce(new Error('temporary failure'));
      mockConnection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const retrySpy = jest.fn();
      worker.on('job_retry_scheduled', retrySpy);

      await (worker as any).processJob(mockJob);

      expect(mockConnection.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('next_retry_at = DATE_ADD(NOW(), INTERVAL ? MICROSECOND)'),
        [1, 1000 * 1000, 'job-retry']
      );
      expect(retrySpy).toHaveBeenCalledWith({ jobId: 'job-retry', retryCount: 1 });
    });

    it('should fail immediately on permanent authorization errors', async () => {
      const mockJob = {
        id: 'job-auth-fail',
        trace_id: 'trace-auth-fail',
        source_key: 'user_123',
        source_type: 'private',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        tools_json: null,
        config_json: null,
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: { userId: 123 }
      };

      const authError = Object.assign(
        new Error('Your API key was reported as leaked. Please use another API key.'),
        { status: 403 }
      );

      mockAIService.generateContent.mockRejectedValueOnce(authError);
      mockConnection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const failedSpy = jest.fn();
      worker.on('job_failed', failedSpy);

      await (worker as any).processJob(mockJob);

      expect(mockConnection.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("SET status = 'failed'"),
        [
          authError.message,
          JSON.stringify({
            userId: 123,
            loopOutcome: {
              kind: 'failed',
              error: authError.message
            }
          }),
          'job-auth-fail'
        ]
      );
      expect(failedSpy).toHaveBeenCalledWith(expect.objectContaining({
        jobId: 'job-auth-fail',
        traceId: 'trace-auth-fail',
        error: authError.message,
        outcome: {
          kind: 'failed',
          error: authError.message
        },
        metadata: {
          userId: 123,
          loopOutcome: {
            kind: 'failed',
            error: authError.message
          }
        }
      }));
    });

    it('should convert bare chat text into a terminal send tool outcome for chat_bot', async () => {
      const mockJob = {
        id: 'job-chat-fallback',
        trace_id: 'trace-chat-fallback',
        source_key: 'user_123',
        source_type: 'private',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: [{ role: 'user', parts: [{ text: 'hello' }] }],
        tools_json: null,
        config_json: null,
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {
          userId: 123,
          conversationId: 'conv-123',
          agentType: 'chat_bot',
          promptName: 'basic_chat',
          modelName: 'gpt-5.4-mini'
        }
      };

      mockAIService.generateContent.mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [{ text: '你好呀' }]
            }
          }
        ]
      });

      mockDispatcher.dispatch.mockResolvedValueOnce({
        kind: 'complete',
        outcome: {
          kind: 'message_sent',
          toolName: 'send_private_chat_message',
          message: '你好呀',
          summary: '你好呀'
        }
      });

      mockConnection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // updateJobStatus
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // updateJobProgress
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // completeJob

      const completedSpy = jest.fn();
      worker.on('job_completed', completedSpy);

      await (worker as any).processJob(mockJob);

      expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
        {
          name: 'send_private_chat_message',
          args: {
            user_id: 123,
            message: '你好呀'
          }
        },
        expect.objectContaining({
          jobId: 'job-chat-fallback',
          traceId: 'trace-chat-fallback'
        })
      );
      expect(completedSpy).toHaveBeenCalledWith(expect.objectContaining({
        outcome: expect.objectContaining({
          kind: 'message_sent',
          protocolFallback: 'text_to_send_tool'
        })
      }));
      expect(mockDatabase.updateConversationStatus).toHaveBeenCalledWith(
        'conv-123',
        'completed',
        undefined,
        '你好呀',
        0,
        'gpt-5.4-mini',
        expect.any(String)
      );
    });

    it('should complete chat_bot jobs with end outcome and no reply text', async () => {
      const mockJob = {
        id: 'job-chat-end',
        trace_id: 'trace-chat-end',
        source_key: 'user_123',
        source_type: 'private',
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
        contents_json: [{ role: 'user', parts: [{ text: '...' }] }],
        tools_json: null,
        config_json: null,
        current_turn: 1,
        max_turns: 10,
        created_at: new Date(),
        updated_at: new Date(),
        metadata: {
          userId: 123,
          conversationId: 'conv-end',
          agentType: 'chat_bot',
          promptName: 'basic_chat',
          modelName: 'gpt-5.4-mini'
        }
      };

      mockAIService.generateContent.mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'end',
                    args: {}
                  }
                }
              ]
            }
          }
        ]
      });

      mockDispatcher.dispatch.mockResolvedValueOnce({
        kind: 'complete',
        outcome: {
          kind: 'ended_no_reply',
          toolName: 'end',
          summary: 'Conversation ended without reply'
        }
      });

      mockConnection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // updateJobStatus
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // updateJobProgress
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // completeJob

      const completedSpy = jest.fn();
      worker.on('job_completed', completedSpy);

      await (worker as any).processJob(mockJob);

      expect(completedSpy).toHaveBeenCalledWith(expect.objectContaining({
        jobId: 'job-chat-end',
        traceId: 'trace-chat-end',
        finalResponse: '',
        outcome: expect.objectContaining({
          kind: 'ended_no_reply',
          toolName: 'end'
        })
      }));
      expect(mockDatabase.updateConversationStatus).toHaveBeenCalledWith(
        'conv-end',
        'completed',
        undefined,
        '',
        0,
        'gpt-5.4-mini',
        expect.any(String)
      );
    });
  });

  describe('Stats', () => {
    it('should return worker stats', () => {
      const stats = worker.getStats();

      expect(stats).toHaveProperty('isRunning');
      expect(stats).toHaveProperty('activeJobs');
      expect(stats).toHaveProperty('maxConcurrentJobs');
      expect(stats.maxConcurrentJobs).toBe(2);
    });
  });
});
