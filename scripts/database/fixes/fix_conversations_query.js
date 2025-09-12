const mysql = require('mysql2/promise');

async function fixConversationsQuery() {
    const config = {
        host: 'localhost',
        port: 3306,
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db',
        charset: 'utf8mb4',
        timezone: '+08:00'
    };

    let connection;
    
    try {
        console.log('=== Conversations Query Fix Analysis ===');
        connection = await mysql.createConnection(config);
        
        // 1. 测试Admin Panel的原始查询
        console.log('\n1. Testing Admin Panel Query (Original)...');
        try {
            const adminQuery = `
                SELECT id, user_id, user_message, ai_response, timestamp, response_time, 
                       model_name, message_id, reply_to_message_id, reply_to_text, 
                       created_at, updated_at
                FROM conversations 
                WHERE 1=1
                ORDER BY timestamp DESC 
                LIMIT 5 OFFSET 0
            `;
            const [adminRows] = await connection.execute(adminQuery);
            console.log(`   ✅ Admin query SUCCESS - ${adminRows.length} rows returned`);
            if (adminRows.length > 0) {
                console.log(`   First record: ${adminRows[0].id}, user_id: ${adminRows[0].user_id}`);
            }
        } catch (error) {
            console.log(`   ❌ Admin query FAILED: ${error.message}`);
        }
        
        // 2. 测试QQBot Core的原始查询
        console.log('\n2. Testing QQBot Core Query (Original)...');
        try {
            const coreQuery = `
                SELECT c.*, 
                       JSON_EXTRACT(c.raw_request, '$.raw_message') as user_raw_input,
                       JSON_EXTRACT(c.raw_request, '$.sender.nickname') as user_nickname,
                       JSON_EXTRACT(c.raw_request, '$.message_type') as message_type,
                       JSON_EXTRACT(c.raw_request, '$.group_id') as group_id
                FROM conversations c 
                ORDER BY c.timestamp DESC 
                LIMIT 5 OFFSET 0
            `;
            const [coreRows] = await connection.execute(coreQuery);
            console.log(`   ✅ Core query SUCCESS - ${coreRows.length} rows returned`);
            if (coreRows.length > 0) {
                console.log(`   First record: ${coreRows[0].id}, user_id: ${coreRows[0].user_id}`);
            }
        } catch (error) {
            console.log(`   ❌ Core query FAILED: ${error.message}`);
            console.log(`   Error details:`, error);
            
            // 尝试简化的查询来检查JSON_EXTRACT问题
            console.log('\n   Testing simplified JSON_EXTRACT...');
            try {
                const simpleJsonQuery = `SELECT id, raw_request FROM conversations LIMIT 1`;
                const [simpleRows] = await connection.execute(simpleJsonQuery);
                if (simpleRows.length > 0) {
                    console.log(`   Raw request sample: ${simpleRows[0].raw_request ? 'HAS_DATA' : 'NULL'}`);
                    if (simpleRows[0].raw_request) {
                        try {
                            const parsed = JSON.parse(simpleRows[0].raw_request);
                            console.log(`   JSON parsing: SUCCESS`);
                            console.log(`   Keys:`, Object.keys(parsed));
                        } catch (parseError) {
                            console.log(`   JSON parsing: FAILED - ${parseError.message}`);
                        }
                    }
                }
            } catch (innerError) {
                console.log(`   Simple query also failed: ${innerError.message}`);
            }
        }
        
        // 3. 检查raw_request字段的数据质量
        console.log('\n3. Analyzing raw_request data quality...');
        try {
            const [dataQuality] = await connection.execute(`
                SELECT 
                    COUNT(*) as total_records,
                    SUM(CASE WHEN raw_request IS NOT NULL THEN 1 ELSE 0 END) as has_raw_request,
                    SUM(CASE WHEN raw_request IS NULL THEN 1 ELSE 0 END) as null_raw_request,
                    SUM(CASE WHEN JSON_VALID(raw_request) THEN 1 ELSE 0 END) as valid_json,
                    SUM(CASE WHEN NOT JSON_VALID(raw_request) AND raw_request IS NOT NULL THEN 1 ELSE 0 END) as invalid_json
                FROM conversations
            `);
            console.log(`   Data quality:`, dataQuality[0]);
        } catch (error) {
            console.log(`   Data quality check failed: ${error.message}`);
        }
        
        // 4. 测试修复版本的查询
        console.log('\n4. Testing Fixed Queries...');
        
        // Admin Panel 修复版本 - 添加错误处理
        console.log('\n   4a. Admin Panel Fixed Query...');
        try {
            const fixedAdminQuery = `
                SELECT id, user_id, user_message, ai_response, timestamp, response_time, 
                       model_name, message_id, reply_to_message_id, reply_to_text, 
                       created_at, updated_at
                FROM conversations 
                ORDER BY timestamp DESC 
                LIMIT 5
            `;
            const [fixedAdminRows] = await connection.execute(fixedAdminQuery);
            console.log(`   ✅ Fixed Admin query SUCCESS - ${fixedAdminRows.length} rows`);
        } catch (error) {
            console.log(`   ❌ Fixed Admin query FAILED: ${error.message}`);
        }
        
        // QQBot Core 修复版本 - 安全的JSON处理
        console.log('\n   4b. QQBot Core Fixed Query...');
        try {
            const fixedCoreQuery = `
                SELECT 
                    c.*,
                    CASE 
                        WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                        THEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.raw_message'))
                        ELSE NULL 
                    END as user_raw_input,
                    CASE 
                        WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                        THEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.sender.nickname'))
                        ELSE NULL 
                    END as user_nickname,
                    CASE 
                        WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                        THEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.message_type'))
                        ELSE NULL 
                    END as message_type,
                    CASE 
                        WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                        THEN JSON_EXTRACT(c.raw_request, '$.group_id')
                        ELSE NULL 
                    END as group_id
                FROM conversations c 
                ORDER BY c.timestamp DESC 
                LIMIT 5
            `;
            const [fixedCoreRows] = await connection.execute(fixedCoreQuery);
            console.log(`   ✅ Fixed Core query SUCCESS - ${fixedCoreRows.length} rows`);
            if (fixedCoreRows.length > 0) {
                console.log(`   Sample data:`, {
                    id: fixedCoreRows[0].id,
                    user_id: fixedCoreRows[0].user_id,
                    user_nickname: fixedCoreRows[0].user_nickname,
                    message_type: fixedCoreRows[0].message_type,
                    has_raw_request: !!fixedCoreRows[0].raw_request
                });
            }
        } catch (error) {
            console.log(`   ❌ Fixed Core query FAILED: ${error.message}`);
        }
        
        console.log('\n=== Fix Recommendations ===');
        console.log('1. Admin Panel: Remove silent error handling, let errors surface');
        console.log('2. QQBot Core: Add JSON_VALID() checks before JSON_EXTRACT()');
        console.log('3. Add proper logging for database query failures');
        console.log('4. Consider adding database query timeout configuration');
        
    } catch (error) {
        console.error('Connection error:', error.message);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

fixConversationsQuery().catch(console.error);