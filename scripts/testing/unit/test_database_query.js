const mysql = require('mysql2/promise');

async function testDatabaseQueries() {
    console.log('🔍 开始数据库查询性能测试...');
    
    const config = {
        host: 'localhost',
        port: 3306,
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db',
        charset: 'utf8mb4',
        timezone: '+08:00',
        acquireTimeout: 10000,
        timeout: 15000
    };

    let connection = null;
    try {
        console.log('⏱️  连接数据库...');
        const startConnect = Date.now();
        connection = await mysql.createConnection(config);
        const connectTime = Date.now() - startConnect;
        console.log(`✅ 数据库连接成功 (${connectTime}ms)`);

        // 测试基本查询
        console.log('\n📊 执行基本查询测试...');
        const basicStart = Date.now();
        const [basicResult] = await connection.execute('SELECT COUNT(*) as total FROM conversations');
        const basicTime = Date.now() - basicStart;
        console.log(`📈 conversations表总记录数: ${basicResult[0].total} (${basicTime}ms)`);

        // 测试问题查询 - 用户85178516的私聊历史
        console.log('\n🎯 执行问题查询测试 (用户85178516私聊历史)...');
        const problemQuery = `
            SELECT * FROM conversations 
            WHERE user_id = ? 
            AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' 
                 OR raw_request IS NULL 
                 OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL) 
            ORDER BY timestamp DESC 
            LIMIT 20
        `;
        
        const queryStart = Date.now();
        console.log('⏳ 开始执行查询...');
        
        // 添加超时保护
        const queryPromise = connection.execute(problemQuery, [85178516]);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Query timeout after 15 seconds')), 15000);
        });
        
        try {
            const [rows] = await Promise.race([queryPromise, timeoutPromise]);
            const queryTime = Date.now() - queryStart;
            console.log(`✅ 查询成功! 返回 ${rows.length} 条记录 (${queryTime}ms)`);
            
            if (rows.length > 0) {
                console.log('\n📝 最新3条记录预览:');
                rows.slice(0, 3).forEach((row, index) => {
                    console.log(`${index + 1}. [${row.timestamp}] ${row.user_message?.substring(0, 50) || 'No message'}...`);
                });
            }
        } catch (queryError) {
            const queryTime = Date.now() - queryStart;
            console.log(`❌ 查询失败! (${queryTime}ms)`);
            console.log('错误详情:', queryError.message);
            throw queryError;
        }

        // 测试表结构和索引
        console.log('\n🔧 检查表结构和索引...');
        const [tableInfo] = await connection.execute('DESCRIBE conversations');
        console.log('表结构字段数:', tableInfo.length);
        
        const [indexes] = await connection.execute('SHOW INDEX FROM conversations');
        console.log('索引数量:', indexes.length);
        indexes.forEach(idx => {
            console.log(`- ${idx.Key_name}: ${idx.Column_name} (${idx.Index_type})`);
        });

        // 测试查询执行计划
        console.log('\n📋 分析查询执行计划...');
        const explainQuery = `EXPLAIN ${problemQuery}`;
        const [explainResult] = await connection.execute(explainQuery, [85178516]);
        console.log('执行计划:');
        explainResult.forEach(row => {
            console.log(`- Table: ${row.table}, Type: ${row.type}, Key: ${row.key || 'NONE'}, Rows: ${row.rows}`);
        });

    } catch (error) {
        console.error('❌ 测试失败:', error);
        if (error.code) {
            console.error('错误代码:', error.code);
        }
        if (error.sqlState) {
            console.error('SQL状态:', error.sqlState);
        }
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 数据库连接已关闭');
        }
    }
}

// 执行测试
testDatabaseQueries().then(() => {
    console.log('\n🎉 测试完成!');
    process.exit(0);
}).catch(error => {
    console.error('\n💥 测试异常结束:', error);
    process.exit(1);
});