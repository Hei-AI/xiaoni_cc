#!/usr/bin/env python3
"""
Frontend Development Hook for Claude Code Multi-Agent Collaboration
前端专用轻量级hook，不干扰后端服务，优化多agent协作体验
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path


class FrontendDevHook:
    def __init__(self):
        self.project_dir = os.environ.get('CLAUDE_PROJECT_DIR', '/home/liahua/IdeaProject/qq_bot')
        self.log_dir = Path(self.project_dir) / 'logs'
        self.log_file = self.log_dir / 'hook-frontend-dev.log'
        
        # 创建日志目录
        self.log_dir.mkdir(exist_ok=True)
    
    def log_message(self, message: str):
        """记录日志消息"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"[{timestamp}] [Frontend-Dev] {message}\n"
        
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(log_entry)
        
        print(f"[Frontend-Dev] {message}")
    
    def parse_hook_input(self) -> dict:
        """解析hook输入数据"""
        try:
            hook_input = sys.stdin.read().strip()
            self.log_message(f"Received frontend hook input: {hook_input}")
            
            hook_data = json.loads(hook_input)
            return hook_data
        except json.JSONDecodeError as e:
            self.log_message(f"Failed to parse hook input JSON: {e}")
            return {}
        except Exception as e:
            self.log_message(f"Error reading hook input: {e}")
            return {}
    
    def handle_frontend_change(self, file_path: str):
        """处理前端文件变更"""
        self.log_message(f"Processing frontend file change (no backend restart): {file_path}")
        
        frontend_dir = Path(self.project_dir) / 'frontend'
        if not frontend_dir.exists():
            self.log_message(f"Frontend directory not found: {frontend_dir}")
            return False
        
        file_name = os.path.basename(file_path)
        file_extension = os.path.splitext(file_path)[1]
        
        # 根据文件类型执行相应操作
        if file_name == 'package.json':
            self.log_message("Frontend package.json modified - dependency changes detected")
            package_lock = frontend_dir / 'package-lock.json'
            if package_lock.exists():
                self.log_message("Checking if npm install is needed...")
                # 可选：检查依赖更新
                # self.log_message("Dependencies may need update")
        
        elif file_name in ['vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json']:
            self.log_message(f"Frontend configuration file changed: {file_name}")
            self.log_message("Note: You may need to restart Vite dev server if running")
        
        elif file_path.endswith(('src/', 'src\\')) and file_extension in ['.vue', '.ts', '.js']:
            self.log_message(f"Frontend source file modified: {file_path}")
            self.log_message("Hot reload should handle this automatically if Vite is running")
            # 可选：TypeScript类型检查
            # if file_extension == '.ts':
            #     self.log_message("TypeScript file - type checking may be needed")
        
        elif file_extension in ['.css', '.scss', '.sass']:
            self.log_message(f"Frontend stylesheet modified: {file_path}")
            self.log_message("CSS hot reload should apply changes automatically")
        
        elif file_extension in ['.html']:
            self.log_message(f"Frontend HTML file modified: {file_path}")
            self.log_message("Page refresh may be needed to see changes")
        
        elif file_extension in ['.json'] and 'src/' in file_path:
            self.log_message(f"Frontend JSON file modified: {file_path}")
            self.log_message("Configuration or data file change detected")
        
        else:
            self.log_message(f"Frontend file processed: {file_path}")
        
        self.log_message("Frontend file processing completed - backend service unaffected")
        self.log_message("Claude agents working on backend can continue without API interruption")
        return True
    
    def run(self):
        """主执行函数"""
        hook_data = self.parse_hook_input()
        
        if not hook_data:
            self.log_message("Invalid hook input data")
            return
        
        tool_name = hook_data.get('tool_name', '')
        file_path = hook_data.get('file_path', '')
        
        self.log_message(f"Tool: {tool_name}, File: {file_path} (Frontend-focused hook)")
        
        # 主逻辑 - 由于使用了filePathPatterns，这里只会处理前端文件
        if tool_name in ['Write', 'Edit']:
            self.log_message(f"Frontend-only file modified: {file_path} - using lightweight processing")
            self.handle_frontend_change(file_path)
        else:
            self.log_message(f"Tool {tool_name} does not trigger frontend processing")
        
        self.log_message("Frontend development hook execution completed")


if __name__ == '__main__':
    hook = FrontendDevHook()
    hook.run()