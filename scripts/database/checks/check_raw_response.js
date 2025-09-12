const mysql = require('mysql2/promise');

async function checkRawResponse() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            charset: 'utf8mb4'
        });
        
        console.log('🔍 检查raw_response中的LLM请求内容...');
        
        const [results] = await connection.execute(
            `SELECT user_message, raw_response, timestamp
             FROM conversations 
             WHERE user_id = 85178516 
             ORDER BY timestamp DESC 
             LIMIT 1`
        );
        
        if (results.length > 0) {
            const record = results[0];
            console.log(`\n📝 最新消息: ${record.user_message}`);
            console.log(`时间: ${new Date(record.timestamp).toLocaleString()}`);
            
            try {
                const rawResponse = JSON.parse(record.raw_response);
                console.log('\n📄 raw_response JSON结构:');
                console.log('顶级字段:', Object.keys(rawResponse));
                
                // 查找LLM请求相关的字段
                if (rawResponse.request) {
                    console.log('\n🎯 找到request字段:');
                    if (rawResponse.request.contents) {
                        console.log('✅ 找到contents字段');
                        if (rawResponse.request.contents[0]?.parts?.[0]?.text) {
                            const promptText = rawResponse.request.contents[0].parts[0].text;
                            console.log(`\n🤖 发给LLM的完整Prompt (${promptText.length}字符):`);
                            console.log('='.repeat(80));
                            console.log(promptText);
                            console.log('='.repeat(80));
                            
                            // 分析是否包含上下文
                            const hasHistory = promptText.includes('历史对话') || promptText.includes('最近') && promptText.includes('条');
                            const hasContextKeyword = promptText.includes('上下文') || promptText.includes('对话上下文');
                            const hasUserHistory = promptText.includes('用户:') && promptText.includes('阿正:');
                            const hasTimeFormat = promptText.includes('[') && promptText.includes(':') && promptText.includes(']');
                            
                            console.log(`\n📊 上下文分析结果:`);
                            console.log(`  ✅ Prompt长度: ${promptText.length}字符`);
                            console.log(`  ${hasHistory ? '✅' : '❌'} 包含历史对话关键词`);
                            console.log(`  ${hasContextKeyword ? '✅' : '❌'} 包含上下文关键词`);
                            console.log(`  ${hasUserHistory ? '✅' : '❌'} 包含用户对话格式`);
                            console.log(`  ${hasTimeFormat ? '✅' : '❌'} 包含时间格式标记`);
                            
                            if (!hasHistory && !hasUserHistory) {
                                console.log(`\n❌ 结论: LLM请求中没有包含历史对话上下文！`);
                            } else {
                                console.log(`\n✅ 结论: LLM请求中包含了对话上下文`);
                            }
                        }
                    }
                }
                
                // 查看其他可能包含prompt的字段
                if (rawResponse.llmRequest) {
                    console.log('\n🔍 发现llmRequest字段');
                }
                if (rawResponse.generationConfig) {
                    console.log('\n⚙️  发现generationConfig字段');
                }
                
            } catch (parseError) {
                console.log('❌ 解析raw_response JSON失败:', parseError.message);
                console.log('原始内容预览:', record.raw_response?.substring(0, 500));
            }
        }
        
        await connection.end();
        
    } catch (error) {
        console.error('❌ 查询失败:', error.message);
    }
}

checkRawResponse();