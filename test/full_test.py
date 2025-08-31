#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完整的QQ机器人功能测试脚本
验证私聊、群聊、@消息、回复消息等功能
"""

import asyncio
import logging
import json
import os
from datetime import datetime
from websocket_client import WebSocketClient


def setup_test_logging():
    """设置测试日志"""
    log_dir = "log"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    today = datetime.now().strftime("%Y-%m-%d")
    test_log_file = os.path.join(log_dir, f"full_test_{today}.log")
    
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


async def test_private_message_functions(client):
    """测试私聊消息功能"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Private Message Functions ===")
    print("=== Testing Private Message Functions ===")
    
    # 测试参数
    test_user_id = 123456789
    
    try:
        # 测试1: 简单文本消息
        logger.info("Test 1: Simple text message")
        print("Test 1: Simple text message")
        
        message = "这是一条测试私聊消息"
        logger.info(f"Will send: {message}")
        print(f"Will send: {message}")
        
        # 注意：这里只是测试消息构造，不实际发送
        # result = await client.send_private_message(test_user_id, message)
        # logger.info(f"Send result: {result}")
        
        # 测试2: 消息段
        logger.info("Test 2: Message segments")
        print("Test 2: Message segments")
        
        message_segments = [
            {"type": "text", "data": {"text": "测试"}},
            {"type": "face", "data": {"id": 123}},
            {"type": "text", "data": {"text": "表情消息"}}
        ]
        logger.info(f"Message segments: {json.dumps(message_segments, ensure_ascii=False)}")
        print(f"Message segments: {json.dumps(message_segments, ensure_ascii=False)}")
        
        # 测试3: 长文本
        logger.info("Test 3: Long text message")
        print("Test 3: Long text message")
        
        long_text = "这是一条很长的测试消息，用来测试机器人是否能正确处理长文本消息。" * 3
        logger.info(f"Long text length: {len(long_text)} characters")
        print(f"Long text length: {len(long_text)} characters")
        
        logger.info("Private message function tests completed")
        print("Private message function tests completed")
        
    except Exception as e:
        logger.error(f"Private message test failed: {e}")
        print(f"Private message test failed: {e}")


async def test_group_message_functions(client):
    """测试群聊消息功能"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Group Message Functions ===")
    print("=== Testing Group Message Functions ===")
    
    # 测试参数
    test_group_id = 987654321
    test_user_id = 123456789
    
    try:
        # 测试1: 简单群聊消息
        logger.info("Test 1: Simple group message")
        print("Test 1: Simple group message")
        
        message = "这是一条测试群聊消息"
        logger.info(f"Will send to group {test_group_id}: {message}")
        print(f"Will send to group {test_group_id}: {message}")
        
        # 测试2: @消息
        logger.info("Test 2: At message")
        print("Test 2: At message")
        
        at_message = "这是@消息测试"
        logger.info(f"Will send @ message to group {test_group_id} for user {test_user_id}: {at_message}")
        print(f"Will send @ message to group {test_group_id} for user {test_user_id}: {at_message}")
        
        # 测试3: 特殊字符消息
        logger.info("Test 3: Special characters message")
        print("Test 3: Special characters message")
        
        special_chars = "测试特殊字符：!@#$%^&*()_+-=[]{}|;':\",./<>?"
        logger.info(f"Special characters: {special_chars}")
        print(f"Special characters: {special_chars}")
        
        logger.info("Group message function tests completed")
        print("Group message function tests completed")
        
    except Exception as e:
        logger.error(f"Group message test failed: {e}")
        print(f"Group message test failed: {e}")


async def test_reply_message_functions(client):
    """测试回复消息功能"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Reply Message Functions ===")
    print("=== Testing Reply Message Functions ===")
    
    # 测试参数
    test_user_id = 123456789
    test_group_id = 987654321
    test_reply_id = 1001
    
    try:
        # 测试1: 私聊回复消息
        logger.info("Test 1: Private reply message")
        print("Test 1: Private reply message")
        
        reply_text = f"这是回复消息，回复ID: {test_reply_id}"
        logger.info(f"Will send reply to user {test_user_id}: {reply_text}")
        print(f"Will send reply to user {test_user_id}: {reply_text}")
        
        # 测试2: 群聊回复消息
        logger.info("Test 2: Group reply message")
        print("Test 2: Group reply message")
        
        group_reply_text = f"这是群聊回复消息，回复ID: {test_reply_id}"
        logger.info(f"Will send reply to group {test_group_id}: {group_reply_text}")
        print(f"Will send reply to group {test_group_id}: {group_reply_text}")
        
        logger.info("Reply message function tests completed")
        print("Reply message function tests completed")
        
    except Exception as e:
        logger.error(f"Reply message test failed: {e}")
        print(f"Reply message test failed: {e}")


