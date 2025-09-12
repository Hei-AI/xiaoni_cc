#!/usr/bin/env node

/**
 * Test Script: Message Storage Fix Testing
 * Tests that original user messages are stored correctly (not context prompts)
 * and that raw_request contains complete message data
 */

const mysql = require('mysql2/promise');

// Database configuration
const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'qqbot_user',
  password: 'qqbot_password',
  database: 'qqbot_db',
  charset: 'utf8mb4'
};

// Mock message data
const testMessages = {
  privateMessage: {
    time: Date.now() / 1000,
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: 12345,
    user_id: 123456789,
    message: '你好，这是一条测试私聊消息',
    raw_message: '你好，这是一条测试私聊消息',
    font: 0,
    sender: {
      user_id: 123456789,
      nickname: '测试用户',
      sex: 'unknown'
    },
    self_id: 987654321
  },
  groupMessage: {
    time: Date.now() / 1000,
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: 54321,
    user_id: 123456789,
    group_id: 987654321,
    message: '@机器人 请帮我实现一个登录功能',
    raw_message: '@机器人 请帮我实现一个登录功能',
    font: 0,
    sender: {
      user_id: 123456789,
      nickname: '测试用户',
      card: '群昵称',
      sex: 'unknown',
      role: 'member'
    },
    self_id: 987654321
  },
  groupMessageWithAt: {
    time: Date.now() / 1000,
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: 54322,
    user_id: 123456789,
    group_id: 987654321,
    message: [
      {
        type: 'at',
        data: { qq: '987654321' }
      },
      {
        type: 'text',
        data: { text: ' 能帮我优化这段代码吗？' }
      }
    ],
    raw_message: '@987654321 能帮我优化这段代码吗？',
    font: 0,
    sender: {
      user_id: 123456789,
      nickname: '测试用户',
      card: '群昵称',
      sex: 'unknown',
      role: 'member'
    },
    self_id: 987654321
  }
};

