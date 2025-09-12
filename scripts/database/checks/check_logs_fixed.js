const mysql = require('mysql2/promise');

async function checkLogsFixed() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db'
    });

    try {
        // 先查看表结构
        console.log('=== websocket_logs 表结构 ===');
        const [wsStructure] = await connection.execute('DESCRIBE websocket_logs');
        console.table(wsStructure);

        console.log('\n=== system_logs 表结构 ===');
        const [sysStructure] = await connection.execute('DESCRIBE system_logs');
        console.table(sysStructure);

        // 查看最近的WebSocket日志（根据实际字段名）
        console.log('\n=== 最近的WebSocket日志 ===');
        const [wsLogs] = await connection.execute(`
            SELECT * FROM websocket_logs 
            ORDER BY timestamp DESC 
            LIMIT 10
        `);
        
        if (wsLogs.length > 0) {
            console.table(wsLogs);
        } else {
            console.log('没有找到WebSocket日志记录');
        }

        // 查看系统日志
        console.log('\n=== 最近的系统日志 ===');
        const [systemLogs] = await connection.execute(`
            SELECT level, message, timestamp, details 
            FROM system_logs 
            WHERE timestamp > DATE_SUB(NOW(), INTERVAL 2 HOUR)
            ORDER BY timestamp DESC 
            LIMIT 15
        `);
        
        if (systemLogs.length > 0) {
            console.table(systemLogs);
        } else {
            console.log('没有找到最近2小时的系统日志');
        }

        // 检查bot状态
        console.log('\n=== Bot状态记录 ===');
        const [botStatus] = await connection.execute(`
            SELECT * FROM bot_status 
            ORDER BY updated_at DESC 
            LIMIT 3
        `);
        
        if (botStatus.length > 0) {
            console.table(botStatus);
        } else {
            console.log('没有找到bot状态记录');
        }

    } catch (error) {
        console.error('查询错误:', error.message);
    } finally {
        await connection.end();
    }
}

checkLogsFixed().catch(console.error);