const mysql = require('mysql2/promise');
const { spawn } = require('child_process');

// 深度系统诊断工具
class DeepDiagnostic {
    constructor() {
        this.config = {
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            charset: 'utf8mb4',
            timezone: '+08:00'
        };
    }

    async runDiagnostic() {
        console.log('🔬 开始深度系统诊断...\n');
        
        // 1. MySQL服务状态检查
        await this.checkMySQLStatus();
        
        // 2. 连接池状态检查
        await this.checkConnectionPool();
        
        // 3. 数据库锁状态检查
        await this.checkDatabaseLocks();
        
        // 4. 进程状态检查
        await this.checkProcessStatus();
        
        // 5. 实时监控问题查询
        await this.monitorProblematicQuery();
    }

    async checkMySQLStatus() {
        console.log('📊 检查MySQL服务状态...');
        
        try {
            const connection = await mysql.createConnection(this.config);
            
            // 检查连接状态
            const [status] = await connection.execute('SHOW STATUS LIKE "Threads%"');
            console.log('MySQL连接状态:');
            status.forEach(row => {
                console.log(`  ${row.Variable_name}: ${row.Value}`);
            });
            
            // 检查进程列表
            const [processes] = await connection.execute('SHOW PROCESSLIST');
            console.log(`\n当前MySQL进程数: ${processes.length}`);
            
            const problematicProcesses = processes.filter(p => 
                p.Time > 5 || p.State === 'Locked' || p.Command === 'Sleep'
            );
            
            if (problematicProcesses.length > 0) {
                console.log('🚨 发现可疑进程:');
                problematicProcesses.forEach(p => {
                    console.log(`  ID: ${p.Id}, User: ${p.User}, Command: ${p.Command}, Time: ${p.Time}s, State: ${p.State}`);
                    if (p.Info) console.log(`    Query: ${p.Info.substring(0, 100)}...`);
                });
            } else {
                console.log('✅ 未发现长时间运行的查询');
            }
            
            await connection.end();
        } catch (error) {
            console.error('❌ MySQL状态检查失败:', error.message);
        }
    }

    async checkConnectionPool() {
        console.log('\n🔗 检查连接池状态...');
        
        try {
            // 创建多个并发连接测试
            const testConnections = [];
            const startTime = Date.now();
            
            for (let i = 0; i < 5; i++) {
                testConnections.push(
                    mysql.createConnection(this.config).then(conn => {
                        return conn.execute('SELECT CONNECTION_ID(), NOW() as test_time')
                            .then(([rows]) => ({ connectionId: i, rows, conn }));
                    })
                );
            }
            
            const results = await Promise.all(testConnections);
            const connectionTime = Date.now() - startTime;
            
            console.log(`✅ ${results.length} 个并发连接成功创建 (${connectionTime}ms)`);
            
            // 关闭连接
            for (const result of results) {
                await result.conn.end();
            }
            
        } catch (error) {
            console.error('❌ 连接池测试失败:', error.message);
        }
    }

    async checkDatabaseLocks() {
        console.log('\n🔒 检查数据库锁状态...');
        
        try {
            const connection = await mysql.createConnection(this.config);
            
            // 检查InnoDB锁状态
            const [locks] = await connection.execute(`
                SELECT 
                    r.trx_id waiting_trx_id,
                    r.trx_mysql_thread_id waiting_thread,
                    r.trx_query waiting_query,
                    b.trx_id blocking_trx_id,
                    b.trx_mysql_thread_id blocking_thread,
                    b.trx_query blocking_query
                FROM information_schema.innodb_lock_waits w
                INNER JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
                INNER JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id
            `);
            
            if (locks.length > 0) {
                console.log('🚨 发现数据库锁等待:');
                locks.forEach(lock => {
                    console.log(`  等待事务: ${lock.waiting_trx_id} (线程: ${lock.waiting_thread})`);
                    console.log(`  阻塞事务: ${lock.blocking_trx_id} (线程: ${lock.blocking_thread})`);
                    if (lock.waiting_query) console.log(`  等待查询: ${lock.waiting_query}`);
                    if (lock.blocking_query) console.log(`  阻塞查询: ${lock.blocking_query}`);
                });
            } else {
                console.log('✅ 未发现数据库锁等待');
            }
            
            // 检查表级锁
            const [tableLocks] = await connection.execute('SHOW OPEN TABLES WHERE In_use > 0');
            if (tableLocks.length > 0) {
                console.log('🚨 发现表级锁:');
                tableLocks.forEach(lock => {
                    console.log(`  Database: ${lock.Database}, Table: ${lock.Table}, In_use: ${lock.In_use}`);
                });
            } else {
                console.log('✅ 未发现表级锁');
            }
            
            await connection.end();
        } catch (error) {
            console.error('❌ 锁状态检查失败:', error.message);
        }
    }

