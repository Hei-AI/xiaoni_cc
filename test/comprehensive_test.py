#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQ机器人全面功能测试脚本
测试群聊和私聊的接收和发送功能
"""

import asyncio
import logging
import json
import os
import time
from datetime import datetime
import sys
import os

# 添加main目录到Python路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'main'))

from websocket_client import WebSocketClient


def setup_test_logging():
    """设置测试日志"""
    log_dir = "log"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    today = datetime.now().strftime("%Y-%m-%d")
    test_log_file = os.path.join(log_dir, f"comprehensive_test_{today}.log")
    
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


async def test_private_message_functionality(client):
    """测试私聊消息功能"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Private Message Functionality ===")
    print("=== Testing Private Message Functionality ===")
    
    # 测试用户ID（基于日志中的实际数据）
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
        
        # 模拟一个消息ID（基于日志中的实际数据）
        test_message_id = 826585340  # 从日志中看到的私聊消息ID
        
        reply_message = "这是对'咋了'的回复消息"
        logger.info(f"Sending reply message: {reply_message}")
        print(f"Sending reply message: {reply_message}")
        
        result = await client.send_reply_message("private", test_user_id, test_message_id, reply_message)
        logger.info(f"Reply send result: {result}")
        print(f"Reply send result: {result}")
        
        await asyncio.sleep(2)  # 等待2秒
        
        logger.info("Private message functionality tests completed")
        print("Private message functionality tests completed")
        
    except Exception as e:
        logger.error(f"Private message functionality test failed: {e}")
        print(f"Private message functionality test failed: {e}")


async def test_group_message_functionality(client):
    """测试群聊消息功能"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Group Message Functionality ===")
    print("=== Testing Group Message Functionality ===")
    
    # 测试群ID（基于日志中的实际数据）
    test_group_id = 1019235326  # liahua_dnf1、骑猪...
    test_user_id = 85178516  # 李阿花
    
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
        logger.info(f"Sending @ message to user {test_user_id} in group {test_group_id}")
        print(f"Sending @ message to user {test_user_id} in group {test_group_id}")
        
        result = await client.send_at_message(test_group_id, test_user_id, at_message)
        logger.info(f"@ message send result: {result}")
        print(f"@ message send result: {result}")
        
        await asyncio.sleep(2)  # 等待2秒
        
        # 测试3: 发送群聊回复消息
        logger.info("Test 3: Sending group reply message")
        print("Test 3: Sending group reply message")
        
        # 模拟一个群聊消息ID（基于日志中的实际数据）
        test_message_id = 1624888917  # 从日志中看到的群聊消息ID
        
        reply_message = "这是对群聊消息的回复"
        logger.info(f"Sending group reply message: {reply_message}")
        print(f"Sending group reply message: {reply_message}")
        
        result = await client.send_reply_message("group", test_group_id, test_message_id, reply_message)
        logger.info(f"Group reply send result: {result}")
        print(f"Group reply send result: {result}")
        
        await asyncio.sleep(2)  # 等待2秒
        
        # 测试4: 发送复杂消息段到群聊
        logger.info("Test 4: Sending complex message segments to group")
        print("Test 4: Sending complex message segments to group")
        
        complex_message = [
            {"type": "text", "data": {"text": "复杂消息测试："}},
            {"type": "face", "data": {"id": 1}},
            {"type": "text", "data": {"text": " 表情"}},
            {"type": "at", "data": {"qq": test_user_id}},
            {"type": "text", "data": {"text": " 这是@消息"}}
        ]
        
        logger.info(f"Sending complex message: {json.dumps(complex_message, ensure_ascii=False)}")
        print(f"Sending complex message: {json.dumps(complex_message, ensure_ascii=False)}")
        
        result = await client.send_group_message(test_group_id, complex_message)
        logger.info(f"Complex message send result: {result}")
        print(f"Complex message send result: {result}")
        
        await asyncio.sleep(2)  # 等待2秒
        
        logger.info("Group message functionality tests completed")
        print("Group message functionality tests completed")
        
    except Exception as e:
        logger.error(f"Group message functionality test failed: {e}")
        print(f"Group message functionality test failed: {e}")


async def test_message_types(client):
    """测试不同类型的消息"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing Different Message Types ===")
    print("=== Testing Different Message Types ===")
    
    # 测试用户和群ID
    test_user_id = 85178516  # 李阿花
    test_group_id = 1019235326  # liahua_dnf1、骑猪...
    
    try:
        # 测试1: 纯文本消息
        logger.info("Test 1: Text message")
        print("Test 1: Text message")
        
        text_message = "这是一条纯文本测试消息"
        
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
        
        # 测试3: @消息
        logger.info("Test 3: At message")
        print("Test 3: At message")
        
        at_message = [
            {"type": "at", "data": {"qq": test_user_id}},
            {"type": "text", "data": {"text": " 这是@消息测试"}}
        ]
        
        # 群聊发送@消息
        result = await client.send_group_message(test_group_id, at_message)
        logger.info(f"At message send result: {result}")
        print(f"At message send result: {result}")
        
        await asyncio.sleep(2)
        
        logger.info("Message type tests completed")
        print("Message type tests completed")
        
    except Exception as e:
        logger.error(f"Message type test failed: {e}")
        print(f"Message type test failed: {e}")


