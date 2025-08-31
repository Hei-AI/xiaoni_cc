#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HTTP API测试脚本
测试QQ机器人的HTTP接口
"""

import asyncio
import aiohttp
import json
import logging
from datetime import datetime


def setup_logging():
    """设置日志"""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    return logging.getLogger(__name__)


async def test_health_check(session, base_url):
    """测试健康检查接口"""
    logger = logging.getLogger(__name__)
    logger.info("Testing health check endpoint...")
    
    try:
        async with session.get(f"{base_url}/health") as response:
            if response.status == 200:
                data = await response.json()
                logger.info(f"Health check passed: {data}")
                return True
            else:
                logger.error(f"Health check failed: {response.status}")
                return False
    except Exception as e:
        logger.error(f"Health check error: {e}")
        return False


async def test_send_private_message(session, base_url):
    """测试发送私聊消息接口"""
    logger = logging.getLogger(__name__)
    logger.info("Testing private message sending...")
    
    # 基于实际接收到的私聊消息数据
    test_data = {
        "user_id": 85178516,  # 李阿花
        "message": "这是一条通过HTTP API发送的测试私聊消息",
        "message_type": "text"
    }
    
    try:
        async with session.post(f"{base_url}/api/send_private", json=test_data) as response:
            if response.status == 200:
                data = await response.json()
                logger.info(f"Private message sent successfully: {data}")
                return True
            else:
                error_data = await response.json()
                logger.error(f"Private message failed: {response.status} - {error_data}")
                return False
    except Exception as e:
        logger.error(f"Private message error: {e}")
        return False


async def test_send_group_message(session, base_url):
    """测试发送群聊消息接口"""
    logger = logging.getLogger(__name__)
    logger.info("Testing group message sending...")
    
    # 基于实际接收到的群聊消息数据
    test_data = {
        "group_id": 1019235326,  # liahua_dnf1、骑猪...
        "message": "这是一条通过HTTP API发送的测试群聊消息",
        "message_type": "text"
    }
    
    try:
        async with session.post(f"{base_url}/api/send_group", json=test_data) as response:
            if response.status == 200:
                data = await response.json()
                logger.info(f"Group message sent successfully: {data}")
                return True
            else:
                error_data = await response.json()
                logger.error(f"Group message failed: {response.status} - {error_data}")
                return False
    except Exception as e:
        logger.error(f"Group message error: {e}")
        return False


async def test_send_at_message(session, base_url):
    """测试发送@消息接口"""
    logger = logging.getLogger(__name__)
    logger.info("Testing @ message sending...")
    
    test_data = {
        "group_id": 1019235326,  # liahua_dnf1、骑猪...
        "user_id": 85178516,     # 李阿花
        "message": "这是通过HTTP API发送的@消息测试"
    }
    
    try:
        async with session.post(f"{base_url}/api/send_at", json=test_data) as response:
            if response.status == 200:
                data = await response.json()
                logger.info(f"@ message sent successfully: {data}")
                return True
            else:
                error_data = await response.json()
                logger.error(f"@ message failed: {response.status} - {error_data}")
                return False
    except Exception as e:
        logger.error(f"@ message error: {e}")
        return False


async def test_send_reply_message(session, base_url):
    """测试发送回复消息接口"""
    logger = logging.getLogger(__name__)
    logger.info("Testing reply message sending...")
    
    test_data = {
        "message_type": "private",
        "target_id": 85178516,  # 李阿花
        "reply_id": 1001,       # 模拟消息ID
        "message": "这是通过HTTP API发送的回复消息",
        "message_format": "text"
    }
    
    try:
        async with session.post(f"{base_url}/api/send_reply", json=test_data) as response:
            if response.status == 200:
                data = await response.json()
                logger.info(f"Reply message sent successfully: {data}")
                return True
            else:
                error_data = await response.json()
                logger.error(f"Reply message failed: {response.status} - {error_data}")
                return False
    except Exception as e:
        logger.error(f"Reply message error: {e}")
        return False


async def test_get_status(session, base_url):
    """测试获取状态接口"""
    logger = logging.getLogger(__name__)
    logger.info("Testing status endpoints...")
    
    try:
        # 测试机器人状态
        async with session.get(f"{base_url}/api/status") as response:
            if response.status == 200:
                data = await response.json()
                logger.info(f"Bot status: {data}")
            else:
                logger.error(f"Status check failed: {response.status}")
                
        # 测试连接状态
        async with session.get(f"{base_url}/api/connection") as response:
            if response.status == 200:
                data = await response.json()
                logger.info(f"Connection status: {data}")
            else:
                logger.error(f"Connection check failed: {response.status}")
                
        return True
    except Exception as e:
        logger.error(f"Status check error: {e}")
        return False


async def test_message_segments(session, base_url):
    """测试消息段发送"""
    logger = logging.getLogger(__name__)
    logger.info("Testing message segments...")
    
    # 测试私聊消息段
    private_segments = [
        {"type": "text", "data": {"text": "测试"}},
        {"type": "face", "data": {"id": 123}},
        {"type": "text", "data": {"text": "表情消息"}}
    ]
    
    test_data = {
        "user_id": 85178516,
        "message": private_segments,
        "message_type": "segments"
    }
    
    try:
        async with session.post(f"{base_url}/api/send_private", json=test_data) as response:
            if response.status == 200:
                data = await response.json()
                logger.info(f"Private segments sent successfully: {data}")
            else:
                error_data = await response.json()
                logger.error(f"Private segments failed: {response.status} - {error_data}")
                
        # 测试群聊消息段
        group_segments = [
            {"type": "text", "data": {"text": "群聊"}},
            {"type": "face", "data": {"id": 456}},
            {"type": "text", "data": {"text": "表情测试"}}
        ]
        
        test_data = {
            "group_id": 1019235326,
            "message": group_segments,
            "message_type": "segments"
        }
        
        async with session.post(f"{base_url}/api/send_group", json=test_data) as response:
            if response.status == 200:
                data = await response.json()
                logger.info(f"Group segments sent successfully: {data}")
            else:
                error_data = await response.json()
                logger.error(f"Group segments failed: {response.status} - {error_data}")
                
        return True
    except Exception as e:
        logger.error(f"Message segments error: {e}")
        return False


async def run_all_tests():
    """运行所有测试"""
    logger = logging.getLogger(__name__)
    logger.info("Starting HTTP API tests...")
    
    base_url = "http://127.0.0.1:8080"
    
    async with aiohttp.ClientSession() as session:
        # 等待一下确保服务启动
        await asyncio.sleep(2)
        
        tests = [
            ("Health Check", test_health_check(session, base_url)),
            ("Bot Status", test_get_status(session, base_url)),
            ("Private Message", test_send_private_message(session, base_url)),
            ("Group Message", test_send_group_message(session, base_url)),
            ("@ Message", test_send_at_message(session, base_url)),
            ("Reply Message", test_send_reply_message(session, base_url)),
            ("Message Segments", test_message_segments(session, base_url))
        ]
        
        results = []
        for test_name, test_coro in tests:
            logger.info(f"\n{'='*50}")
            logger.info(f"Running test: {test_name}")
            try:
                result = await test_coro
                results.append((test_name, result))
                logger.info(f"Test {test_name}: {'PASSED' if result else 'FAILED'}")
            except Exception as e:
                logger.error(f"Test {test_name} error: {e}")
                results.append((test_name, False))
            
            # 等待一下避免消息发送过快
            await asyncio.sleep(2)
        
        # 输出测试结果摘要
        logger.info(f"\n{'='*50}")
        logger.info("Test Results Summary:")
        passed = sum(1 for _, result in results if result)
        total = len(results)
        
        for test_name, result in results:
            status = "PASSED" if result else "FAILED"
            logger.info(f"  {test_name}: {status}")
            
        logger.info(f"\nOverall: {passed}/{total} tests passed")
        
        if passed == total:
            logger.info("🎉 All tests passed!")
        else:
            logger.warning(f"⚠️  {total - passed} tests failed")


if __name__ == "__main__":
    setup_logging()
    asyncio.run(run_all_tests())
