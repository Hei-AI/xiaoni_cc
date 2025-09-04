#!/usr/bin/env python3
"""
QQ Bot 前后端分离项目 - 初始化脚本
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

def run_command(command, description):
    """运行命令并处理错误"""
    print(f"📦 {description}...")
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        if result.stdout.strip():
            print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description}失败: {e}")
        if e.stderr:
            print(f"错误详情: {e.stderr}")
        return False

def check_requirements():
    """检查Node.js和npm"""
    print("🚀 启动QQ Bot项目初始化...")
    
    # 检查Node.js
    try:
        node_version = subprocess.check_output(["node", "--version"], text=True).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ Node.js未安装，请先安装Node.js")
        sys.exit(1)
    
    # 检查npm
    try:
        npm_version = subprocess.check_output(["npm", "--version"], text=True).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ npm未安装，请先安装npm")
        sys.exit(1)
    
    print(f"✅ Node.js {node_version} 和 npm {npm_version} 已安装")

def install_dependencies():
    """安装依赖"""
    # 安装根目录依赖
    if not run_command("npm install", "安装根目录依赖"):
        return False
    
    # 安装后端依赖
    if not run_command("cd backend && npm install", "安装后端依赖"):
        return False
    
    # 安装前端依赖
    if not run_command("cd frontend && npm install", "安装前端依赖"):
        return False
    
    return True

def create_config_files():
    """创建配置文件"""
    backend_env = Path("backend/.env")
    if not backend_env.exists():
        print("📄 创建后端环境配置文件...")
        env_example = Path("backend/.env.example")
        if env_example.exists():
            shutil.copy(env_example, backend_env)
        else:
            with open(backend_env, 'w', encoding='utf-8') as f:
                f.write("# 请手动配置环境变量\n")

def create_runtime_directories():
    """创建运行时目录"""
    print("📁 创建运行时目录...")
    runtime_dirs = [
        "backend/runtime/logs",
        "backend/runtime/temp", 
        "backend/runtime/uploads"
    ]
    
    for dir_path in runtime_dirs:
        Path(dir_path).mkdir(parents=True, exist_ok=True)

def main():
    """主函数"""
    try:
        check_requirements()
        
        if not install_dependencies():
            sys.exit(1)
        
        create_config_files()
        create_runtime_directories()
        
        print("✅ 项目初始化完成！")
        print("")
        print("🎯 下一步操作：")
        print("   1. 配置backend/.env文件")
        print("   2. 启动数据库服务")
        print("   3. 运行 npm run dev 启动开发环境")
        print("")
        
    except KeyboardInterrupt:
        print("\n❌ 初始化被用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 初始化失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()