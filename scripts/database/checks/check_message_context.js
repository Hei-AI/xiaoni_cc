const mysql = require('mysql2/promise');

async function checkMessageContext() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            charset: 'utf8mb4'
        });
        
        console.log('🔍 检查MessageContext字段内容...');
        
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
            
            try {
                const rawResponse = JSON.parse(record.raw_response);
                
                if (rawResponse.messageContext) {
                    const messageContext = rawResponse.messageContext;
                    console.log('\n📋 MessageContext 结构:');
                    console.log('字段:', Object.keys(messageContext));
                    
                    // 检查是否有历史消息
                    if (messageContext.recentMessages) {
                        console.log(`\n📚 recentMessages: ${messageContext.recentMessages.length}条`);
                        console.log('recentMessages示例:', messageContext.recentMessages.slice(0, 2));
                    } else {
                        console.log('\n❌ 没有recentMessages字段');
                    }
                    
                    if (messageContext.historyMessages) {
                        console.log(`\n📚 historyMessages: ${messageContext.historyMessages.length}条`);
                        console.log('historyMessages示例:', messageContext.historyMessages.slice(0, 2));
                    } else {
                        console.log('\n❌ 没有historyMessages字段');
                    }
                    
                    if (messageContext.userInfo) {
                        console.log(`\n👤 userInfo:`, messageContext.userInfo);
                    } else {
                        console.log('\n❌ 没有userInfo字段');
                    }
                    
                    if (messageContext.contextSummary) {
                        console.log(`\n📄 contextSummary:`, messageContext.contextSummary);
                    } else {
                        console.log('\n❌ 没有contextSummary字段');
                    }
                    
                    // 整体分析
                    const hasAnyHistory = (messageContext.recentMessages && messageContext.recentMessages.length > 0) || 
                                        (messageContext.historyMessages && messageContext.historyMessages.length > 0);
                                        
                    console.log(`\n📊 MessageContext分析:`);
                    console.log(`  ${hasAnyHistory ? '✅' : '❌'} 包含历史消息`);
                    console.log(`  ${messageContext.userInfo ? '✅' : '❌'} 包含用户信息`);
                    console.log(`  ${messageContext.contextSummary ? '✅' : '❌'} 包含上下文摘要`);
                    
                    if (!hasAnyHistory) {
                        console.log(`\n❌ 结论: MessageContext中没有历史消息数据！`);
                    } else {
                        console.log(`\n✅ 结论: MessageContext中包含历史消息数据`);
                    }
                }
                
                // 检查baseResponse中是否包含实际的LLM请求
                if (rawResponse.baseResponse) {
                    console.log('\n🔍 检查baseResponse:');
                    console.log('baseResponse字段:', Object.keys(rawResponse.baseResponse));
                    
                    if (rawResponse.baseResponse.raw_request) {
                        console.log('\n📄 找到raw_request字段');
                        const llmRequest = JSON.parse(rawResponse.baseResponse.raw_request);
                        if (llmRequest.contents?.[0]?.parts?.[0]?.text) {
                            const promptText = llmRequest.contents[0].parts[0].text;
                            console.log(`\n🤖 实际发给LLM的Prompt (${promptText.length}字符):`);
                            console.log('='.repeat(80));
                            console.log(promptText);
                            console.log('='.repeat(80));
                            
                            // 分析上下文
                            const hasContextSection = promptText.includes('对话上下文') || promptText.includes('历史对话');
                            const hasHistoryList = promptText.includes('1. [') && promptText.includes('用户:');
                            const hasMultipleMessages = (promptText.match(/\d+\. \[/g) || []).length > 1;
                            
                            console.log(`\n📊 Prompt上下文分析:`);
                            console.log(`  ${hasContextSection ? '✅' : '❌'} 包含上下文标题`);
                            console.log(`  ${hasHistoryList ? '✅' : '❌'} 包含历史对话列表`);  
                            console.log(`  ${hasMultipleMessages ? '✅' : '❌'} 包含多条历史消息`);
                            console.log(`  📏 Prompt总长度: ${promptText.length}字符`);
                            
                            if (!hasContextSection && !hasHistoryList) {
                                console.log(`\n❌ 最终结论: LLM没有收到前20条消息上下文！`);
                            } else {
                                console.log(`\n✅ 最终结论: LLM收到了上下文信息`);
                            }
                        }
                    }
                }
                
            } catch (parseError) {
                console.log('❌ 解析失败:', parseError.message);
            }
        }
        
        await connection.end();
        
    } catch (error) {
        console.error('❌ 查询失败:', error.message);
    }
}

checkMessageContext();