const mysql = require('mysql2/promise');

async function queryConversationTrace(conversationId) {
    const config = {
        host: 'localhost',
        port: 3306,
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db',
        charset: 'utf8mb4'
    };

    let connection;
    
    try {
        console.log(`🔍 查询对话 ${conversationId} 的LLM调用链路...`);
        connection = await mysql.createConnection(config);
        
        // 1. 查询基本对话信息
        console.log('\n📄 基本对话信息:');
        const [conversation] = await connection.execute(
            'SELECT * FROM conversations WHERE id = ?',
            [conversationId]
        );
        
        if (conversation.length === 0) {
            console.log(`❌ 未找到对话记录: ${conversationId}`);
            return;
        }
        
        const conv = conversation[0];
        console.log(`  对话ID: ${conv.id}`);
        console.log(`  用户ID: ${conv.user_id}`);
        console.log(`  用户消息: ${conv.user_message}`);
        console.log(`  AI回复: ${conv.ai_response?.substring(0, 100)}...`);
        console.log(`  时间: ${conv.timestamp}`);
        console.log(`  响应时间: ${conv.response_time}ms`);
        console.log(`  会话ID: ${conv.session_id || '无'}`);
        
        // 2. 查询该对话的LLM调用记录
        console.log('\n🔍 LLM调用记录:');
        const [llmTraces] = await connection.execute(
            'SELECT * FROM llm_call_traces WHERE conversation_id = ? ORDER BY call_sequence ASC',
            [conversationId]
        );
        
        if (llmTraces.length === 0) {
            console.log('  ❌ 未找到LLM调用记录');
            
            // 检查是否有同session的记录
            if (conv.session_id) {
                console.log(`\n🔍 检查同session (${conv.session_id}) 的LLM记录:`);
                const [sessionTraces] = await connection.execute(
                    'SELECT * FROM llm_call_traces WHERE session_id = ? ORDER BY timestamp ASC',
                    [conv.session_id]
                );
                
                if (sessionTraces.length > 0) {
                    console.log(`  找到 ${sessionTraces.length} 条session级LLM记录:`);
                    sessionTraces.forEach((trace, index) => {
                        console.log(`    ${index + 1}. [${trace.timestamp}] ${trace.engine_type}引擎`);
                        console.log(`       调用序号: ${trace.call_sequence}`);
                        console.log(`       响应时间: ${trace.response_time}ms`);
                        console.log(`       Token使用: ${trace.total_tokens || 0}`);
                        console.log(`       成功状态: ${trace.success ? '✅' : '❌'}`);
                        if (trace.conversation_id) {
                            console.log(`       关联对话: ${trace.conversation_id}`);
                        }
                        console.log('');
                    });
                } else {
                    console.log('  ❌ session级别也没有LLM记录');
                }
            }
        } else {
            console.log(`  ✅ 找到 ${llmTraces.length} 条LLM调用记录:`);
            
            // 计算总统计
            let totalTokens = 0;
            let totalResponseTime = 0;
            let successCount = 0;
            const engineBreakdown = {};
            
            llmTraces.forEach((trace, index) => {
                console.log(`\n  ${index + 1}. 调用序号 ${trace.call_sequence}:`);
                console.log(`     引擎类型: ${trace.engine_type}`);
                console.log(`     模型: ${trace.model_name || '未知'}`);
                console.log(`     时间: ${trace.timestamp}`);
                console.log(`     响应时间: ${trace.response_time}ms`);
                console.log(`     Token使用: 输入${trace.prompt_tokens || 0} + 输出${trace.completion_tokens || 0} = 总计${trace.total_tokens || 0}`);
                console.log(`     成功状态: ${trace.success ? '✅' : '❌'}`);
                
                if (trace.prompt && trace.prompt.length > 0) {
                    console.log(`     Prompt预览: ${trace.prompt.substring(0, 100)}...`);
                }
                
                if (trace.response && trace.response.length > 0) {
                    console.log(`     响应预览: ${trace.response.substring(0, 100)}...`);
                }
                
                if (!trace.success && trace.error_message) {
                    console.log(`     错误信息: ${trace.error_message}`);
                }
                
                // 统计
                totalTokens += trace.total_tokens || 0;
                totalResponseTime += trace.response_time || 0;
                if (trace.success) successCount++;
                engineBreakdown[trace.engine_type] = (engineBreakdown[trace.engine_type] || 0) + 1;
            });
            
            // 显示统计信息
            console.log('\n📊 统计信息:');
            console.log(`  总调用次数: ${llmTraces.length}`);
            console.log(`  成功率: ${((successCount / llmTraces.length) * 100).toFixed(1)}%`);
            console.log(`  总Token消耗: ${totalTokens}`);
            console.log(`  总响应时间: ${totalResponseTime}ms`);
            console.log(`  平均响应时间: ${(totalResponseTime / llmTraces.length).toFixed(1)}ms`);
            console.log(`  预估成本: $${(totalTokens * 0.003 / 1000).toFixed(4)}`);
            
            console.log('\n🔧 引擎使用分布:');
            Object.entries(engineBreakdown).forEach(([engine, count]) => {
                console.log(`  ${engine}: ${count}次`);
            });
        }
        
        // 3. 检查raw_request数据完整性
        console.log('\n🔍 raw_request数据完整性检查:');
        if (conv.raw_request) {
            try {
                const rawData = JSON.parse(conv.raw_request);
                console.log('  ✅ raw_request格式正确');
                console.log(`  包含字段: ${Object.keys(rawData).join(', ')}`);
                
                // 检查关键字段
                const requiredFields = ['message_type', 'user_id', 'message', 'sender'];
                const missingFields = requiredFields.filter(field => !rawData[field]);
                
                if (missingFields.length === 0) {
                    console.log('  ✅ 所有关键字段都存在');
                } else {
                    console.log(`  ⚠️ 缺少字段: ${missingFields.join(', ')}`);
                }
                
                if (rawData.message_type === 'group' && !rawData.group_id) {
                    console.log('  ⚠️ 群聊消息缺少group_id字段');
                }
                
            } catch (error) {
                console.log('  ❌ raw_request JSON格式错误:', error.message);
            }
        } else {
            console.log('  ❌ raw_request为空');
        }
        
        // 4. 验证用户消息存储修复
        console.log('\n✅ 用户消息存储验证:');
        const isContextPrompt = conv.user_message && conv.user_message.includes('=== 对话上下文 ===');
        if (isContextPrompt) {
            console.log('  ❌ 检测到用户消息仍包含上下文信息 - 修复未生效!');
        } else {
            console.log('  ✅ 用户消息存储正确，不包含上下文信息');
        }
        
    } catch (error) {
        console.error('❌ 查询失败:', error.message);
        console.error('详细错误:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// 从命令行参数获取conversation ID，如果没有则使用默认值
const conversationId = process.argv[2] || 'e09cf1c3-d4ad-4572-997c-a4f3bf43331d';
queryConversationTrace(conversationId).catch(console.error);