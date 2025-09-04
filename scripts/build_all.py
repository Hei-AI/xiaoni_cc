#!/usr/bin/env python3
"""
QQ Bot 前后端分离项目 - 统一构建脚本
"""

import os
import sys
import subprocess
from pathlib import Path

def run_command(command, cwd=None, description=""):
    """运行命令并处理错误"""
    print(f"🔧 {description}...")
    try:
        result = subprocess.run(
            command, 
            shell=True, 
            check=True, 
            capture_output=True, 
            text=True,
            cwd=cwd
        )
        if result.stdout.strip():
            print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description}失败")
        if e.stderr:
            print(f"错误详情: {e.stderr}")
        return False

def build_backend():
    """构建后端"""
    backend_path = Path("backend")
    if not backend_path.exists():
        print("❌ backend目录不存在")
        return False
    
    if not run_command("npm run build", cwd="backend", description="构建后端"):
        return False
    
    print("✅ 后端构建完成")
    return True

def build_frontend():
    """构建前端"""
    frontend_path = Path("frontend")
    if not frontend_path.exists():
        print("❌ frontend目录不存在")
        return False
    
    if not run_command("npm run build", cwd="frontend", description="构建前端"):
        return False
    
    print("✅ 前端构建完成")
    return True

def show_build_output():
    """显示构建产物信息"""
    print("🎉 项目构建完成！")
    print("📦 产物位置：")
    
    backend_dist = Path("backend/build/dist/")
    if backend_dist.exists():
        print(f"   - 后端: {backend_dist}/")
    
    frontend_build = Path("frontend/build/")
    if frontend_build.exists():
        print(f"   - 前端: {frontend_build}/")
    print("")

def main():
    """主函数"""
    print("🔨 开始构建整个项目...")
    
    try:
        # 构建后端
        if not build_backend():
            sys.exit(1)
        
        # 构建前端
        if not build_frontend():
            sys.exit(1)
        
        show_build_output()
        
    except KeyboardInterrupt:
        print("\n❌ 构建被用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 构建失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()