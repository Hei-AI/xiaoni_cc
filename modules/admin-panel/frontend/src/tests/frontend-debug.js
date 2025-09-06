const puppeteer = require('puppeteer');

async function debugFrontend() {
  let browser;
  try {
    console.log('🚀 启动浏览器调试会话...');
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // 捕获控制台日志
    const logs = [];
    const errors = [];
    const warnings = [];
    const networkErrors = [];
    
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      
      logs.push({ type, text, timestamp: new Date() });
      
      if (type === 'error') {
        errors.push(text);
        console.log(`❌ [Console Error]: ${text}`);
      } else if (type === 'warning') {
        warnings.push(text);
        console.log(`⚠️  [Console Warning]: ${text}`);
      } else {
        console.log(`📝 [Console ${type.toUpperCase()}]: ${text}`);
      }
    });
    
    // 捕获JavaScript异常
    page.on('pageerror', (error) => {
      console.log(`💥 [Page Error]: ${error.message}`);
      errors.push(`Page Error: ${error.message}`);
    });
    
    // 捕获网络失败
    page.on('requestfailed', (request) => {
      const failure = `${request.method()} ${request.url()} - ${request.failure().errorText}`;
      networkErrors.push(failure);
      console.log(`🌐 [Network Error]: ${failure}`);
    });
    
    // 捕获响应错误
    page.on('response', (response) => {
      if (!response.ok()) {
        const error = `${response.status()} ${response.url()}`;
        networkErrors.push(error);
        console.log(`📡 [HTTP Error]: ${error}`);
      }
    });
    
    console.log('🔗 导航到前端应用...');
    await page.goto('http://localhost:3002', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    console.log('⏳ 等待页面完全加载...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 检查页面标题
    const title = await page.title();
    console.log(`📄 页面标题: ${title}`);
    
    // 检查DOM是否包含预期内容
    const content = await page.evaluate(() => {
      const app = document.getElementById('root');
      return {
        hasRoot: !!app,
        rootInnerHTML: app ? app.innerHTML.substring(0, 200) : null,
        bodyText: document.body.innerText.substring(0, 500)
      };
    });
    
    console.log('🏗️  DOM状态:');
    console.log(`  - Root元素存在: ${content.hasRoot}`);
    console.log(`  - 页面内容预览: ${content.bodyText}`);
    
    // 检查React DevTools
    const hasReact = await page.evaluate(() => {
      return !!(window.React || window.__REACT_DEVTOOLS_GLOBAL_HOOK__);
    });
    
    console.log(`⚛️  React检测: ${hasReact ? '已加载' : '未检测到'}`);
    
    // 截图保存
    await page.screenshot({ 
      path: '/home/liahua/IdeaProject/qq_bot/frontend-debug-screenshot.png',
      fullPage: true 
    });
    console.log('📸 截图已保存到: frontend-debug-screenshot.png');
    
    // 生成报告
    const report = {
      timestamp: new Date(),
      url: 'http://localhost:3002',
      title,
      dom: content,
      reactDetected: hasReact,
      summary: {
        totalLogs: logs.length,
        errors: errors.length,
        warnings: warnings.length,
        networkErrors: networkErrors.length
      },
      details: {
        consoleErrors: errors,
        consoleWarnings: warnings,
        networkErrors,
        allLogs: logs
      }
    };
    
    console.log('\n📊 前端调试报告:');
    console.log('================================');
    console.log(`总控制台消息: ${report.summary.totalLogs}`);
    console.log(`JavaScript错误: ${report.summary.errors}`);
    console.log(`控制台警告: ${report.summary.warnings}`);
    console.log(`网络错误: ${report.summary.networkErrors}`);
    console.log(`React状态: ${hasReact ? '✅ 正常' : '❌ 未检测到'}`);
    console.log(`页面标题: ${title}`);
    
    if (errors.length > 0) {
      console.log('\n❌ JavaScript错误详情:');
      errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    if (warnings.length > 0) {
      console.log('\n⚠️  控制台警告详情:');
      warnings.forEach((warning, index) => {
        console.log(`  ${index + 1}. ${warning}`);
      });
    }
    
    if (networkErrors.length > 0) {
      console.log('\n🌐 网络错误详情:');
      networkErrors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    return report;
    
  } catch (error) {
    console.error('💥 调试会话失败:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔚 浏览器已关闭');
    }
  }
}

// 运行调试
debugFrontend()
  .then(() => {
    console.log('✅ 前端调试完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 调试失败:', error);
    process.exit(1);
  });