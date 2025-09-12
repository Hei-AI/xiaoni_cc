#!/usr/bin/env node

const mysql = require('mysql2/promise');

async function testCorrectedQueries() {
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
    console.log('Testing corrected database queries...');
    
    const connection = await pool.getConnection();
    
    // Set UTF-8 charset
    await connection.execute("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    
    // Test private message query
    const userId = 123456789;
    const safeLimit = 20;
    
    const privateQuery = `SELECT * FROM conversations WHERE user_id = ? AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' OR raw_request IS NULL OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL) ORDER BY timestamp DESC LIMIT ${safeLimit}`;
    
    console.log('Testing private message query...');
    console.log('Query:', privateQuery);
    console.log('Parameters:', [userId]);
    
    const startTime = Date.now();
    const [privateRows] = await connection.execute(privateQuery, [userId]);
    const privateDuration = Date.now() - startTime;
    
    console.log(`✅ Private query executed successfully in ${privateDuration}ms`);
    console.log(`📊 Found ${privateRows.length} private conversation records`);
    
    // Test group message query  
    const groupId = 987654321;
    const groupQuery = `
      SELECT c.*, 'group' as message_type FROM conversations c
      WHERE JSON_EXTRACT(c.raw_request, '$.group_id') = ?
        AND JSON_EXTRACT(c.raw_request, '$.message_type') = 'group'
      ORDER BY c.timestamp DESC 
      LIMIT ${safeLimit}
    `;
    
    console.log('\nTesting group message query...');
    console.log('Query:', groupQuery.replace(/\s+/g, ' ').trim());
    console.log('Parameters:', [groupId]);
    
    const groupStartTime = Date.now();
    const [groupRows] = await connection.execute(groupQuery, [groupId]);
    const groupDuration = Date.now() - groupStartTime;
    
    console.log(`✅ Group query executed successfully in ${groupDuration}ms`);
    console.log(`📊 Found ${groupRows.length} group conversation records`);
    
    // Test complete context building simulation
    console.log('\nTesting buildUserInfo query...');
    const userStatsQuery = 'SELECT COUNT(*) as message_count FROM conversations WHERE user_id = ?';
    const [userStats] = await connection.execute(userStatsQuery, [userId]);
    console.log('✅ User stats query works:', userStats[0]);
    
    connection.release();
    console.log('\n🎉 All queries work correctly! The hanging issue should be fixed.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.code, error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

testCorrectedQueries();