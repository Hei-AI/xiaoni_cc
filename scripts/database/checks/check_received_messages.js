const mysql = require('mysql2/promise');

async function checkReceivedMessages() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db'
    });

    try {
        // 查看最近的系统日志（修正字段名）
        console.log('=== 最近的系统日志 ===');
        const [systemLogs] = await connection.execute(`
            SELECT log_level, module_name, message, timestamp 
            FROM system_logs 
            WHERE timestamp > DATE_SUB(NOW(), INTERVAL 2 HOUR)
            ORDER BY timestamp DESC 
            LIMIT 20
        `);
        
        if (systemLogs.length > 0) {
            console.table(systemLogs);
        } else {
            console.log('没有找到最近2小时的系统日志');
        }

        // 查看接收到的消息（不是发送的）
        console.log('\n=== 最近接收到的消息 ===');
        const [receivedMessages] = await connection.execute(`
            SELECT id, direction, message_type, user_id, group_id, message_id, timestamp, status
            FROM websocket_logs 
            WHERE direction = 'IN' 
            AND message_type NOT IN ('message_sent', 'notice')
            ORDER BY timestamp DESC 
            LIMIT 10
        `);
        
        if (receivedMessages.length > 0) {
            console.table(receivedMessages);
        } else {
            console.log('没有找到最近接收到的消息');
        }

        // 查看raw_payload来分析具体的消息内容
        console.log('\n=== 最近接收消息的详细内容 ===');
        const [messageDetails] = await connection.execute(`
            SELECT id, direction, message_type, raw_payload, timestamp
            FROM websocket_logs 
            WHERE direction = 'IN'
            ORDER BY timestamp DESC 
            LIMIT 5
        `);
        
        for (const msg of messageDetails) {
            console.log(`\n--- 消息 ID: ${msg.id}, 时间: ${msg.timestamp} ---`);
            console.log(`方向: ${msg.direction}, 类型: ${msg.message_type}`);
            console.log('原始内容:', JSON.stringify(msg.raw_payload, null, 2));
        }

        // 检查ERROR状态的消息
        console.log('\n=== 处理失败的消息 ===');
        const [errorMessages] = await connection.execute(`
            SELECT id, direction, message_type, user_id, group_id, timestamp, error_message
            FROM websocket_logs 
            WHERE status = 'ERROR'
            ORDER BY timestamp DESC 
            LIMIT 5
        `);
        
        if (errorMessages.length > 0) {
            console.table(errorMessages);
        } else {
            console.log('没有找到处理失败的消息');
        }

    } catch (error) {
        console.error('查询错误:', error.message);
    } finally {
        await connection.end();
    }
}

checkReceivedMessages().catch(console.error);