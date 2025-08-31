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
        self.requirements: Dict[str, Requirement] = {}
        self.load_requirements()
        
    def load_requirements(self):
        """加载存储的需求"""
        try:
            if os.path.exists(self.REQUIREMENT_FILE):
                with open(self.REQUIREMENT_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for req_id, req_data in data.items():
                        req_data['status'] = RequirementStatus(req_data['status'])
                        self.requirements[req_id] = Requirement(**req_data)
                logger.info(f"Loaded {len(self.requirements)} requirements")
        except Exception as e:
            logger.error(f"Error loading requirements: {e}")
    
    def save_requirements(self):
        """保存需求到文件"""
        try:
            data = {}
            for req_id, req in self.requirements.items():
                req_dict = asdict(req)
                req_dict['status'] = req.status.value
                data[req_id] = req_dict
            
            with open(self.REQUIREMENT_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                
        except Exception as e:
            logger.error(f"Error saving requirements: {e}")
    
    async def is_requirement_message(self, user_id: int, message: str) -> bool:
        """判断是否为需求消息"""
        if user_id != self.AUTHORIZED_USER_ID:
            return False
            
        # 需求关键词判断
        requirement_indicators = [
            "实现", "开发", "添加", "修改", "修复", "优化",
            "需要", "需求", "功能", "特性", "bug", "问题",
            "创建", "构建", "集成", "升级", "更新", "改进"
        ]
        
        message_lower = message.lower()
        return any(keyword in message or keyword in message_lower 
                  for keyword in requirement_indicators)
    
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
        """更新需求状态"""
        if req_id not in self.requirements:
            return
            
        req = self.requirements[req_id]
        req.status = status
        req.updated_at = datetime.now().isoformat()
        
        if details:
            req.completion_details = details
        if error:
            req.error_message = error
            
        self.save_requirements()
        logger.info(f"Updated requirement {req_id} to status {status.value}")
    
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
        """执行Claude Code命令"""
        try:
            # 创建临时文件存储输入
            with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt', encoding='utf-8') as f:
                f.write(input_text)
                temp_file = f.name
            
            try:
                # 使用管道输入方式调用Claude Code
                process = await asyncio.create_subprocess_shell(
                    f"cat {temp_file} | {self.CLAUDE_CODE_COMMAND}",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=os.getcwd()
                )
                
                stdout, stderr = await process.communicate()
                
                if process.returncode == 0:
                    return {
                        'success': True,
                        'output': stdout.decode('utf-8', errors='ignore'),
                        'error': None
                    }
                else:
                    return {
                        'success': False,
                        'output': None,
                        'error': stderr.decode('utf-8', errors='ignore')
                    }
                    
            finally:
                # 清理临时文件
                try:
                    os.unlink(temp_file)
                except:
                    pass
                    
        except Exception as e:
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
            notification = f"""✅ 需求完成通知

需求ID: {req_id}
状态: 已完成
创建时间: {req.created_at}
完成时间: {req.updated_at}

原始需求: {req.message}

实施摘要: {req.completion_details[:200] if req.completion_details else '无详情'}...

🔧 所有功能已实现并验证完成！"""
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
    
    def get_requirement_status(self, req_id: str) -> Optional[Requirement]:
        """获取需求状态"""
        return self.requirements.get(req_id)
    
    def get_user_requirements(self, user_id: int) -> List[Requirement]:
        """获取用户的所有需求"""
        return [req for req in self.requirements.values() if req.user_id == user_id]
    
    async def generate_status_report(self, user_id: int) -> str:
        """生成需求状态报告"""
        user_reqs = self.get_user_requirements(user_id)
        
        if not user_reqs:
            return "📝 您暂无任何需求记录。"
        
        # 按状态分组统计
        status_counts = {}
        for req in user_reqs:
            status = req.status.value
            status_counts[status] = status_counts.get(status, 0) + 1
        
        # 最近的需求
        recent_reqs = sorted(user_reqs, key=lambda r: r.updated_at, reverse=True)[:5]
        
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
            }.get(req.status.value, '❓')
            
            report += f"\n{status_emoji} {req.id}: {req.message[:30]}..."
        
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