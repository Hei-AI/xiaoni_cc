#!/usr/bin/env python3
"""
PostToolUse Hook for Bot Server Restart
根据Claude Code官方hooks文档创建
"""

import json
import os
import subprocess
import sys
import time
import requests
from datetime import datetime

PROJECT_DIR = os.environ.get('CLAUDE_PROJECT_DIR', '/home/liahua/IdeaProject/qq_bot')
LOG_DIR = os.path.join(PROJECT_DIR, "logs")

def log_message(message):
    """记录日志消息"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_file = os.path.join(LOG_DIR, "hook-post-tool.log")
    
    # 确保日志目录存在
    os.makedirs(LOG_DIR, exist_ok=True)
    
    with open(log_file, "a", encoding='utf-8') as f:
        f.write(f"[{timestamp}] {message}\n")

def should_restart(hook_data):
    """判断是否应该重启服务"""
    tool_name = hook_data.get('tool_name', '')
    
    if tool_name not in ['Write', 'Edit', 'MultiEdit']:
        return False
    
    tool_input = hook_data.get('tool_input', {})
    file_path = tool_input.get('file_path', '')
    
    # 只在修改关键文件时重启
    restart_patterns = [
        '/src/',           # TypeScript源码
        '/package.json',   # 依赖配置
        '/tsconfig.json',  # TypeScript配置
        '.ts'              # TypeScript文件
    ]
    
    return any(pattern in file_path for pattern in restart_patterns)

def restart_bot_service():
    """重启bot服务"""
    log_message("Starting bot service restart...")
    
    # 切换到项目目录
    os.chdir(PROJECT_DIR)
    
    # 停止现有进程
    log_message("Stopping existing bot service...")
    try:
        subprocess.run(['pkill', '-f', 'node dist/index.js'], 
                      capture_output=True, timeout=10)
    except subprocess.TimeoutExpired:
        log_message("Force killing processes...")
        subprocess.run(['pkill', '-9', '-f', 'node dist/index.js'], 
                      capture_output=True)
    
    time.sleep(2)
    
    # 构建项目
    log_message("Building TypeScript project...")
    try:
        result = subprocess.run(['npm', 'run', 'build'], 
                               capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            log_message(f"Build failed: {result.stderr}")
            return False
    except subprocess.TimeoutExpired:
        log_message("Build timeout!")
        return False
    
    log_message("Build successful")
    
    # 启动服务
    log_message("Starting bot service...")
    service_log = os.path.join(LOG_DIR, "service.log")
    try:
        with open(service_log, "w") as f:
            subprocess.Popen(['npm', 'start'], 
                           stdout=f, stderr=subprocess.STDOUT, 
                           cwd=PROJECT_DIR)
    except Exception as e:
        log_message(f"Failed to start service: {e}")
        return False
    
    # 等待服务启动
    time.sleep(5)
    
    # 健康检查
    for attempt in range(3):
        try:
            response = requests.get("http://127.0.0.1:8080/health", timeout=5)
            if response.status_code == 200:
                log_message("Bot service restarted successfully!")
                return True
        except Exception as e:
            log_message(f"Health check attempt {attempt + 1} failed: {e}")
            time.sleep(2)
    
    log_message("Service restart completed but health check failed")
    return False

def main():
    """主函数"""
    try:
        # 读取hook输入数据
        hook_input = sys.stdin.read()
        if not hook_input.strip():
            log_message("No hook input received")
            return
        
        hook_data = json.loads(hook_input)
        log_message(f"Received hook data: {hook_data.get('tool_name', 'unknown')}")
        
        # 判断是否需要重启
        if should_restart(hook_data):
            file_path = hook_data.get('tool_input', {}).get('file_path', 'unknown')
            log_message(f"File modified: {file_path} - triggering restart")
            restart_bot_service()
        else:
            log_message("No restart needed for this file change")
            
    except json.JSONDecodeError as e:
        log_message(f"Failed to parse hook input JSON: {e}")
    except Exception as e:
        log_message(f"Hook execution error: {e}")

if __name__ == "__main__":
    main()