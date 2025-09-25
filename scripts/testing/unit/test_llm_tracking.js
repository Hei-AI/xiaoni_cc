const axios = require('axios');

async function testLLMTracking() {
    console.log('🧪 开始测试完整LLM调用链路追踪...\n');
    
    const testMessage = {
        message_type: 'private',
        user_id: 85178516, // 使用测试用户ID
        message: '测试LLM追踪功能',
        raw_message: '测试LLM追踪功能',
        message_id: Date.now(),
        time: Math.floor(Date.now() / 1000),
        sender: {
            user_id: 85178516,
            nickname: '测试用户',
            card: ''
        },
        font: 14,
        sub_type: 'friend',
        post_type: 'message'
    };

    try {
        console.log('📤 发送模拟私聊消息...');
        console.log(`消息内容: "${testMessage.message}"`);
        console.log(`用户ID: ${testMessage.user_id}`);
        
        // 通过HTTP API发送模拟消息
        const response = await axios.post('http://localhost:8081/webhook/test', testMessage, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log(`📡 HTTP响应状态: ${response.status}`);
        
        if (response.data) {
            console.log('📄 服务器响应:', response.data);
            
            if (response.data.conversationId) {
                console.log('\n⏳ 等待5秒让AI处理完成...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                console.log('\n🔍 查询LLM调用链路...');
                const mysql = require('mysql2/promise');
                const dbConfig = {
                    host: 'localhost',
                    port: 3306,
                    user: 'qqbot_user',
                    password: 'qqbot_password',
                    database: 'qqbot_db'
                };
                
                const connection = await mysql.createConnection(dbConfig);
                
                // 查询对话记录
                const [conversations] = await connection.execute(
                    'SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1',
                    [testMessage.user_id]
                );
                
                if (conversations.length > 0) {
                    const conv = conversations[0];
                    console.log('✅ 对话记录创建成功:');
                    console.log(`  - 对话ID: ${conv.id}`);
                    console.log(`  - 会话ID: ${conv.session_id || '无'}`);
                    console.log(`  - 用户消息: ${conv.user_message}`);
                    console.log(`  - AI回复: ${conv.ai_response?.substring(0, 50)}...`);
                    
                    // 查询LLM追踪记录
                    const sessionId = conv.session_id;
                    if (sessionId) {
                        const [llmTraces] = await connection.execute(
                            'SELECT * FROM llm_call_traces WHERE session_id = ? ORDER BY call_sequence ASC',
                            [sessionId]
                        );
                        
                        console.log(`\n📊 LLM调用链路 (${llmTraces.length} 条记录):`);
                        llmTraces.forEach((trace, index) => {
                            console.log(`  ${index + 1}. 引擎: ${trace.engine_type}`);
                            console.log(`     - 对话ID: ${trace.conversation_id}`);
                            console.log(`     - 调用序号: ${trace.call_sequence}`);
                            console.log(`     - Token消耗: ${trace.total_tokens}`);
                            console.log(`     - 响应时间: ${trace.response_time}ms`);
                            console.log(`     - 状态: ${trace.success ? '✅ 成功' : '❌ 失败'}`);
                        });
                        
                        // 验证修复效果
                        console.log('\n🔍 修复验证结果:');
                        const hasMainChat = llmTraces.some(t => t.engine_type === 'main_chat');
                        const hasPersonaChat = llmTraces.some(t => t.engine_type === 'persona');
                        const conversationIdMatch = llmTraces.every(t => t.conversation_id === conv.id);
                        
                        console.log(`  - enhanced_chat调用: ${hasMainChat ? '✅' : '❌'}`);
                        console.log(`  - persona_chat调用: ${hasPersonaChat ? '✅' : '❌'}`);
                        console.log(`  - conversation_id匹配: ${conversationIdMatch ? '✅' : '❌'}`);
                        console.log(`  - session_id存在: ${sessionId ? '✅' : '❌'}`);
                        
                        if (hasMainChat && hasPersonaChat && conversationIdMatch && sessionId) {
                            console.log('\n🎉 所有修复都成功生效！LLM追踪系统工作正常！');
                        } else {
                            console.log('\n⚠️  仍有部分问题需要修复');
                        }
                    } else {
                        console.log('\n❌ session_id缺失，修复未完全生效');
                    }
                } else {
                    console.log('\n❌ 未找到对话记录');
                }
                
                await connection.end();
            }
        }
        
    } catch (error) {
        console.error('❌ 测试失败:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.error('💡 提示: 请确保QQBot Core服务正在运行 (端口8081)');
        }
    }
}

// 运行测试
testLLMTracking().catch(console.error);