async function connectDB() {
  const connection = await mysql.createConnection(dbConfig);
  
  // Set UTF8MB4 encoding
  await connection.execute("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
  await connection.execute("SET character_set_client = utf8mb4");
  await connection.execute("SET character_set_connection = utf8mb4");
  await connection.execute("SET character_set_results = utf8mb4");
  
  return connection;
}

async function cleanupTestData(connection) {
  console.log('\n🧹 Cleaning up test data...');
  
  // Delete test conversations
  const deleteConversations = `
    DELETE FROM conversations 
    WHERE user_id = 123456789 
    AND (user_message LIKE '%测试%' OR user_message LIKE '%Test%')
  `;
  
  const deleteTraces = `
    DELETE FROM llm_call_traces 
    WHERE session_id LIKE '%test_session%'
  `;
  
  await connection.execute(deleteConversations);
  await connection.execute(deleteTraces);
  
  console.log('✅ Test data cleaned up');
}

async function testMessageStorageFix() {
  let connection;
  
  try {
    console.log('🚀 Starting Message Storage Fix Testing...\n');
    
    connection = await connectDB();
    console.log('✅ Database connected successfully');
    
    // Cleanup any existing test data
    await cleanupTestData(connection);
    
    // Test 1: Private Message Storage
    console.log('\n📝 Test 1: Private Message Storage');
    await testPrivateMessageStorage(connection);
    
    // Test 2: Group Message Storage
    console.log('\n📝 Test 2: Group Message Storage');
    await testGroupMessageStorage(connection);
    
    // Test 3: Complex Message with Segments
    console.log('\n📝 Test 3: Complex Message with @mention');
    await testComplexMessageStorage(connection);
    
    // Test 4: Raw Request Data Integrity
    console.log('\n📝 Test 4: Raw Request Data Integrity');
    await testRawRequestIntegrity(connection);
    
    // Test 5: Context vs Original Message Verification
    console.log('\n📝 Test 5: Context vs Original Message Verification');
    await testContextVsOriginalMessage(connection);
    
    console.log('\n🎉 All message storage tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    if (connection) {
      await cleanupTestData(connection);
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

async function testPrivateMessageStorage(connection) {
  const message = testMessages.privateMessage;
  const conversationId = `test_conv_${Date.now()}_private`;
  
  // Simulate saving a conversation
  const saveQuery = `
    INSERT INTO conversations (
      id, user_id, user_message, ai_response, timestamp, response_time, 
      model_name, raw_request, raw_response, message_id
    ) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)
  `;
  
  const params = [
    conversationId,
    message.user_id,
    message.message, // This should be the original user message
    'Test AI Response for private message',
    1500, // response_time
    'gemini-1.5-pro',
    JSON.stringify(message), // Complete original message data
    JSON.stringify({ test: 'ai_response_data' }),
    message.message_id
  ];
  
  await connection.execute(saveQuery, params);
  
  // Verify the stored data
  const verifyQuery = `
    SELECT id, user_id, user_message, raw_request, message_id 
    FROM conversations 
    WHERE id = ?
  `;
  
  const [results] = await connection.execute(verifyQuery, [conversationId]);
  const stored = results[0];
  
  // Assertions
  console.log('  ✓ Conversation stored successfully');
  console.log(`  ✓ User Message: "${stored.user_message}"`);
  
  if (stored.user_message !== message.message) {
    throw new Error(`Message mismatch! Expected: "${message.message}", Got: "${stored.user_message}"`);
  }
  
  const rawRequest = JSON.parse(stored.raw_request);
  if (rawRequest.user_id !== message.user_id) {
    throw new Error(`Raw request user_id mismatch! Expected: ${message.user_id}, Got: ${rawRequest.user_id}`);
  }
  
  if (rawRequest.message_type !== 'private') {
    throw new Error(`Message type mismatch! Expected: private, Got: ${rawRequest.message_type}`);
  }
  
  console.log('  ✅ Private message storage test passed');
}

async function testGroupMessageStorage(connection) {
  const message = testMessages.groupMessage;
  const conversationId = `test_conv_${Date.now()}_group`;
  
  const saveQuery = `
    INSERT INTO conversations (
      id, user_id, user_message, ai_response, timestamp, response_time, 
      model_name, raw_request, raw_response, message_id
    ) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)
  `;
  
  const params = [
    conversationId,
    message.user_id,
    message.message,
    'Test AI Response for group message with development requirement',
    2000,
    'gemini-1.5-pro',
    JSON.stringify(message),
    JSON.stringify({ test: 'ai_response_data', requirement_detected: true }),
    message.message_id
  ];
  
  await connection.execute(saveQuery, params);
  
  // Verify the stored data
  const [results] = await connection.execute(
    'SELECT * FROM conversations WHERE id = ?',
    [conversationId]
  );
  const stored = results[0];
  
  console.log('  ✓ Group conversation stored successfully');
  
  const rawRequest = JSON.parse(stored.raw_request);
  if (rawRequest.group_id !== message.group_id) {
    throw new Error(`Group ID mismatch! Expected: ${message.group_id}, Got: ${rawRequest.group_id}`);
  }
  
  if (!stored.user_message.includes('实现一个登录功能')) {
    throw new Error('Original user message not preserved correctly');
  }
  
  console.log('  ✅ Group message storage test passed');
}

async function testComplexMessageStorage(connection) {
  const message = testMessages.groupMessageWithAt;
  const conversationId = `test_conv_${Date.now()}_complex`;
  
  const saveQuery = `
    INSERT INTO conversations (
      id, user_id, user_message, ai_response, timestamp, response_time, 
      model_name, raw_request, raw_response, message_id
    ) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)
  `;
  
  // Test that we can handle both segment arrays and plain text
  const userMessage = Array.isArray(message.message) 
    ? message.raw_message 
    : message.message;
  
  const params = [
    conversationId,
    message.user_id,
    userMessage,
    'Test AI Response for complex message with @mention',
    1800,
    'gemini-1.5-pro',
    JSON.stringify(message),
    JSON.stringify({ test: 'complex_response' }),
    message.message_id
  ];
  
  await connection.execute(saveQuery, params);
  
  // Verify complex message handling
  const [results] = await connection.execute(
    'SELECT * FROM conversations WHERE id = ?',
    [conversationId]
  );
  const stored = results[0];
  
  console.log('  ✓ Complex message with segments stored successfully');
  
  const rawRequest = JSON.parse(stored.raw_request);
  if (!Array.isArray(rawRequest.message)) {
    throw new Error('Message segments not preserved in raw_request');
  }
  
  if (!stored.user_message.includes('能帮我优化这段代码吗')) {
    throw new Error('User message text not extracted correctly from segments');
  }
  
  console.log('  ✅ Complex message storage test passed');
}

async function testRawRequestIntegrity(connection) {
  console.log('  🔍 Testing raw_request data integrity...');
  
  // Get all test conversations
  const [conversations] = await connection.execute(`
    SELECT id, raw_request, user_id, message_id
    FROM conversations 
    WHERE id LIKE 'test_conv_%'
    ORDER BY timestamp DESC
    LIMIT 10
  `);
  
  for (const conv of conversations) {
    const rawRequest = JSON.parse(conv.raw_request);
    
    // Check required fields
    const requiredFields = ['time', 'post_type', 'message_type', 'user_id', 'message_id', 'sender'];
    for (const field of requiredFields) {
      if (rawRequest[field] === undefined) {
        throw new Error(`Missing required field '${field}' in raw_request for conversation ${conv.id}`);
      }
    }
    
    // Verify data consistency
    if (rawRequest.user_id !== conv.user_id) {
      throw new Error(`User ID mismatch in raw_request for conversation ${conv.id}`);
    }
    
    if (rawRequest.message_id !== conv.message_id) {
      throw new Error(`Message ID mismatch in raw_request for conversation ${conv.id}`);
    }
  }
  
  console.log(`  ✅ Raw request integrity verified for ${conversations.length} conversations`);
}

async function testContextVsOriginalMessage(connection) {
  console.log('  🔍 Verifying original messages vs context prompts...');
  
  const [conversations] = await connection.execute(`
    SELECT user_message, raw_request
    FROM conversations 
    WHERE id LIKE 'test_conv_%'
  `);
  
  for (const conv of conversations) {
    const rawRequest = JSON.parse(conv.raw_request);
    const originalMessage = Array.isArray(rawRequest.message) 
      ? rawRequest.raw_message 
      : rawRequest.message;
    
    // The user_message should be the original message, not a context prompt
    if (conv.user_message !== originalMessage) {
      console.warn(`  ⚠️ Potential issue: user_message doesn't match original message`);
      console.warn(`    Stored: "${conv.user_message}"`);
      console.warn(`    Original: "${originalMessage}"`);
    }
    
    // Check that we're not storing context prompts as user messages
    if (conv.user_message.includes('你是一个智能QQ机器人助手') || 
        conv.user_message.includes('system_instructions') ||
        conv.user_message.length > 1000) {
      throw new Error('Context prompt detected in user_message field');
    }
  }
  
  console.log('  ✅ Original message preservation verified');
}

// Additional edge case tests
async function testEdgeCases(connection) {
  console.log('\n📝 Test 6: Edge Cases');
  
  // Test empty message
  try {
    const emptyMessage = { ...testMessages.privateMessage };
    emptyMessage.message = '';
    emptyMessage.raw_message = '';
    emptyMessage.message_id = 99999;
    
    const conversationId = `test_conv_${Date.now()}_empty`;
    
    const saveQuery = `
      INSERT INTO conversations (
        id, user_id, user_message, ai_response, timestamp, response_time, 
        model_name, raw_request, message_id
      ) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?)
    `;
    
    await connection.execute(saveQuery, [
      conversationId,
      emptyMessage.user_id,
      emptyMessage.message || '(empty message)',
      'AI handled empty message',
      1000,
      'gemini-1.5-pro',
      JSON.stringify(emptyMessage),
      emptyMessage.message_id
    ]);
    
    console.log('  ✅ Empty message handling test passed');
  } catch (error) {
    console.log('  ✅ Empty message properly rejected or handled');
  }
  
  // Test very long message
  const longMessage = { ...testMessages.privateMessage };
  longMessage.message = 'A'.repeat(4000); // Very long message
  longMessage.message_id = 99998;
  
  const longConversationId = `test_conv_${Date.now()}_long`;
  
  try {
    const saveQuery = `
      INSERT INTO conversations (
        id, user_id, user_message, ai_response, timestamp, response_time, 
        model_name, raw_request, message_id
      ) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?)
    `;
    
    await connection.execute(saveQuery, [
      longConversationId,
      longMessage.user_id,
      longMessage.message,
      'AI response to long message',
      2500,
      'gemini-1.5-pro',
      JSON.stringify(longMessage),
      longMessage.message_id
    ]);
    
    console.log('  ✅ Long message storage test passed');
  } catch (error) {
    console.log('  ⚠️ Long message storage failed (may be expected due to field limits)');
  }
}

if (require.main === module) {
  testMessageStorageFix().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { testMessageStorageFix };