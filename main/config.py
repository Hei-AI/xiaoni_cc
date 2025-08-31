#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQ机器人配置文件
包含WebSocket连接参数和测试配置
"""

# WebSocket连接配置
WEBSOCKET_CONFIG = {
    "host": "127.0.0.1",
    "port": 3001,
    "access_token": "w@123456",
    "uri": "ws://127.0.0.1:3001?access_token=w@123456"
}

# 机器人配置
BOT_CONFIG = {
    "qq_number": 1129974489,  # 机器人QQ号
    "name": "智能助手",
    "auto_reply_at": True,     # 自动回复@消息
    "group_ai_enabled": True   # 群聊AI功能启用
}

# 测试配置
TEST_CONFIG = {
    # 测试用户ID（请根据实际情况修改）
    "test_user_id": 123456789,
    
    # 测试群ID（请根据实际情况修改）
    "test_group_id": 987654321,
    
    # 测试消息ID（请根据实际情况修改）
    "test_reply_id": 1001,
    
    # 测试延迟（秒）
    "test_delay": 1.0,
    
    # 是否启用自动测试
    "enable_auto_test": True
}

# 日志配置
LOGGING_CONFIG = {
    "level": "INFO",
    "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    "log_dir": "log",
    "main_log_file": "main_{date}.log",
    "websocket_log_file": "websocket_events_{date}.log",
    "test_log_file": "test_{date}.log"
}

# 消息模板
MESSAGE_TEMPLATES = {
    "welcome": "你好！我是QQ机器人，很高兴为你服务！",
    "help": """可用命令：
- 你好：打招呼
- 帮助：显示此帮助信息
- 时间：显示当前时间
- 测试：测试机器人功能
- 群帮助：显示群聊帮助信息""",
    "group_help": """群聊可用命令：
- 群帮助：显示此帮助信息
- 群时间：显示当前时间
- @机器人：@机器人测试
- 测试群聊：测试群聊功能""",
    "test_message": "这是一条测试消息",
    "error_message": "抱歉，处理您的请求时出现了错误"
}

# 事件处理配置
EVENT_HANDLERS = {
    "message": True,
    "notice": True,
    "request": True,
    "meta": True,
    "default": True
}

# 自动回复配置
AUTO_REPLY_CONFIG = {
    "enabled": True,
    "private_enabled": True,
    "group_enabled": True,
    "keywords": {
        "你好": "你好！我是QQ机器人",
        "帮助": "help",
        "时间": "time",
        "测试": "test",
        "群帮助": "group_help"
    }
}

# 安全配置
SECURITY_CONFIG = {
    "max_message_length": 1000,
    "rate_limit": {
        "enabled": True,
        "max_messages_per_minute": 60,
        "max_messages_per_user_per_minute": 10
    },
    "blocked_users": [],
    "blocked_groups": []
}

# 功能开关
FEATURES = {
    "private_message": True,
    "group_message": True,
    "at_message": True,
    "reply_message": True,
    "auto_reply": True,
    "welcome_message": True,
    "file_upload": False,
    "image_send": False
}
