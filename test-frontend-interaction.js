// 前端交互测试脚本 - 使用Puppeteer模拟用户操作
// 运行: node test-frontend-interaction.js

const puppeteer = require('puppeteer');
const http = require('http');

class FrontendInteractionTester {
    constructor() {
        this.serverUrl = 'http://localhost:8080';
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.log('🚀 启动浏览器进行前端交互测试...');
        this.browser = await puppeteer.launch({ 
            headless: false,  // 显示浏览器界面
            devtools: true,   // 打开开发者工具
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        this.page = await this.browser.newPage();
        
        // 监听控制台日志
        this.page.on('console', msg => {
            console.log('📝 浏览器控制台:', msg.text());
        });
        
        // 监听网络请求
        this.page.on('request', request => {
            if (request.url().includes('/api/conversations')) {
                console.log('🌐 API请求:', request.method(), request.url());
            }
        });
        
        // 监听网络响应
        this.page.on('response', response => {
            if (response.url().includes('/api/conversations')) {
                console.log('✅ API响应:', response.status(), response.url());
            }
        });
    }

    async testPageLoad() {
        console.log('\n📋 测试: 页面加载');
        await this.page.goto(`${this.serverUrl}/conversations`);
        await this.page.waitForSelector('#filterForm', { timeout: 10000 });
        
        const title = await this.page.title();
        console.log('✅ 页面标题:', title);
        
        // 检查关键元素是否存在
        const elements = await this.page.evaluate(() => {
            return {
                filterForm: !!document.getElementById('filterForm'),
                searchKeyword: !!document.getElementById('searchKeyword'),
                userId: !!document.getElementById('userId'),
                conversationList: !!document.getElementById('conversationList'),
                conversationManager: typeof window.conversationManager !== 'undefined'
            };
        });
        
        console.log('📋 DOM元素检查:', elements);
        return elements;
    }

    async testInitialLoad() {
        console.log('\n📋 测试: 初始数据加载');
        await this.page.waitForTimeout(2000); // 等待初始加载完成
        
        const conversationCount = await this.page.evaluate(() => {
            const list = document.getElementById('conversationList');
            return list ? list.children.length : 0;
        });
        
        console.log('📊 初始对话数量:', conversationCount);
        return conversationCount;
    }

    async testSearchFunctionality() {
        console.log('\n📋 测试: 搜索功能');
        
        // 输入搜索关键词
        await this.page.type('#searchKeyword', 'hello');
        console.log('✏️  输入搜索关键词: hello');
        
        // 点击搜索按钮
        console.log('🔍 点击搜索按钮...');
        await this.page.click('button[type="submit"]');
        
        // 等待API调用完成
        await this.page.waitForTimeout(3000);
        
        // 检查结果
        const searchResults = await this.page.evaluate(() => {
            const list = document.getElementById('conversationList');
            return {
                resultCount: list ? list.children.length : 0,
                hasEmptyState: list ? list.innerHTML.includes('未找到对话记录') : false,
                searchValue: document.getElementById('searchKeyword').value
            };
        });
        
        console.log('🔍 搜索结果:', searchResults);
        return searchResults;
    }

    async testUserFilter() {
        console.log('\n📋 测试: 用户ID筛选');
        
        // 清空搜索框
        await this.page.evaluate(() => {
            document.getElementById('searchKeyword').value = '';
        });
        
        // 输入用户ID
        await this.page.type('#userId', '85178516');
        console.log('👤 输入用户ID: 85178516');
        
        // 点击搜索按钮
        await this.page.click('button[type="submit"]');
        await this.page.waitForTimeout(3000);
        
        const filterResults = await this.page.evaluate(() => {
            const list = document.getElementById('conversationList');
            return {
                resultCount: list ? list.children.length : 0,
                userIdValue: document.getElementById('userId').value
            };
        });
        
        console.log('👤 用户筛选结果:', filterResults);
        return filterResults;
    }

    async testResetFilters() {
        console.log('\n📋 测试: 重置筛选');
        
        await this.page.click('#resetBtn');
        await this.page.waitForTimeout(2000);
        
        const resetResults = await this.page.evaluate(() => {
            return {
                userIdValue: document.getElementById('userId').value,
                searchValue: document.getElementById('searchKeyword').value,
            };
        });
        
        console.log('🔄 重置结果:', resetResults);
        return resetResults;
    }

    async checkNetworkActivity() {
        console.log('\n📋 检查网络活动');
        
        // 获取当前网络请求数量
        const requests = await this.page.evaluate(() => {
            return window.performance.getEntriesByType('navigation').length + 
                   window.performance.getEntriesByType('resource').filter(r => 
                       r.name.includes('/api/conversations')).length;
        });
        
        console.log('🌐 API请求数量:', requests);
        return requests;
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔚 浏览器已关闭');
        }
    }

    async runAllTests() {
        try {
            await this.init();
            
            const pageElements = await this.testPageLoad();
            if (!pageElements.conversationManager) {
                throw new Error('ConversationManager未正确初始化');
            }
            
            await this.testInitialLoad();
            await this.testSearchFunctionality();
            await this.testUserFilter();
            await this.testResetFilters();
            await this.checkNetworkActivity();
            
            console.log('\n🎉 所有前端交互测试完成！');
            
        } catch (error) {
            console.error('❌ 测试失败:', error.message);
        } finally {
            await this.cleanup();
        }
    }
}

// 运行测试
const tester = new FrontendInteractionTester();
tester.runAllTests().catch(console.error);