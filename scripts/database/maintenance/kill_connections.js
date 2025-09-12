const mysql = require('mysql2/promise');

async function killLeakedConnections() {
    const config = {
        host: 'localhost',
        port: 3306,
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db'
    };

    try {
        console.log('🔧 清理泄漏的数据库连接...');
        
        const connection = await mysql.createConnection(config);
        
        // 获取所有Sleep状态的qqbot_user连接
        const [processes] = await connection.execute(`
            SELECT Id, User, Command, Time, State 
            FROM information_schema.processlist 
            WHERE User = 'qqbot_user' 
            AND Command = 'Sleep' 
            AND Time > 60
        `);
        
        console.log(`发现 ${processes.length} 个泄漏连接`);
        
        // 逐个KILL
        for (const process of processes) {
            try {
                await connection.execute(`KILL ${process.Id}`);
                console.log(`✅ 已终止连接 ${process.Id} (Sleep ${process.Time}s)`);
            } catch (error) {
                console.log(`⚠️  无法终止连接 ${process.Id}: ${error.message}`);
            }
        }
        
        // 检查结果
        const [remaining] = await connection.execute(`
            SELECT COUNT(*) as count 
            FROM information_schema.processlist 
            WHERE User = 'qqbot_user' 
            AND Command = 'Sleep'
        `);
        
        console.log(`清理完成，剩余Sleep连接: ${remaining[0].count} 个`);
        
        await connection.end();
        
    } catch (error) {
        console.error('❌ 清理连接失败:', error);
    }
}

killLeakedConnections().then(() => {
    console.log('🎉 连接清理完成!');
    process.exit(0);
});