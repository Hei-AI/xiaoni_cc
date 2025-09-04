#!/usr/bin/env python3
"""
Backend-only Restart Hook for Claude Code Multi-Agent Collaboration
仅处理后端相关文件的修改，避免前端开发时的后端服务干扰
"""

import json
import os
import sys
import subprocess
import time
import requests
from datetime import datetime
from pathlib import Path


class BackendRestartHook:
    def __init__(self):
        self.project_dir = os.environ.get('CLAUDE_PROJECT_DIR', '/home/liahua/IdeaProject/qq_bot')
        self.log_dir = Path(self.project_dir) / 'logs'
        self.log_file = self.log_dir / 'hook-backend-restart.log'
        
        # 创建日志目录
        self.log_dir.mkdir(exist_ok=True)
    
    def log_message(self, message: str):
        """记录日志消息"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"[{timestamp}] [Backend-Restart] {message}\n"
        
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(log_entry)
        
        print(f"[Backend-Restart] {message}")
    
    def parse_hook_input(self) -> dict:
        """解析hook输入数据"""
        try:
            hook_input = sys.stdin.read().strip()
            self.log_message(f"Received backend hook input: {hook_input}")
            
            hook_data = json.loads(hook_input)
            return hook_data
        except json.JSONDecodeError as e:
            self.log_message(f"Failed to parse hook input JSON: {e}")
            return {}
        except Exception as e:
            self.log_message(f"Error reading hook input: {e}")
            return {}
    
    def stop_existing_service(self):
        """停止现有的后端服务"""
        self.log_message("Stopping existing backend service...")
        try:
            subprocess.run(['pkill', '-f', 'node dist/index.js'], 
                          check=False, capture_output=True)
            time.sleep(2)
            self.log_message("Existing backend service stopped")
        except Exception as e:
            self.log_message(f"Error stopping service: {e}")
    
    def build_project(self) -> bool:
        """构建TypeScript项目"""
        self.log_message("Building TypeScript backend project...")
        
        try:
            os.chdir(self.project_dir)
            
            result = subprocess.run(['npm', 'run', 'build'], 
                                  capture_output=True, text=True, check=True)
            
            # 将构建输出写入日志
            with open(self.log_file, 'a', encoding='utf-8') as f:
                f.write(result.stdout)
                if result.stderr:
                    f.write(result.stderr)
            
            self.log_message("Backend build successful")
            return True
            
        except subprocess.CalledProcessError as e:
            self.log_message(f"Backend build failed: {e}")
            self.log_message(f"Build stderr: {e.stderr}")
            return False
        except Exception as e:
            self.log_message(f"Build error: {e}")
            return False
    
    def start_service(self) -> int:
        """启动后端服务"""
        self.log_message("Starting backend service...")
        
        try:
            service_log = self.log_dir / 'service.log'
            
            with open(service_log, 'w') as f:
                process = subprocess.Popen(
                    ['npm', 'start'],
                    cwd=self.project_dir,
                    stdout=f,
                    stderr=subprocess.STDOUT
                )
            
            self.log_message(f"Waiting for backend service to start (PID: {process.pid})...")
            time.sleep(5)
            return process.pid
            
        except Exception as e:
            self.log_message(f"Error starting service: {e}")
            return -1
    
    def health_check(self) -> bool:
        """健康检查"""
        max_retries = 10
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                response = requests.get('http://127.0.0.1:8080/health', timeout=5)
                if response.status_code == 200:
                    self.log_message("Backend service restarted successfully! Health check passed.")
                    self.log_message("Claude agents can now safely use backend APIs.")
                    return True
            except requests.RequestException:
                pass
            
            retry_count += 1
            self.log_message(f"Health check attempt {retry_count}/{max_retries} failed, retrying...")
            time.sleep(2)
        
        self.log_message(f"WARNING: Backend service restart completed but health check failed after {max_retries} attempts")
        self.log_message("Claude agents may experience API connection issues")
        return False
    
    def restart_backend_service(self, file_path: str):
        """重启后端服务"""
        self.log_message(f"Starting backend service restart for file: {file_path}")
        
        try:
            # 切换到项目目录
            if not os.path.exists(self.project_dir):
                self.log_message(f"Failed to find project directory: {self.project_dir}")
                return False
            
            # 停止现有进程
            self.stop_existing_service()
            
            # 构建项目
            if not self.build_project():
                self.log_message("Build failed - aborting restart")
                return False
            
            # 启动服务
            service_pid = self.start_service()
            if service_pid == -1:
                self.log_message("Failed to start service")
                return False
            
            # 健康检查
            return self.health_check()
            
        except Exception as e:
            self.log_message(f"Error during service restart: {e}")
            return False
    
    def run(self):
        """主执行函数"""
        hook_data = self.parse_hook_input()
        
        if not hook_data:
            self.log_message("Invalid hook input data")
            return
        
        tool_name = hook_data.get('tool_name', '')
        file_path = hook_data.get('file_path', '')
        
        self.log_message(f"Tool: {tool_name}, File: {file_path} (Backend-focused hook)")
        
        # 主逻辑 - 由于使用了filePathPatterns，这里只会处理后端文件
        if tool_name in ['Write', 'Edit']:
            self.log_message(f"Backend file modified: {file_path} - triggering targeted restart")
            self.restart_backend_service(file_path)
        else:
            self.log_message(f"Tool {tool_name} does not trigger backend restart")
        
        self.log_message("Backend restart hook execution completed")


if __name__ == '__main__':
    hook = BackendRestartHook()
    hook.run()