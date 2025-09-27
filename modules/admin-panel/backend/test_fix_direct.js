// 直接修复测试脚本
const mysql = require('mysql2/promise');

async function fixSessionData() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'qqbot_user',
      password: 'qqbot_password',
      database: 'qqbot_db'
    });

    console.log('✅ Connected to database');

    // 直接查询新会话
    const [rows] = await connection.execute(
      'SELECT * FROM prompt_debug_sessions WHERE id = ?',
      ['9fe8bae4-48a9-4fac-979f-48293fed82dc']
    );

    if (rows.length === 0) {
      console.log('❌ No session found');
      return;
    }

    const sessionData = rows[0];
    console.log('🔍 Raw session data:');
    console.log('- ID:', sessionData.id);
    console.log('- Messages type:', typeof sessionData.messages);
    console.log('- Messages value:', sessionData.messages);

    // 检查messages是否是数组
    if (Array.isArray(sessionData.messages)) {
      console.log('✅ Messages is already an array with', sessionData.messages.length, 'items');
      console.log('Messages content:', JSON.stringify(sessionData.messages, null, 2));
    } else if (typeof sessionData.messages === 'string') {
      console.log('📝 Messages is a string, trying to parse...');
      try {
        const parsedMessages = JSON.parse(sessionData.messages);
        console.log('✅ Parsed successfully:', parsedMessages.length, 'messages');
        console.log('Messages content:', JSON.stringify(parsedMessages, null, 2));
      } catch (error) {
        console.log('❌ Parse failed:', error.message);
      }
    } else {
      console.log('⚠️ Unexpected messages type:', typeof sessionData.messages);
    }

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

fixSessionData();