async def test_http_api_endpoints():
    """测试HTTP API端点"""
    logger = logging.getLogger(__name__)
    
    logger.info("=== Testing HTTP API Endpoints ===")
    print("=== Testing HTTP API Endpoints ===")
    
    try:
        import requests
        
        base_url = "http://127.0.0.1:8080"
        
        # 测试1: 健康检查
        logger.info("Test 1: Health check")
        print("Test 1: Health check")
        
        response = requests.get(f"{base_url}/health")
        logger.info(f"Health check response: {response.status_code} - {response.text}")
        print(f"Health check response: {response.status_code} - {response.text}")
        
        await asyncio.sleep(1)
        
        # 测试2: 发送私聊消息API
        logger.info("Test 2: Send private message API")
        print("Test 2: Send private message API")
        
        private_data = {
            "user_id": 85178516,
            "message": "这是通过HTTP API发送的私聊消息",
            "message_type": "text"
        }
        
        response = requests.post(f"{base_url}/api/send_private", json=private_data)
        logger.info(f"Private message API response: {response.status_code} - {response.text}")
        print(f"Private message API response: {response.status_code} - {response.text}")
        
        await asyncio.sleep(2)
        
        # 测试3: 发送群聊消息API
        logger.info("Test 3: Send group message API")
        print("Test 3: Send group message API")
        
        group_data = {
            "group_id": 1019235326,
            "message": "这是通过HTTP API发送的群聊消息",
            "message_type": "text"
        }
        
        response = requests.post(f"{base_url}/api/send_group", json=group_data)
        logger.info(f"Group message API response: {response.status_code} - {response.text}")
        print(f"Group message API response: {response.status_code} - {response.text}")
        
        await asyncio.sleep(2)
        
        # 测试4: 获取状态API
        logger.info("Test 4: Get status API")
        print("Test 4: Get status API")
        
        response = requests.get(f"{base_url}/api/status")
        logger.info(f"Status API response: {response.status_code} - {response.text}")
        print(f"Status API response: {response.status_code} - {response.text}")
        
        await asyncio.sleep(1)
        
        logger.info("HTTP API endpoint tests completed")
        print("HTTP API endpoint tests completed")
        
    except ImportError:
        logger.warning("requests module not available, skipping HTTP API tests")
        print("requests module not available, skipping HTTP API tests")
    except Exception as e:
        logger.error(f"HTTP API endpoint test failed: {e}")
        print(f"HTTP API endpoint test failed: {e}")


async def run_comprehensive_tests():
    """运行所有全面测试"""
    logger = logging.getLogger(__name__)
    
    logger.info("Starting QQ Bot Comprehensive Functionality Tests...")
    print("Starting QQ Bot Comprehensive Functionality Tests...")
    
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
            await test_private_message_functionality(client)
            await test_group_message_functionality(client)
            await test_message_types(client)
            
            # 测试HTTP API端点
            await test_http_api_endpoints()
            
            logger.info("All comprehensive tests completed successfully!")
            print("All comprehensive tests completed successfully!")
            
            # 等待一段时间让消息发送完成
            await asyncio.sleep(5)
            
        else:
            logger.error("Failed to connect to WebSocket server")
            print("Failed to connect to WebSocket server")
            
    except Exception as e:
        logger.error(f"Comprehensive test execution failed: {e}")
        print(f"Comprehensive test execution failed: {e}")
        
    finally:
        # 断开连接
        await client.disconnect()
        logger.info("Disconnected from WebSocket server")
        print("Disconnected from WebSocket server")


if __name__ == "__main__":
    # 设置日志
    setup_test_logging()
    
    # 运行测试
    asyncio.run(run_comprehensive_tests())
