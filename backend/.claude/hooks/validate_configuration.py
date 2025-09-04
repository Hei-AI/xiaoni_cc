#!/usr/bin/env python3
"""
Claude Code Hooks Configuration Validator (Python版本)
验证hooks配置是否符合官方最佳实践，避免dos2unix问题
"""

import json
import os
import subprocess
import requests
from datetime import datetime
from pathlib import Path


class HooksValidator:
    def __init__(self):
        self.project_dir = os.environ.get('CLAUDE_PROJECT_DIR', '/home/liahua/IdeaProject/qq_bot')
        self.settings_file = Path(self.project_dir) / '.claude' / 'settings.json'
        self.log_file = Path(self.project_dir) / 'logs' / 'hook-validation.log'
        
        self.log_file.parent.mkdir(exist_ok=True)
    
    def log_message(self, message: str):
        """记录和显示验证消息"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"[{timestamp}] [Validation] {message}\n"
        
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(log_entry)
        
        print(message)
    
    def validate_settings_file(self) -> bool:
        """验证设置文件格式"""
        self.log_message("Validating Claude Code settings file...")
        
        if not self.settings_file.exists():
            self.log_message(f"❌ Settings file not found: {self.settings_file}")
            return False
        
        try:
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                json.load(f)
            self.log_message("✅ Settings file format is valid")
            return True
        except json.JSONDecodeError as e:
            self.log_message(f"❌ Invalid JSON format in settings file: {e}")
            return False
        except Exception as e:
            self.log_message(f"❌ Error reading settings file: {e}")
            return False
    
    def validate_hook_structure(self) -> bool:
        """验证hooks结构"""
        self.log_message("Validating hooks structure...")
        
        try:
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                settings = json.load(f)
            
            if 'hooks' not in settings or 'PostToolUse' not in settings['hooks']:
                self.log_message("❌ PostToolUse hooks not found")
                return False
            
            post_tool_hooks = settings['hooks']['PostToolUse']
            
            # 检查backend和frontend hooks
            backend_hooks = 0
            frontend_hooks = 0
            
            for hook_config in post_tool_hooks:
                if 'filePathPatterns' in hook_config:
                    patterns = hook_config['filePathPatterns']
                    if any('src/' in pattern and pattern.endswith('.ts') for pattern in patterns):
                        backend_hooks += 1
                    if any(pattern.startswith('frontend/') for pattern in patterns):
                        frontend_hooks += 1
            
            if backend_hooks == 0:
                self.log_message("❌ No backend hooks configured")
                return False
            
            if frontend_hooks == 0:
                self.log_message("⚠️  No frontend hooks configured")
            
            self.log_message(f"✅ Hooks structure is valid (Backend: {backend_hooks}, Frontend: {frontend_hooks})")
            return True
            
        except Exception as e:
            self.log_message(f"❌ Error validating hook structure: {e}")
            return False
    
    def validate_hook_scripts(self) -> bool:
        """验证hook脚本"""
        self.log_message("Validating hook scripts...")
        
        try:
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                settings = json.load(f)
            
            post_tool_hooks = settings['hooks']['PostToolUse']
            
            for hook_config in post_tool_hooks:
                if 'hooks' in hook_config:
                    for hook in hook_config['hooks']:
                        if hook.get('type') == 'command':
                            command = hook['command']
                            # 替换环境变量
                            command = command.replace('$CLAUDE_PROJECT_DIR', self.project_dir)
                            
                            # 如果是Python命令，检查脚本文件
                            if command.startswith('python3 '):
                                script_path = command.split('python3 ')[1]
                                if not Path(script_path).exists():
                                    self.log_message(f"❌ Python script not found: {script_path}")
                                    return False
                                
                                # 检查Python语法
                                try:
                                    result = subprocess.run(
                                        ['python3', '-m', 'py_compile', script_path],
                                        capture_output=True, text=True, check=True
                                    )
                                    self.log_message(f"✅ Python script valid: {Path(script_path).name}")
                                except subprocess.CalledProcessError as e:
                                    self.log_message(f"❌ Python script syntax error: {Path(script_path).name}")
                                    return False
                            
                            else:
                                # 传统shell脚本检查
                                script_path = Path(command)
                                if not script_path.exists():
                                    self.log_message(f"❌ Script not found: {script_path}")
                                    return False
                                if not os.access(script_path, os.X_OK):
                                    self.log_message(f"❌ Script not executable: {script_path}")
                                    return False
                                
                                self.log_message(f"✅ Script valid: {script_path.name}")
            
            return True
            
        except Exception as e:
            self.log_message(f"❌ Error validating hook scripts: {e}")
            return False
    
    def test_hook_execution(self) -> bool:
        """测试hook执行（语法检查）"""
        self.log_message("Testing hook execution...")
        
        # 测试Python脚本
        backend_script = Path(self.project_dir) / '.claude' / 'hooks' / 'backend_restart.py'
        if backend_script.exists():
            try:
                subprocess.run(
                    ['python3', '-m', 'py_compile', str(backend_script)],
                    check=True, capture_output=True
                )
                self.log_message("✅ Backend Python hook syntax valid")
            except subprocess.CalledProcessError:
                self.log_message("❌ Backend Python hook syntax error")
                return False
        
        frontend_script = Path(self.project_dir) / '.claude' / 'hooks' / 'frontend_dev.py'
        if frontend_script.exists():
            try:
                subprocess.run(
                    ['python3', '-m', 'py_compile', str(frontend_script)],
                    check=True, capture_output=True
                )
                self.log_message("✅ Frontend Python hook syntax valid")
            except subprocess.CalledProcessError:
                self.log_message("❌ Frontend Python hook syntax error")
                return False
        
        return True
    
    def check_best_practices(self) -> bool:
        """检查最佳实践"""
        self.log_message("Checking Claude Code best practices...")
        
        try:
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                settings = json.load(f)
            
            post_tool_hooks = settings['hooks']['PostToolUse']
            
            # 检查是否使用$CLAUDE_PROJECT_DIR
            non_relative_paths = []
            for hook_config in post_tool_hooks:
                if 'hooks' in hook_config:
                    for hook in hook_config['hooks']:
                        if hook.get('type') == 'command':
                            command = hook['command']
                            if '$CLAUDE_PROJECT_DIR' not in command and '/' in command:
                                non_relative_paths.append(command)
            
            if non_relative_paths:
                self.log_message("⚠️  Found hardcoded paths (consider using $CLAUDE_PROJECT_DIR):")
                for path in non_relative_paths:
                    self.log_message(f"   {path}")
            else:
                self.log_message("✅ All hook commands use relative paths")
            
            # 检查filePathPatterns
            has_dist_pattern = False
            for hook_config in post_tool_hooks:
                if 'filePathPatterns' in hook_config:
                    patterns = hook_config['filePathPatterns']
                    if 'dist/**/*' in patterns:
                        has_dist_pattern = True
                        break
            
            if has_dist_pattern:
                self.log_message("⚠️  Found dist/**/* in filePathPatterns (build output shouldn't trigger hooks)")
            else:
                self.log_message("✅ No build output patterns in filePathPatterns")
            
            # 检查Python优势
            python_hooks = 0
            for hook_config in post_tool_hooks:
                if 'hooks' in hook_config:
                    for hook in hook_config['hooks']:
                        if hook.get('type') == 'command' and 'python3' in hook['command']:
                            python_hooks += 1
            
            if python_hooks > 0:
                self.log_message(f"✅ Using Python hooks ({python_hooks}) - avoids dos2unix issues")
            
            return True
            
        except Exception as e:
            self.log_message(f"❌ Error checking best practices: {e}")
            return False
    
    def check_backend_service(self) -> bool:
        """检查后端服务状态"""
        self.log_message("Checking backend service health...")
        
        try:
            response = requests.get('http://127.0.0.1:8080/health', timeout=5)
            if response.status_code == 200:
                health_data = response.json()
                self.log_message("✅ Backend service is healthy")
                self.log_message(f"   WebSocket connected: {health_data.get('websocket_connected', 'unknown')}")
                self.log_message(f"   Database connected: {health_data.get('database_connected', 'unknown')}")
                return True
            else:
                self.log_message(f"⚠️  Backend service returned status code: {response.status_code}")
                return False
        except requests.RequestException as e:
            self.log_message(f"⚠️  Backend service not accessible: {e}")
            return False
    
    def run_validation(self) -> bool:
        """运行完整验证"""
        self.log_message("=" * 50)
        self.log_message("Starting Claude Code Hooks Validation (Python)")
        self.log_message("=" * 50)
        
        all_passed = True
        
        # 核心验证
        if not self.validate_settings_file():
            all_passed = False
        if not self.validate_hook_structure():
            all_passed = False
        if not self.validate_hook_scripts():
            all_passed = False
        if not self.test_hook_execution():
            all_passed = False
        if not self.check_best_practices():
            all_passed = False
        
        # 可选检查
        self.check_backend_service()
        
        self.log_message("=" * 50)
        if all_passed:
            self.log_message("🎉 All validations passed! Python hooks configuration is optimal.")
            self.log_message("No more dos2unix issues! Multi-agent collaboration ready.")
        else:
            self.log_message("❌ Some validations failed. Please review the issues above.")
        self.log_message("=" * 50)
        
        return all_passed


if __name__ == '__main__':
    validator = HooksValidator()
    success = validator.run_validation()
    exit(0 if success else 1)