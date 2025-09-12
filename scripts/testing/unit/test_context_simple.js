/**
 * 简单的上下文测试 - 直接连接数据库查询
 */

const mysql = require('mysql2/promise');

async function testContextDirectly() {
    console.log('🔍 直接测试上下文获取...');
    
    try {
        // 数据库连接
        const connection = await mysql.createConnection({
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            charset: 'utf8mb4'
        });
        
        console.log('✅ 数据库连接成功');
        
        const userId = 85178516; // 你的QQ号
        
        // 1. 检查conversations表中有多少条记录
        const [totalCount] = await connection.execute(
            'SELECT COUNT(*) as count FROM conversations WHERE user_id = ?',
            [userId]
        );
        console.log(`📊 用户${userId}的总消息数: ${totalCount[0].count}`);
        
        // 2. 查看最近几条记录的详情
        const [recentMessages] = await connection.execute(
            `SELECT id, user_id, user_message, ai_response, timestamp, 
                    JSON_EXTRACT(raw_request, '$.message_type') as message_type
             FROM conversations 
             WHERE user_id = ? 
             ORDER BY timestamp DESC 
             LIMIT 5`,
            [userId]
        );
        
        console.log(`\n📝 最近5条消息记录:`);
        recentMessages.forEach((msg, i) => {
            console.log(`${i + 1}. [${new Date(msg.timestamp).toLocaleString()}]`);
            console.log(`   消息类型: ${msg.message_type}`);
            console.log(`   用户消息: ${msg.user_message?.substring(0, 50)}...`);
            console.log(`   AI回复: ${msg.ai_response?.substring(0, 50)}...`);
            console.log('');
        });
        
        // 3. 测试我们的私聊查询逻辑
        const [privateMessages] = await connection.execute(
            `SELECT * FROM conversations 
             WHERE user_id = ? 
               AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL)
             ORDER BY timestamp DESC 
             LIMIT 20`,
            [userId]
        );
        
        console.log(`🎯 私聊查询结果: 找到${privateMessages.length}条记录`);
        
        if (privateMessages.length > 0) {
            console.log(`\n📋 私聊历史消息 (前3条):`);
            privateMessages.slice(0, 3).forEach((msg, i) => {
                console.log(`${i + 1}. [${new Date(msg.timestamp).toLocaleString()}]`);
                console.log(`   ID: ${msg.id}`);
                console.log(`   消息: ${msg.user_message}`);
                console.log(`   回复: ${msg.ai_response || '无回复'}`);
                console.log('');
            });
            
            // 4. 生成AI上下文格式
            console.log('🤖 生成的AI上下文格式:');
            console.log('=' * 60);
            
            let aiContext = `=== 对话上下文 ===\n`;
            aiContext += `对话类型: 私聊\n`;
            aiContext += `用户: CodeMaster (ID: ${userId})\n`;
            aiContext += `用户历史消息数: ${privateMessages.length}条\n`;
            
            aiContext += `\n=== 与该用户的最近${Math.min(privateMessages.length, 5)}条私聊历史 ===\n`;
            privateMessages.slice(0, 5).reverse().forEach((msg, i) => {
                const time = new Date(msg.timestamp).toLocaleTimeString();
                aiContext += `${i + 1}. [${time}] 用户: ${msg.user_message}\n`;
                if (msg.ai_response) {
                    aiContext += `   阿正: ${msg.ai_response}\n`;
                }
                aiContext += `\n`;
            });
            
            aiContext += `=== 当前消息 ===\n`;
            aiContext += `CodeMaster: 我之前说了啥？\n`;
            
            console.log(aiContext);
            console.log('=' * 60);
            
        } else {
            console.log('❌ 没有找到私聊历史消息');
            
            // 检查是否有任何消息
            const [anyMessages] = await connection.execute(
                'SELECT id, user_message, JSON_EXTRACT(raw_request, "$.message_type") as msg_type FROM conversations WHERE user_id = ? LIMIT 3',
                [userId]
            );
            
            if (anyMessages.length > 0) {
                console.log('🔍 但找到了这些消息:');
                anyMessages.forEach(msg => {
                    console.log(`  - ID: ${msg.id}, 类型: ${msg.msg_type}, 内容: ${msg.user_message?.substring(0, 30)}...`);
                });
            }
        }
        
        await connection.end();
        console.log('\n✅ 测试完成');
        
    } catch (error) {
        console.error('❌ 测试失败:', error.message);
        if (error.sql) {
            console.error('SQL:', error.sql);
        }
    }
}

// 运行测试
testContextDirectly().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('💥 运行失败:', err);
    process.exit(1);
});