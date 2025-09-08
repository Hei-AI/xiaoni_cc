const mysql = require('mysql2/promise');

async function fixDatabaseSchema() {
    let connection;
    try {
        console.log('🔧 开始修复数据库架构...');
        
        // 创建数据库连接
        connection = await mysql.createConnection({
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            charset: 'utf8mb4'
        });

        console.log('✅ 数据库连接建立成功');

        // 修复1: 确保conversation_sessions表存在
        console.log('\n1. 检查和创建conversation_sessions表...');
        const createConversationSessionsSQL = `
        CREATE TABLE IF NOT EXISTS conversation_sessions (
          session_id VARCHAR(255) PRIMARY KEY COMMENT '会话ID',
          user_id BIGINT NOT NULL COMMENT '用户ID',
          session_type ENUM('chat', 'requirement', 'mixed') NOT NULL DEFAULT 'chat' COMMENT '会话类型',
          current_service VARCHAR(100) NOT NULL DEFAULT 'chat' COMMENT '当前服务',
          status ENUM('active', 'paused', 'completed', 'expired') NOT NULL DEFAULT 'active' COMMENT '会话状态',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后活跃时间',
          expires_at TIMESTAMP NULL COMMENT '过期时间',
          conversation_context JSON COMMENT '对话上下文',
          business_context JSON COMMENT '业务上下文',
          message_count INT DEFAULT 0 COMMENT '消息计数',
          service_transitions JSON COMMENT '服务切换历史',
          recent_messages JSON COMMENT '最近消息记录',
          
          INDEX idx_user_id (user_id),
          INDEX idx_status (status),
          INDEX idx_last_activity (last_activity),
          INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话管理表'`;

        await connection.execute(createConversationSessionsSQL);
        console.log('✅ conversation_sessions表处理完成');

        // 修复2: 检查和添加conversations表的字段
        console.log('\n2. 检查conversations表结构...');
        
        // 首先检查表结构
        const [columns] = await connection.execute(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'conversations'"
        );
        
        const existingColumns = columns.map(col => col.COLUMN_NAME);
        console.log('现有字段:', existingColumns);

        // 检查并添加缺失的字段
        const requiredFields = [
            { name: 'raw_request', sql: 'ADD COLUMN raw_request TEXT NULL COMMENT "AI请求原始数据"' },
            { name: 'raw_response', sql: 'ADD COLUMN raw_response TEXT NULL COMMENT "AI响应原始数据"' },
            { name: 'message_id', sql: 'ADD COLUMN message_id BIGINT NULL COMMENT "消息ID"' },
            { name: 'reply_to_message_id', sql: 'ADD COLUMN reply_to_message_id BIGINT NULL COMMENT "回复的消息ID"' },
            { name: 'reply_to_text', sql: 'ADD COLUMN reply_to_text TEXT NULL COMMENT "回复的消息内容"' },
            { name: 'session_id', sql: 'ADD COLUMN session_id VARCHAR(255) NULL COMMENT "会话ID"' }
        ];

        for (const field of requiredFields) {
            if (!existingColumns.includes(field.name)) {
                console.log(`添加字段: ${field.name}`);
                try {
                    await connection.execute(`ALTER TABLE conversations ${field.sql}`);
                    console.log(`✅ ${field.name} 字段添加成功`);
                } catch (error) {
                    if (error.code === 'ER_DUP_FIELDNAME') {
                        console.log(`⚠️  ${field.name} 字段已存在`);
                    } else {
                        throw error;
                    }
                }
            } else {
                console.log(`✅ ${field.name} 字段已存在`);
            }
        }

        // 添加索引（如果不存在）
        console.log('\n3. 添加必要的索引...');
        try {
            await connection.execute('CREATE INDEX IF NOT EXISTS idx_session_id ON conversations(session_id)');
            console.log('✅ session_id索引处理完成');
        } catch (error) {
            if (error.code !== 'ER_DUP_KEYNAME') {
                throw error;
            }
            console.log('⚠️  session_id索引已存在');
        }

        // 验证修复结果
        console.log('\n4. 验证修复结果...');
        
        // 检查conversation_sessions表
        const [sessionCount] = await connection.execute('SELECT COUNT(*) as count FROM conversation_sessions');
        console.log(`✅ conversation_sessions表可访问，包含${sessionCount[0].count}条记录`);
        
        // 检查conversations表字段
        const [updatedColumns] = await connection.execute(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'qqbot_db' AND TABLE_NAME = 'conversations' ORDER BY COLUMN_NAME"
        );
        console.log('✅ conversations表字段:', updatedColumns.map(col => col.COLUMN_NAME));
        
        // 测试字段查询
        const [testQuery] = await connection.execute('SELECT COUNT(*) as count FROM conversations WHERE raw_request IS NOT NULL OR raw_request IS NULL');
        console.log(`✅ raw_request字段查询测试成功，表中有${testQuery[0].count}条记录`);

        console.log('\n🎉 数据库架构修复完成！');

    } catch (error) {
        console.error('❌ 数据库架构修复失败:', error.message);
        console.error('错误详情:', error);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
            console.log('📊 数据库连接已关闭');
        }
    }
}

// 执行修复
fixDatabaseSchema();