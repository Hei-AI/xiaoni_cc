const mysql = require('mysql2/promise');

async function testDatabaseConnection() {
    try {
        console.log('Testing database connection...');
        
        const connection = await mysql.createConnection({
            host: 'localhost',
            port: 3306,
            user: 'qqbot_user',
            password: 'qqbot_password',
            database: 'qqbot_db',
            charset: 'utf8mb4'
        });

        console.log('✅ Database connection established successfully!');

        // Test table existence
        const [tables] = await connection.execute('SHOW TABLES');
        console.log(`✅ Found ${tables.length} tables in database:`);
        tables.forEach(table => {
            console.log(`  - ${Object.values(table)[0]}`);
        });

        // Test conversation_sessions table
        try {
            const [sessionsResult] = await connection.execute('SELECT COUNT(*) as count FROM conversation_sessions');
            console.log(`✅ conversation_sessions table accessible, has ${sessionsResult[0].count} records`);
        } catch (error) {
            console.error('❌ Error accessing conversation_sessions table:', error.message);
        }

        // Test raw_request/raw_response columns
        try {
            const [conversationsResult] = await connection.execute('SELECT COUNT(*) as count FROM conversations WHERE raw_request IS NOT NULL');
            console.log(`✅ conversations table accessible, ${conversationsResult[0].count} records have raw_request data`);
        } catch (error) {
            console.error('❌ Error accessing conversations table raw columns:', error.message);
        }

        // Test describe tables
        try {
            const [conversationsDesc] = await connection.execute('DESCRIBE conversations');
            const rawRequestColumn = conversationsDesc.find(col => col.Field === 'raw_request');
            const rawResponseColumn = conversationsDesc.find(col => col.Field === 'raw_response');
            
            if (rawRequestColumn && rawResponseColumn) {
                console.log('✅ raw_request and raw_response columns exist in conversations table');
            } else {
                console.error('❌ Missing raw_request or raw_response columns');
            }
        } catch (error) {
            console.error('❌ Error describing conversations table:', error.message);
        }

        await connection.end();
        console.log('✅ Database connection test completed successfully');

    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('Error code:', error.code);
        console.error('Error errno:', error.errno);
        console.error('Error sqlMessage:', error.sqlMessage);
    }
}

testDatabaseConnection();