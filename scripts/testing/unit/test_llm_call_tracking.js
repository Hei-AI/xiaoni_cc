#!/usr/bin/env node

/**
 * Test Script: LLM Call Tracking Testing  
 * Tests the LLM trace creation, storage, session-level aggregation,
 * cost calculation, token tracking, and trace linkage
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

// Mock LLM call data
const testLLMCalls = [
  {
    id: uuidv4(),
    session_id: 'test_session_123',
    conversation_id: 'test_conv_456',
    call_sequence: 1,
    engine_type: 'decision',
    model_name: 'gemini-1.5-pro',
    prompt: '分析这条消息是否需要回复：你好',
    response: '{"shouldReply": true, "confidence": 0.9}',
    prompt_tokens: 25,
    completion_tokens: 15,
    total_tokens: 40,
    response_time: 850,
    timestamp: new Date(),
    success: true
  },
  {
    id: uuidv4(),
    session_id: 'test_session_123',
    conversation_id: 'test_conv_456',
    call_sequence: 2,
    engine_type: 'context',
    model_name: 'gemini-1.5-pro',
    prompt: '基于历史消息分析用户意图...',
    response: 'User is greeting the bot, casual conversation context',
    prompt_tokens: 150,
    completion_tokens: 80,
    total_tokens: 230,
    response_time: 1200,
    timestamp: new Date(),
    success: true
  },
  {
    id: uuidv4(),
    session_id: 'test_session_123',
    conversation_id: 'test_conv_456',
    call_sequence: 3,
    engine_type: 'persona',
    model_name: 'gemini-1.5-pro',
    prompt: '根据用户关系调整回复风格...',
    response: 'Use friendly casual tone for new user',
    prompt_tokens: 80,
    completion_tokens: 40,
    total_tokens: 120,
    response_time: 750,
    timestamp: new Date(),
    success: true
  },
  {
    id: uuidv4(),
    session_id: 'test_session_123',
    conversation_id: 'test_conv_456',
    call_sequence: 4,
    engine_type: 'main_chat',
    model_name: 'gemini-1.5-pro',
    prompt: '你是一个智能QQ机器人助手...\n\n用户消息：你好',
    response: '你好！很高兴见到你。我是智能QQ机器人助手，有什么可以帮助你的吗？',
    prompt_tokens: 200,
    completion_tokens: 60,
    total_tokens: 260,
    response_time: 1500,
    timestamp: new Date(),
    success: true
  },
  // Failed call example
  {
    id: uuidv4(),
    session_id: 'test_session_456',
    conversation_id: 'test_conv_789',
    call_sequence: 1,
    engine_type: 'decision',
    model_name: 'gemini-1.5-pro',
    prompt: 'Test prompt that will fail',
    response: null,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    response_time: 5000,
    timestamp: new Date(),
    success: false,
    error_message: 'API rate limit exceeded'
  }
];

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
  console.log('\n🧹 Cleaning up LLM trace test data...');
  
  // Delete test traces
  await connection.execute(`
    DELETE FROM llm_call_traces 
    WHERE session_id LIKE 'test_session_%'
  `);
  
  // Delete test conversations
  await connection.execute(`
    DELETE FROM conversations 
    WHERE id LIKE 'test_conv_%'
  `);
  
  console.log('✅ Test data cleaned up');
}

async function testLLMCallTracking() {
  let connection;
  
  try {
    console.log('🚀 Starting LLM Call Tracking Testing...\n');
    
    connection = await connectDB();
    console.log('✅ Database connected successfully');
    
    // Cleanup existing test data
    await cleanupTestData(connection);
    
    // Test 1: LLM Trace Creation and Storage
    console.log('\n📝 Test 1: LLM Trace Creation and Storage');
    await testLLMTraceStorage(connection);
    
    // Test 2: Session-Level LLM Call Aggregation
    console.log('\n📝 Test 2: Session-Level LLM Call Aggregation');
    await testSessionLLMAggregation(connection);
    
    // Test 3: Cost Calculation and Token Tracking
    console.log('\n📝 Test 3: Cost Calculation and Token Tracking');
    await testCostCalculation(connection);
    
    // Test 4: Trace Linkage to Conversations
    console.log('\n📝 Test 4: Trace Linkage to Conversations and Sessions');
    await testTraceLinkage(connection);
    
    // Test 5: Call Sequence Management
    console.log('\n📝 Test 5: Call Sequence Management');
    await testCallSequence(connection);
    
    // Test 6: Error Handling and Failed Calls
    console.log('\n📝 Test 6: Error Handling and Failed Calls');
    await testErrorHandling(connection);
    
    // Test 7: Performance and Query Optimization
    console.log('\n📝 Test 7: Performance and Query Optimization');
    await testPerformance(connection);
    
    console.log('\n🎉 All LLM call tracking tests completed!');
    
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

async function testLLMTraceStorage(connection) {
  console.log('  💾 Testing LLM trace storage...');
  
  // Store all test traces
  for (const trace of testLLMCalls) {
    const query = `
      INSERT INTO llm_call_traces 
      (id, session_id, conversation_id, call_sequence, engine_type, model_name, 
       prompt, response, prompt_tokens, completion_tokens, total_tokens, 
       response_time, timestamp, success, error_message) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      trace.id,
      trace.session_id,
      trace.conversation_id || null,
      trace.call_sequence,
      trace.engine_type,
      trace.model_name || null,
      trace.prompt || null,
      trace.response || null,
      trace.prompt_tokens || 0,
      trace.completion_tokens || 0,
      trace.total_tokens || 0,
      trace.response_time,
      trace.timestamp,
      trace.success,
      trace.error_message || null
    ];
    
    await connection.execute(query, params);
  }
  
  // Verify storage
  const [results] = await connection.execute(`
    SELECT COUNT(*) as count FROM llm_call_traces 
    WHERE session_id LIKE 'test_session_%'
  `);
  
  const storedCount = results[0].count;
  if (storedCount !== testLLMCalls.length) {
    throw new Error(`Expected ${testLLMCalls.length} traces, found ${storedCount}`);
  }
  
  console.log(`  ✅ Successfully stored ${storedCount} LLM traces`);
}

async function testSessionLLMAggregation(connection) {
  console.log('  📊 Testing session-level LLM aggregation...');
  
  // Test aggregation queries
  const sessionAnalysisQuery = `
    SELECT 
      session_id,
      COUNT(*) as total_calls,
      SUM(total_tokens) as total_tokens,
      SUM(response_time) as total_response_time,
      AVG(response_time) as avg_response_time,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_calls,
      COUNT(DISTINCT engine_type) as unique_engines
    FROM llm_call_traces 
    WHERE session_id = 'test_session_123'
    GROUP BY session_id
  `;
  
  const [sessionResults] = await connection.execute(sessionAnalysisQuery);
  const sessionData = sessionResults[0];
  
  // Verify aggregation data
  const expectedCalls = testLLMCalls.filter(c => c.session_id === 'test_session_123').length;
  if (sessionData.total_calls !== expectedCalls) {
    throw new Error(`Expected ${expectedCalls} calls, found ${sessionData.total_calls}`);
  }
  
  const expectedTokens = testLLMCalls
    .filter(c => c.session_id === 'test_session_123')
    .reduce((sum, c) => sum + c.total_tokens, 0);
  
  // Convert to numbers for comparison to handle potential string/number issues from MySQL
  const expectedNum = Number(expectedTokens);
  const actualNum = Number(sessionData.total_tokens);
  
  if (actualNum !== expectedNum) {
    throw new Error(`Token count mismatch: Expected ${expectedNum} tokens, found ${actualNum}`);
  }
  
  console.log(`  ✅ Session aggregation correct: ${sessionData.total_calls} calls, ${sessionData.total_tokens} tokens`);
  
  // Test engine breakdown
  const engineBreakdownQuery = `
    SELECT 
      engine_type,
      COUNT(*) as call_count,
      SUM(total_tokens) as tokens_used,
      AVG(response_time) as avg_response_time
    FROM llm_call_traces 
    WHERE session_id = 'test_session_123'
    GROUP BY engine_type
    ORDER BY call_count DESC
  `;
  
  const [engineResults] = await connection.execute(engineBreakdownQuery);
  console.log('  📈 Engine breakdown:');
  engineResults.forEach(row => {
    console.log(`    ${row.engine_type}: ${row.call_count} calls, ${row.tokens_used} tokens, ${Math.round(row.avg_response_time)}ms avg`);
  });
  
  console.log('  ✅ Engine breakdown analysis passed');
}

async function testCostCalculation(connection) {
  console.log('  💰 Testing cost calculation and token tracking...');
  
  // Calculate costs based on token usage
  const costAnalysisQuery = `
    SELECT 
      session_id,
      engine_type,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens,
      SUM(total_tokens) as total_tokens,
      COUNT(*) as call_count
    FROM llm_call_traces 
    WHERE session_id LIKE 'test_session_%' AND success = 1
    GROUP BY session_id, engine_type
    ORDER BY session_id, total_tokens DESC
  `;
  
  const [costResults] = await connection.execute(costAnalysisQuery);
  
  let totalEstimatedCost = 0;
  
  console.log('  📊 Token usage and cost estimation:');
  costResults.forEach(row => {
    // Gemini 1.5 Pro pricing (example rates)
    const inputCost = (row.total_prompt_tokens / 1000) * 0.00125; // $0.00125 per 1K input tokens
    const outputCost = (row.total_completion_tokens / 1000) * 0.005; // $0.005 per 1K output tokens
    const engineCost = inputCost + outputCost;
    totalEstimatedCost += engineCost;
    
    console.log(`    ${row.session_id}:${row.engine_type} - ${row.call_count} calls, ${row.total_tokens} tokens, ~$${engineCost.toFixed(4)}`);
  });
  
  console.log(`  💵 Total estimated cost: ~$${totalEstimatedCost.toFixed(4)}`);
  
  // Test token efficiency
  const efficiencyQuery = `
    SELECT 
      engine_type,
      AVG(total_tokens) as avg_tokens_per_call,
      AVG(response_time) as avg_response_time,
      AVG(total_tokens / response_time * 1000) as tokens_per_second
    FROM llm_call_traces 
    WHERE success = 1 AND response_time > 0
    GROUP BY engine_type
  `;
  
  const [efficiencyResults] = await connection.execute(efficiencyQuery);
  
  console.log('  ⚡ Engine efficiency metrics:');
  efficiencyResults.forEach(row => {
    console.log(`    ${row.engine_type}: ${Math.round(row.avg_tokens_per_call)} avg tokens, ${Math.round(row.avg_response_time)}ms, ${parseFloat(row.tokens_per_second).toFixed(2)} tokens/sec`);
  });
  
  console.log('  ✅ Cost calculation and tracking tests passed');
}

async function testTraceLinkage(connection) {
  console.log('  🔗 Testing trace linkage to conversations and sessions...');
  
  // Create test conversations linked to traces
  const testConversations = [
    {
      id: 'test_conv_456',
      user_id: 123456789,
      user_message: '你好',
      ai_response: '你好！很高兴见到你。我是智能QQ机器人助手，有什么可以帮助你的吗？',
      timestamp: new Date(),
      response_time: 3300, // Sum of all response times for this conversation
      model_name: 'gemini-1.5-pro',
      raw_request: JSON.stringify({
        message_type: 'private',
        user_id: 123456789,
        message: '你好'
      }),
      message_id: 12345
    },
    {
      id: 'test_conv_789',
      user_id: 987654321,
      user_message: 'Test message that failed',
      ai_response: 'Sorry, I encountered an error processing your request.',
      timestamp: new Date(),
      response_time: 5000,
      model_name: 'gemini-1.5-pro',
      raw_request: JSON.stringify({
        message_type: 'private',
        user_id: 987654321,
        message: 'Test message that failed'
      }),
      message_id: 54321
    }
  ];
  
  // Insert test conversations
  for (const conv of testConversations) {
    const query = `
      INSERT INTO conversations (
        id, user_id, user_message, ai_response, timestamp, response_time, 
        model_name, raw_request, message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await connection.execute(query, [
      conv.id, conv.user_id, conv.user_message, conv.ai_response,
      conv.timestamp, conv.response_time, conv.model_name, 
      conv.raw_request, conv.message_id
    ]);
  }
  
  // Test trace-to-conversation linking
  const linkageQuery = `
    SELECT 
      c.id as conversation_id,
      c.user_message,
      c.ai_response,
      COUNT(lct.id) as trace_count,
      SUM(lct.total_tokens) as total_tokens,
      SUM(lct.response_time) as total_llm_time,
      c.response_time as conversation_response_time
    FROM conversations c
    LEFT JOIN llm_call_traces lct ON c.id = lct.conversation_id
    WHERE c.id LIKE 'test_conv_%'
    GROUP BY c.id
    ORDER BY c.timestamp DESC
  `;
  
  const [linkageResults] = await connection.execute(linkageQuery);
  
  console.log('  🔍 Conversation-trace linkage results:');
  linkageResults.forEach(row => {
    console.log(`    Conversation ${row.conversation_id}:`);
    console.log(`      Message: "${row.user_message}"`);
    console.log(`      LLM Traces: ${row.trace_count}`);
    console.log(`      Total Tokens: ${row.total_tokens || 0}`);
    console.log(`      LLM Time: ${row.total_llm_time || 0}ms`);
    console.log(`      Total Response Time: ${row.conversation_response_time}ms`);
  });
  
  // Verify specific conversation has all expected traces
  const conv456Traces = testLLMCalls.filter(t => t.conversation_id === 'test_conv_456');
  const conv456Result = linkageResults.find(r => r.conversation_id === 'test_conv_456');
  
  if (conv456Result.trace_count !== conv456Traces.length) {
    throw new Error(`Expected ${conv456Traces.length} traces for conv_456, found ${conv456Result.trace_count}`);
  }
  
  console.log('  ✅ Trace linkage verification passed');
}

async function testCallSequence(connection) {
  console.log('  🔢 Testing call sequence management...');
  
  // Test sequence ordering
  const sequenceQuery = `
    SELECT session_id, call_sequence, engine_type, timestamp
    FROM llm_call_traces 
    WHERE session_id = 'test_session_123'
    ORDER BY call_sequence ASC
  `;
  
  const [sequenceResults] = await connection.execute(sequenceQuery);
  
  // Verify sequence is correct
  const expectedSequence = ['decision', 'context', 'persona', 'main_chat'];
  
  for (let i = 0; i < sequenceResults.length; i++) {
    const result = sequenceResults[i];
    
    if (result.call_sequence !== i + 1) {
      throw new Error(`Expected sequence ${i + 1}, found ${result.call_sequence}`);
    }
    
    if (result.engine_type !== expectedSequence[i]) {
      throw new Error(`Expected engine ${expectedSequence[i]}, found ${result.engine_type}`);
    }
  }
  
  console.log('  ✅ Call sequence ordering verified');
  
  // Test next sequence number calculation
  const nextSequenceQuery = `
    SELECT COALESCE(MAX(call_sequence), 0) + 1 as next_sequence 
    FROM llm_call_traces 
    WHERE session_id = 'test_session_123'
  `;
  
  const [nextResults] = await connection.execute(nextSequenceQuery);
  const nextSequence = nextResults[0].next_sequence;
  
  if (nextSequence !== 5) { // Should be 5 after 4 existing calls
    throw new Error(`Expected next sequence 5, found ${nextSequence}`);
  }
  
  console.log('  ✅ Next sequence calculation correct');
}

async function testErrorHandling(connection) {
  console.log('  ❌ Testing error handling and failed calls...');
  
  // Query failed calls
  const errorQuery = `
    SELECT session_id, engine_type, error_message, success, response_time
    FROM llm_call_traces 
    WHERE success = 0
  `;
  
  const [errorResults] = await connection.execute(errorQuery);
  
  if (errorResults.length === 0) {
    throw new Error('No failed calls found, but we inserted one');
  }
  
  const failedCall = errorResults[0];
  if (!failedCall.error_message) {
    throw new Error('Failed call missing error message');
  }
  
  console.log(`  ⚠️ Found ${errorResults.length} failed call(s):`);
  errorResults.forEach(row => {
    console.log(`    ${row.session_id}:${row.engine_type} - ${row.error_message}`);
  });
  
  // Test success rate calculation
  const successRateQuery = `
    SELECT 
      session_id,
      COUNT(*) as total_calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_calls,
      (SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100) as success_rate
    FROM llm_call_traces 
    GROUP BY session_id
  `;
  
  const [successResults] = await connection.execute(successRateQuery);
  
  console.log('  📊 Success rates by session:');
  successResults.forEach(row => {
    console.log(`    ${row.session_id}: ${parseFloat(row.success_rate).toFixed(1)}% (${row.successful_calls}/${row.total_calls})`);
  });
  
  console.log('  ✅ Error handling tests passed');
}

async function testPerformance(connection) {
  console.log('  ⚡ Testing performance and query optimization...');
  
  const startTime = Date.now();
  
  // Test complex aggregation query performance
  const complexQuery = `
    SELECT 
      DATE(timestamp) as date,
      engine_type,
      COUNT(*) as call_count,
      SUM(total_tokens) as total_tokens,
      AVG(response_time) as avg_response_time,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*) * 100 as success_rate
    FROM llm_call_traces 
    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY DATE(timestamp), engine_type
    ORDER BY date DESC, total_tokens DESC
  `;
  
  const [performanceResults] = await connection.execute(complexQuery);
  const queryTime = Date.now() - startTime;
  
  console.log(`  ⏱️ Complex aggregation query executed in ${queryTime}ms`);
  console.log(`  📈 Query returned ${performanceResults.length} result rows`);
  
  // Test index effectiveness (if indexes exist)
  const explainQuery = `EXPLAIN ${complexQuery}`;
  try {
    const [explainResults] = await connection.execute(explainQuery);
    console.log('  🔍 Query execution plan:');
    explainResults.forEach((row, idx) => {
      console.log(`    ${idx + 1}. ${row.select_type} on ${row.table} (${row.type})`);
    });
  } catch (error) {
    console.log('  ℹ️ EXPLAIN query not available');
  }
  
  if (queryTime > 1000) {
    console.log('  ⚠️ Query took longer than 1 second - consider adding indexes');
  }
  
  console.log('  ✅ Performance tests completed');
}

if (require.main === module) {
  testLLMCallTracking().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { testLLMCallTracking };