const mysql = require('mysql2/promise');

async function testDatabaseQuery() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'qqbot_user',
      password: 'qqbot_password',
      database: 'qqbot_db'
    });

    console.log('✅ Database connected successfully');

    const [rows] = await connection.execute(
      'SELECT * FROM prompt_debug_sessions WHERE id = ?',
      ['3544bc79-4253-48f3-ad1b-4239a64656a8']
    );

    if (rows.length === 0) {
      console.log('❌ No data found');
      return;
    }

    const sessionData = rows[0];
    console.log('🔍 Raw data from database:');
    console.log('- ID:', sessionData.id);
    console.log('- Messages type:', typeof sessionData.messages);
    console.log('- Messages length:', sessionData.messages?.length);
    console.log('- Messages preview:', sessionData.messages?.substring(0, 100));

    // 尝试解析JSON
    try {
      const parsedMessages = JSON.parse(sessionData.messages);
      console.log('✅ JSON parse successful! Message count:', parsedMessages.length);
      console.log('Messages:', parsedMessages);
    } catch (parseError) {
      console.log('❌ JSON parse failed:', parseError.message);
      console.log('Raw messages data:', sessionData.messages);
    }

    await connection.end();
  } catch (error) {
    console.error('❌ Database test failed:', error.message);
  }
}

testDatabaseQuery();