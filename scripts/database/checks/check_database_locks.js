#!/usr/bin/env node

const mysql = require('mysql2/promise');

async function checkDatabaseStatus() {
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
    console.log('🔍 Checking database status and locks...');
    
    const connection = await pool.getConnection();
    
    // Check for locked tables
    console.log('\n📋 Checking for locked tables...');
    const [locks] = await connection.execute('SHOW OPEN TABLES WHERE In_use > 0');
    console.log('Open tables with locks:', locks);
    
    // Check for running processes
    console.log('\n📋 Checking for long-running processes...');
    const [processes] = await connection.execute('SHOW PROCESSLIST');
    const longRunning = processes.filter(p => p.Time > 5); // More than 5 seconds
    console.log('Long-running processes:', longRunning);
    
    // Check connection pool status
    console.log('\n📋 Checking connection limits...');
    const [maxConn] = await connection.execute('SHOW VARIABLES LIKE "max_connections"');
    const [currentConn] = await connection.execute('SHOW STATUS LIKE "Threads_connected"');
    console.log('Max connections:', maxConn[0].Value);
    console.log('Current connections:', currentConn[0].Value);
    
    // Test a simple query similar to what's failing
    console.log('\n🧪 Testing query performance...');
    const startTime = Date.now();
    const [testQuery] = await connection.execute(
      'SELECT COUNT(*) as message_count FROM conversations WHERE user_id = ?',
      [85178516]
    );
    const queryTime = Date.now() - startTime;
    console.log(`✅ User stats query completed in ${queryTime}ms`);
    console.log('Result:', testQuery[0]);
    
    // Test the private message history query
    console.log('\n🧪 Testing private message history query...');
    const historyStartTime = Date.now();
    const [historyQuery] = await connection.execute(
      `SELECT * FROM conversations WHERE user_id = ? AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' OR raw_request IS NULL OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL) ORDER BY timestamp DESC LIMIT 20`,
      [85178516]
    );
    const historyQueryTime = Date.now() - historyStartTime;
    console.log(`✅ History query completed in ${historyQueryTime}ms`);
    console.log(`Found ${historyQuery.length} records`);
    
    connection.release();
    
  } catch (error) {
    console.error('❌ Database check failed:', error.message);
  } finally {
    await pool.end();
  }
}

checkDatabaseStatus();