#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
手动发送测试脚本
"""

import asyncio
import logging
from websocket_client import WebSocketClient

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def test_send():
    """测试发送功能"""
    client = WebSocketClient()
    
    try:
        # 连接到服务器
        if await client.connect():
            logger.info("Connected to WebSocket server")
            
            # 等待一下确保连接稳定
            await asyncio.sleep(2)
            
            # 测试1: 发送私聊消息
            logger.info("Testing private message sending...")
            test_user_id = 85178516  # 李阿花
            
            result = await client.send_private_message(test_user_id, "这是一条测试私聊消息")
            logger.info(f"Private message send result: {result}")
            
            await asyncio.sleep(3)
            
            # 测试2: 发送群聊消息
            logger.info("Testing group message sending...")
            test_group_id = 1019235326  # liahua_dnf1、骑猪...
            
            result = await client.send_group_message(test_group_id, "这是一条测试群聊消息")
            logger.info(f"Group message send result: {result}")
            
            await asyncio.sleep(3)
            
            # 测试3: 发送@消息
            logger.info("Testing @ message sending...")
            
            result = await client.send_at_message(test_group_id, test_user_id, "这是@消息测试")
            logger.info(f"@ message send result: {result}")
            
            await asyncio.sleep(3)
            
            logger.info("All tests completed!")
            
        else:
            logger.error("Failed to connect to WebSocket server")
            
    except Exception as e:
        logger.error(f"Test failed: {e}")
        
    finally:
        await client.disconnect()
        logger.info("Disconnected from WebSocket server")

if __name__ == "__main__":
    asyncio.run(test_send())
