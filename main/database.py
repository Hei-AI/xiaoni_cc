#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库连接和管理模块
使用MySQL数据库存储对话历史和需求管理数据
"""

import mysql.connector
from mysql.connector import pooling, Error
import logging
import json
from datetime import datetime, date
from typing import Optional, Dict, List, Any, Union
from contextlib import contextmanager
import os


class DatabaseManager:
    """数据库管理器"""
    
    def __init__(self, config: Dict[str, Any] = None):
        """初始化数据库连接"""
        self.config = config or self._get_default_config()
        self.pool = None
        self.logger = self._setup_logger()
        self._create_connection_pool()
    
    def _get_default_config(self) -> Dict[str, Any]:
        """获取默认数据库配置"""
        return {
            'host': os.getenv('MYSQL_HOST', 'localhost'),
            'port': int(os.getenv('MYSQL_PORT', 3306)),
            'database': os.getenv('MYSQL_DATABASE', 'qqbot_db'),
            'user': os.getenv('MYSQL_USER', 'qqbot_user'),
            'password': os.getenv('MYSQL_PASSWORD', 'qqbot_password'),
            'charset': 'utf8mb4',
            'collation': 'utf8mb4_unicode_ci',
            'pool_name': 'qqbot_pool',
            'pool_size': 10,
            'pool_reset_session': True,
            'autocommit': True
        }
    
    def _setup_logger(self) -> logging.Logger:
        """设置日志记录器"""
        logger = logging.getLogger('database_manager')
        logger.setLevel(logging.INFO)
        
        if not logger.handlers:
            log_dir = "../logs/mysql"
            os.makedirs(log_dir, exist_ok=True)
            
            today = datetime.now().strftime("%Y-%m-%d")
            log_file = os.path.join(log_dir, f"mysql_{today}.log")
            
            file_handler = logging.FileHandler(log_file, encoding='utf-8')
            console_handler = logging.StreamHandler()
            
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            
            file_handler.setFormatter(formatter)
            console_handler.setFormatter(formatter)
            
            logger.addHandler(file_handler)
            logger.addHandler(console_handler)
        
        return logger
    
    def _create_connection_pool(self):
        """创建数据库连接池"""
        try:
            self.pool = pooling.MySQLConnectionPool(**self.config)
            self.logger.info("Database connection pool created successfully")
        except Error as e:
            self.logger.error(f"Error creating connection pool: {e}")
            self.pool = None
    
    @contextmanager
    def get_connection(self):
        """获取数据库连接（上下文管理器）"""
        connection = None
        try:
            if not self.pool:
                self._create_connection_pool()
            
            connection = self.pool.get_connection()
            yield connection
            
        except Error as e:
            if connection and connection.in_transaction:
                connection.rollback()
            self.logger.error(f"Database connection error: {e}")
            raise
        finally:
            if connection and connection.is_connected():
                connection.close()
    
    def test_connection(self) -> bool:
        """测试数据库连接"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                result = cursor.fetchone()
                cursor.close()
                self.logger.info("Database connection test successful")
                return result[0] == 1
        except Exception as e:
            self.logger.error(f"Database connection test failed: {e}")
            return False
    
    def execute_query(self, query: str, params: tuple = None) -> List[Dict[str, Any]]:
        """执行查询语句并返回结果"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor(dictionary=True)
                cursor.execute(query, params or ())
                results = cursor.fetchall()
                cursor.close()
                
                # 处理日期时间序列化
                for result in results:
                    for key, value in result.items():
                        if isinstance(value, (datetime, date)):
                            result[key] = value.isoformat()
                
                return results
        except Exception as e:
            self.logger.error(f"Query execution failed: {e}")
            return []
    
    def execute_update(self, query: str, params: tuple = None) -> int:
        """执行更新语句并返回受影响的行数"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(query, params or ())
                affected_rows = cursor.rowcount
                conn.commit()
                cursor.close()
                return affected_rows
        except Exception as e:
            self.logger.error(f"Update execution failed: {e}")
            return 0
    
    def execute_batch(self, query: str, params_list: List[tuple]) -> int:
        """批量执行语句"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.executemany(query, params_list)
                affected_rows = cursor.rowcount
                conn.commit()
                cursor.close()
                return affected_rows
        except Exception as e:
            self.logger.error(f"Batch execution failed: {e}")
            return 0
    
    def get_conversation_by_id(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        """根据ID获取对话记录"""
        query = "SELECT * FROM conversations WHERE id = %s"
        results = self.execute_query(query, (conversation_id,))
        return results[0] if results else None
    
    def save_conversation(self, conversation_data: Dict[str, Any]) -> bool:
        """保存对话记录"""
        query = """
        INSERT INTO conversations (id, user_id, user_message, ai_response, timestamp, response_time, model_name, raw_request, raw_response, message_id, reply_to_message_id, reply_to_text)
        VALUES (%(id)s, %(user_id)s, %(user_message)s, %(ai_response)s, %(timestamp)s, %(response_time)s, %(model_name)s, %(raw_request)s, %(raw_response)s, %(message_id)s, %(reply_to_message_id)s, %(reply_to_text)s)
        ON DUPLICATE KEY UPDATE
        ai_response = VALUES(ai_response),
        response_time = VALUES(response_time),
        raw_request = VALUES(raw_request),
        raw_response = VALUES(raw_response),
        message_id = VALUES(message_id),
        reply_to_message_id = VALUES(reply_to_message_id),
        reply_to_text = VALUES(reply_to_text),
        updated_at = CURRENT_TIMESTAMP
        """
        
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(query, conversation_data)
                conn.commit()
                cursor.close()
                
                self.logger.info(f"Conversation saved: {conversation_data['id']}")
                return True
        except Exception as e:
            self.logger.error(f"Failed to save conversation: {e}")
            return False
    
    def get_conversations(self, user_id: Optional[int] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """获取对话记录列表"""
        if user_id:
            query = "SELECT * FROM conversations WHERE user_id = %s ORDER BY timestamp DESC LIMIT %s"
            params = (user_id, limit)
        else:
            query = "SELECT * FROM conversations ORDER BY timestamp DESC LIMIT %s"
            params = (limit,)
        
        return self.execute_query(query, params)
    
    def clear_conversations(self) -> int:
        """清空对话历史"""
        query = "DELETE FROM conversations"
        return self.execute_update(query)
    
    def get_requirement_by_id(self, requirement_id: str) -> Optional[Dict[str, Any]]:
        """根据ID获取需求记录"""
        query = "SELECT * FROM requirements WHERE id = %s"
        results = self.execute_query(query, (requirement_id,))
        return results[0] if results else None
    
    def save_requirement(self, requirement_data: Dict[str, Any]) -> bool:
        """保存需求记录"""
        query = """
        INSERT INTO requirements (id, user_id, message, status, created_at, updated_at, 
                                 claude_code_output, completion_details, error_message,
                                 processing_start_time, processing_end_time)
        VALUES (%(id)s, %(user_id)s, %(message)s, %(status)s, %(created_at)s, %(updated_at)s,
                %(claude_code_output)s, %(completion_details)s, %(error_message)s,
                %(processing_start_time)s, %(processing_end_time)s)
        ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        updated_at = VALUES(updated_at),
        claude_code_output = VALUES(claude_code_output),
        completion_details = VALUES(completion_details),
        error_message = VALUES(error_message),
        processing_start_time = VALUES(processing_start_time),
        processing_end_time = VALUES(processing_end_time)
        """
        
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(query, requirement_data)
                conn.commit()
                cursor.close()
                
                self.logger.info(f"Requirement saved: {requirement_data['id']}")
                return True
        except Exception as e:
            self.logger.error(f"Failed to save requirement: {e}")
            return False
    
    def get_requirements(self, user_id: Optional[int] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """获取需求记录列表"""
        if user_id:
            query = "SELECT * FROM requirements WHERE user_id = %s ORDER BY updated_at DESC LIMIT %s"
            params = (user_id, limit)
        else:
            query = "SELECT * FROM requirements ORDER BY updated_at DESC LIMIT %s"
            params = (limit,)
        
        return self.execute_query(query, params)
    
    def update_requirement_status(self, requirement_id: str, status: str, **kwargs) -> bool:
        """更新需求状态"""
        update_fields = ["status = %s", "updated_at = CURRENT_TIMESTAMP"]
        params = [status]
        
        for field, value in kwargs.items():
            if field in ['claude_code_output', 'completion_details', 'error_message', 
                        'processing_start_time', 'processing_end_time']:
                update_fields.append(f"{field} = %s")
                params.append(value)
        
        query = f"UPDATE requirements SET {', '.join(update_fields)} WHERE id = %s"
        params.append(requirement_id)
        
        affected_rows = self.execute_update(query, tuple(params))
        return affected_rows > 0
    
    def log_system_event(self, level: str, module: str, message: str, extra_data: Dict[str, Any] = None):
        """记录系统日志"""
        query = """
        INSERT INTO system_logs (log_level, module_name, message, extra_data, timestamp)
        VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
        """
        
        params = (
            level.upper(),
            module,
            message,
            json.dumps(extra_data, ensure_ascii=False) if extra_data else None
        )
        
        self.execute_update(query, params)
    
    def update_bot_status(self, bot_id: str, status: str, websocket_connected: bool = False, 
                         http_server_running: bool = False, error_message: str = None):
        """更新机器人状态"""
        query = """
        INSERT INTO bot_status (bot_id, status, websocket_connected, http_server_running, 
                               last_heartbeat, error_message, timestamp)
        VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP, %s, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        websocket_connected = VALUES(websocket_connected),
        http_server_running = VALUES(http_server_running),
        last_heartbeat = VALUES(last_heartbeat),
        error_message = VALUES(error_message),
        timestamp = VALUES(timestamp)
        """
        
        params = (bot_id, status, websocket_connected, http_server_running, error_message)
        return self.execute_update(query, params) > 0
    
    def get_conversation_stats(self) -> Dict[str, Any]:
        """获取对话统计数据"""
        stats_query = """
        SELECT 
            COUNT(*) as total_conversations,
            COUNT(DISTINCT user_id) as unique_users,
            AVG(response_time) as avg_response_time,
            MIN(timestamp) as first_conversation,
            MAX(timestamp) as last_conversation
        FROM conversations
        """
        
        stats = self.execute_query(stats_query)
        return stats[0] if stats else {}
    
    def get_requirement_stats(self) -> List[Dict[str, Any]]:
        """获取需求统计数据"""
        return self.execute_query("SELECT * FROM requirement_status_stats")
    
    def cleanup_old_data(self, days_to_keep: int = 30) -> Dict[str, int]:
        """清理旧数据"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.callproc('CleanOldData', [days_to_keep])
                
                # 获取删除的记录数
                results = {}
                for result in cursor.stored_results():
                    results.update(result.fetchall())
                
                conn.commit()
                cursor.close()
                
                self.logger.info(f"Cleaned up data older than {days_to_keep} days")
                return results
                
        except Exception as e:
            self.logger.error(f"Data cleanup failed: {e}")
            return {}


# 全局数据库管理器实例
database_manager: Optional[DatabaseManager] = None


def get_database_manager() -> DatabaseManager:
    """获取数据库管理器单例"""
    global database_manager
    if database_manager is None:
        database_manager = DatabaseManager()
    return database_manager


if __name__ == "__main__":
    # 测试数据库连接
    db = DatabaseManager()
    
    if db.test_connection():
        print("✅ Database connection successful!")
        
        # 测试对话统计
        stats = db.get_conversation_stats()
        print(f"📊 Conversation stats: {stats}")
        
        # 测试需求统计
        req_stats = db.get_requirement_stats()
        print(f"📋 Requirement stats: {req_stats}")
        
    else:
        print("❌ Database connection failed!")