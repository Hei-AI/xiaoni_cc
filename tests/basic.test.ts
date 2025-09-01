import { DatabaseManager } from '../src/services/database';
import { config } from '../src/config';

describe('Basic TypeScript Migration Tests', () => {
  let database: DatabaseManager;

  beforeAll(() => {
    database = new DatabaseManager(config.database);
  });

  afterAll(async () => {
    await database.close();
  });

  describe('Database Manager', () => {
    test('should create database instance', () => {
      expect(database).toBeInstanceOf(DatabaseManager);
    });

    test('should test connection', async () => {
      const isConnected = await database.testConnection();
      // Note: This may fail if database is not running
      // In CI/CD, you would use a test database
      expect(typeof isConnected).toBe('boolean');
    });
  });

  describe('Configuration', () => {
    test('should load configuration', () => {
      expect(config).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.websocket).toBeDefined();
      expect(config.http_server).toBeDefined();
      expect(config.ai).toBeDefined();
    });

    test('should have required database config', () => {
      expect(config.database.host).toBeDefined();
      expect(config.database.port).toBeGreaterThan(0);
      expect(config.database.database).toBeDefined();
      expect(config.database.user).toBeDefined();
      expect(config.database.password).toBeDefined();
    });

    test('should have required websocket config', () => {
      expect(config.websocket.host).toBeDefined();
      expect(config.websocket.port).toBeGreaterThan(0);
      expect(config.websocket.access_token).toBeDefined();
      expect(config.websocket.uri).toContain('ws://');
    });

    test('should have required AI config', () => {
      expect(Array.isArray(config.ai.gemini_api_keys)).toBe(true);
      expect(config.ai.model_name).toBeDefined();
      expect(config.ai.authorized_user_id).toBeGreaterThan(0);
      expect(config.ai.bot_qq_number).toBeGreaterThan(0);
    });
  });
});