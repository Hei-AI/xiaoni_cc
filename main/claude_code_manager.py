#!/usr/bin/env python3
"""
Claude Code交互管理器
负责启动和管理专门用于Claude Code交互的bash进程
"""

import asyncio
import logging
import subprocess
import os
import signal
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class ClaudeCodeManager:
    """Claude Code交互管理器"""
    
    def __init__(self, working_dir: str = "/mnt/c/Users/a8517/PycharmProjects/qq_bot"):
        self.working_dir = working_dir
        self.claude_process: Optional[subprocess.Popen] = None
        self.is_running = False
        self.setup_logger()
        
    def setup_logger(self):
        """设置日志记录器"""
        global logger
        logger = logging.getLogger('claude_code_manager')
        logger.setLevel(logging.INFO)
        
        if not logger.handlers:
            log_dir = "../logs/claude_code"
            os.makedirs(log_dir, exist_ok=True)
            
            today = datetime.now().strftime("%Y-%m-%d")
            log_file = os.path.join(log_dir, f"claude_code_{today}.log")
            
            file_handler = logging.FileHandler(log_file, encoding='utf-8')
            console_handler = logging.StreamHandler()
            
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            
            file_handler.setFormatter(formatter)
            console_handler.setFormatter(formatter)
            
            logger.addHandler(file_handler)
            logger.addHandler(console_handler)
    
    async def start_claude_code_process(self) -> bool:
        """启动Claude Code交互bash进程"""
        if self.is_running and self.claude_process:
            logger.warning("Claude Code process already running")
            return True
            
        try:
            # 检查claude命令是否可用
            check_result = subprocess.run(
                ["which", "claude"], 
                capture_output=True, 
                text=True
            )
            
            if check_result.returncode != 0:
                logger.error("Claude Code command not found. Please install Claude Code CLI.")
                return False
            
            logger.info(f"Starting Claude Code process in directory: {self.working_dir}")
            
            # 启动专门的bash进程用于Claude Code交互
            self.claude_process = subprocess.Popen(
                ["bash"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE,
                text=True,
                cwd=self.working_dir,
                bufsize=1,
                universal_newlines=True
            )
            
            # 初始化bash环境
            init_commands = [
                f"cd {self.working_dir}",
                "export CLAUDE_CONFIG_PATH=.",
                "echo 'Claude Code bash process ready'"
            ]
            
            for cmd in init_commands:
                self.claude_process.stdin.write(f"{cmd}\n")
                self.claude_process.stdin.flush()
            
            self.is_running = True
            logger.info("Claude Code process started successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start Claude Code process: {e}")
            return False
    
    async def execute_claude_code_command(self, input_text: str) -> Dict[str, Any]:
        """通过Claude Code处理需求文本"""
        if not self.is_running or not self.claude_process:
            await self.start_claude_code_process()
            
        if not self.is_running:
            return {
                "success": False,
                "error": "Claude Code process not available"
            }
        
        try:
            # 创建临时输入文件
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            input_file = f"/tmp/claude_input_{timestamp}.txt"
            
            with open(input_file, 'w', encoding='utf-8') as f:
                f.write(input_text)
            
            # 构建Claude Code命令
            claude_command = f"cat {input_file} | claude --no-confirm"
            
            logger.info(f"Executing Claude Code command: {claude_command}")
            
            # 发送命令到bash进程
            self.claude_process.stdin.write(f"{claude_command}\n")
            self.claude_process.stdin.write("echo 'CLAUDE_COMMAND_FINISHED'\n")
            self.claude_process.stdin.flush()
            
            # 读取输出直到看到结束标记
            output_lines = []
            error_lines = []
            
            # 设置超时读取
            timeout = 300  # 5分钟超时
            start_time = datetime.now()
            
            while True:
                if (datetime.now() - start_time).seconds > timeout:
                    logger.error("Claude Code command timeout")
                    break
                    
                try:
                    # 非阻塞读取
                    line = await asyncio.wait_for(
                        asyncio.to_thread(self.claude_process.stdout.readline), 
                        timeout=1.0
                    )
                    
                    if not line:
                        break
                        
                    line = line.strip()
                    if line == 'CLAUDE_COMMAND_FINISHED':
                        break
                        
                    output_lines.append(line)
                    
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    logger.error(f"Error reading Claude Code output: {e}")
                    break
            
            # 清理临时文件
            try:
                os.remove(input_file)
            except:
                pass
            
            output = '\n'.join(output_lines)
            errors = '\n'.join(error_lines)
            
            return {
                "success": True,
                "output": output,
                "errors": errors,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Claude Code execution error: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def stop_claude_code_process(self):
        """停止Claude Code进程"""
        if self.claude_process:
            try:
                self.claude_process.terminate()
                await asyncio.sleep(2)
                
                if self.claude_process.poll() is None:
                    self.claude_process.kill()
                    
                self.claude_process = None
                self.is_running = False
                logger.info("Claude Code process stopped")
                
            except Exception as e:
                logger.error(f"Error stopping Claude Code process: {e}")
    
    def get_status(self) -> Dict[str, Any]:
        """获取Claude Code进程状态"""
        return {
            "is_running": self.is_running,
            "process_id": self.claude_process.pid if self.claude_process else None,
            "working_directory": self.working_dir,
            "last_updated": datetime.now().isoformat()
        }


# 全局实例
_claude_code_manager = None

def get_claude_code_manager(working_dir: str = None) -> ClaudeCodeManager:
    """获取Claude Code管理器实例"""
    global _claude_code_manager
    if _claude_code_manager is None:
        _claude_code_manager = ClaudeCodeManager(working_dir or "/mnt/c/Users/a8517/PycharmProjects/qq_bot")
    return _claude_code_manager