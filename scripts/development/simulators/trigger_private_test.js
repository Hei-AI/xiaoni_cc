#!/usr/bin/env node

const http = require('http');

// Test the API endpoint to simulate a private message
function testPrivateMessage() {
  const testData = {
    post_type: 'message',
    message_type: 'private',
    message_id: Date.now(),
    user_id: 85178516,
    message: 'DEBUG测试消息 - 我们之前说到哪了',
    raw_message: 'DEBUG测试消息 - 我们之前说到哪了',
    sender: {
      user_id: 85178516,
      nickname: 'DebugUser',
      sex: 'unknown',
      age: 0
    },
    time: Math.floor(Date.now() / 1000)
  };

  const postData = JSON.stringify(testData);

  const options = {
    hostname: 'localhost',
    port: 8081,
    path: '/api/simulate/private-message', // Test endpoint
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 5000 // 5 second timeout
  };

  console.log('🧪 Sending test private message to provider-service simulator...');
  
  const req = http.request(options, (res) => {
    console.log(`✅ Response Status: ${res.statusCode}`);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('📋 Response:', data || 'No response body');
      console.log('📋 Check provider logs with: docker logs -f qqbot-provider-service');
    });
  });

  req.on('error', (e) => {
    console.error(`❌ Request error: ${e.message}`);
    console.log('💡 This might be expected if the simulate endpoint doesn\'t exist');
    console.log('📋 Try checking logs for manual message testing instead');
  });

  req.on('timeout', () => {
    console.error('⏱️  Request timed out after 5 seconds');
    req.destroy();
  });

  req.write(postData);
  req.end();
}

// Wait a moment for service to initialize, then test
setTimeout(testPrivateMessage, 2000);
