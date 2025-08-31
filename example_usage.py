import asyncio
from websocket_client import WebSocketClient


async def example_usage():
    """WebSocket客户端使用示例"""
    client = WebSocketClient()
    
    # 定义事件处理器
    async def on_message(data):
        print(f"收到消息: {data}")
        
    async def on_user_join(data):
        print(f"用户加入: {data}")
        
    async def on_default(data):
        print(f"收到事件: {data}")
    
    # 注册事件处理器
    client.on('message', on_message)
    client.on('user_join', on_user_join)
    client.on('default', on_default)
    
    # 连接到服务器
    if await client.connect():
        print("连接成功！")
        
        # 发送事件示例
        await client.send_event('join', {'user': 'test_user'})
        await client.send_event('message', {'text': 'Hello WebSocket!'})
        
        # 监听事件（这会一直运行直到连接断开）
        await client.listen()
    else:
        print("连接失败！")


if __name__ == '__main__':
    asyncio.run(example_usage())