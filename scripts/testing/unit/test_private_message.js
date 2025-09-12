#!/usr/bin/env node

// Simulate private message to test the context building
const WebSocket = require('ws');

function sendTestPrivateMessage() {
  // Simulate the private message that was causing issues
  const testMessage = {
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: Date.now(),
    user_id: 85178516, // Same user ID from the logs
    message: '我们之前说到哪了 debug test',
    raw_message: '我们之前说到哪了 debug test',
    font: 0,
    sender: {
      user_id: 85178516,
      nickname: 'TestUser',
      sex: 'unknown',
      age: 0
    },
    time: Math.floor(Date.now() / 1000)
  };

  console.log('Sending test private message to bot at ws://localhost:8081/ws');
  console.log('Message:', JSON.stringify(testMessage, null, 2));

  // Don't actually send via WebSocket since it's complex to set up
  // Instead, let's directly call the QQBot Core API
  const http = require('http');
  
  const postData = JSON.stringify(testMessage);
  
  const options = {
    hostname: 'localhost',
    port: 8081,
    path: '/api/test/private-message',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    res.on('data', (chunk) => {
      console.log('Response:', chunk.toString());
    });
  });

  req.on('error', (e) => {
    console.error(`Request error: ${e.message}`);
    console.log('This is expected since the endpoint might not exist. Check logs instead.');
  });

  req.write(postData);
  req.end();
  
  console.log('Test message sent. Check the qqbot-core logs for debugging output.');
}

setTimeout(sendTestPrivateMessage, 2000);