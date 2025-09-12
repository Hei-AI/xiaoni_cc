#!/usr/bin/env node

const mysql = require('mysql2/promise');

async function checkMySQLInfo() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'qqbot_user',
    password: 'qqbot_password',
    database: 'qqbot_db'
  });

  try {
    const connection = await pool.getConnection();
    
    // Check MySQL version
    const [versionRows] = await connection.execute('SELECT VERSION() as version');
    console.log('MySQL Version:', versionRows[0].version);
    
    // Check if prepared statements support LIMIT parameters
    try {
      const [testRows] = await connection.execute('SELECT 1 as test LIMIT ?', [1]);
      console.log('✅ LIMIT parameters ARE supported');
    } catch (error) {
      console.log('❌ LIMIT parameters NOT supported:', error.code);
    }
    
    // Test with string interpolation instead
    const safeLimit = 20;
    const query = `SELECT COUNT(*) as count FROM conversations LIMIT ${safeLimit}`;
    const [countRows] = await connection.execute(query);
    console.log('✅ String interpolation works for LIMIT:', countRows[0].count);
    
    connection.release();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkMySQLInfo();