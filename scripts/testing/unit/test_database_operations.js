#!/usr/bin/env node

/**
 * Test Script: Database Operations Testing
 * Tests all new database methods, query performance, and cleanup operations
 */

const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

// Database configuration
const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'qqbot_user',
  password: 'qqbot_password',
  database: 'qqbot_db',
  charset: 'utf8mb4'
};

// Performance benchmarks
const performanceBenchmarks = {
  singleInsert: 100,      // ms
  batchInsert: 500,       // ms
  complexQuery: 1000,     // ms
  aggregation: 2000       // ms
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
  console.log('\n🧹 Cleaning up database test data...');
  
  const cleanupQueries = [
    `DELETE FROM llm_call_traces WHERE session_id LIKE 'test_db_%'`,
    `DELETE FROM conversations WHERE user_id IN (999888777, 999888778, 999888779, 999888780, 999888781)`,
    `DELETE FROM requirements WHERE user_id IN (999888777, 999888778, 999888779, 999888780, 999888781)`,
    `DELETE FROM group_chat_settings WHERE group_id = 888999111`,
    `DELETE FROM conversation_sessions WHERE session_id LIKE 'test_db_%'`,
    `DELETE FROM message_reply_chain WHERE session_id LIKE 'test_db_%'`,
    // Clean up any test conversations from integration tests that might be interfering
    `DELETE FROM conversations WHERE JSON_EXTRACT(raw_request, '$.group_id') = 888999111`,
    `DELETE FROM llm_call_traces WHERE session_id LIKE '%test_%'`
  ];
  
  for (const query of cleanupQueries) {
    try {
      await connection.execute(query);
    } catch (error) {
      // Ignore table not found errors
      if (!error.message.includes("doesn't exist")) {
        console.warn(`Cleanup warning: ${error.message}`);
      }
    }
  }
  
  console.log('✅ Test data cleaned up');
}

