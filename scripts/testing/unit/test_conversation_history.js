// Test script to simulate user message via OneBot API
// This will trigger conversation history retrieval and LLM processing

const http = require('http');

// Simulate a private message from authorized user
const messageData = {
  self_id: 1129974489,
  user_id: 85178516, // Authorized user ID
  time: Math.floor(Date.now() / 1000),
  message_id: Math.floor(Math.random() * 1000000000),
  message_seq: Math.floor(Math.random() * 1000000000),
  real_id: Math.floor(Math.random() * 1000000000),
  real_seq: Math.floor(Math.random() * 1000).toString(),
  message_type: "private",
  sender: {
    user_id: 85178516,
    nickname: "测试用户",
    card: ""
  },
  raw_message: "测试对话历史功能，请检查是否能获取到历史记录",
  font: 14,
  sub_type: "friend",
  message: [
    {
      type: "text",
      data: {
        text: "测试对话历史功能，请检查是否能获取到历史记录"
      }
    }
  ],
  message_format: "array",
  post_type: "message",
  target_id: 85178516
};

const postData = JSON.stringify(messageData);

const options = {
  hostname: 'localhost',
  port: 8081,
  path: '/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('🧪 Sending test message to simulate conversation history...');
console.log('📝 Test message:', messageData.raw_message);
console.log('👤 From user:', messageData.user_id);

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('\n✅ Response from QQ Bot:');
    console.log('Status Code:', res.statusCode);
    console.log('Response Body:', data);
    console.log('\n🔍 You can now check the debug interface:');
    console.log('curl http://localhost:8081/api/debug/conversations');
    console.log('\n📋 Check bot logs for conversation history retrieval:');
    console.log('tail -f modules/qqbot-core/logs/main_2025-09-08.log');
  });
});

req.on('error', (e) => {
  console.error('❌ Request failed:', e.message);
});

req.write(postData);
req.end();