const mysql = require('mysql2/promise');

async function checkUserMessages() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db'
    });

    try {
        // 查找所有包含"message"类型的接收消息
        console.log('=== 查找所有接收到的message类型消息 ===');
        const [messageEvents] = await connection.execute(`
            SELECT id, direction, message_type, user_id, group_id, 
                   JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.post_type')) as post_type,
                   JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.message_type')) as msg_type,
                   JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.raw_message')) as raw_message,
                   timestamp
            FROM websocket_logs 
            WHERE direction = 'IN' 
            AND JSON_EXTRACT(raw_payload, '$.post_type') = 'message'
            ORDER BY timestamp DESC 
            LIMIT 20
        `);
        
        if (messageEvents.length > 0) {
            console.table(messageEvents);
        } else {
            console.log('没有找到任何接收到的message类型消息！');
        }

        // 查找最近所有的IN方向消息
        console.log('\n=== 最近所有接收到的消息类型统计 ===');
        const [messageTypes] = await connection.execute(`
            SELECT message_type, 
                   COUNT(*) as count,
                   MAX(timestamp) as latest_time
            FROM websocket_logs 
            WHERE direction = 'IN'
            AND timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)
            GROUP BY message_type
            ORDER BY count DESC
        `);
        
        if (messageTypes.length > 0) {
            console.table(messageTypes);
        } else {
            console.log('没有找到任何接收消息的统计');
        }

        // 查看最新的几条原始payload
        console.log('\n=== 最近接收到的消息原始内容 ===');
        const [rawMessages] = await connection.execute(`
            SELECT id, 
                   JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.post_type')) as post_type,
                   JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.message_type')) as msg_type,
                   JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.raw_message')) as content,
                   JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.user_id')) as sender_id,
                   timestamp
            FROM websocket_logs 
            WHERE direction = 'IN'
            ORDER BY timestamp DESC 
            LIMIT 10
        `);
        
        if (rawMessages.length > 0) {
            console.table(rawMessages);
        } else {
            console.log('没有找到任何接收消息');
        }

        // 特别查找包含"我们之前说到哪了"的消息
        console.log('\n=== 搜索特定消息 ===');
        const [specificMessage] = await connection.execute(`
            SELECT id, raw_payload, timestamp
            FROM websocket_logs 
            WHERE direction = 'IN'
            AND JSON_SEARCH(raw_payload, 'one', '%我们之前说到哪了%') IS NOT NULL
            ORDER BY timestamp DESC
        `);
        
        if (specificMessage.length > 0) {
            console.log('找到包含目标消息的记录:');
            console.table(specificMessage);
        } else {
            console.log('没有找到包含"我们之前说到哪了"的WebSocket记录');
        }

    } catch (error) {
        console.error('查询错误:', error.message);
    } finally {
        await connection.end();
    }
}

checkUserMessages().catch(console.error);