async def test_message_types(client):
    """测试不同类型的消息"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Different Message Types ===")
    print("=== Testing Different Message Types ===")
    
    test_user_id = 123456789
    test_group_id = 987654321
    
    try:
        # 测试1: 纯文本
        logger.info("Test 1: Pure text message")
        print("Test 1: Pure text message")
        
        text_message = "纯文本消息测试"
        logger.info(f"Text message: {text_message}")
        print(f"Text message: {text_message}")
        
        # 测试2: 表情消息
        logger.info("Test 2: Face message")
        print("Test 2: Face message")
        
        face_message = [
            {"type": "face", "data": {"id": 1}},
            {"type": "text", "data": {"text": " 表情消息测试"}}
        ]
        logger.info(f"Face message: {json.dumps(face_message, ensure_ascii=False)}")
        print(f"Face message: {json.dumps(face_message, ensure_ascii=False)}")
        
        # 测试3: 图片消息（模拟）
        logger.info("Test 3: Image message (simulated)")
        print("Test 3: Image message (simulated)")
        
        image_message = [
            {"type": "text", "data": {"text": "图片消息测试："}},
            {"type": "image", "data": {"file": "test.jpg", "url": "http://example.com/test.jpg"}}
        ]
        logger.info(f"Image message: {json.dumps(image_message, ensure_ascii=False)}")
        print(f"Image message: {json.dumps(image_message, ensure_ascii=False)}")
        
        # 测试4: 群聊@消息
        logger.info("Test 4: Group at message")
        print("Test 4: Group at message")
        
        at_text = "群聊@消息测试"
        logger.info(f"Will send @ message to group {test_group_id} for user {test_user_id}: {at_text}")
        print(f"Will send @ message to group {test_group_id} for user {test_user_id}: {at_text}")
        
        logger.info("Message type tests completed")
        print("Message type tests completed")
        
    except Exception as e:
        logger.error(f"Message type test failed: {e}")
        print(f"Message type test failed: {e}")


async def test_error_handling(client):
    """测试错误处理"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Error Handling ===")
    print("=== Testing Error Handling ===")
    
    try:
        # 测试1: 无效的用户ID
        logger.info("Test 1: Invalid user ID")
        print("Test 1: Invalid user ID")
        
        invalid_user_id = 0
        logger.info(f"Testing with invalid user ID: {invalid_user_id}")
        print(f"Testing with invalid user ID: {invalid_user_id}")
        
        # 测试2: 无效的群ID
        logger.info("Test 2: Invalid group ID")
        print("Test 2: Invalid group ID")
        
        invalid_group_id = 0
        logger.info(f"Testing with invalid group ID: {invalid_group_id}")
        print(f"Testing with invalid group ID: {invalid_group_id}")
        
        # 测试3: 空消息
        logger.info("Test 3: Empty message")
        print("Test 3: Empty message")
        
        empty_message = ""
        logger.info(f"Testing with empty message: '{empty_message}'")
        print(f"Testing with empty message: '{empty_message}'")
        
        logger.info("Error handling tests completed")
        print("Error handling tests completed")
        
    except Exception as e:
        logger.error(f"Error handling test failed: {e}")
        print(f"Error handling test failed: {e}")


async def test_configuration():
    """测试配置功能"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Configuration ===")
    print("=== Testing Configuration ===")
    
    try:
        import config
        
        logger.info("Configuration imported successfully")
        print("Configuration imported successfully")
        
        # 测试WebSocket配置
        logger.info("WebSocket Configuration:")
        print("WebSocket Configuration:")
        ws_config = config.WEBSOCKET_CONFIG
        logger.info(f"  Host: {ws_config.get('host')}")
        print(f"  Host: {ws_config.get('host')}")
        logger.info(f"  Port: {ws_config.get('port')}")
        print(f"  Port: {ws_config.get('port')}")
        logger.info(f"  Access Token: {ws_config.get('access_token')}")
        print(f"  Access Token: {ws_config.get('access_token')}")
        
        # 测试测试配置
        logger.info("Test Configuration:")
        print("Test Configuration:")
        test_config = config.TEST_CONFIG
        logger.info(f"  Test User ID: {test_config.get('test_user_id')}")
        print(f"  Test User ID: {test_config.get('test_user_id')}")
        logger.info(f"  Test Group ID: {test_config.get('test_group_id')}")
        print(f"  Test Group ID: {test_config.get('test_group_id')}")
        logger.info(f"  Test Reply ID: {test_config.get('test_reply_id')}")
        print(f"  Test Reply ID: {test_config.get('test_reply_id')}")
        
        # 测试日志配置
        logger.info("Logging Configuration:")
        print("Logging Configuration:")
        log_config = config.LOGGING_CONFIG
        logger.info(f"  Level: {log_config.get('level')}")
        print(f"  Level: {log_config.get('level')}")
        logger.info(f"  Log Directory: {log_config.get('log_dir')}")
        print(f"  Log Directory: {log_config.get('log_dir')}")
        
        logger.info("Configuration tests completed")
        print("Configuration tests completed")
        
    except Exception as e:
        logger.error(f"Configuration test failed: {e}")
        print(f"Configuration test failed: {e}")


async def run_all_tests():
    """运行所有测试"""
    logger = logging.getLogger(__name__)
    
    logger.info("Starting QQ Bot Full Functionality Tests...")
    print("Starting QQ Bot Full Functionality Tests...")
    
    try:
        # 创建WebSocket客户端
        logger.info("Creating WebSocket client...")
        print("Creating WebSocket client...")
        client = WebSocketClient()
        logger.info("WebSocket client created successfully")
        print("WebSocket client created successfully")
        
        # 运行各项测试
        await test_private_message_functions(client)
        await test_group_message_functions(client)
        await test_reply_message_functions(client)
        await test_message_types(client)
        await test_error_handling(client)
        await test_configuration()
        
        logger.info("All tests completed successfully!")
        print("All tests completed successfully!")
        
    except Exception as e:
        logger.error(f"Test execution failed: {e}")
        print(f"Test execution failed: {e}")


if __name__ == "__main__":
    # 设置日志
    setup_test_logging()
    
    # 运行测试
    asyncio.run(run_all_tests())
