const mysql = require('mysql2/promise');

async function checkLLMRequest() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            charset: 'utf8mb4'
        });
        
        console.log('🔍 检查最新发给LLM的请求内容...');
        
        // 查看最新的对话记录的raw_request
        const [results] = await connection.execute(
            `SELECT user_message, raw_request, ai_response, timestamp 
             FROM conversations 
             WHERE user_id = 85178516 
             ORDER BY timestamp DESC 
             LIMIT 2`,
            []
        );
        
        console.log(`\n找到 ${results.length} 条最新记录:`);
        
        results.forEach((record, i) => {
            console.log(`\n=== 记录 ${i + 1} [${new Date(record.timestamp).toLocaleString()}] ===`);
            console.log(`用户消息: ${record.user_message}`);
            console.log(`AI回复: ${record.ai_response?.substring(0, 100)}...`);
            
            if (record.raw_request) {
                try {
                    const rawRequest = JSON.parse(record.raw_request);
                    console.log(`\n📄 发给LLM的完整请求内容:`);
                    console.log(`请求类型: ${rawRequest.contents?.[0]?.parts?.[0]?.text ? 'text' : 'unknown'}`);
                    
                    if (rawRequest.contents?.[0]?.parts?.[0]?.text) {
                        const promptContent = rawRequest.contents[0].parts[0].text;
                        console.log(`\n🤖 LLM Prompt 内容:`);
                        console.log('='.repeat(80));
                        console.log(promptContent);
                        console.log('='.repeat(80));
                        
                        // 分析prompt是否包含上下文
                        const hasContext = promptContent.includes('历史对话') || promptContent.includes('上下文') || promptContent.includes('最近') || promptContent.includes('之前');
                        const hasHistory = promptContent.includes('[') && promptContent.includes('用户:') && promptContent.includes('阿正:');
                        const tokenCount = promptContent.length;
                        
                        console.log(`\n📊 Prompt 分析:`);
                        console.log(`  - 字符长度: ${tokenCount}`);
                        console.log(`  - 包含上下文关键词: ${hasContext ? '✅' : '❌'}`);
                        console.log(`  - 包含历史对话格式: ${hasHistory ? '✅' : '❌'}`);
                        console.log(`  - 预估token数: ~${Math.ceil(tokenCount / 4)}`);
                        
                        if (!hasContext && !hasHistory) {
                            console.log(`\n⚠️  发现问题: LLM请求中没有包含上下文信息！`);
                        } else {
                            console.log(`\n✅ 确认: LLM请求中包含了上下文信息`);
                        }
                    }
                    
                } catch (parseError) {
                    console.log(`❌ 解析raw_request失败: ${parseError.message}`);
                    console.log(`原始内容: ${record.raw_request?.substring(0, 200)}...`);
                }
            } else {
                console.log(`❌ 没有raw_request数据`);
            }
        });
        
        await connection.end();
        
    } catch (error) {
        console.error('❌ 查询失败:', error.message);
    }
}

checkLLMRequest();