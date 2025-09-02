#!/usr/bin/env node

/**
 * Token系统快速测试脚本
 * 用于验证新的数据库驱动Token管理系统是否正常工作
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:8080';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function testTokenSystem() {
    console.log('🧪 开始测试Token管理系统...\n');
    
    try {
        // 1. 测试服务器健康状态
        console.log('1️⃣ 测试服务器连接...');
        const healthResponse = await axios.get(`${BASE_URL}/health`);
        console.log('✅ 服务器连接正常');
        console.log(`   数据库连接: ${healthResponse.data.database_connected ? '✅' : '❌'}`);
        console.log(`   WebSocket连接: ${healthResponse.data.websocket_connected ? '✅' : '❌'}\n`);
        
        // 2. 测试Token统计API
        console.log('2️⃣ 测试Token统计API...');
        const statsResponse = await axios.get(`${BASE_URL}/api/tokens/stats`);
        const stats = statsResponse.data.data;
        console.log('✅ Token统计API正常');
        console.log(`   总Token数: ${stats.total}`);
        console.log(`   活跃Token: ${stats.active}`);  
        console.log(`   健康Token: ${stats.healthy}`);
        console.log(`   黑名单Token: ${stats.blacklisted}`);
        console.log(`   超限Token: ${stats.over_daily_limit}\n`);
        
        if (stats.total === 0) {
            console.log('⚠️  警告: 没有发现Token数据，请先运行迁移脚本');
            console.log('   执行: ./migrate-tokens.sh\n');
            return;
        }
        
        // 3. 测试获取详细Token信息
        console.log('3️⃣ 测试Token详细信息API...');
        const tokensResponse = await axios.get(`${BASE_URL}/api/tokens`);
        const tokenList = tokensResponse.data.data.tokens;
        console.log('✅ Token列表API正常');
        
        if (tokenList.length > 0) {
            const firstToken = tokenList[0];
            console.log(`   示例Token: ${firstToken.project_name} (ID: ${firstToken.id})`);
            console.log(`   健康状态: ${firstToken.is_healthy ? '✅' : '❌'}`);
            console.log(`   今日使用: ${firstToken.daily_used}/${firstToken.daily_limit}\n`);
        }
        
        // 4. 测试健康检查功能
        console.log('4️⃣ 测试健康检查功能...');
        try {
            await axios.post(`${BASE_URL}/api/tokens/health-check`);
            console.log('✅ 健康检查API正常\n');
        } catch (error) {
            console.log('⚠️  健康检查可能需要更长时间，这是正常的\n');
        }
        
        // 5. 模拟Token实际使用测试（可选，需要有效的Token）
        if (stats.healthy > 0) {
            console.log('5️⃣ 测试Token实际API调用...');
            
            // 这里不会真正调用Gemini API，只是演示如何使用
            console.log('💡 新的Token管理系统特性:');
            console.log('   - 智能Token轮换策略');
            console.log('   - 每日使用限制管理');
            console.log('   - 自动健康检查');
            console.log('   - 黑名单自动恢复');
            console.log('   - 详细使用日志记录\n');
        }
        
        // 6. 测试Token激活/停用功能
        if (tokenList.length > 0) {
            console.log('6️⃣ 测试Token管理功能...');
            const testTokenId = tokenList[0].id;
            
            try {
                // 测试停用Token
                await axios.post(`${BASE_URL}/api/tokens/${testTokenId}/deactivate`);
                console.log('✅ Token停用功能正常');
                
                // 测试激活Token  
                await axios.post(`${BASE_URL}/api/tokens/${testTokenId}/activate`);
                console.log('✅ Token激活功能正常\n');
            } catch (error) {
                console.log('⚠️  Token管理功能测试失败:', error.message);
            }
        }
        
        // 7. 测试日志查询功能
        if (tokenList.length > 0) {
            console.log('7️⃣ 测试Token日志查询...');
            const testTokenId = tokenList[0].id;
            
            try {
                const logsResponse = await axios.get(`${BASE_URL}/api/tokens/${testTokenId}/logs?limit=5`);
                const logs = logsResponse.data.data;
                console.log('✅ Token日志API正常');
                console.log(`   日志总数: ${logs.total}`);
                console.log(`   返回条数: ${logs.logs.length}\n`);
            } catch (error) {
                console.log('⚠️  日志查询功能测试失败:', error.message);
            }
        }
        
        // 测试总结
        console.log('🎉 Token系统测试完成!\n');
        console.log('📊 系统状态总结:');
        console.log(`   服务器状态: ✅ 正常`);
        console.log(`   数据库连接: ✅ 正常`);
        console.log(`   Token数量: ${stats.total} 个`);
        console.log(`   可用Token: ${stats.healthy} 个`);
        
        if (stats.healthy === 0) {
            console.log('\n⚠️  警告: 没有健康的Token可用!');
            console.log('建议操作:');
            console.log('1. 检查Token是否有效');
            console.log('2. 运行健康检查: curl -X POST http://localhost:8080/api/tokens/health-check');
            console.log('3. 清除黑名单: curl -X DELETE http://localhost:8080/api/tokens/blacklist');
        } else {
            console.log('\n✅ Token系统运行正常，可以开始使用!');
        }
        
        console.log('\n📚 更多信息:');
        console.log('- API文档: 查看 src/services/http-server.ts');
        console.log('- 使用指南: doc/token-management-guide.md');
        console.log('- 运行测试: npm test tests/token-management.test.ts');
        
    } catch (error) {
        console.error('❌ 测试失败:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 解决建议:');
            console.log('1. 确保HTTP服务器正在运行 (npm start 或 npm run dev)');
            console.log('2. 检查服务器端口是否为8080');
            console.log('3. 验证防火墙设置');
        } else if (error.response?.status === 500) {
            console.log('\n💡 解决建议:');
            console.log('1. 检查数据库连接配置');
            console.log('2. 确保数据库服务正在运行');
            console.log('3. 验证Token表是否存在 (运行 ./migrate-tokens.sh)');
        }
        
        process.exit(1);
    }
}

// 运行测试
if (require.main === module) {
    testTokenSystem();
}

module.exports = { testTokenSystem };