async function testDatabaseOperations() {
  let connection;
  
  try {
    console.log('🚀 Starting Database Operations Testing...\n');
    
    connection = await connectDB();
    console.log('✅ Database connected successfully');
    
    // Cleanup existing test data
    await cleanupTestData(connection);
    
    // Test 1: Basic CRUD Operations
    console.log('\n📝 Test 1: Basic CRUD Operations');
    await testBasicCRUD(connection);
    
    // Test 2: LLM Trace Methods
    console.log('\n📝 Test 2: LLM Trace Methods');
    await testLLMTraceMethods(connection);
    
    // Test 3: Session Management Methods
    console.log('\n📝 Test 3: Session Management Methods');
    await testSessionMethods(connection);
    
    // Test 4: Context and History Methods
    console.log('\n📝 Test 4: Context and History Methods');
    await testContextHistoryMethods(connection);
    
    // Test 5: Query Performance Testing
    console.log('\n📝 Test 5: Query Performance Testing');
    await testQueryPerformance(connection);
    
    // Test 6: Complex Aggregation Queries
    console.log('\n📝 Test 6: Complex Aggregation Queries');
    await testAggregationQueries(connection);
    
    // Test 7: Data Integrity and Constraints
    console.log('\n📝 Test 7: Data Integrity and Constraints');
    await testDataIntegrity(connection);
    
    // Test 8: Batch Operations
    console.log('\n📝 Test 8: Batch Operations');
    await testBatchOperations(connection);
    
    console.log('\n🎉 All database operations tests completed!');
    
  } catch (error) {
    console.error('❌ Database operations test failed:', error);
    throw error;
  } finally {
    if (connection) {
      await cleanupTestData(connection);
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

async function testBasicCRUD(connection) {
  console.log('  📊 Testing basic CRUD operations...');
  
  const testUserId = 999888777;
  const testConversationId = `test_db_conv_${Date.now()}`;
  
  // CREATE: Insert conversation
  const insertStart = Date.now();
  const insertQuery = `
    INSERT INTO conversations (
      id, user_id, user_message, ai_response, timestamp, response_time, 
      model_name, raw_request, message_id
    ) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?)
  `;
  
  await connection.execute(insertQuery, [
    testConversationId,
    testUserId,
    'Test CRUD message',
    'Test CRUD response',
    1500,
    'gemini-1.5-pro',
    JSON.stringify({ test: 'crud_data' }),
    123456
  ]);
  
  const insertTime = Date.now() - insertStart;
  console.log(`    ✅ INSERT: ${insertTime}ms`);
  
  if (insertTime > performanceBenchmarks.singleInsert) {
    console.log(`    ⚠️ INSERT slow: ${insertTime}ms > ${performanceBenchmarks.singleInsert}ms benchmark`);
  }
  
  // READ: Select conversation
  const selectStart = Date.now();
  const [selectResults] = await connection.execute(
    'SELECT * FROM conversations WHERE id = ?',
    [testConversationId]
  );
  const selectTime = Date.now() - selectStart;
  
  console.log(`    ✅ SELECT: ${selectTime}ms`);
  
  if (selectResults.length !== 1) {
    throw new Error(`Expected 1 result, got ${selectResults.length}`);
  }
  
  const conversation = selectResults[0];
  if (conversation.user_message !== 'Test CRUD message') {
    throw new Error('Data integrity issue: message mismatch');
  }
  
  // UPDATE: Modify conversation
  const updateStart = Date.now();
  await connection.execute(
    'UPDATE conversations SET ai_response = ? WHERE id = ?',
    ['Updated CRUD response', testConversationId]
  );
  const updateTime = Date.now() - updateStart;
  
  console.log(`    ✅ UPDATE: ${updateTime}ms`);
  
  // Verify update
  const [updateResults] = await connection.execute(
    'SELECT ai_response FROM conversations WHERE id = ?',
    [testConversationId]
  );
  
  if (updateResults[0].ai_response !== 'Updated CRUD response') {
    throw new Error('Update verification failed');
  }
  
  // DELETE: Remove conversation
  const deleteStart = Date.now();
  await connection.execute(
    'DELETE FROM conversations WHERE id = ?',
    [testConversationId]
  );
  const deleteTime = Date.now() - deleteStart;
  
  console.log(`    ✅ DELETE: ${deleteTime}ms`);
  
  // Verify deletion
  const [deleteResults] = await connection.execute(
    'SELECT * FROM conversations WHERE id = ?',
    [testConversationId]
  );
  
  if (deleteResults.length !== 0) {
    throw new Error('Delete verification failed');
  }
  
  console.log('    ✅ Basic CRUD operations test passed');
}

async function testLLMTraceMethods(connection) {
  console.log('  🤖 Testing LLM trace methods...');
  
  const sessionId = `test_db_session_${Date.now()}`;
  const conversationId = `test_db_conv_${Date.now()}`;
  
  // Test saveLLMCallTrace method equivalent
  console.log('    💾 Testing LLM trace storage...');
  
  const traces = [];
  for (let i = 1; i <= 5; i++) {
    const trace = {
      id: uuidv4(),
      session_id: sessionId,
      conversation_id: conversationId,
      call_sequence: i,
      engine_type: ['decision', 'context', 'persona', 'main_chat', 'cleanup'][i-1],
      model_name: 'gemini-1.5-pro',
      prompt: `Test prompt ${i}`,
      response: `Test response ${i}`,
      prompt_tokens: 50 + (i * 10),
      completion_tokens: 30 + (i * 5),
      total_tokens: 80 + (i * 15),
      response_time: 800 + (i * 100),
      timestamp: new Date(),
      success: i !== 3 // Make trace 3 fail for testing
    };
    
    traces.push(trace);
  }
  
  // Insert all traces
  const insertStart = Date.now();
  for (const trace of traces) {
    const query = `
      INSERT INTO llm_call_traces 
      (id, session_id, conversation_id, call_sequence, engine_type, model_name, 
       prompt, response, prompt_tokens, completion_tokens, total_tokens, 
       response_time, timestamp, success, error_message) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      trace.id, trace.session_id, trace.conversation_id, trace.call_sequence,
      trace.engine_type, trace.model_name, trace.prompt, trace.response,
      trace.prompt_tokens, trace.completion_tokens, trace.total_tokens,
      trace.response_time, trace.timestamp, trace.success,
      trace.success ? null : 'Test error message'
    ];
    
    await connection.execute(query, params);
  }
  const insertTime = Date.now() - insertStart;
  
  console.log(`    ✅ Stored ${traces.length} traces in ${insertTime}ms`);
  
  // Test getSessionLLMTraces method equivalent
  const selectStart = Date.now();
  const [sessionTraces] = await connection.execute(`
    SELECT * FROM llm_call_traces 
    WHERE session_id = ? 
    ORDER BY call_sequence ASC, timestamp ASC
  `, [sessionId]);
  const selectTime = Date.now() - selectStart;
  
  console.log(`    ✅ Retrieved session traces in ${selectTime}ms`);
  
  if (sessionTraces.length !== 5) {
    throw new Error(`Expected 5 traces, got ${sessionTraces.length}`);
  }
  
  // Verify sequence order
  for (let i = 0; i < sessionTraces.length; i++) {
    if (sessionTraces[i].call_sequence !== i + 1) {
      throw new Error(`Sequence order wrong: expected ${i + 1}, got ${sessionTraces[i].call_sequence}`);
    }
  }
  
  // Test getNextCallSequence method equivalent
  const [nextSeqResults] = await connection.execute(`
    SELECT COALESCE(MAX(call_sequence), 0) + 1 as next_sequence 
    FROM llm_call_traces 
    WHERE session_id = ?
  `, [sessionId]);
  
  const nextSequence = nextSeqResults[0].next_sequence;
  if (nextSequence !== 6) {
    throw new Error(`Expected next sequence 6, got ${nextSequence}`);
  }
  
  console.log('    ✅ Next sequence calculation correct');
  
  // Test session analysis
  const analysisStart = Date.now();
  const [analysisResults] = await connection.execute(`
    SELECT 
      session_id,
      COUNT(*) as total_calls,
      SUM(total_tokens) as total_tokens,
      AVG(response_time) as avg_response_time,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_calls,
      (SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100) as success_rate
    FROM llm_call_traces 
    WHERE session_id = ?
    GROUP BY session_id
  `, [sessionId]);
  const analysisTime = Date.now() - analysisStart;
  
  const analysis = analysisResults[0];
  console.log(`    📊 Session analysis (${analysisTime}ms):`);
  console.log(`       Total calls: ${analysis.total_calls}`);
  console.log(`       Total tokens: ${analysis.total_tokens}`);
  console.log(`       Avg response time: ${Math.round(analysis.avg_response_time)}ms`);
  console.log(`       Success rate: ${parseFloat(analysis.success_rate).toFixed(1)}%`);
  
  if (parseFloat(analysis.success_rate) < 60) {
    console.log('    ⚠️ Low success rate detected (expected with test failure)');
  }
  
  console.log('    ✅ LLM trace methods test passed');
}

async function testSessionMethods(connection) {
  console.log('  📋 Testing session management methods...');
  
  // Note: Since conversation_sessions table may not exist, we'll test the fallback methods
  
  const testUserId = 999888777;
  
  // Create some conversations for session testing
  const conversations = [];
  for (let i = 0; i < 3; i++) {
    const convId = `test_db_session_conv_${i}_${Date.now()}`;
    const conv = {
      id: convId,
      user_id: testUserId,
      user_message: `Session test message ${i + 1}`,
      ai_response: `Session test response ${i + 1}`,
      timestamp: new Date(Date.now() - (i * 3600000)), // Space out by hours
      response_time: 1000 + (i * 200),
      model_name: 'gemini-1.5-pro',
      raw_request: JSON.stringify({
        message_type: 'private',
        user_id: testUserId,
        message: `Session test message ${i + 1}`
      }),
      message_id: 200000 + i
    };
    
    conversations.push(conv);
  }
  
  // Insert conversations
  for (const conv of conversations) {
    await connection.execute(`
      INSERT INTO conversations (
        id, user_id, user_message, ai_response, timestamp, response_time, 
        model_name, raw_request, message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      conv.id, conv.user_id, conv.user_message, conv.ai_response,
      conv.timestamp, conv.response_time, conv.model_name, 
      conv.raw_request, conv.message_id
    ]);
  }
  
  // Test session retrieval fallback method
  const sessionStart = Date.now();
  const [sessionResults] = await connection.execute(`
    SELECT 
      user_id,
      COUNT(*) as message_count,
      MIN(timestamp) as created_at,
      MAX(timestamp) as last_activity
    FROM conversations
    WHERE user_id = ?
    GROUP BY user_id
    ORDER BY MAX(timestamp) DESC
  `, [testUserId]);
  const sessionTime = Date.now() - sessionStart;
  
  console.log(`    ✅ Session query executed in ${sessionTime}ms`);
  
  if (sessionResults.length === 0) {
    throw new Error('No session data found');
  }
  
  const session = sessionResults[0];
  console.log(`    📊 Session info:`);
  console.log(`       User ID: ${session.user_id}`);
  console.log(`       Message count: ${session.message_count}`);
  console.log(`       Created: ${session.created_at}`);
  console.log(`       Last activity: ${session.last_activity}`);
  
  if (session.message_count !== 3) {
    throw new Error(`Expected 3 messages, got ${session.message_count}`);
  }
  
  console.log('    ✅ Session management methods test passed');
}

async function testContextHistoryMethods(connection) {
  console.log('  📜 Testing context and history methods...');
  
  const testUserId = 999888777;
  const testGroupId = 888999111;
  
  // Test private message history
  console.log('    👤 Testing private message history...');
  
  const privateHistoryStart = Date.now();
  const [privateHistory] = await connection.execute(`
    SELECT * FROM conversations 
    WHERE user_id = ? 
      AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' 
           OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL)
    ORDER BY timestamp DESC 
    LIMIT 20
  `, [testUserId]);
  const privateHistoryTime = Date.now() - privateHistoryStart;
  
  console.log(`    ✅ Private history query: ${privateHistoryTime}ms (${privateHistory.length} messages)`);
  
  // Create some group messages for testing
  const groupConversations = [];
  for (let i = 0; i < 5; i++) {
    const convId = `test_db_group_conv_${i}_${Date.now()}`;
    const conv = {
      id: convId,
      user_id: testUserId + i, // Different users
      user_message: `Group test message ${i + 1}`,
      ai_response: `Group test response ${i + 1}`,
      timestamp: new Date(Date.now() - (i * 1800000)), // Space out by 30 mins
      response_time: 1200 + (i * 150),
      model_name: 'gemini-1.5-pro',
      raw_request: JSON.stringify({
        message_type: 'group',
        user_id: testUserId + i,
        group_id: testGroupId,
        message: `Group test message ${i + 1}`
      }),
      message_id: 300000 + i
    };
    
    groupConversations.push(conv);
  }
  
  // Insert group conversations
  for (const conv of groupConversations) {
    await connection.execute(`
      INSERT INTO conversations (
        id, user_id, user_message, ai_response, timestamp, response_time, 
        model_name, raw_request, message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      conv.id, conv.user_id, conv.user_message, conv.ai_response,
      conv.timestamp, conv.response_time, conv.model_name, 
      conv.raw_request, conv.message_id
    ]);
  }
  
  // Test group message history
  console.log('    👥 Testing group message history...');
  
  const groupHistoryStart = Date.now();
  const [groupHistory] = await connection.execute(`
    SELECT c.*, 'group' as message_type FROM conversations c
    WHERE JSON_EXTRACT(c.raw_request, '$.group_id') = ?
      AND JSON_EXTRACT(c.raw_request, '$.message_type') = 'group'
    ORDER BY c.timestamp DESC 
    LIMIT 20
  `, [testGroupId]);
  const groupHistoryTime = Date.now() - groupHistoryStart;
  
  console.log(`    ✅ Group history query: ${groupHistoryTime}ms (${groupHistory.length} messages)`);
  
  if (groupHistory.length < 5) {
    throw new Error(`Expected at least 5 group messages, got ${groupHistory.length}`);
  }
  
  // Test message context building
  console.log('    🔗 Testing message context building...');
  
  const contextStart = Date.now();
  
  // Simulate context building for a private message
  const mockPrivateMessage = {
    message_type: 'private',
    user_id: testUserId
  };
  
  const privateContextQuery = `
    SELECT * FROM conversations 
    WHERE user_id = ? 
      AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL)
    ORDER BY timestamp DESC 
    LIMIT 10
  `;
  
  const [privateContext] = await connection.execute(privateContextQuery, [testUserId]);
  
  // Simulate context building for a group message  
  const mockGroupMessage = {
    message_type: 'group',
    group_id: testGroupId
  };
  
  const groupContextQuery = `
    SELECT c.*, 'group' as message_type FROM conversations c
    WHERE JSON_EXTRACT(c.raw_request, '$.group_id') = ?
      AND JSON_EXTRACT(c.raw_request, '$.message_type') = 'group'
    ORDER BY c.timestamp DESC 
    LIMIT 10
  `;
  
  const [groupContext] = await connection.execute(groupContextQuery, [testGroupId]);
  const contextTime = Date.now() - contextStart;
  
  console.log(`    ✅ Context building: ${contextTime}ms`);
  console.log(`       Private context: ${privateContext.length} messages`);
  console.log(`       Group context: ${groupContext.length} messages`);
  
  console.log('    ✅ Context and history methods test passed');
}

async function testQueryPerformance(connection) {
  console.log('  ⚡ Testing query performance...');
  
  const performanceTests = [
    {
      name: 'Simple conversation lookup',
      query: 'SELECT * FROM conversations WHERE user_id = ? LIMIT 10',
      params: [999888777],
      benchmark: 50
    },
    {
      name: 'LLM trace aggregation',
      query: `
        SELECT 
          session_id, 
          COUNT(*) as calls, 
          SUM(total_tokens) as tokens,
          AVG(response_time) as avg_time
        FROM llm_call_traces 
        WHERE session_id LIKE 'test_db_%'
        GROUP BY session_id
      `,
      params: [],
      benchmark: 200
    },
    {
      name: 'Complex join query',
      query: `
        SELECT 
          c.id, c.user_message, c.ai_response,
          COUNT(lct.id) as trace_count,
          SUM(lct.total_tokens) as total_tokens
        FROM conversations c
        LEFT JOIN llm_call_traces lct ON c.id = lct.conversation_id
        WHERE c.user_id = ?
        GROUP BY c.id
        ORDER BY c.timestamp DESC
        LIMIT 5
      `,
      params: [999888777],
      benchmark: 300
    },
    {
      name: 'JSON field query',
      query: `
        SELECT * FROM conversations 
        WHERE JSON_EXTRACT(raw_request, '$.message_type') = ?
        ORDER BY timestamp DESC 
        LIMIT 20
      `,
      params: ['private'],
      benchmark: 400
    }
  ];
  
  for (const test of performanceTests) {
    const start = Date.now();
    const [results] = await connection.execute(test.query, test.params);
    const duration = Date.now() - start;
    
    console.log(`    ${test.name}: ${duration}ms (${results.length} rows)`);
    
    if (duration > test.benchmark) {
      console.log(`      ⚠️ Performance concern: ${duration}ms > ${test.benchmark}ms benchmark`);
    } else {
      console.log(`      ✅ Performance good: ${duration}ms <= ${test.benchmark}ms`);
    }
  }
  
  console.log('  ✅ Query performance tests completed');
}

async function testAggregationQueries(connection) {
  console.log('  📊 Testing complex aggregation queries...');
  
  // Test daily statistics
  console.log('    📈 Testing daily statistics...');
  
  const dailyStatsStart = Date.now();
  const [dailyStats] = await connection.execute(`
    SELECT 
      DATE(timestamp) as date,
      COUNT(*) as conversation_count,
      COUNT(DISTINCT user_id) as unique_users,
      AVG(response_time) as avg_response_time,
      SUM(CASE WHEN JSON_EXTRACT(raw_request, '$.message_type') = 'private' THEN 1 ELSE 0 END) as private_messages,
      SUM(CASE WHEN JSON_EXTRACT(raw_request, '$.message_type') = 'group' THEN 1 ELSE 0 END) as group_messages
    FROM conversations 
    WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    GROUP BY DATE(timestamp)
    ORDER BY date DESC
  `);
  const dailyStatsTime = Date.now() - dailyStatsStart;
  
  console.log(`    ✅ Daily stats query: ${dailyStatsTime}ms (${dailyStats.length} days)`);
  
  if (dailyStatsTime > performanceBenchmarks.aggregation) {
    console.log(`    ⚠️ Aggregation slow: ${dailyStatsTime}ms > ${performanceBenchmarks.aggregation}ms`);
  }
  
  // Test user activity aggregation
  console.log('    👤 Testing user activity aggregation...');
  
  const userStatsStart = Date.now();
  const [userStats] = await connection.execute(`
    SELECT 
      user_id,
      COUNT(*) as message_count,
      MIN(timestamp) as first_message,
      MAX(timestamp) as last_message,
      AVG(response_time) as avg_response_time,
      COUNT(DISTINCT DATE(timestamp)) as active_days
    FROM conversations 
    WHERE user_id IN (999888777, 999888778, 999888779, 999888780, 999888781)
    GROUP BY user_id
    HAVING message_count > 0
    ORDER BY message_count DESC
  `);
  const userStatsTime = Date.now() - userStatsStart;
  
  console.log(`    ✅ User stats query: ${userStatsTime}ms (${userStats.length} users)`);
  
  // Test LLM token usage aggregation
  console.log('    🤖 Testing LLM token usage aggregation...');
  
  const tokenStatsStart = Date.now();
  const [tokenStats] = await connection.execute(`
    SELECT 
      engine_type,
      model_name,
      COUNT(*) as call_count,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens,
      SUM(total_tokens) as total_tokens,
      AVG(response_time) as avg_response_time,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100 as success_rate
    FROM llm_call_traces 
    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY engine_type, model_name
    ORDER BY total_tokens DESC
  `);
  const tokenStatsTime = Date.now() - tokenStatsStart;
  
  console.log(`    ✅ Token stats query: ${tokenStatsTime}ms (${tokenStats.length} engine-model combinations)`);
  
  if (tokenStats.length > 0) {
    console.log('    📊 Token usage summary:');
    tokenStats.forEach(row => {
      const costEstimate = (row.total_tokens / 1000) * 0.003; // Rough estimate
      console.log(`       ${row.engine_type}/${row.model_name}: ${row.total_tokens} tokens (~$${costEstimate.toFixed(4)})`);
    });
  }
  
  console.log('    ✅ Complex aggregation queries test passed');
}

async function testDataIntegrity(connection) {
  console.log('  🔒 Testing data integrity and constraints...');
  
  // Test foreign key relationships (if they exist)
  console.log('    🔗 Testing referential integrity...');
  
  const integrityQueries = [
    {
      name: 'Orphaned LLM traces',
      query: `
        SELECT lct.id, lct.conversation_id 
        FROM llm_call_traces lct 
        LEFT JOIN conversations c ON lct.conversation_id = c.id 
        WHERE lct.conversation_id IS NOT NULL AND c.id IS NULL
        LIMIT 5
      `,
      shouldBeEmpty: true
    },
    {
      name: 'Invalid JSON in raw_request',
      query: `
        SELECT id, user_id 
        FROM conversations 
        WHERE raw_request IS NOT NULL 
          AND NOT JSON_VALID(raw_request)
        LIMIT 5
      `,
      shouldBeEmpty: true
    },
    {
      name: 'Negative response times',
      query: `
        SELECT id, response_time 
        FROM conversations 
        WHERE response_time < 0
        LIMIT 5
      `,
      shouldBeEmpty: true
    },
    {
      name: 'Invalid call sequences',
      query: `
        SELECT session_id, COUNT(*) as count, MIN(call_sequence) as min_seq, MAX(call_sequence) as max_seq
        FROM llm_call_traces 
        GROUP BY session_id
        HAVING min_seq != 1 OR max_seq != COUNT(*)
        LIMIT 5
      `,
      shouldBeEmpty: true
    }
  ];
  
  for (const test of integrityQueries) {
    const start = Date.now();
    const [results] = await connection.execute(test.query);
    const duration = Date.now() - start;
    
    console.log(`    ${test.name}: ${duration}ms`);
    
    if (test.shouldBeEmpty && results.length > 0) {
      console.log(`      ⚠️ Data integrity issue: found ${results.length} problematic records`);
      if (results.length <= 3) {
        console.log('      Sample records:', results);
      }
    } else {
      console.log(`      ✅ No integrity issues found`);
    }
  }
  
  // Test data type constraints
  console.log('    📏 Testing data type constraints...');
  
  try {
    // Try to insert invalid data
    await connection.execute(`
      INSERT INTO conversations (
        id, user_id, user_message, ai_response, timestamp, response_time, 
        model_name, message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'test_invalid_data',
      'not_a_number', // This should fail if user_id is properly typed
      'Test message',
      'Test response',
      new Date(),
      1000,
      'test-model',
      12345
    ]);
    
    console.log('    ⚠️ Invalid data was accepted (weak type constraints)');
    
    // Clean up
    await connection.execute('DELETE FROM conversations WHERE id = ?', ['test_invalid_data']);
    
  } catch (error) {
    console.log('    ✅ Data type constraints working (invalid data rejected)');
  }
  
  console.log('    ✅ Data integrity tests completed');
}

async function testBatchOperations(connection) {
  console.log('  🔄 Testing batch operations...');
  
  // Test batch LLM trace insertion
  console.log('    📦 Testing batch LLM trace insertion...');
  
  const batchSize = 50;
  const sessionId = `test_db_batch_${Date.now()}`;
  
  const batchStart = Date.now();
  
  const batchQuery = `
    INSERT INTO llm_call_traces 
    (id, session_id, conversation_id, call_sequence, engine_type, model_name, 
     prompt, response, prompt_tokens, completion_tokens, total_tokens, 
     response_time, timestamp, success) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
  `;
  
  for (let i = 1; i <= batchSize; i++) {
    const params = [
      uuidv4(),
      sessionId,
      `batch_conv_${i}`,
      i % 5 + 1, // Cycle through sequences 1-5
      ['decision', 'context', 'persona', 'main_chat', 'cleanup'][i % 5],
      'gemini-1.5-pro',
      `Batch prompt ${i}`,
      `Batch response ${i}`,
      50 + (i % 100),
      30 + (i % 50),
      80 + (i % 150),
      800 + (i % 1000),
      true
    ];
    
    await connection.execute(batchQuery, params);
  }
  
  const batchTime = Date.now() - batchStart;
  console.log(`    ✅ Batch insert: ${batchSize} records in ${batchTime}ms (${(batchTime/batchSize).toFixed(1)}ms per record)`);
  
  if (batchTime > performanceBenchmarks.batchInsert) {
    console.log(`    ⚠️ Batch operation slow: ${batchTime}ms > ${performanceBenchmarks.batchInsert}ms benchmark`);
  }
  
  // Verify batch insertion
  const [verifyResults] = await connection.execute(`
    SELECT COUNT(*) as count FROM llm_call_traces WHERE session_id = ?
  `, [sessionId]);
  
  if (verifyResults[0].count !== batchSize) {
    throw new Error(`Batch insert failed: expected ${batchSize}, got ${verifyResults[0].count}`);
  }
  
  // Test batch cleanup
  console.log('    🗑️ Testing batch cleanup...');
  
  const cleanupStart = Date.now();
  await connection.execute(`DELETE FROM llm_call_traces WHERE session_id = ?`, [sessionId]);
  const cleanupTime = Date.now() - cleanupStart;
  
  console.log(`    ✅ Batch cleanup: ${batchSize} records in ${cleanupTime}ms`);
  
  console.log('    ✅ Batch operations test passed');
}

if (require.main === module) {
  testDatabaseOperations().catch(error => {
    console.error('Database operations test failed:', error);
    process.exit(1);
  });
}

module.exports = { testDatabaseOperations };