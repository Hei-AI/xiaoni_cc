#!/usr/bin/env python3
"""
QQ Bot 前后端分离项目 - 部署脚本
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path
from datetime import datetime

def run_command(command, cwd=None, description="", check=True):
    """运行命令并处理错误"""
    if description:
        print(f"🚀 {description}...")
    try:
        result = subprocess.run(
            command, 
            shell=True, 
            check=check, 
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

def backup_previous_deployment():
    """备份之前的部署"""
    backup_dir = Path(f"backup/deployment_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    
    if Path("production").exists():
        print("📦 备份之前的部署...")
        backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copytree("production", backup_dir / "production")
        print(f"✅ 备份完成: {backup_dir}/")

def deploy_backend():
    """部署后端"""
    print("🔧 部署后端...")
    
    # 确保后端已构建
    if not Path("backend/build/dist").exists():
        print("❌ 后端未构建，请先运行构建命令")
        return False
    
    # 创建生产目录
    prod_backend = Path("production/backend")
    prod_backend.mkdir(parents=True, exist_ok=True)
    
    # 复制构建产物
    if Path("backend/build/dist").exists():
        shutil.copytree("backend/build/dist", prod_backend / "dist", dirs_exist_ok=True)
    
    # 复制配置文件
    config_files = ["package.json", ".env"]
    for config_file in config_files:
        src = Path(f"backend/{config_file}")
        if src.exists():
            shutil.copy(src, prod_backend / config_file)
    
    # 复制数据库文件（如果需要）
    if Path("backend/database").exists():
        shutil.copytree("backend/database", prod_backend / "database", dirs_exist_ok=True)
    
    print("✅ 后端部署完成")
    return True

def deploy_frontend():
    """部署前端"""
    print("🔧 部署前端...")
    
    # 确保前端已构建
    if not Path("frontend/build").exists():
        print("❌ 前端未构建，请先运行构建命令")
        return False
    
    # 创建生产目录
    prod_frontend = Path("production/frontend")
    prod_frontend.mkdir(parents=True, exist_ok=True)
    
    # 复制构建产物
    shutil.copytree("frontend/build", prod_frontend, dirs_exist_ok=True)
    
    print("✅ 前端部署完成")
    return True

def install_production_dependencies():
    """安装生产依赖"""
    print("📦 安装生产依赖...")
    
    # 安装后端生产依赖
    backend_prod = Path("production/backend")
    if backend_prod.exists():
        if not run_command(
            "npm ci --only=production", 
            cwd=str(backend_prod), 
            description="安装后端生产依赖"
        ):
            return False
    
    return True

def create_startup_scripts():
    """创建启动脚本"""
    print("📝 创建启动脚本...")
    
    # 创建后端启动脚本
    backend_start = Path("production/start_backend.py")
    with open(backend_start, 'w', encoding='utf-8') as f:
        f.write("""#!/usr/bin/env python3
import subprocess
import sys

def start_backend():
    try:
        subprocess.run(["node", "dist/index.js"], cwd="backend", check=True)
    except KeyboardInterrupt:
        print("\\n后端服务已停止")
    except Exception as e:
        print(f"后端启动失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    start_backend()
""")
    
    # 创建完整启动脚本
    start_all = Path("production/start_all.py")
    with open(start_all, 'w', encoding='utf-8') as f:
        f.write("""#!/usr/bin/env python3
import subprocess
import sys
import threading
import time

def start_backend():
    subprocess.run(["python3", "start_backend.py"], cwd=".")

def start_frontend_server():
    # 使用简单的HTTP服务器服务前端文件
    subprocess.run(["python3", "-m", "http.server", "3000"], cwd="frontend")

def main():
    print("🚀 启动QQ Bot服务...")
    
    # 启动后端
    backend_thread = threading.Thread(target=start_backend)
    backend_thread.daemon = True
    backend_thread.start()
    
    # 等待后端启动
    time.sleep(2)
    
    # 启动前端服务器
    frontend_thread = threading.Thread(target=start_frontend_server)
    frontend_thread.daemon = True  
    frontend_thread.start()
    
    print("✅ 服务已启动")
    print("   - 后端: http://localhost:8080")
    print("   - 前端: http://localhost:3000")
    
    try:
        # 保持主线程运行
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\\n🛑 服务已停止")

if __name__ == "__main__":
    main()
""")
    
    # 设置执行权限
    os.chmod(backend_start, 0o755)
    os.chmod(start_all, 0o755)
    
    print("✅ 启动脚本创建完成")

def main():
    """主函数"""
    print("🚀 开始部署项目...")
    
    try:
        # 备份之前的部署
        backup_previous_deployment()
        
        # 部署后端
        if not deploy_backend():
            sys.exit(1)
        
        # 部署前端
        if not deploy_frontend():
            sys.exit(1)
        
        # 安装生产依赖
        if not install_production_dependencies():
            sys.exit(1)
        
        # 创建启动脚本
        create_startup_scripts()
        
        print("🎉 部署完成！")
        print("")
        print("🎯 启动服务：")
        print("   cd production && python3 start_all.py")
        print("")
        
    except KeyboardInterrupt:
        print("\n❌ 部署被用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 部署失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()