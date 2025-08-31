#!/usr/bin/env python3
"""
需求管理系统 - 基于Claude Code最佳实践
监听特定用户的业务需求，通过Claude Code处理，并通过hook通知完成状态
"""

import asyncio
import json
import logging
import os
import subprocess
import tempfile
from datetime import datetime
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict
from enum import Enum
from database import get_database_manager

logger = logging.getLogger(__name__)


class RequirementStatus(Enum):
    """需求状态枚举"""
    RECEIVED = "received"          # 已接收
    ANALYZING = "analyzing"        # 分析中
    PROCESSING = "processing"      # 处理中
    COMPLETED = "completed"        # 已完成
    FAILED = "failed"             # 失败
    CANCELLED = "cancelled"        # 已取消


@dataclass
class Requirement:
    """需求数据结构"""
    id: str
    user_id: int
    message: str
    status: RequirementStatus
    created_at: str
    updated_at: str
    claude_code_output: Optional[str] = None
    completion_details: Optional[str] = None
    error_message: Optional[str] = None


class RequirementManager:
    """需求管理器"""
    
    AUTHORIZED_USER_ID = 85178516  # 李阿花
    REQUIREMENT_FILE = "requirement_storage.json"
    CLAUDE_CODE_COMMAND = "claude"
    
    def __init__(self, qq_client=None):
        self.qq_client = qq_client
        self.db_manager = get_database_manager()
        self.requirements = {}  # 内存中的需求缓存
        self._setup_logger()
        self._load_existing_requirements()
        
    def _setup_logger(self):
        """设置日志记录器"""
        global logger
        logger = logging.getLogger('requirement_manager')
        logger.setLevel(logging.INFO)
        
        if not logger.handlers:
            # Console handler
            console_handler = logging.StreamHandler()
            
            # File handler with new log structure
            log_dir = "../logs/requirements"
            os.makedirs(log_dir, exist_ok=True)
            
            today = datetime.now().strftime("%Y-%m-%d")
            log_file = os.path.join(log_dir, f"requirements_{today}.log")
            file_handler = logging.FileHandler(log_file, encoding='utf-8')
            
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            
            console_handler.setFormatter(formatter)
            file_handler.setFormatter(formatter)
            
            logger.addHandler(console_handler)
            logger.addHandler(file_handler)
    
    def _load_existing_requirements(self):
        """从数据库加载现有需求到内存"""
        try:
            db_requirements = self.load_requirements_from_db(limit=100)
            for req_data in db_requirements:
                req = Requirement(
                    id=req_data['id'],
                    user_id=req_data['user_id'],
                    message=req_data['message'],
                    status=RequirementStatus(req_data['status']),
                    created_at=req_data['created_at'],
                    updated_at=req_data['updated_at'],
                    claude_code_output=req_data.get('claude_code_output'),
                    completion_details=req_data.get('completion_details'),
                    error_message=req_data.get('error_message')
                )
                self.requirements[req_data['id']] = req
            logger.info(f"Loaded {len(self.requirements)} existing requirements from database")
        except Exception as e:
            logger.error(f"Failed to load existing requirements: {e}")
            self.requirements = {}
    
    def save_requirements(self):
        """保存需求到数据库"""
        try:
            for req in self.requirements.values():
                req_data = {
                    'id': req.id,
                    'user_id': req.user_id,
                    'message': req.message,
                    'status': req.status.value,
                    'created_at': req.created_at,
                    'updated_at': req.updated_at,
                    'claude_code_output': req.claude_code_output,
                    'completion_details': req.completion_details,
                    'error_message': req.error_message,
                    'processing_start_time': None,
                    'processing_end_time': None
                }
                self.save_requirement_to_db(req_data)
        except Exception as e:
            logger.error(f"Failed to save requirements: {e}")
            
    def load_requirements_from_db(self, limit: int = 100) -> List[Dict[str, Any]]:
        """从数据库加载需求"""
        try:
            requirements = self.db_manager.get_requirements(limit=limit)
            logger.info(f"Loaded {len(requirements)} requirements from database")
            return requirements
        except Exception as e:
            logger.error(f"Error loading requirements from database: {e}")
            return []
    
    def save_requirement_to_db(self, requirement_data: Dict[str, Any]) -> bool:
        """保存需求到数据库"""
        try:
            return self.db_manager.save_requirement(requirement_data)
        except Exception as e:
            logger.error(f"Error saving requirement to database: {e}")
            return False
    
    async def is_requirement_message(self, user_id: int, message: str) -> bool:
        """判断是否为需求消息 - 现在通过意图识别Agent判断"""
        # 只验证用户授权，意图判断已移至意图识别Agent
        return user_id == self.AUTHORIZED_USER_ID
    
    async def create_requirement(self, user_id: int, message: str) -> str:
        """创建新需求"""
        req_id = f"req_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        timestamp = datetime.now().isoformat()
        
        requirement = Requirement(
            id=req_id,
            user_id=user_id,
            message=message,
            status=RequirementStatus.RECEIVED,
            created_at=timestamp,
            updated_at=timestamp
        )
        
        self.requirements[req_id] = requirement
        self.save_requirements()
        
        logger.info(f"Created requirement {req_id} from user {user_id}: {message[:100]}")
        return req_id
    
    async def update_requirement_status(self, req_id: str, status: RequirementStatus, 
                                       details: Optional[str] = None, 
                                       error: Optional[str] = None):
        """更新需求状态并自动汇报进度"""
        if req_id not in self.requirements:
            return
            
        req = self.requirements[req_id]
        old_status = req.status
        req.status = status
        req.updated_at = datetime.now().isoformat()
        
        if details:
            req.completion_details = details
        if error:
            req.error_message = error
            
        self.save_requirements()
        logger.info(f"Updated requirement {req_id} to status {status.value}")
        
        # 自动汇报重要状态变更
        await self.auto_report_progress(req_id, old_status, status, details, error)
    
    async def auto_report_progress(self, req_id: str, old_status: RequirementStatus, 
                                  new_status: RequirementStatus, details: Optional[str] = None,
                                  error: Optional[str] = None):
        """自动汇报任务进度给授权用户"""
        if not self.qq_client or req_id not in self.requirements:
            return
            
        req = self.requirements[req_id]
        
        # 只在关键状态变更时汇报
        report_statuses = [
            RequirementStatus.ANALYZING,
            RequirementStatus.PROCESSING, 
            RequirementStatus.COMPLETED,
            RequirementStatus.FAILED
        ]
        
        if new_status not in report_statuses:
            return
            
        # 构建进度汇报消息
        status_emoji = {
            RequirementStatus.ANALYZING: "🔍",
            RequirementStatus.PROCESSING: "⚙️",
            RequirementStatus.COMPLETED: "✅",
            RequirementStatus.FAILED: "❌"
        }
        
        emoji = status_emoji.get(new_status, "📋")
        
        progress_message = f"""{emoji} 任务进度汇报
需求ID: {req_id}
状态: {old_status.value} → {new_status.value}
任务: {req.message[:50]}...
完成时间: {req.updated_at[:19]}"""

        if details:
            progress_message += f"\n详情: {details[:100]}..."
            
        if error:
            progress_message += f"\n错误: {error[:100]}..."
            
        if new_status == RequirementStatus.COMPLETED:
            progress_message += "\n🎉 需求已成功完成！"
        elif new_status == RequirementStatus.PROCESSING:
            progress_message += "\n⏳ 正在处理中，请稍候..."
            
        try:
            await self.qq_client.send_private_message(self.AUTHORIZED_USER_ID, progress_message)
            logger.info(f"Progress report sent for requirement {req_id}")
        except Exception as e:
            logger.error(f"Failed to send progress report: {e}")
    
    async def process_requirement_with_claude_code(self, req_id: str):
        """使用Claude Code处理需求"""
        if req_id not in self.requirements:
            return
            
        req = self.requirements[req_id]
        
        try:
            # 更新状态为分析中
            await self.update_requirement_status(req_id, RequirementStatus.ANALYZING)
            await self.notify_user(req.user_id, f"📋 需求 {req_id} 开始分析...")
            
            # 准备Claude Code输入
            claude_input = self.prepare_claude_input(req)
            
            # 更新状态为处理中
            await self.update_requirement_status(req_id, RequirementStatus.PROCESSING)
            await self.notify_user(req.user_id, f"⚙️ 需求 {req_id} 开始处理...")
            
            # 执行Claude Code命令
            result = await self.execute_claude_code(claude_input)
            
            if result['success']:
                req.claude_code_output = result['output']
                await self.update_requirement_status(
                    req_id, 
                    RequirementStatus.COMPLETED, 
                    details=result['output'][:500] + "..." if len(result['output']) > 500 else result['output']
                )
                
                # 成功通知
                await self.notify_completion(req_id, success=True)
                
            else:
                await self.update_requirement_status(
                    req_id, 
                    RequirementStatus.FAILED, 
                    error=result['error']
                )
                
                # 失败通知
                await self.notify_completion(req_id, success=False, error=result['error'])
                
        except Exception as e:
            error_msg = f"Processing failed: {str(e)}"
            await self.update_requirement_status(req_id, RequirementStatus.FAILED, error=error_msg)
            await self.notify_completion(req_id, success=False, error=error_msg)
            logger.error(f"Error processing requirement {req_id}: {e}")
    
    def prepare_claude_input(self, req: Requirement) -> str:
        """准备Claude Code输入"""
        return f"""基于Claude Code最佳实践，请帮我处理以下需求：

需求ID: {req.id}
用户ID: {req.user_id}
创建时间: {req.created_at}
需求内容: {req.message}

请按照以下要求处理：
1. 分析需求并制定实施计划
2. 实现相关功能代码
3. 验证功能正确性
4. 提供完整的实施摘要

请直接开始处理，无需确认。"""
    
    async def execute_claude_code(self, input_text: str) -> Dict[str, Any]:
        """通过Claude Code管理器执行命令"""
        try:
            from claude_code_manager import get_claude_code_manager
            
            claude_manager = get_claude_code_manager()
            result = await claude_manager.execute_claude_code_command(input_text)
            
            logger.info(f"Claude Code execution result: {result.get('success', False)}")
            return result
                    
        except Exception as e:
            logger.error(f"Claude Code execution error: {e}")
            return {
                'success': False,
                'output': None,
                'error': f"Command execution error: {str(e)}"
            }
    
    async def notify_user(self, user_id: int, message: str):
        """通知用户"""
        if self.qq_client:
            try:
                await self.qq_client.send_private_message(user_id, message)
            except Exception as e:
                logger.error(f"Failed to notify user {user_id}: {e}")
    
    async def notify_completion(self, req_id: str, success: bool, error: Optional[str] = None):
        """通知需求完成状态（Hook机制）"""
        if req_id not in self.requirements:
            return
            
        req = self.requirements[req_id]
        
        if success:
            # 执行自动验证
            verification_result = await self.perform_auto_verification(req_id)
            
            notification = f"""✅ 需求完成通知

需求ID: {req_id}
状态: 已完成
创建时间: {req.created_at}
完成时间: {req.updated_at}

原始需求: {req.message}

实施摘要: {req.completion_details[:200] if req.completion_details else '无详情'}...

📊 自动验证结果:
{verification_result}

🤔 是否需要执行git commit提交代码？
回复 "同意提交" 或 "commit" 来确认提交
回复 "不提交" 或 "skip" 来跳过提交"""
        else:
            notification = f"""❌ 需求失败通知

需求ID: {req_id}
状态: 失败
错误信息: {error or '未知错误'}

原始需求: {req.message}

请检查需求内容或系统状态后重试。"""
        
        await self.notify_user(req.user_id, notification)
        
        # Hook: 可以在这里添加其他通知方式
        # 例如: 发送邮件、调用webhook、记录到外部系统等
        await self.execute_completion_hook(req_id, success, error)
    
    async def perform_auto_verification(self, req_id: str) -> str:
        """执行需求完成后的自动验证"""
        try:
            verification_steps = []
            
            # 1. 检查服务状态
            try:
                import requests
                health_response = requests.get("http://127.0.0.1:8080/health", timeout=5)
                if health_response.status_code == 200:
                    verification_steps.append("✅ HTTP服务器运行正常")
                else:
                    verification_steps.append("❌ HTTP服务器响应异常")
            except:
                verification_steps.append("❌ HTTP服务器无法访问")
            
            # 2. 检查WebSocket连接
            if self.qq_client and self.qq_client.is_connected():
                verification_steps.append("✅ WebSocket连接正常")
            else:
                verification_steps.append("❌ WebSocket连接断开")
            
            # 3. 检查数据库连接
            try:
                if self.db_manager and self.db_manager.test_connection():
                    verification_steps.append("✅ 数据库连接正常")
                else:
                    verification_steps.append("❌ 数据库连接失败")
            except:
                verification_steps.append("❌ 数据库测试异常")
            
            # 4. 检查AI Agent状态
            try:
                from gemini_agent import get_gemini_agent
                agent = get_gemini_agent()
                if agent.is_available():
                    verification_steps.append("✅ Gemini AI服务可用")
                else:
                    verification_steps.append("❌ Gemini AI服务不可用")
            except:
                verification_steps.append("❌ Gemini AI检查异常")
            
            # 5. 检查项目文件完整性
            import os
            key_files = ['main.py', 'config.py', 'websocket_client.py', 'http_server.py', 'gemini_agent.py']
            missing_files = [f for f in key_files if not os.path.exists(f)]
            if not missing_files:
                verification_steps.append("✅ 核心文件完整")
            else:
                verification_steps.append(f"❌ 缺失文件: {', '.join(missing_files)}")
            
            return "\n".join(verification_steps)
            
        except Exception as e:
            return f"❌ 验证过程异常: {str(e)}"
    
    async def handle_commit_permission(self, user_id: int, message: str, req_id: str = None):
        """处理Git提交许可询问"""
        if user_id != self.AUTHORIZED_USER_ID:
            return False
        
        # 检查是否为提交许可回复
        commit_keywords = ["同意提交", "commit", "提交", "确认提交"]
        skip_keywords = ["不提交", "skip", "跳过", "不要提交"]
        
        message_lower = message.lower().strip()
        
        if any(keyword in message_lower for keyword in commit_keywords):
            # 执行git commit
            commit_result = await self.execute_git_commit(req_id)
            await self.notify_user(user_id, commit_result)
            return True
            
        elif any(keyword in message_lower for keyword in skip_keywords):
            # 跳过提交
            await self.notify_user(user_id, "✅ 已跳过代码提交，需求处理完成。")
            return True
            
        return False
    
    async def execute_git_commit(self, req_id: str = None) -> str:
        """执行Git提交操作"""
        try:
            import subprocess
            import os
            
            # 获取当前目录
            current_dir = os.getcwd()
            
            # 检查git状态
            result = subprocess.run(['git', 'status', '--porcelain'], 
                                 capture_output=True, text=True, cwd=current_dir)
            
            if not result.stdout.strip():
                return "ℹ️ 没有需要提交的更改。"
            
            # 添加所有更改
            subprocess.run(['git', 'add', '.'], cwd=current_dir, check=True)
            
            # 生成提交消息
            commit_message = f"需求完成: {req_id if req_id else '自动提交'}"
            if req_id and req_id in self.requirements:
                req = self.requirements[req_id]
                commit_message += f"\n\n{req.message[:100]}"
            
            # 执行提交
            commit_result = subprocess.run(['git', 'commit', '-m', commit_message], 
                                        capture_output=True, text=True, cwd=current_dir)
            
            if commit_result.returncode == 0:
                return f"✅ 代码已成功提交到Git仓库\n提交信息: {commit_message}"
            else:
                return f"❌ Git提交失败: {commit_result.stderr}"
                
        except Exception as e:
            return f"❌ Git操作异常: {str(e)}"
    
    async def execute_completion_hook(self, req_id: str, success: bool, error: Optional[str] = None):
        """执行完成状态Hook"""
        try:
            # 记录到完成日志
            completion_log = {
                'req_id': req_id,
                'success': success,
                'timestamp': datetime.now().isoformat(),
                'error': error
            }
            
            # 写入Hook日志文件
            hook_log_file = f"log/requirement_completion_{datetime.now().strftime('%Y-%m-%d')}.log"
            with open(hook_log_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(completion_log, ensure_ascii=False) + '\n')
            
            logger.info(f"Completion hook executed for {req_id}, success: {success}")
            
        except Exception as e:
            logger.error(f"Completion hook failed for {req_id}: {e}")
    
    async def handle_requirement_message(self, user_id: int, message: str):
        """处理需求消息的主入口"""
        if not await self.is_requirement_message(user_id, message):
            return False
            
        # 创建需求
        req_id = await self.create_requirement(user_id, message)
        
        # 确认接收
        await self.notify_user(user_id, f"🎯 需求已接收！\n\n需求ID: {req_id}\n需求内容: {message}\n\n正在启动Claude Code处理...")
        
        # 异步处理需求
        asyncio.create_task(self.process_requirement_with_claude_code(req_id))
        
        return True
    
    def get_requirement_status(self, req_id: str) -> Optional[Dict[str, Any]]:
        """从数据库获取需求状态"""
        try:
            return self.db_manager.get_requirement_by_id(req_id)
        except Exception as e:
            logger.error(f"Error getting requirement {req_id} from database: {e}")
            return None
    
    def get_user_requirements(self, user_id: int, limit: int = 50) -> List[Dict[str, Any]]:
        """从数据库获取用户的所有需求"""
        try:
            return self.db_manager.get_requirements(user_id=user_id, limit=limit)
        except Exception as e:
            logger.error(f"Error getting user requirements from database: {e}")
            return []
    
    async def generate_status_report(self, user_id: int) -> str:
        """生成需求状态报告"""
        user_reqs = self.get_user_requirements(user_id)
        
        if not user_reqs:
            return "📝 您暂无任何需求记录。"
        
        # 按状态分组统计
        status_counts = {}
        for req in user_reqs:
            status = req['status'] if isinstance(req, dict) else req.status.value
            status_counts[status] = status_counts.get(status, 0) + 1
        
        # 最近的需求
        recent_reqs = sorted(user_reqs, key=lambda r: r['updated_at'] if isinstance(r, dict) else r.updated_at, reverse=True)[:5]
        
        report = f"""📊 需求状态报告
        
总需求数: {len(user_reqs)}
状态分布:"""
        
        for status, count in status_counts.items():
            status_emoji = {
                'received': '📋',
                'analyzing': '🔍', 
                'processing': '⚙️',
                'completed': '✅',
                'failed': '❌',
                'cancelled': '🚫'
            }.get(status, '❓')
            report += f"\n  {status_emoji} {status}: {count}个"
        
        report += f"\n\n📋 最近需求:"
        for req in recent_reqs[:3]:
            status_emoji = {
                'received': '📋',
                'analyzing': '🔍',
                'processing': '⚙️', 
                'completed': '✅',
                'failed': '❌',
                'cancelled': '🚫'
            }.get(req['status'] if isinstance(req, dict) else req.status.value, '❓')
            
            req_id = req['id'] if isinstance(req, dict) else req.id
            req_message = req['message'] if isinstance(req, dict) else req.message
            report += f"\n{status_emoji} {req_id}: {req_message[:30]}..."
        
        return report


# 全局需求管理器实例
requirement_manager: Optional[RequirementManager] = None


def get_requirement_manager(qq_client=None) -> RequirementManager:
    """获取需求管理器单例"""
    global requirement_manager
    if requirement_manager is None:
        requirement_manager = RequirementManager(qq_client)
    elif qq_client and requirement_manager.qq_client is None:
        requirement_manager.qq_client = qq_client
    return requirement_manager


async def handle_requirement_message(user_id: int, message: str, qq_client=None) -> bool:
    """处理需求消息的便捷函数"""
    manager = get_requirement_manager(qq_client)
    return await manager.handle_requirement_message(user_id, message)