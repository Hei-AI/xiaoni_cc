const mysql = require('mysql2/promise');

async function checkWebSocketLogs() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db'
    });

    try {
        // 检查最近的WebSocket日志
        console.log('=== 最近的WebSocket日志 ===');
        const [wsLogs] = await connection.execute(`
            SELECT * FROM websocket_logs 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
        if (wsLogs.length > 0) {
            console.table(wsLogs);
        } else {
            console.log('没有找到WebSocket日志记录');
        }

        // 检查系统日志
        console.log('\n=== 最近的系统日志 ===');
        const [systemLogs] = await connection.execute(`
            SELECT level, message, timestamp, details 
            FROM system_logs 
            WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
            ORDER BY timestamp DESC 
            LIMIT 15
        `);
        
        if (systemLogs.length > 0) {
            console.table(systemLogs);
        } else {
            console.log('没有找到最近1小时的系统日志');
        }

        // 检查错误日志
        console.log('\n=== 最近的错误日志 ===');
        const [errorLogs] = await connection.execute(`
            SELECT level, message, timestamp, details 
            FROM system_logs 
            WHERE level = 'ERROR'
            ORDER BY timestamp DESC 
            LIMIT 10
        `);
        
        if (errorLogs.length > 0) {
            console.table(errorLogs);
        } else {
            console.log('没有找到错误日志');
        }

        // 检查bot状态
        console.log('\n=== Bot状态记录 ===');
        const [botStatus] = await connection.execute(`
            SELECT * FROM bot_status 
            ORDER BY updated_at DESC 
            LIMIT 5
        `);
        
        if (botStatus.length > 0) {
            console.table(botStatus);
        } else {
            console.log('没有找到bot状态记录');
        }

    } catch (error) {
        console.error('查询错误:', error.message);
        console.log('可能的表不存在，让我们检查一下有哪些表...');
        
        try {
            const [tables] = await connection.execute('SHOW TABLES');
            console.log('\n当前数据库中的表:');
            console.table(tables);
        } catch (e) {
            console.error('无法获取表列表:', e.message);
        }
    } finally {
        await connection.end();
    }
}

checkWebSocketLogs().catch(console.error);