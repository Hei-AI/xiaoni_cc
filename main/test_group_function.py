#!/usr/bin/env python3
"""
直接测试群聊@处理函数
"""

import asyncio
import config

# 模拟全局client
class MockClient:
    async def send_at_message(self, group_id, user_id, message):
        print(f"[MOCK] 发送@消息到群 {group_id}，@用户 {user_id}: {message}")
        return True
    
    async def send_group_message(self, group_id, message):
        print(f"[MOCK] 发送群消息到 {group_id}: {message}")
        return True

# 设置模拟client
import sys
current_module = sys.modules[__name__]
current_module.client = MockClient()

# 导入函数定义后再测试
from main import handle_group_message

async def test_at_detection():
    """测试@检测和AI回复功能"""
    
    print("=== 测试群聊@机器人功能 ===\n")
    
    # 测试案例1: @机器人消息
    test_event_1 = {
        "group_id": 1019235326,
        "user_id": 85178516,  # 真实用户
        "raw_message": "@1129974489 你好，请介绍一下你自己",
        "message_id": 98765
    }
    
    print("测试1: @机器人消息")
    print(f"消息: {test_event_1['raw_message']}")
    await handle_group_message(test_event_1)
    print()
    
    # 测试案例2: OneBot格式@消息
    test_event_2 = {
        "group_id": 1019235326,
        "user_id": 85178516,
        "raw_message": "[CQ:at,qq=1129974489] 今天天气怎么样？",
        "message_id": 98766
    }
    
    print("测试2: OneBot格式@消息")
    print(f"消息: {test_event_2['raw_message']}")
    await handle_group_message(test_event_2)
    print()
    
    # 测试案例3: 普通群聊消息（不@机器人）
    test_event_3 = {
        "group_id": 1019235326,
        "user_id": 85178516,
        "raw_message": "群帮助",
        "message_id": 98767
    }
    
    print("测试3: 普通群聊指令")
    print(f"消息: {test_event_3['raw_message']}")
    await handle_group_message(test_event_3)
    print()

if __name__ == "__main__":
    asyncio.run(test_at_detection())