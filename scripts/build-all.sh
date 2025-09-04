#!/bin/bash

# QQ Bot 前后端分离项目 - 统一构建脚本

echo "🔨 开始构建整个项目..."

# 构建后端
echo "🔧 构建后端..."
cd backend
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 后端构建失败"
    exit 1
fi
echo "✅ 后端构建完成"
cd ..

# 构建前端
echo "🔧 构建前端..."
cd frontend  
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 前端构建失败"
    exit 1
fi
echo "✅ 前端构建完成"
cd ..

echo "🎉 项目构建完成！"
echo "📦 产物位置："
echo "   - 后端: backend/build/dist/"
echo "   - 前端: frontend/build/"
echo ""