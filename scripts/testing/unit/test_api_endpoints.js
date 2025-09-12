const axios = require('axios');

async function testAPIEndpoints() {
    console.log('=== Testing API Endpoints ===\n');

    try {
        // 测试 Admin Panel 的 conversations 端点
        console.log('1. Testing Admin Panel /api/conversations...');
        const adminResponse = await axios.get('http://localhost:9080/api/conversations?limit=5', {
            timeout: 10000
        });
        
        console.log(`   Response Status: ${adminResponse.status}`);
        console.log(`   Response Headers:`, adminResponse.headers['content-type']);
        console.log(`   Response Data:`, JSON.stringify({
            success: adminResponse.data.success,
            data_length: adminResponse.data.data?.length || 0,
            total: adminResponse.data.total,
            timestamp: adminResponse.data.timestamp
        }, null, 2));
        
        if (adminResponse.data.data && adminResponse.data.data.length > 0) {
            console.log(`   First record sample:`, {
                id: adminResponse.data.data[0].id,
                user_id: adminResponse.data.data[0].user_id,
                has_user_message: !!adminResponse.data.data[0].user_message,
                has_ai_response: !!adminResponse.data.data[0].ai_response,
                timestamp: adminResponse.data.data[0].timestamp
            });
        }
    } catch (error) {
        console.error('Admin Panel API Error:', {
            message: error.message,
            response_status: error.response?.status,
            response_data: error.response?.data
        });
    }

    console.log('\n' + '='.repeat(50) + '\n');

    try {
        // 测试 QQBot Core 的 debug/conversations 端点  
        console.log('2. Testing QQBot Core /api/debug/conversations...');
        const coreResponse = await axios.get('http://localhost:8081/api/debug/conversations?limit=5', {
            timeout: 10000
        });
        
        console.log(`   Response Status: ${coreResponse.status}`);
        console.log(`   Response Headers:`, coreResponse.headers['content-type']);
        console.log(`   Response Data:`, JSON.stringify({
            success: coreResponse.data.success,
            data_length: coreResponse.data.data?.length || 0,
            pagination: coreResponse.data.pagination,
            timestamp: coreResponse.data.timestamp
        }, null, 2));
        
        if (coreResponse.data.data && coreResponse.data.data.length > 0) {
            console.log(`   First record sample:`, {
                conversation_id: coreResponse.data.data[0].conversation_id,
                user_id: coreResponse.data.data[0].user_id,
                user_nickname: coreResponse.data.data[0].user_nickname,
                message_type: coreResponse.data.data[0].message_type,
                has_user_input: !!coreResponse.data.data[0].user_input,
                has_ai_response: !!coreResponse.data.data[0].ai_response,
                llm_call_count: coreResponse.data.data[0].llm_call_count,
                timestamp: coreResponse.data.data[0].timestamp
            });
        }
    } catch (error) {
        console.error('QQBot Core API Error:', {
            message: error.message,
            response_status: error.response?.status,
            response_data: error.response?.data
        });
    }

    console.log('\n' + '='.repeat(50) + '\n');

    try {
        // 测试 Admin Panel 的统计端点作为对照
        console.log('3. Testing Admin Panel /api/dashboard/stats (for comparison)...');
        const statsResponse = await axios.get('http://localhost:9080/api/dashboard/stats', {
            timeout: 10000
        });
        
        console.log(`   Response Status: ${statsResponse.status}`);
        console.log(`   Stats Data:`, JSON.stringify({
            totalMessages: statsResponse.data.totalMessages,
            aiResponses: statsResponse.data.aiResponses,
            systemHealth: statsResponse.data.systemHealth
        }, null, 2));
    } catch (error) {
        console.error('Dashboard Stats API Error:', {
            message: error.message,
            response_status: error.response?.status,
            response_data: error.response?.data
        });
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // 测试数据库连接状态
    try {
        console.log('4. Testing database connection status...');
        const dbTestResponse = await axios.get('http://localhost:9080/api/database/test', {
            timeout: 10000
        });
        
        console.log(`   Database Status:`, JSON.stringify({
            status: dbTestResponse.data.status,
            host: dbTestResponse.data.host,
            database: dbTestResponse.data.database
        }, null, 2));
    } catch (error) {
        console.error('Database Test Error:', {
            message: error.message,
            response_status: error.response?.status,
            response_data: error.response?.data
        });
    }
}

// 运行测试
testAPIEndpoints().catch(console.error);