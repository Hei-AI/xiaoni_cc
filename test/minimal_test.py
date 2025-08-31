

print("Hello World")

import asyncio
import logging
import os
from datetime import datetime
print("asyncio imported")

try:
    from websocket_client import WebSocketClient
    print("WebSocketClient imported successfully")
    
    def setup_test_logging():
        """设置测试日志"""
        log_dir = "log"
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        today = datetime.now().strftime("%Y-%m-%d")
        test_log_file = os.path.join(log_dir, f"minimal_test_{today}.log")
        
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
    
    async def test_client():
        print("Creating WebSocket client...")
        client = WebSocketClient()
        print(f"Client created: host={client.host}, port={client.port}")
        return client
    
    async def test_message_functions(client):
        print("Testing message functions...")
        
        # 测试私聊消息构造
        test_user_id = 123456789
        test_message = "这是一条测试私聊消息"
        print(f"Will send private message to {test_user_id}: {test_message}")
        
        # 测试群聊消息构造
        test_group_id = 987654321
        test_group_message = "这是一条测试群聊消息"
        print(f"Will send group message to {test_group_id}: {test_group_message}")
        
        # 测试@消息构造
        at_message = "这是@消息测试"
        print(f"Will send @ message to group {test_group_id} for user {test_user_id}: {at_message}")
        
        # 测试消息段构造
        message_segments = [
            {"type": "text", "data": {"text": "测试"}},
            {"type": "face", "data": {"id": 123}},
            {"type": "text", "data": {"text": "表情消息"}}
        ]
        print(f"Message segments: {message_segments}")
        
        print("Message function tests completed")
    
    async def test_config():
        print("Testing configuration...")
        
        try:
            import config
            print("Configuration imported successfully")
            print(f"WebSocket config: {config.WEBSOCKET_CONFIG}")
            print(f"Test config: {config.TEST_CONFIG}")
            print(f"Logging config: {config.LOGGING_CONFIG}")
            
            # 测试配置值
            host = config.WEBSOCKET_CONFIG.get('host')
            port = config.WEBSOCKET_CONFIG.get('port')
            print(f"Server address: {host}:{port}")
            
            print("Configuration tests completed")
            
        except Exception as e:
            print(f"Configuration test failed: {e}")
    
    async def test_logging():
        print("Testing logging functionality...")
        
        logger = logging.getLogger(__name__)
        
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
        logger.info(f"Test data: {test_data}")
        
        print("Logging functionality tests completed")
    
    async def main():
        print("main function called")
        
        # 设置日志
        setup_test_logging()
        print("Logging setup completed")
        
        client = await test_client()
        await test_message_functions(client)
        await test_config()
        await test_logging()
        print("test completed")
        
except Exception as e:
    print(f"Error: {e}")

if __name__ == "__main__":
    print("script started")
    asyncio.run(main())
    print("script finished")
