const mysql = require('mysql2/promise');

async function debugDatabaseQueries() {
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
        console.log('=== Database Debug Analysis ===');
        connection = await mysql.createConnection(config);
        
        // 1. 检查总数统计（用于Admin Panel统计）
        console.log('\n1. Stats Query (COUNT):');
        const [countRows] = await connection.execute('SELECT COUNT(*) as total FROM conversations');
        console.log(`   Total conversations: ${countRows[0].total}`);
        
        // 2. 检查表结构
        console.log('\n2. Table Structure:');
        const [structureRows] = await connection.execute('DESCRIBE conversations');
        console.log('   Table columns:', structureRows.map(row => row.Field).join(', '));
        
        // 3. 检查前5条记录的基本信息（不包含大字段）
        console.log('\n3. Sample Records (Basic Info):');
        const [sampleRows] = await connection.execute(
            'SELECT id, user_id, timestamp, LENGTH(user_message) as msg_len, LENGTH(ai_response) as response_len FROM conversations LIMIT 5'
        );
        console.log('   Sample records:', sampleRows);
        
        // 4. 执行Admin Panel的实际查询
        console.log('\n4. Admin Panel Query Test:');
        const adminQuery = `
            SELECT id, user_id, user_message, ai_response, timestamp, response_time, 
                   model_name, message_id, reply_to_message_id, reply_to_text, 
                   created_at, updated_at
            FROM conversations 
            WHERE 1=1 
            ORDER BY timestamp DESC 
            LIMIT 10 OFFSET 0
        `;
        const [adminRows] = await connection.execute(adminQuery);
        console.log(`   Admin query returned ${adminRows.length} rows`);
        if (adminRows.length > 0) {
            console.log('   First row:', {
                id: adminRows[0].id,
                user_id: adminRows[0].user_id,
                has_message: !!adminRows[0].user_message,
                has_response: !!adminRows[0].ai_response,
                timestamp: adminRows[0].timestamp
            });
        }
        
        // 5. 执行QQBot Core的实际查询
        console.log('\n5. QQBot Core Query Test:');
        const coreQuery = `
            SELECT c.*, 
                   JSON_EXTRACT(c.raw_request, '$.raw_message') as user_raw_input, 
                   JSON_EXTRACT(c.raw_request, '$.sender.nickname') as user_nickname, 
                   JSON_EXTRACT(c.raw_request, '$.message_type') as message_type, 
                   JSON_EXTRACT(c.raw_request, '$.group_id') as group_id 
            FROM conversations c 
            ORDER BY c.timestamp DESC 
            LIMIT 10 OFFSET 0
        `;
        const [coreRows] = await connection.execute(coreQuery);
        console.log(`   Core query returned ${coreRows.length} rows`);
        if (coreRows.length > 0) {
            console.log('   First row:', {
                id: coreRows[0].id,
                user_id: coreRows[0].user_id,
                has_raw_request: !!coreRows[0].raw_request,
                message_type: coreRows[0].message_type,
                timestamp: coreRows[0].timestamp
            });
        }
        
        // 6. 检查是否有NULL值或空字符串导致过滤
        console.log('\n6. Data Quality Check:');
        const [nullCheck] = await connection.execute(`
            SELECT 
                SUM(CASE WHEN user_message IS NULL THEN 1 ELSE 0 END) as null_user_message,
                SUM(CASE WHEN ai_response IS NULL THEN 1 ELSE 0 END) as null_ai_response,
                SUM(CASE WHEN user_message = '' THEN 1 ELSE 0 END) as empty_user_message,
                SUM(CASE WHEN ai_response = '' THEN 1 ELSE 0 END) as empty_ai_response,
                SUM(CASE WHEN raw_request IS NULL THEN 1 ELSE 0 END) as null_raw_request
            FROM conversations
        `);
        console.log('   Null/Empty values:', nullCheck[0]);
        
        // 7. 检查时间戳范围
        console.log('\n7. Timestamp Range:');
        const [timeRange] = await connection.execute(`
            SELECT 
                MIN(timestamp) as earliest_timestamp,
                MAX(timestamp) as latest_timestamp,
                MIN(created_at) as earliest_created,
                MAX(created_at) as latest_created
            FROM conversations
        `);
        console.log('   Time range:', timeRange[0]);
        
    } catch (error) {
        console.error('Database query error:', error.message);
        if (error.code) {
            console.error('Error code:', error.code);
        }
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

debugDatabaseQueries().catch(console.error);