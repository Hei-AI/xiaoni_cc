const mysql = require('mysql2/promise');

async function checkConversation() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        port: 3306,
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db',
        charset: 'utf8mb4'
    });

    try {
        console.log('🔍 查询最近的对话记录...\n');

        const [rows] = await connection.execute(`
            SELECT
                conversation_id,
                user_id,
                SUBSTRING(user_message, 1, 50) as user_message_preview,
                SUBSTRING(ai_response, 1, 100) as ai_response_preview,
                status,
                trace_id,
                created_at
            FROM conversations
            WHERE user_id = 85178516
            ORDER BY created_at DESC
            LIMIT 3
        `);

        if (rows.length === 0) {
            console.log('❌ 没有找到用户 85178516 的对话记录');

            // 查询最近的任何对话记录
            const [allRows] = await connection.execute(`
                SELECT
                    conversation_id,
                    user_id,
                    SUBSTRING(user_message, 1, 50) as user_message_preview,
                    status,
                    trace_id,
                    created_at
                FROM conversations
                ORDER BY created_at DESC
                LIMIT 5
            `);

            console.log('\n📋 最近的对话记录 (任何用户):');
            allRows.forEach((row, index) => {
                console.log(`${index + 1}. ID: ${row.conversation_id}, User: ${row.user_id}, Message: "${row.user_message_preview}", Status: ${row.status}, Time: ${row.created_at}`);
            });
        } else {
            console.log('✅ 找到对话记录:');
            rows.forEach((row, index) => {
                console.log(`\n${index + 1}. 对话ID: ${row.conversation_id}`);
                console.log(`   用户ID: ${row.user_id}`);
                console.log(`   用户消息: "${row.user_message_preview}..."`);
                console.log(`   AI回复: "${row.ai_response_preview}..."`);
                console.log(`   状态: ${row.status}`);
                console.log(`   追踪ID: ${row.trace_id}`);
                console.log(`   时间: ${row.created_at}`);
            });
        }

    } catch (error) {
        console.error('❌ 数据库查询失败:', error.message);
    } finally {
        await connection.end();
        console.log('\n🔧 数据库连接已关闭');
    }
}

checkConversation();
