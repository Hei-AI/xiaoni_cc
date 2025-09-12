const mysql = require('mysql2/promise');

async function testDebugAPIQuery() {
    console.log('🔍 测试Debug API中的复杂查询...');
    
    const config = {
        host: 'localhost',
        port: 3306,
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db',
        charset: 'utf8mb4',
        timezone: '+08:00'
    };

    let connection = null;
    try {
        connection = await mysql.createConnection(config);
        console.log('✅ 数据库连接成功');

        // 这是Debug API中的复杂查询
        const debugQuery = `
          SELECT c.*, 
                 CASE 
                   WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                   THEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.raw_message'))
                   ELSE NULL 
                 END as user_raw_input,
                 CASE 
                   WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                   THEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.sender.nickname'))
                   ELSE NULL 
                 END as user_nickname,
                 CASE 
                   WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                   THEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.message_type'))
                   ELSE NULL 
                 END as message_type,
                 CASE 
                   WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                   THEN JSON_EXTRACT(c.raw_request, '$.group_id')
                   ELSE NULL 
                 END as group_id
          FROM conversations c 
          WHERE c.user_id = ? 
          ORDER BY c.timestamp DESC 
          LIMIT 1
        `;

        console.log('⏳ 执行Debug API查询...');
        const startTime = Date.now();
        
        // 添加超时保护
        const queryPromise = connection.execute(debugQuery, [85178516]);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Query timeout after 10 seconds')), 10000);
        });
        
        const [rows] = await Promise.race([queryPromise, timeoutPromise]);
        const queryTime = Date.now() - startTime;
        
        console.log(`✅ Debug查询完成! (${queryTime}ms, ${rows.length} 条记录)`);
        
        if (rows.length > 0) {
            console.log('\n📝 查询结果预览:');
            const row = rows[0];
            console.log('- ID:', row.id);
            console.log('- 用户ID:', row.user_id);
            console.log('- 消息:', (row.user_message || '').substring(0, 50) + '...');
            console.log('- Raw输入:', (row.user_raw_input || '').substring(0, 50) + '...');
            console.log('- 用户昵称:', row.user_nickname);
            console.log('- 消息类型:', row.message_type);
            console.log('- 群ID:', row.group_id);
            console.log('- Raw请求长度:', row.raw_request ? row.raw_request.length : 0);
        }

        // 测试简化查询
        console.log('\n🔧 测试简化版查询...');
        const simpleQuery = `SELECT id, user_id, user_message, ai_response, timestamp FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`;
        
        const simpleStart = Date.now();
        const [simpleRows] = await connection.execute(simpleQuery, [85178516]);
        const simpleTime = Date.now() - simpleStart;
        
        console.log(`✅ 简化查询完成! (${simpleTime}ms, ${simpleRows.length} 条记录)`);

        // 测试JSON函数性能
        console.log('\n⚡ 测试JSON函数性能...');
        const jsonTestQuery = `
            SELECT 
                COUNT(*) as total_records,
                COUNT(CASE WHEN JSON_VALID(raw_request) THEN 1 END) as valid_json_records,
                AVG(JSON_LENGTH(raw_request)) as avg_json_length
            FROM conversations 
            WHERE user_id = ?
        `;
        
        const jsonStart = Date.now();
        const [jsonRows] = await connection.execute(jsonTestQuery, [85178516]);
        const jsonTime = Date.now() - jsonStart;
        
        console.log(`✅ JSON性能测试完成! (${jsonTime}ms)`);
        console.log('- 总记录数:', jsonRows[0].total_records);
        console.log('- 有效JSON记录数:', jsonRows[0].valid_json_records);
        console.log('- 平均JSON长度:', Math.round(jsonRows[0].avg_json_length || 0));

        // 查找可能的问题记录
        console.log('\n🔍 查找可能的问题记录...');
        const problemQuery = `
            SELECT id, user_id, user_message, 
                   CHAR_LENGTH(raw_request) as raw_request_length,
                   JSON_VALID(raw_request) as is_valid_json,
                   timestamp
            FROM conversations 
            WHERE user_id = ? 
            AND (raw_request IS NULL OR NOT JSON_VALID(raw_request) OR CHAR_LENGTH(raw_request) > 10000)
            ORDER BY timestamp DESC 
            LIMIT 5
        `;
        
        const problemStart = Date.now();
        const [problemRows] = await connection.execute(problemQuery, [85178516]);
        const problemTime = Date.now() - problemStart;
        
        console.log(`✅ 问题记录查询完成! (${problemTime}ms, ${problemRows.length} 条记录)`);
        
        if (problemRows.length > 0) {
            console.log('发现可能的问题记录:');
            problemRows.forEach((row, idx) => {
                console.log(`${idx + 1}. ID: ${row.id}, JSON长度: ${row.raw_request_length || 0}, 有效JSON: ${row.is_valid_json}`);
            });
        } else {
            console.log('未发现明显的问题记录');
        }

    } catch (error) {
        console.error('❌ 测试失败:', error);
        if (error.message.includes('timeout')) {
            console.error('💥 查询超时! 这可能是导致QQBot Core卡住的原因');
        }
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 数据库连接已关闭');
        }
    }
}

// 执行测试
testDebugAPIQuery().then(() => {
    console.log('\n🎉 Debug API查询测试完成!');
    process.exit(0);
}).catch(error => {
    console.error('\n💥 测试异常:', error);
    process.exit(1);
});