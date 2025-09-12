// 测试QQBot Core的DatabaseManager
const path = require('path');

// 模拟QQBot Core的数据库管理器
class TestDatabaseManager {
    constructor() {
        this.mysql = require('mysql2/promise');
        this.pool = null;
        this.config = {
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            charset: 'utf8mb4',
            timezone: '+08:00',
            connectionLimit: 10,
            queueLimit: 0,
            acquireTimeout: 10000,
            timeout: 15000,
            idleTimeout: 300000,
            enableKeepAlive: true
        };
        this.createConnectionPool();
    }

    createConnectionPool() {
        try {
            this.pool = this.mysql.createPool(this.config);
            console.log('✅ Database connection pool created');
        } catch (error) {
            console.error('❌ Error creating pool:', error);
        }
    }

    async ensureUtf8Connection(connection) {
        try {
            await connection.execute("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
            await connection.execute("SET character_set_client = utf8mb4");
        } catch (error) {
            console.warn('Failed to set UTF-8:', error.message);
        }
    }

    async executeQuery(query, params = []) {
        const startTime = Date.now();
        const queryId = Math.random().toString(36).substr(2, 8);
        let connection = null;
        
        console.log(`[${queryId}] 🔍 Starting query execution`);
        
        try {
            if (!this.pool) {
                throw new Error('Database pool not initialized');
            }

            console.log(`[${queryId}] 🔗 Getting connection from pool`);
            connection = await this.pool.getConnection();
            
            console.log(`[${queryId}] ⚙️  Setting UTF-8 connection`);
            await this.ensureUtf8Connection(connection);
            
            console.log(`[${queryId}] ⚡ Executing query with timeout protection`);
            
            // 添加查询超时保护 (与修复后的代码一致)
            const queryPromise = connection.execute(query, params);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Query timeout after 12 seconds`)), 12000);
            });
            
            const [rows] = await Promise.race([queryPromise, timeoutPromise]);
            
            console.log(`[${queryId}] 🔓 Releasing connection`);
            connection.release();
            connection = null;
            
            const executionTime = Date.now() - startTime;
            console.log(`[${queryId}] ✅ Query completed (${executionTime}ms, ${Array.isArray(rows) ? rows.length : 0} rows)`);
            
            return Array.isArray(rows) ? rows : [];
        } catch (error) {
            const executionTime = Date.now() - startTime;
            console.error(`[${queryId}] ❌ Query failed (${executionTime}ms):`, error.message);
            
            // 释放连接
            if (connection) {
                try {
                    connection.release();
                } catch (releaseError) {
                    console.error(`[${queryId}] 💥 Failed to release connection:`, releaseError.message);
                }
            }
            
            throw error;
        }
    }

    async getPrivateMessageHistory(userId, limit = 20) {
        const safeLimit = Math.max(1, Math.floor(Number(limit)));
        
        const query = `SELECT * FROM conversations WHERE user_id = ? AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' OR raw_request IS NULL OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL) ORDER BY timestamp DESC LIMIT ${safeLimit}`;
        
        console.log(`🎯 Executing getPrivateMessageHistory for user ${userId} with limit ${safeLimit}`);
        
        const results = await this.executeQuery(query, [userId]);
        
        console.log(`📊 Retrieved ${results.length} private messages`);
        return results.reverse(); // 返回正序
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('🔌 Database pool closed');
        }
    }
}

async function testQQBotDatabaseManager() {
    console.log('🚀 测试QQBot Core的DatabaseManager...\n');
    
    const dbManager = new TestDatabaseManager();
    
    try {
        // 测试1: 基本连接测试
        console.log('📋 测试1: 基本查询测试');
        const basicQuery = 'SELECT COUNT(*) as total FROM conversations';
        const basicResult = await dbManager.executeQuery(basicQuery);
        console.log(`总记录数: ${basicResult[0].total}\n`);

        // 测试2: 问题查询 - 这是卡住的查询
        console.log('📋 测试2: 问题查询 - getPrivateMessageHistory(85178516, 20)');
        const historyStart = Date.now();
        const history = await dbManager.getPrivateMessageHistory(85178516, 20);
        const historyTime = Date.now() - historyStart;
        console.log(`✅ getPrivateMessageHistory完成! (${historyTime}ms, ${history.length} 条记录)\n`);

        // 测试3: 模拟上下文管理器的完整流程
        console.log('📋 测试3: 模拟完整的buildMessageContext流程');
        const mockMessage = {
            message_type: 'private',
            user_id: 85178516,
            message: '咱之前都聊了啥？',
            raw_message: '咱之前都聊了啥？',
            message_id: Date.now(),
            time: Math.floor(Date.now() / 1000),
            self_id: 1129974489,
            sender: {
                user_id: 85178516,
                nickname: '测试用户85178516',
                sex: 'unknown'
            },
            font: 14,
            sub_type: 'friend',
            post_type: 'message'
        };

        console.log('Step 1: Getting history messages...');
        const contextStart = Date.now();
        const contextHistory = await dbManager.getPrivateMessageHistory(mockMessage.user_id, 20);
        const contextTime = Date.now() - contextStart;
        
        console.log(`✅ 上下文构建完成! (${contextTime}ms)`);
        console.log(`📝 获取到 ${contextHistory.length} 条历史消息`);
        
        if (contextHistory.length > 0) {
            console.log('最新消息预览:');
            contextHistory.slice(-3).forEach((msg, idx) => {
                console.log(`  ${idx + 1}. ${msg.user_message?.substring(0, 30) || 'No message'}...`);
            });
        }

        // 测试4: 并发查询测试
        console.log('\n📋 测试4: 并发查询测试 (模拟多用户同时访问)');
        const concurrentStart = Date.now();
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(dbManager.getPrivateMessageHistory(85178516, 10));
        }
        
        const concurrentResults = await Promise.all(promises);
        const concurrentTime = Date.now() - concurrentStart;
        console.log(`✅ 5个并发查询完成! (${concurrentTime}ms)`);
        concurrentResults.forEach((result, idx) => {
            console.log(`  查询${idx + 1}: ${result.length} 条记录`);
        });

    } catch (error) {
        console.error('💥 测试失败:', error);
        console.error('错误堆栈:', error.stack);
    } finally {
        await dbManager.close();
    }
}

// 执行测试
testQQBotDatabaseManager().then(() => {
    console.log('\n🎉 QQBot DatabaseManager测试完成!');
    process.exit(0);
}).catch(error => {
    console.error('\n💥 测试异常:', error);
    process.exit(1);
});