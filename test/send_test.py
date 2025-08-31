#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQ机器人发送功能测试脚本
基于实际接收到的消息数据进行测试
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
    test_log_file = os.path.join(log_dir, f"send_test_{today}.log")
    
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


async def test_private_message_sending(client):
    """测试私聊消息发送"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Private Message Sending ===")
    print("=== Testing Private Message Sending ===")
    
    # 基于实际接收到的私聊消息数据
    test_user_id = 85178516  # 李阿花
    
    try:
        # 测试1: 发送简单文本消息
        logger.info("Test 1: Sending simple text message")
        print("Test 1: Sending simple text message")
        
        message = "你好！这是一条测试私聊消息"
        logger.info(f"Sending to user {test_user_id}: {message}")
        print(f"Sending to user {test_user_id}: {message}")
        
        result = await client.send_private_message(test_user_id, message)
        logger.info(f"Send result: {result}")
        print(f"Send result: {result}")
        
        await asyncio.sleep(2)  # 等待2秒
        
        # 测试2: 发送消息段
        logger.info("Test 2: Sending message segments")
        print("Test 2: Sending message segments")
        
        message_segments = [
            {"type": "text", "data": {"text": "测试"}},
            {"type": "face", "data": {"id": 123}},
            {"type": "text", "data": {"text": "表情消息"}}
        ]
        logger.info(f"Sending message segments: {json.dumps(message_segments, ensure_ascii=False)}")
        print(f"Sending message segments: {json.dumps(message_segments, ensure_ascii=False)}")
        
        result = await client.send_private_message(test_user_id, message_segments)
        logger.info(f"Send result: {result}")
        print(f"Send result: {result}")
        
        await asyncio.sleep(2)  # 等待2秒
        
        # 测试3: 发送回复消息
        logger.info("Test 3: Sending reply message")
        print("Test 3: Sending reply message")
        
        reply_message = "这是对"咋了"的回复消息"
        logger.info(f"Sending reply: {reply_message}")
        print(f"Sending reply: {reply_message}")
        
        # 注意：这里需要实际的消息ID，我们先发送普通消息
        result = await client.send_private_message(test_user_id, reply_message)
        logger.info(f"Send result: {result}")
        print(f"Send result: {result}")
        
        logger.info("Private message sending tests completed")
        print("Private message sending tests completed")
        
    except Exception as e:
        logger.error(f"Private message sending test failed: {e}")
        print(f"Private message sending test failed: {e}")


async def test_group_message_sending(client):
    """测试群聊消息发送"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Group Message Sending ===")
    print("=== Testing Group Message Sending ===")
    
    # 基于实际接收到的群聊消息数据
    test_group_id = 1019235326  # liahua_dnf1、骑猪...
    test_user_id = 85178516     # 李阿花
    
    try:
        # 测试1: 发送简单群聊消息
        logger.info("Test 1: Sending simple group message")
        print("Test 1: Sending simple group message")
        
        message = "大家好！这是一条测试群聊消息"
        logger.info(f"Sending to group {test_group_id}: {message}")
        print(f"Sending to group {test_group_id}: {message}")
        
        result = await client.send_group_message(test_group_id, message)
        logger.info(f"Send result: {result}")
        print(f"Send result: {result}")
        
        await asyncio.sleep(2)  # 等待2秒
        
        # 测试2: 发送@消息
        logger.info("Test 2: Sending @ message")
        print("Test 2: Sending @ message")
        
        at_message = "这是@消息测试"
        logger.info(f"Sending @ message to group {test_group_id} for user {test_user_id}: {at_message}")
        print(f"Sending @ message to group {test_group_id} for user {test_user_id}: {at_message}")
        
        result = await client.send_at_message(test_group_id, test_user_id, at_message)
        logger.info(f"Send result: {result}")
        print(f"Send result: {result}")
        
        await asyncio.sleep(2)  # 等待2秒
        
        # 测试3: 发送特殊字符消息
        logger.info("Test 3: Sending special characters message")
        print("Test 3: Sending special characters message")
        
        special_chars = "测试特殊字符：!@#$%^&*()_+-=[]{}|;':\",./<>?"
        logger.info(f"Sending special characters: {special_chars}")
        print(f"Sending special characters: {special_chars}")
        
        result = await client.send_group_message(test_group_id, special_chars)
        logger.info(f"Send result: {result}")
        print(f"Send result: {result}")
        
        logger.info("Group message sending tests completed")
        print("Group message sending tests completed")
        
    except Exception as e:
        logger.error(f"Group message sending test failed: {e}")
        print(f"Group message sending test failed: {e}")


