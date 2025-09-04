import request from 'supertest';
import express from 'express';
import { SessionApiHandlers } from '../src/services/session-api-handlers';
import { DatabaseManager } from '../src/services/database';

// Mock 数据库管理器
jest.mock('../src/services/database');
const MockedDatabaseManager = DatabaseManager as jest.MockedClass<typeof DatabaseManager>;

describe('Session API Handlers', () => {
  let app: express.Application;
  let sessionApiHandlers: SessionApiHandlers;
  let mockDatabase: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    mockDatabase = new MockedDatabaseManager({
      host: 'localhost',
      port: 3306,
      user: 'test',
      password: 'test',
      database: 'test'
    }) as jest.Mocked<DatabaseManager>;
    
    sessionApiHandlers = new SessionApiHandlers(mockDatabase);

    // 设置路由
    app.get('/api/sessions', sessionApiHandlers.handleGetSessions.bind(sessionApiHandlers));
    app.get('/api/sessions/:id', sessionApiHandlers.handleGetSession.bind(sessionApiHandlers));
    app.post('/api/sessions/:id/switch-service', sessionApiHandlers.handleSwitchSessionService.bind(sessionApiHandlers));
    app.post('/api/sessions/cleanup', sessionApiHandlers.handleCleanupSessions.bind(sessionApiHandlers));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/sessions', () => {
    test('should return sessions list with default parameters', async () => {
      const testDate = new Date();
      const mockSessions = [
        {
          session_id: 'session_85178516_1',
          user_id: 85178516,
          session_type: 'chat',
          status: 'active',
          created_at: testDate,
          last_activity: testDate
        },
        {
          session_id: 'session_85178516_2',
          user_id: 85178516,
          session_type: 'requirement',
          status: 'active',
          created_at: testDate,
          last_activity: testDate
        }
      ];
      
      // 期望返回的数据格式（日期转为字符串）
      const expectedSessions = mockSessions.map(session => ({
        ...session,
        created_at: testDate.toISOString(),
        last_activity: testDate.toISOString()
      }));

      mockDatabase.getSessions.mockResolvedValue(mockSessions);

      const response = await request(app)
        .get('/api/sessions')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockSessions,
        total: mockSessions.length
      });

      expect(mockDatabase.getSessions).toHaveBeenCalledWith(undefined, 50, undefined);
    });

    test('should filter sessions by user_id', async () => {
      const mockSessions = [
        {
          session_id: 'session_85178516_1',
          user_id: 85178516,
          session_type: 'chat',
          status: 'active',
          created_at: new Date(),
          last_activity: new Date()
        }
      ];

      mockDatabase.getSessions.mockResolvedValue(mockSessions);

      const response = await request(app)
        .get('/api/sessions?user_id=85178516&limit=10')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockSessions,
        total: mockSessions.length
      });

      expect(mockDatabase.getSessions).toHaveBeenCalledWith(85178516, 10, undefined);
    });

    test('should filter sessions by status', async () => {
      const mockSessions = [
        {
          session_id: 'session_85178516_1',
          user_id: 85178516,
          session_type: 'chat',
          status: 'active',
          created_at: new Date(),
          last_activity: new Date()
        }
      ];

      mockDatabase.getSessions.mockResolvedValue(mockSessions);

      const response = await request(app)
        .get('/api/sessions?status=active')
        .expect(200);

      expect(mockDatabase.getSessions).toHaveBeenCalledWith(undefined, 50, 'active');
    });

    test('should handle database errors', async () => {
      mockDatabase.getSessions.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/sessions')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to get sessions',
        message: 'Database connection failed'
      });
    });
  });

  describe('GET /api/sessions/:id', () => {
    test('should return specific session by ID', async () => {
      const mockSession = {
        session_id: 'session_85178516_1',
        user_id: 85178516,
        session_type: 'chat',
        status: 'active',
        created_at: new Date(),
        last_activity: new Date(),
        conversation_context: {},
        business_context: {},
        service_transitions: [],
        recent_messages: []
      };

      mockDatabase.getSessionById.mockResolvedValue(mockSession);

      const response = await request(app)
        .get('/api/sessions/session_85178516_1')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockSession
      });

      expect(mockDatabase.getSessionById).toHaveBeenCalledWith('session_85178516_1');
    });

    test('should return 404 for non-existent session', async () => {
      mockDatabase.getSessionById.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/sessions/nonexistent')
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: 'Session not found'
      });
    });

    test('should handle database errors', async () => {
      mockDatabase.getSessionById.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/sessions/session_85178516_1')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to get session',
        message: 'Database error'
      });
    });
  });

  describe('POST /api/sessions/:id/switch-service', () => {
    test('should successfully switch session service', async () => {
      mockDatabase.switchSessionService.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/sessions/session_85178516_1/switch-service')
        .send({
          service: 'gemini_ai',
          reason: 'User requested to switch to chat mode'
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Session service switched successfully'
      });

      expect(mockDatabase.switchSessionService).toHaveBeenCalledWith(
        'session_85178516_1',
        'gemini_ai',
        'User requested to switch to chat mode'
      );
    });

    test('should return 400 for missing service parameter', async () => {
      const response = await request(app)
        .post('/api/sessions/session_85178516_1/switch-service')
        .send({
          reason: 'Missing service parameter test'
        })
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: 'Missing required parameter: service'
      });
    });

    test('should return 404 for failed switch', async () => {
      mockDatabase.switchSessionService.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/sessions/session_85178516_1/switch-service')
        .send({
          service: 'invalid_service'
        })
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: 'Session not found or switch failed'
      });
    });

    test('should handle database errors', async () => {
      mockDatabase.switchSessionService.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/sessions/session_85178516_1/switch-service')
        .send({
          service: 'gemini_ai'
        })
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to switch session service',
        message: 'Database connection failed'
      });
    });
  });

  describe('POST /api/sessions/cleanup', () => {
    test('should successfully cleanup expired sessions', async () => {
      mockDatabase.cleanupExpiredSessions.mockResolvedValue(5);

      const response = await request(app)
        .post('/api/sessions/cleanup')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Sessions cleaned up successfully',
        cleaned_count: 5
      });

      expect(mockDatabase.cleanupExpiredSessions).toHaveBeenCalled();
    });

    test('should handle cleanup with no expired sessions', async () => {
      mockDatabase.cleanupExpiredSessions.mockResolvedValue(0);

      const response = await request(app)
        .post('/api/sessions/cleanup')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Sessions cleaned up successfully',
        cleaned_count: 0
      });
    });

    test('should handle database errors during cleanup', async () => {
      mockDatabase.cleanupExpiredSessions.mockRejectedValue(new Error('Cleanup failed'));

      const response = await request(app)
        .post('/api/sessions/cleanup')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to cleanup sessions',
        message: 'Cleanup failed'
      });
    });
  });

  describe('Input Validation', () => {
    test('should handle invalid query parameters gracefully', async () => {
      mockDatabase.getSessions.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/sessions?user_id=invalid&limit=invalid')
        .expect(200);

      // Invalid user_id should result in NaN, which becomes undefined
      // Invalid limit should result in NaN, which becomes undefined and defaults to 50
      expect(mockDatabase.getSessions).toHaveBeenCalledWith(undefined, 50, undefined);
    });

    test('should handle empty request body for service switch', async () => {
      const response = await request(app)
        .post('/api/sessions/session_85178516_1/switch-service')
        .send({})
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: 'Missing required parameter: service'
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle very large user ID', async () => {
      const largeUserId = 999999999999;
      mockDatabase.getSessions.mockResolvedValue([]);

      const response = await request(app)
        .get(`/api/sessions?user_id=${largeUserId}`)
        .expect(200);

      expect(mockDatabase.getSessions).toHaveBeenCalledWith(largeUserId, 50, undefined);
    });

    test('should handle very large limit parameter', async () => {
      mockDatabase.getSessions.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/sessions?limit=999999')
        .expect(200);

      expect(mockDatabase.getSessions).toHaveBeenCalledWith(undefined, 999999, undefined);
    });

    test('should handle special characters in session ID', async () => {
      const specialSessionId = 'session_test_特殊字符_123';
      mockDatabase.getSessionById.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/sessions/${encodeURIComponent(specialSessionId)}`)
        .expect(404);

      expect(mockDatabase.getSessionById).toHaveBeenCalledWith(specialSessionId);
    });
  });
});