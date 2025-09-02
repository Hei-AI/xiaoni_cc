#!/bin/bash

# Token管理系统迁移脚本
# 将token.properties中的数据迁移到数据库

echo "🔄 开始Token管理系统迁移..."

# 检查环境
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 请在项目根目录下运行此脚本"
    exit 1
fi

if [ ! -f "resource/token.properties" ]; then
    echo "❌ 错误: 未找到resource/token.properties文件"
    exit 1
fi

if [ ! -f "scripts/migrate_tokens_to_db.ts" ]; then
    echo "❌ 错误: 未找到迁移脚本"
    exit 1
fi

# 检查Node.js和npm
if ! command -v node &> /dev/null; then
    echo "❌ 错误: Node.js 未安装"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ 错误: npm 未安装"  
    exit 1
fi

# 安装依赖（如果需要）
echo "📦 检查依赖..."
if [ ! -d "node_modules" ]; then
    echo "安装项目依赖..."
    npm install
fi

# 编译TypeScript（如果需要）
if [ ! -d "dist" ]; then
    echo "🔨 编译TypeScript代码..."
    npm run build
fi

echo "🚀 执行数据库迁移..."

# 执行迁移
npx ts-node scripts/migrate_tokens_to_db.ts

# 检查迁移结果
if [ $? -eq 0 ]; then
    echo "✅ Token迁移完成!"
    echo ""
    echo "📊 验证迁移结果:"
    
    # 如果服务正在运行，显示统计信息
    if curl -f -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "🌐 获取Token统计信息..."
        curl -s http://localhost:8080/api/tokens/stats | jq '.' 2>/dev/null || echo "请启动HTTP服务器查看详细统计"
    else
        echo "💡 启动服务器后，可访问 http://localhost:8080/api/tokens/stats 查看Token统计"
    fi
    
    echo ""
    echo "📚 相关文档:"
    echo "  - Token管理指南: doc/token-management-guide.md"
    echo "  - HTTP API文档: 请查看http-server.ts中的Token相关路由"
    echo ""
    echo "🧪 运行测试验证:"
    echo "  npm test tests/token-management.test.ts"
    echo "  npm test tests/token-http-api.test.ts"
    
else
    echo "❌ Token迁移失败，请检查错误信息"
    echo ""
    echo "🔍 常见问题排查:"
    echo "  1. 检查数据库连接配置 (.env文件)"
    echo "  2. 确保MySQL服务正在运行"
    echo "  3. 验证数据库用户权限"
    echo "  4. 检查resource/token.properties文件格式"
    exit 1
fi

echo ""
echo "🎉 迁移完成! 新的Token管理系统已就绪。"