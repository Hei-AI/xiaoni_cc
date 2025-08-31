#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简化的QQ机器人功能测试脚本
"""

import asyncio
import logging
import json
import os
from datetime import datetime

print("Starting simple full test...")

try:
    from websocket_client import WebSocketClient
    print("WebSocketClient imported successfully")
    
    def setup_logging():
        """设置日志"""
        log_dir = "log"
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        today = datetime.now().strftime("%Y-%m-%d")
        test_log_file = os.path.join(log_dir, f"simple_full_test_{today}.log")
        
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
    
    async def test_basic_functions():
        """测试基本功能"""
        print("Testing basic functions...")
        
        # 创建客户端
        client = WebSocketClient()
        print(f"Client created: {client.host}:{client.port}")
        
        # 测试配置
        import config
        print("Configuration loaded successfully")
        print(f"WebSocket config: {config.WEBSOCKET_CONFIG}")
        print(f"Test config: {config.TEST_CONFIG}")
        
        # 测试消息构造
        test_user_id = 123456789
        test_group_id = 987654321
        
        # 私聊消息
        private_message = "测试私聊消息"
        print(f"Private message: {private_message}")
        
        # 群聊消息
        group_message = "测试群聊消息"
        print(f"Group message: {group_message}")
        
        # @消息
        at_message = "测试@消息"
        print(f"At message: {at_message}")
        
        # 消息段
        message_segments = [
            {"type": "text", "data": {"text": "测试"}},
            {"type": "face", "data": {"id": 123}},
            {"type": "text", "data": {"text": "表情"}}
        ]
        print(f"Message segments: {json.dumps(message_segments, ensure_ascii=False)}")
        
        print("Basic function tests completed")
    
    async def main():
        print("Main function called")
        
        # 设置日志
        logger = setup_logging()
        print("Logging setup completed")
        
        # 测试基本功能
        await test_basic_functions()
        
        print("All tests completed")
    
    if __name__ == "__main__":
        print("Script started")
        asyncio.run(main())
        print("Script finished")
        
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
