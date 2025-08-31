#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简单的WebSocket连接测试脚本
"""

import asyncio
import logging
import sys
import os

# 添加main目录到Python路径
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'main'))

from websocket_client import WebSocketClient


async def test_connection():
    """测试WebSocket连接"""
    print("=== Testing WebSocket Connection ===")
    
    try:
        # 创建WebSocket客户端
        print("Creating WebSocket client...")
        client = WebSocketClient()
        print("WebSocket client created successfully")
        
        # 连接到服务器
        print("Connecting to WebSocket server...")
        if await client.connect():
            print("✓ Connected to WebSocket server successfully!")
            
            # 测试发送消息
            print("Testing message sending...")
            
            # 测试私聊消息
            test_user_id = 85178516
            result = await client.send_private_message(test_user_id, "这是一条测试私聊消息")
            print(f"Private message send result: {result}")
            
            # 测试群聊消息
            test_group_id = 1019235326
            result = await client.send_group_message(test_group_id, "这是一条测试群聊消息")
            print(f"Group message send result: {result}")
            
            # 等待一段时间
            await asyncio.sleep(3)
            
            # 断开连接
            await client.disconnect()
            print("✓ Disconnected from WebSocket server")
            
        else:
            print("✗ Failed to connect to WebSocket server")
            
    except Exception as e:
        print(f"✗ Error during test: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    print("Starting simple connection test...")
    asyncio.run(test_connection())
    print("Test completed.")
