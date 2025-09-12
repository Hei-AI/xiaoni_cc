const mysql = require('mysql2/promise');

async function checkDbFields() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            charset: 'utf8mb4'
        });
        
        console.log('🔍 检查数据库字段情况...');
        
        // 查看表结构
        const [columns] = await connection.execute(
            `SHOW COLUMNS FROM conversations`
        );
        
        console.log('\n📋 conversations表字段:');
        columns.forEach(col => {
            console.log(`  - ${col.Field}: ${col.Type} ${col.Null} ${col.Key || ''}`);
        });
        
        // 查看最新记录的所有字段情况
        const [results] = await connection.execute(
            `SELECT id, user_message, ai_response, timestamp, 
                    raw_request IS NULL as raw_request_null,
                    raw_response IS NULL as raw_response_null,
                    LENGTH(raw_request) as raw_request_len,
                    LENGTH(raw_response) as raw_response_len
             FROM conversations 
             WHERE user_id = 85178516 
             ORDER BY timestamp DESC 
             LIMIT 3`
        );
        
        console.log('\n📊 最新3条记录的字段情况:');
        results.forEach((record, i) => {
            console.log(`\n记录 ${i + 1} [${new Date(record.timestamp).toLocaleString()}]:`);
            console.log(`  用户消息: ${record.user_message}`);
            console.log(`  raw_request为null: ${record.raw_request_null}`);
            console.log(`  raw_response为null: ${record.raw_response_null}`);
            console.log(`  raw_request长度: ${record.raw_request_len || 0}`);
            console.log(`  raw_response长度: ${record.raw_response_len || 0}`);
        });
        
        // 如果有raw_request内容，查看一小部分
        const [detailResults] = await connection.execute(
            `SELECT SUBSTRING(raw_request, 1, 200) as raw_request_preview,
                    SUBSTRING(raw_response, 1, 200) as raw_response_preview
             FROM conversations 
             WHERE user_id = 85178516 AND raw_request IS NOT NULL
             ORDER BY timestamp DESC 
             LIMIT 1`
        );
        
        if (detailResults.length > 0) {
            console.log('\n📄 raw_request内容预览:');
            console.log(detailResults[0].raw_request_preview);
        } else {
            console.log('\n❌ 没有找到包含raw_request内容的记录');
        }
        
        await connection.end();
        
    } catch (error) {
        console.error('❌ 查询失败:', error.message);
    }
}

checkDbFields();