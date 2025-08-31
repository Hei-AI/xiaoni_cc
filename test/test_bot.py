#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQ机器人功能测试文件
用于测试私聊、群聊、@消息、回复消息等功能
"""

import asyncio
import logging
import json
from datetime import datetime
from websocket_client import WebSocketClient


def setup_test_logging():
    """设置测试日志"""
    import os
    log_dir = "log"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    today = datetime.now().strftime("%Y-%m-%d")
    test_log_file = os.path.join(log_dir, f"test_{today}.log")
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(test_log_file, encoding='utf-8'),
            logging.StreamHandler()
        ]
    )


async def test_private_message(client, user_id):
    """测试私聊消息发送"""
    logger = logging.getLogger(__name__)
    
    logger.info(f"Testing private message to user {user_id}")
    
    # 测试1: 发送简单文本消息
    result = await client.send_private_message(user_id, "这是一条测试私聊消息")
    logger.info(f"Simple text message result: {result}")
    await asyncio.sleep(1)
    
    # 测试2: 发送消息段
    message_segments = [
        {"type": "text", "data": {"text": "测试"}},
        {"type": "face", "data": {"id": 123}},
        {"type": "text", "data": {"text": "表情消息"}}
    ]
    result = await client.send_private_message(user_id, message_segments)
    logger.info(f"Message segments result: {result}")
    await asyncio.sleep(1)
    
    # 测试3: 发送长文本
    long_text = "这是一条很长的测试消息，用来测试机器人是否能正确处理长文本消息。" * 3
    result = await client.send_private_message(user_id, long_text)
    logger.info(f"Long text message result: {result}")
    await asyncio.sleep(1)


async def test_group_message(client, group_id):
    """测试群聊消息发送"""
    logger = logging.getLogger(__name__)
    
    logger.info(f"Testing group message to group {group_id}")
    
    # 测试1: 发送简单文本消息
    result = await client.send_group_message(group_id, "这是一条测试群聊消息")
    logger.info(f"Simple group text message result: {result}")
    await asyncio.sleep(1)
    
    # 测试2: 发送@消息
    test_user_id = 123456789  # 替换为实际的测试用户ID
    result = await client.send_at_message(group_id, test_user_id, "这是@消息测试")
    logger.info(f"At message result: {result}")
    await asyncio.sleep(1)
    
    # 测试3: 发送特殊字符消息
    special_chars = "测试特殊字符：!@#$%^&*()_+-=[]{}|;':\",./<>?"
    result = await client.send_group_message(group_id, special_chars)
    logger.info(f"Special characters message result: {result}")
    await asyncio.sleep(1)


async def test_reply_message(client, message_type, target_id, reply_id):
    """测试回复消息功能"""
    logger = logging.getLogger(__name__)
    
    logger.info(f"Testing reply message to {message_type} {target_id}, reply to {reply_id}")
    
    # 测试回复消息
    reply_text = f"这是回复消息，回复ID: {reply_id}"
    result = await client.send_reply_message(message_type, target_id, reply_id, reply_text)
    logger.info(f"Reply message result: {result}")
    await asyncio.sleep(1)


async def test_message_types(client, user_id, group_id):
    """测试不同类型的消息"""
    logger = logging.getLogger(__name__)
    
    logger.info("Testing different message types")
    
    # 测试1: 纯文本
    await client.send_private_message(user_id, "纯文本消息测试")
    await asyncio.sleep(0.5)
    
    # 测试2: 表情消息
    face_message = [
        {"type": "face", "data": {"id": 1}},
        {"type": "text", "data": {"text": " 表情消息测试"}}
    ]
    await client.send_private_message(user_id, face_message)
    await asyncio.sleep(0.5)
    
    # 测试3: 图片消息（模拟）
    image_message = [
        {"type": "text", "data": {"text": "图片消息测试："}},
        {"type": "image", "data": {"file": "test.jpg", "url": "http://example.com/test.jpg"}}
    ]
    await client.send_private_message(user_id, image_message)
    await asyncio.sleep(0.5)
    
    # 测试4: 群聊@消息
    await client.send_at_message(group_id, user_id, "群聊@消息测试")
    await asyncio.sleep(0.5)


async def test_error_handling(client):
    """测试错误处理"""
    logger = logging.getLogger(__name__)
    
    logger.info("Testing error handling")
    
    # 测试1: 无效的用户ID
    try:
        result = await client.send_private_message(0, "测试无效用户ID")
        logger.info(f"Invalid user ID test result: {result}")
    except Exception as e:
        logger.error(f"Invalid user ID test error: {e}")
    
    # 测试2: 无效的群ID
    try:
        result = await client.send_group_message(0, "测试无效群ID")
        logger.info(f"Invalid group ID test result: {result}")
    except Exception as e:
        logger.error(f"Invalid group ID test error: {e}")
    
    # 测试3: 空消息
    try:
        result = await client.send_private_message(123456789, "")
        logger.info(f"Empty message test result: {result}")
    except Exception as e:
        logger.error(f"Empty message test error: {e}")


async def run_all_tests():
    """运行所有测试"""
    logger = logging.getLogger(__name__)
    
    logger.info("Starting QQ Bot functionality tests...")
    
    # 创建WebSocket客户端
    client = WebSocketClient()
    
    try:
        # 连接到服务器
        if await client.connect():
            logger.info("Connected to WebSocket server")
            
            # 测试参数（请根据实际情况修改）
            test_user_id = 123456789  # 替换为实际的测试用户ID
            test_group_id = 987654321  # 替换为实际的测试群ID
            test_reply_id = 1001  # 替换为实际的消息ID
            
            # 运行测试
            logger.info("Running private message tests...")
            await test_private_message(client, test_user_id)
            
            logger.info("Running group message tests...")
            await test_group_message(client, test_group_id)
            
            logger.info("Running message type tests...")
            await test_message_types(client, test_user_id, test_group_id)
            
            logger.info("Running reply message tests...")
            await test_reply_message(client, "private", test_user_id, test_reply_id)
            await test_reply_message(client, "group", test_group_id, test_reply_id)
            
            logger.info("Running error handling tests...")
            await test_error_handling(client)
            
            logger.info("All tests completed successfully!")
            
        else:
            logger.error("Failed to connect to WebSocket server")
            
    except Exception as e:
        logger.error(f"Test execution failed: {e}")
        
    finally:
        # 断开连接
        await client.disconnect()
        logger.info("Disconnected from WebSocket server")


async def test_connection_only():
    """仅测试连接功能"""
    logger = logging.getLogger(__name__)
    
    logger.info("Testing WebSocket connection only...")
    
    client = WebSocketClient()
    
    try:
        if await client.connect():
            logger.info("Connection test successful!")
            
            # 发送一个测试事件
            test_data = {"test": "connection", "timestamp": datetime.now().isoformat()}
            result = await client.send_event("test", test_data)
            logger.info(f"Test event sent: {result}")
            
            await asyncio.sleep(2)  # 等待2秒
            
        else:
            logger.error("Connection test failed!")
            
    except Exception as e:
        logger.error(f"Connection test error: {e}")
        
    finally:
        await client.disconnect()
        logger.info("Connection test completed")


if __name__ == "__main__":
    # 设置日志
    setup_test_logging()
    
    # 选择运行模式
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "connection":
        # 仅测试连接
        asyncio.run(test_connection_only())
    else:
        # 运行完整测试
        asyncio.run(run_all_tests())
