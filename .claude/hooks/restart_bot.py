#!/usr/bin/env python3
"""
Bot Server 重启脚本
根据Claude Code官方hooks指南创建
"""

import os
import subprocess
import sys
import time
import requests
from datetime import datetime

PROJECT_DIR = "/home/liahua/IdeaProject/qq_bot"
LOG_DIR = os.path.join(PROJECT_DIR, "logs")

def log_message(message):
    """记录日志消息"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_file = os.path.join(LOG_DIR, "hook-restart.log")
    
    # 确保日志目录存在
    os.makedirs(LOG_DIR, exist_ok=True)
    
    with open(log_file, "a") as f:
        f.write(f"[{timestamp}] {message}\n")
    
    print(f"[{timestamp}] {message}")

def run_command(cmd, cwd=None):
    """安全地运行命令"""
    try:
        result = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

def main():
    """主要的重启逻辑"""
    log_message("Starting bot server restart...")
    
    # 切换到项目目录
    os.chdir(PROJECT_DIR)
    
    # 停止现有进程
    log_message("Stopping existing bot service...")
    subprocess.run("pkill -f 'node dist/index.js'", shell=True)
    time.sleep(2)
    
    # 构建项目
    log_message("Building TypeScript project...")
    success, stdout, stderr = run_command("npm run build", PROJECT_DIR)
    
    if not success:
        log_message(f"Build failed: {stderr}")
        sys.exit(1)
    
    log_message("Build successful")
    
    # 启动服务
    log_message("Starting bot service...")
    service_log = os.path.join(LOG_DIR, "service.log")
    subprocess.Popen(f"npm start > {service_log} 2>&1", shell=True, cwd=PROJECT_DIR)
    
    # 等待服务启动
    time.sleep(5)
    
    # 健康检查
    try:
        response = requests.get("http://127.0.0.1:8080/health", timeout=5)
        if response.status_code == 200:
            log_message("Bot service restarted successfully!")
        else:
            log_message(f"Health check failed with status: {response.status_code}")
    except Exception as e:
        log_message(f"Health check failed: {e}")
    
    log_message("Bot server restart completed")

if __name__ == "__main__":
    main()