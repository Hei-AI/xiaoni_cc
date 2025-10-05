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
      }
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
      getInvokeDeclaration: jest.fn()
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
        metadata: mockJob.metadata
      }));
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
        contents_json: [{ role: 'user', parts: [{ text: 'What time is it?' }] }],
        tools_json: [
          {
            name: 'get_current_time',
            description: 'Get current time',
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
                    name: 'get_current_time',
                    args: { format: 'readable' }
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
        shouldContinue: true,
        isCompleted: false,
        functionResponse: {
          name: 'get_current_time',
          response: {
            name: 'get_current_time',
            content: { current_time: '10:30 AM' }
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
        { name: 'get_current_time', args: { format: 'readable' } },
        expect.objectContaining({ jobId: 'job-123' })
      );
      expect(completedSpy).toHaveBeenCalledWith(expect.objectContaining({
        jobId: 'job-123',
        traceId: 'trace-123',
        metadata: mockJob.metadata
      }));
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
