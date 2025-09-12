const mysql = require('mysql2/promise');
const fs = require('fs').promises;

async function backupDatabase() {
    const config = {
        host: 'localhost',
        port: 3306,
        user: 'qqbot_user',
        password: 'qqbot_password',
        database: 'qqbot_db',
        charset: 'utf8mb4'
    };

    let connection;
    
    try {
        console.log('🔗 连接数据库...');
        connection = await mysql.createConnection(config);
        console.log('✅ 数据库连接成功');

        // 获取当前时间作为备份文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = `database_backup_${timestamp}.sql`;
        
        console.log(`📦 开始备份数据库到: ${backupFile}`);
        
        let backupData = `-- QQBot Database Backup\n-- Date: ${new Date().toISOString()}\n-- Total records to backup\n\n`;
        
        // 备份 conversations 表
        console.log('📄 备份 conversations 表...');
        const [conversations] = await connection.execute('SELECT * FROM conversations ORDER BY timestamp DESC');
        
        backupData += `-- conversations 表备份 (${conversations.length} 条记录)\n`;
        backupData += `DROP TABLE IF EXISTS conversations_backup;\n`;
        backupData += `CREATE TABLE conversations_backup LIKE conversations;\n`;
        
        for (const row of conversations) {
            const values = [
                `'${row.id}'`,
                row.user_id,
                `'${(row.user_message || '').replace(/'/g, "''")}'`,
                `'${(row.ai_response || '').replace(/'/g, "''")}'`,
                `'${row.timestamp.toISOString().slice(0, 19).replace('T', ' ')}'`,
                row.response_time,
                row.model_name ? `'${row.model_name}'` : 'NULL',
                `'${row.created_at.toISOString().slice(0, 19).replace('T', ' ')}'`,
                `'${row.updated_at.toISOString().slice(0, 19).replace('T', ' ')}'`,
                row.raw_request ? `'${row.raw_request.replace(/'/g, "''")}'` : 'NULL',
                row.raw_response ? `'${row.raw_response.replace(/'/g, "''")}'` : 'NULL',
                row.message_id || 'NULL',
                row.reply_to_message_id || 'NULL',
                row.reply_to_text ? `'${row.reply_to_text.replace(/'/g, "''")}'` : 'NULL',
                row.session_id ? `'${row.session_id}'` : 'NULL'
            ];
            
            backupData += `INSERT INTO conversations_backup VALUES (${values.join(', ')});\n`;
        }
        
        backupData += `\n`;
        
        // 备份其他重要表
        const otherTables = ['api_tokens', 'requirements', 'system_logs'];
        
        for (const tableName of otherTables) {
            try {
                console.log(`📄 备份 ${tableName} 表...`);
                const [rows] = await connection.execute(`SELECT * FROM ${tableName}`);
                console.log(`  找到 ${rows.length} 条记录`);
                
                if (rows.length > 0) {
                    backupData += `-- ${tableName} 表备份 (${rows.length} 条记录)\n`;
                    backupData += `-- 这个表的数据需要手动恢复\n\n`;
                }
            } catch (error) {
                console.log(`  ⚠️ 表 ${tableName} 不存在或无法访问: ${error.message}`);
            }
        }
        
        // 写入备份文件
        await fs.writeFile(backupFile, backupData, 'utf8');
        console.log(`✅ 数据库备份完成: ${backupFile}`);
        
        // 显示备份统计
        console.log('\n📊 备份统计:');
        console.log(`  conversations: ${conversations.length} 条记录`);
        console.log(`  备份文件大小: ${(await fs.stat(backupFile)).size} bytes`);
        
        return backupFile;
        
    } catch (error) {
        console.error('❌ 备份失败:', error.message);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 数据库连接已关闭');
        }
    }
}

backupDatabase().then(file => {
    console.log(`\n🎉 备份成功完成！备份文件: ${file}`);
}).catch(console.error);