#!/usr/bin/env node

const mysql = require('mysql2/promise');

async function testPrivateMessageQuery() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'qqbot_user',
    password: 'qqbot_password',
    database: 'qqbot_db',
    charset: 'utf8mb4',
    timezone: '+08:00'
  });

  try {
    console.log('Testing fixed private message history query...');
    
    const connection = await pool.getConnection();
    
    // Set UTF-8 charset
    await connection.execute("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    
    // Test the fixed query with proper parameter binding
    const userId = 123456789; // Test user ID
    const safeLimit = 20;
    
    const query = `SELECT * FROM conversations WHERE user_id = ? AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' OR raw_request IS NULL OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL) ORDER BY timestamp DESC LIMIT ?`;
    
    console.log('Executing query:', query);
    console.log('Parameters:', [userId, safeLimit]);
    
    const startTime = Date.now();
    const [rows] = await connection.execute(query, [userId, safeLimit]);
    const duration = Date.now() - startTime;
    
    console.log(`✅ Query executed successfully in ${duration}ms`);
    console.log(`📊 Found ${rows.length} conversation records`);
    
    // Test with the old broken query for comparison
    try {
      const brokenQuery = `SELECT * FROM conversations WHERE user_id = ? AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' OR raw_request IS NULL OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL) ORDER BY timestamp DESC LIMIT ${safeLimit}`;
      console.log('\nTesting broken query for comparison...');
      await connection.execute(brokenQuery, [userId]);
      console.log('❌ Broken query should have failed but didn\'t!');
    } catch (brokenError) {
      console.log('✅ Confirmed broken query fails:', brokenError.code);
    }
    
    connection.release();
    
  } catch (error) {
    console.error('❌ Test failed:', error.code, error.message);
  } finally {
    await pool.end();
  }
}

testPrivateMessageQuery();