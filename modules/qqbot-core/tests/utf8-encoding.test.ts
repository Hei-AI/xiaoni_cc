import { DatabaseManager } from '../src/services/database';
import { config } from '../src/config';
import { ConversationData, RequirementData } from '../src/types';

describe('UTF-8 Encoding Tests', () => {
  let dbManager: DatabaseManager;

  beforeAll(async () => {
    dbManager = new DatabaseManager(config.database);
    
    // 等待连接建立
    const connectionSuccess = await dbManager.testConnection();
    if (!connectionSuccess) {
      throw new Error('Database connection failed');
    }
  });

  afterAll(async () => {
    await dbManager.close();
  });

  test('Database connection with UTF-8 support', async () => {
    const connectionResult = await dbManager.testConnection();
    expect(connectionResult).toBe(true);
  });

  test('Insert and retrieve Chinese text correctly', async () => {
    const testMessage = '这是一个中文测试消息！包含特殊字符：你好世界 🌍';
    const testUserId = 999999999;
    const conversationId = `utf8_test_${Date.now()}`;

    // 插入包含中文的对话记录
    const conversationData: ConversationData = {
      id: conversationId,
      user_id: testUserId,
      user_message: testMessage,
      ai_response: '我收到了你的中文消息：' + testMessage,
      timestamp: new Date(),
      response_time: 1.5,
      model_name: 'gemini-2.5-flash'
    };

    const saveResult = await dbManager.saveConversation(conversationData);
    expect(saveResult).toBe(true);

    // 查询并验证中文文本
    const retrievedData = await dbManager.getConversationById(conversationId);
    expect(retrievedData).not.toBeNull();
    expect(retrievedData?.user_message).toBe(testMessage);
    expect(retrievedData?.ai_response).toBe('我收到了你的中文消息：' + testMessage);

    // 清理测试数据
    await dbManager.executeUpdate('DELETE FROM conversations WHERE id = ?', [conversationId]);
  });

  test('Insert and retrieve emoji characters correctly', async () => {
    const emojiMessage = '表情符号测试: 😀😃😄😁😆🤖💬🔧⚙️📊✅🎉🔥💯⭐';
    const testUserId = 999999998;
    const conversationId = `emoji_test_${Date.now()}`;

    const conversationData: ConversationData = {
      id: conversationId,
      user_id: testUserId,
      user_message: emojiMessage,
      ai_response: '表情符号回复: 收到! 👍',
      timestamp: new Date(),
      response_time: 0.8,
      model_name: 'gemini-2.5-flash'
    };

    const saveResult = await dbManager.saveConversation(conversationData);
    expect(saveResult).toBe(true);

    const retrievedData = await dbManager.getConversationById(conversationId);
    expect(retrievedData).not.toBeNull();
    expect(retrievedData?.user_message).toBe(emojiMessage);
    expect(retrievedData?.ai_response).toBe('表情符号回复: 收到! 👍');

    // 清理测试数据
    await dbManager.executeUpdate('DELETE FROM conversations WHERE id = ?', [conversationId]);
  });

  test('Mixed Chinese, English and emoji text', async () => {
    const mixedMessage = 'Hello 世界! This is mixed content: 你好 🌍 JavaScript ☕ TypeScript 🚀';
    const testUserId = 999999997;
    const conversationId = `mixed_test_${Date.now()}`;

    const conversationData: ConversationData = {
      id: conversationId,
      user_id: testUserId,
      user_message: mixedMessage,
      ai_response: 'Mixed response: 收到混合内容 ✅ Processing完成 🎯',
      timestamp: new Date(),
      response_time: 2.1,
      model_name: 'gemini-2.5-flash'
    };

    const saveResult = await dbManager.saveConversation(conversationData);
    expect(saveResult).toBe(true);

    const retrievedData = await dbManager.getConversationById(conversationId);
    expect(retrievedData).not.toBeNull();
    expect(retrievedData?.user_message).toBe(mixedMessage);
    expect(retrievedData?.ai_response).toBe('Mixed response: 收到混合内容 ✅ Processing完成 🎯');

    // 清理测试数据
    await dbManager.executeUpdate('DELETE FROM conversations WHERE id = ?', [conversationId]);
  });

  test('Requirement table Chinese text support', async () => {
    const requirementMessage = '请实现一个智能对话系统，要求支持中文自然语言处理和情感分析功能。';
    const requirementId = `req_utf8_test_${Date.now()}`;
    
    const requirementData: RequirementData = {
      id: requirementId,
      user_id: 85178516,
      message: requirementMessage,
      status: 'received' as const,
      created_at: new Date(),
      updated_at: new Date(),
      claude_code_output: '功能实现完成 ✅',
      completion_details: '中文自然语言处理模块已集成，情感分析API已配置完成。',
      error_message: undefined
    };

    const saveResult = await dbManager.saveRequirement(requirementData);
    expect(saveResult).toBe(true);

    const retrievedData = await dbManager.getRequirementById(requirementId);
    expect(retrievedData).not.toBeNull();
    expect(retrievedData?.message).toBe(requirementMessage);
    expect(retrievedData?.claude_code_output).toBe('功能实现完成 ✅');
    expect(retrievedData?.completion_details).toBe('中文自然语言处理模块已集成，情感分析API已配置完成。');

    // 清理测试数据
    await dbManager.executeUpdate('DELETE FROM requirements WHERE id = ?', [requirementId]);
  });

  test('System logs Chinese content', async () => {
    const chineseLogMessage = '用户请求处理完成，AI响应生成成功 🎉';
    const moduleNameChinese = '智能对话模块';

    await dbManager.logSystemEvent('info', moduleNameChinese, chineseLogMessage, {
      userId: 85178516,
      responseTime: '2.5秒',
      status: '成功 ✅'
    });

    // 查询最近的系统日志
    const logs = await dbManager.executeQuery(
      'SELECT * FROM system_logs WHERE module_name = ? AND message = ? ORDER BY timestamp DESC LIMIT 1',
      [moduleNameChinese, chineseLogMessage]
    );

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].module_name).toBe(moduleNameChinese);
    expect(logs[0].message).toBe(chineseLogMessage);
    
    const extraData = typeof logs[0].extra_data === 'string' 
      ? JSON.parse(logs[0].extra_data) 
      : logs[0].extra_data;
    expect(extraData.responseTime).toBe('2.5秒');
    expect(extraData.status).toBe('成功 ✅');

    // 清理测试数据
    await dbManager.executeUpdate('DELETE FROM system_logs WHERE id = ?', [logs[0].id]);
  });

  test('Database charset and collation verification', async () => {
    // 检查数据库字符集设置
    const dbCharset = await dbManager.executeQuery(`
      SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
      FROM information_schema.SCHEMATA 
      WHERE SCHEMA_NAME = ?
    `, [config.database.database]);

    expect(dbCharset.length).toBeGreaterThan(0);
    expect(dbCharset[0].DEFAULT_CHARACTER_SET_NAME).toBe('utf8mb4');
    expect(dbCharset[0].DEFAULT_COLLATION_NAME).toMatch(/utf8mb4.*ci/);

    // 检查主要表的字符集设置
    const tableCharsets = await dbManager.executeQuery(`
      SELECT TABLE_NAME, TABLE_COLLATION
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('conversations', 'requirements', 'system_logs', 'bot_status')
      ORDER BY TABLE_NAME
    `, [config.database.database]);

    expect(tableCharsets.length).toBeGreaterThan(0);
    tableCharsets.forEach(table => {
      expect(table.TABLE_COLLATION).toMatch(/utf8mb4.*ci/);
    });
  });
});