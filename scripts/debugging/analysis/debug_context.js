const { DatabaseManager } = require('./modules/qqbot-core/dist/services/database');
const { ContextManager } = require('./modules/qqbot-core/dist/services/context-manager');

// 创建测试函数
async function debugPrivateContext() {
    console.log('🔍 开始调试私聊上下文获取...');
    
    try {
        // 数据库配置
        const dbConfig = {
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            timezone: '+08:00'
        };
        
        const database = new DatabaseManager(dbConfig);
        await database.testConnection();
        console.log('✅ 数据库连接成功');
        
        const contextManager = new ContextManager(database);
        
        // 模拟一个私聊消息
        const mockPrivateMessage = {
            time: Date.now() / 1000,
            message_type: 'private',
            message_id: 12345,
            user_id: 85178516, // 你的QQ号
            message: '测试私聊上下文获取',
            raw_message: '测试私聊上下文获取',
            sender: {
                user_id: 85178516,
                nickname: 'CodeMaster'
            },
            self_id: 123456789
        };
        
        console.log('📝 模拟私聊消息:', mockPrivateMessage);
        
        // 1. 先查看数据库中有多少条该用户的记录
        const userMessages = await database.executeQuery(
            'SELECT COUNT(*) as count FROM conversations WHERE user_id = ?',
            [85178516]
        );
        console.log(`📊 数据库中用户${85178516}的总消息数:`, userMessages[0]?.count || 0);
        
        // 2. 查看私聊历史消息
        const privateHistory = await database.getPrivateMessageHistory(85178516, 20);
        console.log(`📝 私聊历史消息数量: ${privateHistory.length}`);
        if (privateHistory.length > 0) {
            console.log('📋 最近3条私聊历史:');
            privateHistory.slice(-3).forEach((msg, i) => {
                console.log(`  ${i + 1}. [${new Date(msg.timestamp).toLocaleString()}] ${msg.user_message.substring(0, 50)}`);
            });
        }
        
        // 3. 构建完整上下文
        const messageContext = await contextManager.buildMessageContext(mockPrivateMessage, 20);
        console.log(`🎯 上下文构建结果:`);
        console.log(`  - 历史消息数: ${messageContext.historyMessages.length}`);
        console.log(`  - 用户信息: ${messageContext.userInfo ? '有' : '无'}`);
        console.log(`  - 上下文摘要长度: ${messageContext.contextSummary.length}字符`);
        
        // 4. 查看格式化后的AI prompt
        const aiPrompt = contextManager.formatContextForAI(messageContext);
        console.log('\n🤖 发给LLM的完整prompt (plain text):');
        console.log('='.repeat(80));
        console.log(aiPrompt.plainText);
        console.log('='.repeat(80));
        console.log('Parts:', JSON.stringify(aiPrompt.parts, null, 2));
        
        // 5. 检查数据库中实际的消息格式
        const sampleMessages = await database.executeQuery(
            'SELECT id, user_id, user_message, timestamp, raw_request FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT 3',
            [85178516]
        );
        
        if (sampleMessages.length > 0) {
            console.log('\n📋 数据库中的样本消息:');
            sampleMessages.forEach((msg, i) => {
                console.log(`\n消息 ${i + 1}:`);
                console.log(`  ID: ${msg.id}`);
                console.log(`  用户ID: ${msg.user_id}`);
                console.log(`  消息内容: ${msg.user_message?.substring(0, 100)}...`);
                console.log(`  时间: ${new Date(msg.timestamp).toLocaleString()}`);
                console.log(`  raw_request: ${msg.raw_request ? JSON.stringify(JSON.parse(msg.raw_request), null, 2).substring(0, 200) + '...' : '无'}`);
            });
        }
        
    } catch (error) {
        console.error('❌ 调试过程中出错:', error);
    }
}

// 运行调试
debugPrivateContext().then(() => {
    console.log('\n🎉 调试完成');
    process.exit(0);
}).catch(err => {
    console.error('💥 调试失败:', err);
    process.exit(1);
});
