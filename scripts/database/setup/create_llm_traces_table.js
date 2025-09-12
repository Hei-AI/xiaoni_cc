const mysql = require('mysql2/promise');

async function createLLMTracesTable() {
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
        console.log('🔗 连接数据库...');
        connection = await mysql.createConnection(config);
        console.log('✅ 数据库连接成功');

        // 创建 LLM 调用追踪表
        console.log('📋 创建 llm_call_traces 表...');
        const createTableSQL = `
        CREATE TABLE IF NOT EXISTS llm_call_traces (
            id VARCHAR(50) PRIMARY KEY,
            session_id VARCHAR(36) NOT NULL,
            conversation_id VARCHAR(50),
            call_sequence INT NOT NULL,
            engine_type ENUM('decision', 'context', 'persona', 'main_chat', 'requirement') NOT NULL,
            model_name VARCHAR(100),
            prompt TEXT,
            response TEXT,
            prompt_tokens INT DEFAULT 0,
            completion_tokens INT DEFAULT 0,
            total_tokens INT DEFAULT 0,
            response_time DECIMAL(10,4) DEFAULT 0,
            timestamp DATETIME NOT NULL,
            success BOOLEAN DEFAULT TRUE,
            error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            
            INDEX idx_session_sequence (session_id, call_sequence),
            INDEX idx_conversation (conversation_id),
            INDEX idx_timestamp (timestamp),
            INDEX idx_engine_type (engine_type),
            
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;
        
        await connection.execute(createTableSQL);
        console.log('✅ llm_call_traces 表创建成功');

        // 检查表结构
        console.log('\n📋 验证表结构...');
        const [columns] = await connection.execute('DESCRIBE llm_call_traces');
        console.log('表字段:');
        columns.forEach(col => {
            console.log(`  ${col.Field}: ${col.Type} ${col.Null === 'YES' ? '(可空)' : '(非空)'} ${col.Extra || ''}`);
        });

        // 检查索引
        console.log('\n🔍 验证索引...');
        const [indexes] = await connection.execute('SHOW INDEX FROM llm_call_traces');
        const uniqueIndexes = [...new Set(indexes.map(idx => idx.Key_name))];
        console.log('索引:');
        uniqueIndexes.forEach(idx => {
            console.log(`  ${idx}`);
        });

        // 插入测试数据以验证表结构
        console.log('\n🧪 插入测试数据验证...');
        const testRecord = {
            id: 'test_' + Date.now(),
            session_id: 'test_session_123',
            conversation_id: null,
            call_sequence: 1,
            engine_type: 'decision',
            model_name: 'gemini-1.5-pro',
            prompt: '测试prompt：这是一个决策引擎调用',
            response: '测试响应：应该回复用户',
            prompt_tokens: 150,
            completion_tokens: 50,
            total_tokens: 200,
            response_time: 1.2345,
            timestamp: new Date(),
            success: true
        };

        await connection.execute(`
            INSERT INTO llm_call_traces 
            (id, session_id, conversation_id, call_sequence, engine_type, model_name, 
             prompt, response, prompt_tokens, completion_tokens, total_tokens, 
             response_time, timestamp, success) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            testRecord.id, testRecord.session_id, testRecord.conversation_id,
            testRecord.call_sequence, testRecord.engine_type, testRecord.model_name,
            testRecord.prompt, testRecord.response, testRecord.prompt_tokens,
            testRecord.completion_tokens, testRecord.total_tokens, testRecord.response_time,
            testRecord.timestamp, testRecord.success
        ]);

        console.log('✅ 测试记录插入成功');

        // 验证查询
        const [testResult] = await connection.execute(
            'SELECT * FROM llm_call_traces WHERE id = ?', [testRecord.id]
        );
        console.log('✅ 测试记录查询成功');
        console.log(`  记录详情: ${testResult[0].engine_type} 引擎, ${testResult[0].total_tokens} tokens`);

        // 清理测试数据
        await connection.execute('DELETE FROM llm_call_traces WHERE id = ?', [testRecord.id]);
        console.log('🧹 测试数据清理完成');

        console.log('\n🎉 llm_call_traces 表创建并验证成功！');
        
    } catch (error) {
        console.error('❌ 创建表失败:', error.message);
        console.error('详细错误:', error);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 数据库连接已关闭');
        }
    }
}

createLLMTracesTable().catch(console.error);