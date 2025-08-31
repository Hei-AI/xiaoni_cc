#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简单的功能测试脚本
不依赖WebSocket连接，用于验证基本功能
"""

import asyncio
import logging
import json
from datetime import datetime
from websocket_client import WebSocketClient


def setup_logging():
    """设置日志"""
    import os
    log_dir = "log"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    today = datetime.now().strftime("%Y-%m-%d")
    test_log_file = os.path.join(log_dir, f"simple_test_{today}.log")
    
    # 创建logger
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    
    # 清除现有的处理器
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)
    
    # 创建文件处理器
    file_handler = logging.FileHandler(test_log_file, encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    
    # 创建控制台处理器
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    
    # 设置格式
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)
    
    # 添加处理器
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger


async def test_message_construction():
    """测试消息构造功能"""
    logger = logging.getLogger(__name__)
    
    logger.info("Testing message construction...")
    print("Testing message construction...")
    
    # 测试1: 文本消息构造
    text_message = "你好，这是一条测试消息"
    logger.info(f"Text message: {text_message}")
    print(f"Text message: {text_message}")
    
    # 测试2: 消息段构造
    message_segments = [
        {"type": "text", "data": {"text": "测试"}},
        {"type": "face", "data": {"id": 123}},
        {"type": "text", "data": {"text": "表情消息"}}
    ]
    logger.info(f"Message segments: {json.dumps(message_segments, ensure_ascii=False)}")
    print(f"Message segments: {json.dumps(message_segments, ensure_ascii=False)}")
    
    # 测试3: @消息构造
    at_message = [
        {"type": "at", "data": {"qq": 123456789}},
        {"type": "text", "data": {"text": "这是@消息"}}
    ]
    logger.info(f"At message: {json.dumps(at_message, ensure_ascii=False)}")
    print(f"At message: {json.dumps(at_message, ensure_ascii=False)}")
    
    # 测试4: 回复消息构造
    reply_message = [
        {"type": "reply", "data": {"id": 1001}},
        {"type": "text", "data": {"text": "这是回复消息"}}
    ]
    logger.info(f"Reply message: {json.dumps(reply_message, ensure_ascii=False)}")
    print(f"Reply message: {json.dumps(reply_message, ensure_ascii=False)}")
    
    logger.info("Message construction tests completed")
    print("Message construction tests completed")


async def test_client_initialization():
    """测试客户端初始化"""
    logger = logging.getLogger(__name__)
    
    logger.info("Testing client initialization...")
    print("Testing client initialization...")
    
    try:
        # 创建客户端实例
        client = WebSocketClient()
        logger.info("WebSocket client created successfully")
        print("WebSocket client created successfully")
        
        # 检查客户端属性
        logger.info(f"Client host: {client.host}")
        print(f"Client host: {client.host}")
        logger.info(f"Client port: {client.port}")
        print(f"Client port: {client.port}")
        logger.info(f"Client URI: {client.uri}")
        print(f"Client URI: {client.uri}")
        logger.info(f"Client is_running: {client.is_running}")
        print(f"Client is_running: {client.is_running}")
        logger.info(f"Client is_connected: {client.is_connected()}")
        print(f"Client is_connected: {client.is_connected()}")
        
        # 测试事件处理器注册
        def test_handler(data):
            logger.info(f"Test handler called with: {data}")
            print(f"Test handler called with: {data}")
        
        client.on('test_event', test_handler)
        logger.info("Event handler registered successfully")
        print("Event handler registered successfully")
        
        # 检查事件处理器
        logger.info(f"Registered event handlers: {list(client.event_handlers.keys())}")
        print(f"Registered event handlers: {list(client.event_handlers.keys())}")
        
        logger.info("Client initialization tests completed")
        print("Client initialization tests completed")
        
    except Exception as e:
        logger.error(f"Client initialization test failed: {e}")
        print(f"Client initialization test failed: {e}")


async def test_logging_functionality():
    """测试日志功能"""
    logger = logging.getLogger(__name__)
    
    logger.info("Testing logging functionality...")
    print("Testing logging functionality...")
    
    # 测试不同级别的日志
    logger.debug("This is a debug message")
    logger.info("This is an info message")
    logger.warning("This is a warning message")
    logger.error("This is an error message")
    
    # 测试日志文件写入
    test_data = {
        "test": "logging",
        "timestamp": datetime.now().isoformat(),
        "message": "测试日志写入功能"
    }
    logger.info(f"Test data: {json.dumps(test_data, ensure_ascii=False)}")
    print(f"Test data: {json.dumps(test_data, ensure_ascii=False)}")
    
    logger.info("Logging functionality tests completed")
    print("Logging functionality tests completed")


async def test_config_loading():
    """测试配置加载"""
    logger = logging.getLogger(__name__)
    
    logger.info("Testing configuration loading...")
    print("Testing configuration loading...")
    
    try:
        # 尝试导入配置
        import config
        
        logger.info("Configuration imported successfully")
        print("Configuration imported successfully")
        logger.info(f"WebSocket config: {config.WEBSOCKET_CONFIG}")
        print(f"WebSocket config: {config.WEBSOCKET_CONFIG}")
        logger.info(f"Test config: {config.TEST_CONFIG}")
        print(f"Test config: {config.TEST_CONFIG}")
        logger.info(f"Logging config: {config.LOGGING_CONFIG}")
        print(f"Logging config: {config.LOGGING_CONFIG}")
        
        # 测试配置值
        host = config.WEBSOCKET_CONFIG.get('host')
        port = config.WEBSOCKET_CONFIG.get('port')
        logger.info(f"Server address: {host}:{port}")
        print(f"Server address: {host}:{port}")
        
        logger.info("Configuration loading tests completed")
        print("Configuration loading tests completed")
        
    except Exception as e:
        logger.error(f"Configuration loading test failed: {e}")
        print(f"Configuration loading test failed: {e}")


async def test_event_handling():
    """测试事件处理逻辑"""
    logger = logging.getLogger(__name__)
    
    logger.info("Testing event handling logic...")
    print("Testing event handling logic...")
    
    # 模拟事件数据
    test_events = [
        {
            "type": "message",
            "post_type": "message",
            "message_type": "private",
            "user_id": 123456789,
            "raw_message": "你好",
            "message_id": 1001
        },
        {
            "type": "message",
            "post_type": "message",
            "message_type": "group",
            "group_id": 987654321,
            "user_id": 123456789,
            "raw_message": "群聊消息",
            "message_id": 1002
        },
        {
            "type": "notice",
            "post_type": "notice",
            "notice_type": "friend_add",
            "user_id": 123456789
        }
    ]
    
    # 测试事件解析
    for i, event in enumerate(test_events):
        logger.info(f"Processing test event {i+1}: {event.get('type')}")
        print(f"Processing test event {i+1}: {event.get('type')}")
        
        # 模拟事件类型判断
        event_type = event.get('type', 'unknown')
        post_type = event.get('post_type', 'unknown')
        
        if post_type == 'message':
            message_type = event.get('message_type', 'unknown')
            logger.info(f"Message event: {message_type}")
            print(f"Message event: {message_type}")
            
            if message_type == 'private':
                user_id = event.get('user_id')
                message = event.get('raw_message', '')
                logger.info(f"Private message from {user_id}: {message}")
                print(f"Private message from {user_id}: {message}")
                
            elif message_type == 'group':
                group_id = event.get('group_id')
                user_id = event.get('user_id')
                message = event.get('raw_message', '')
                logger.info(f"Group message in {group_id} from {user_id}: {message}")
                print(f"Group message in {group_id} from {user_id}: {message}")
                
        elif post_type == 'notice':
            notice_type = event.get('notice_type', 'unknown')
            logger.info(f"Notice event: {notice_type}")
            print(f"Notice event: {notice_type}")
            
        else:
            logger.info(f"Unknown event type: {post_type}")
            print(f"Unknown event type: {post_type}")
    
    logger.info("Event handling logic tests completed")
    print("Event handling logic tests completed")


async def run_all_simple_tests():
    """运行所有简单测试"""
    logger = logging.getLogger(__name__)
    
    logger.info("Starting simple functionality tests...")
    print("Starting simple functionality tests...")
    
    try:
        # 运行各项测试
        await test_message_construction()
        await test_client_initialization()
        await test_logging_functionality()
        await test_config_loading()
        await test_event_handling()
        
        logger.info("All simple tests completed successfully!")
        print("All simple tests completed successfully!")
        
    except Exception as e:
        logger.error(f"Simple test execution failed: {e}")
        print(f"Simple test execution failed: {e}")


if __name__ == "__main__":
    # 设置日志
    setup_logging()
    
    # 运行测试
    asyncio.run(run_all_simple_tests())
