#!/bin/bash

# QQ Bot 前后端分离项目 - 初始化脚本

echo "🚀 启动QQ Bot项目初始化..."

# 检查Node.js和npm
if ! command -v node &> /dev/null; then
    echo "❌ Node.js未安装，请先安装Node.js"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm未安装，请先安装npm"
    exit 1
fi

echo "✅ Node.js $(node --version) 和 npm $(npm --version) 已安装"

# 安装根目录依赖
echo "📦 安装根目录依赖..."
npm install

# 安装后端依赖
echo "📦 安装后端依赖..."
cd backend
npm install
cd ..

# 安装前端依赖
echo "📦 安装前端依赖..."
cd frontend
npm install
cd ..

# 创建环境配置文件
if [ ! -f "backend/.env" ]; then
    echo "📄 创建后端环境配置文件..."
    cp backend/.env.example backend/.env 2>/dev/null || echo "# 请手动配置环境变量" > backend/.env
fi

# 创建运行时目录
echo "📁 创建运行时目录..."
mkdir -p backend/runtime/logs
mkdir -p backend/runtime/temp
mkdir -p backend/runtime/uploads

echo "✅ 项目初始化完成！"
echo ""
echo "🎯 下一步操作："
echo "   1. 配置backend/.env文件"
echo "   2. 启动数据库服务"
echo "   3. 运行 npm run dev 启动开发环境"
echo ""