    async checkProcessStatus() {
        console.log('\n⚙️ 检查系统进程状态...');
        
        return new Promise((resolve) => {
            // 检查端口占用
            const netstat = spawn('netstat', ['-tlnp']);
            let output = '';
            
            netstat.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            netstat.on('close', () => {
                const lines = output.split('\n');
                const relevantPorts = lines.filter(line => 
                    line.includes(':3306') || line.includes(':8081')
                );
                
                console.log('相关端口占用情况:');
                relevantPorts.forEach(line => {
                    if (line.trim()) console.log(`  ${line.trim()}`);
                });
                
                resolve();
            });
        });
    }

    async monitorProblematicQuery() {
        console.log('\n🎯 实时监控问题查询...');
        
        try {
            const connection = await mysql.createConnection(this.config);
            
            console.log('开始执行问题查询，监控5秒...');
            
            // 启动监控
            const monitor = setInterval(async () => {
                try {
                    const [processes] = await connection.execute('SHOW PROCESSLIST');
                    const longRunning = processes.filter(p => p.Time > 1);
                    
                    if (longRunning.length > 0) {
                        console.log(`⏱️  发现运行时间超过1秒的查询: ${longRunning.length} 个`);
                        longRunning.forEach(p => {
                            console.log(`  进程ID: ${p.Id}, 运行时间: ${p.Time}s, 状态: ${p.State}`);
                            if (p.Info) console.log(`  查询: ${p.Info.substring(0, 150)}...`);
                        });
                    }
                } catch (monitorError) {
                    console.error('监控查询失败:', monitorError.message);
                }
            }, 1000);
            
            // 执行问题查询
            setTimeout(async () => {
                console.log('执行问题查询: getPrivateMessageHistory...');
                try {
                    const queryStart = Date.now();
                    const [rows] = await connection.execute(`
                        SELECT * FROM conversations 
                        WHERE user_id = ? 
                        AND (JSON_EXTRACT(raw_request, '$.message_type') = 'private' 
                             OR raw_request IS NULL 
                             OR JSON_EXTRACT(raw_request, '$.message_type') IS NULL) 
                        ORDER BY timestamp DESC 
                        LIMIT 20
                    `, [85178516]);
                    const queryTime = Date.now() - queryStart;
                    
                    console.log(`✅ 查询完成: ${rows.length} 条记录, 耗时 ${queryTime}ms`);
                } catch (queryError) {
                    console.error('❌ 问题查询失败:', queryError.message);
                }
                
                clearInterval(monitor);
                await connection.end();
                
                console.log('\n📋 诊断总结:');
                console.log('1. 如果查询本身正常，问题可能在应用层面');
                console.log('2. 检查Node.js事件循环是否被阻塞');
                console.log('3. 检查是否有异步操作死锁');
                console.log('4. 建议使用Node.js调试工具进一步分析');
                
            }, 1000);
            
        } catch (error) {
            console.error('❌ 查询监控失败:', error.message);
        }
    }
}

// 执行诊断
const diagnostic = new DeepDiagnostic();
diagnostic.runDiagnostic().then(() => {
    console.log('\n🎉 深度诊断完成!');
    setTimeout(() => process.exit(0), 2000);
}).catch(error => {
    console.error('💥 诊断失败:', error);
    process.exit(1);
});