async def test_message_types(client):
    """测试不同类型的消息发送"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Different Message Types ===")
    print("=== Testing Different Message Types ===")
    
    test_user_id = 85178516
    test_group_id = 1019235326
    
    try:
        # 测试1: 纯文本消息
        logger.info("Test 1: Pure text message")
        print("Test 1: Pure text message")
        
        text_message = "纯文本消息测试"
        logger.info(f"Sending text message: {text_message}")
        print(f"Sending text message: {text_message}")
        
        # 私聊发送
        result1 = await client.send_private_message(test_user_id, text_message)
        logger.info(f"Private send result: {result1}")
        print(f"Private send result: {result1}")
        
        await asyncio.sleep(1)
        
        # 群聊发送
        result2 = await client.send_group_message(test_group_id, text_message)
        logger.info(f"Group send result: {result2}")
        print(f"Group send result: {result2}")
        
        await asyncio.sleep(2)
        
        # 测试2: 表情消息
        logger.info("Test 2: Face message")
        print("Test 2: Face message")
        
        face_message = [
            {"type": "face", "data": {"id": 1}},
            {"type": "text", "data": {"text": " 表情消息测试"}}
        ]
        logger.info(f"Sending face message: {json.dumps(face_message, ensure_ascii=False)}")
        print(f"Sending face message: {json.dumps(face_message, ensure_ascii=False)}")
        
        # 私聊发送
        result1 = await client.send_private_message(test_user_id, face_message)
        logger.info(f"Private send result: {result1}")
        print(f"Private send result: {result1}")
        
        await asyncio.sleep(1)
        
        # 群聊发送
        result2 = await client.send_group_message(test_group_id, face_message)
        logger.info(f"Group send result: {result2}")
        print(f"Group send result: {result2}")
        
        await asyncio.sleep(2)
        
        logger.info("Message type tests completed")
        print("Message type tests completed")
        
    except Exception as e:
        logger.error(f"Message type test failed: {e}")
        print(f"Message type test failed: {e}")


async def run_send_tests():
    """运行所有发送测试"""
    logger = logging.getLogger(__name__)
    
    logger.info("Starting QQ Bot Send Functionality Tests...")
    print("Starting QQ Bot Send Functionality Tests...")
    
    try:
        # 创建WebSocket客户端
        logger.info("Creating WebSocket client...")
        print("Creating WebSocket client...")
        client = WebSocketClient()
        logger.info("WebSocket client created successfully")
        print("WebSocket client created successfully")
        
        # 连接到服务器
        logger.info("Connecting to WebSocket server...")
        print("Connecting to WebSocket server...")
        
        if await client.connect():
            logger.info("Connected to WebSocket server")
            print("Connected to WebSocket server")
            
            # 运行各项测试
            await test_private_message_sending(client)
            await test_group_message_sending(client)
            await test_message_types(client)
            
            logger.info("All send tests completed successfully!")
            print("All send tests completed successfully!")
            
            # 等待一段时间让消息发送完成
            await asyncio.sleep(5)
            
        else:
            logger.error("Failed to connect to WebSocket server")
            print("Failed to connect to WebSocket server")
            
    except Exception as e:
        logger.error(f"Send test execution failed: {e}")
        print(f"Send test execution failed: {e}")
        
    finally:
        # 断开连接
        await client.disconnect()
        logger.info("Disconnected from WebSocket server")
        print("Disconnected from WebSocket server")


if __name__ == "__main__":
    # 设置日志
    setup_test_logging()
    
    # 运行测试
    asyncio.run(run_send_tests())
