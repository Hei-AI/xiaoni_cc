import asyncio
import logging
import json
from datetime import datetime
from websocket_client import WebSocketClient
from http_server import start_http_server
from gemini_agent import process_message_with_agent, get_gemini_agent
from requirement_manager import handle_requirement_message, get_requirement_manager
import config


# 设置日志配置
def setup_logging():
    """设置日志配置"""
    # 确保log目录存在
    import os
    log_dir = "log"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    # 创建主日志文件
    today = datetime.now().strftime("%Y-%m-%d")
    main_log_file = os.path.join(log_dir, f"main_{today}.log")
    
    # 配置日志
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(main_log_file, encoding='utf-8'),
            logging.StreamHandler()
        ]
    )


# 创建logger
setup_logging()
logger = logging.getLogger(__name__)

# 全局client变量
client = None


async def handle_message(data):
    """处理接收到的消息事件"""
    global client
    try:
        post_type = data.get('post_type', 'unknown')
        message_type = data.get('message_type', 'unknown')
        
        if post_type == 'message':
            if message_type == 'private':
                await handle_private_message(data)
            elif message_type == 'group':
                await handle_group_message(data)
        elif post_type == 'message_sent':
            logger.info(f"Message sent: {data}")
            
    except Exception as e:
        logger.error(f"Error handling message: {e}")


async def handle_private_message(data):
    """处理私聊消息 - 增强AI Agent支持"""
    global client
    user_id = data.get('user_id')
    message = data.get('raw_message', '')
    message_id = data.get('message_id')
    
    logger.info(f"Private message from {user_id}: {message}")
    
    # 特殊命令处理
    if message == "帮助":
        help_text = """🤖 QQ智能机器人助手 - Claude Code集成版

基础命令：
- 帮助：显示此帮助信息
- 时间：显示当前时间
- 测试：测试机器人功能
- agent状态：查看AI助手状态
- 需求状态：查看需求管理状态

🚀 Claude Code需求管理：
直接发送开发需求，系统将自动：
1. 识别需求内容
2. 通过Claude Code处理实现
3. Hook通知完成状态
支持: 实现、开发、修改、修复、优化等需求

✨ AI智能回复：
非需求消息将通过AI助手智能回复！
支持日常对话、问答、建议等各种交流。"""
        await client.send_private_message(user_id, help_text)
        return
        
    elif message == "时间":
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await client.send_private_message(user_id, f"当前时间：{current_time}")
        return
        
    elif message == "agent状态":
        agent = get_gemini_agent()
        if agent.is_available():
            await client.send_private_message(user_id, "🟢 AI助手在线，随时为您服务！")
        else:
            await client.send_private_message(user_id, "🔴 AI助手暂时离线，请稍后再试")
        return
        
    elif message == "需求状态":
        # 查看需求状态报告
        manager = get_requirement_manager(client)
        report = await manager.generate_status_report(user_id)
        await client.send_private_message(user_id, report)
        return
        
    elif message == "测试":
        # 测试不同类型的消息
        await client.send_private_message(user_id, "测试文本消息")
        
        # 测试消息段
        test_message = [
            {"type": "text", "data": {"text": "测试"}},
            {"type": "face", "data": {"id": 123}},
            {"type": "text", "data": {"text": "表情"}}
        ]
        await client.send_private_message(user_id, test_message)
        
        # 测试回复消息
        if message_id:
            await client.send_reply_message("private", user_id, message_id, "这是回复消息")
        return
    
    # 优先处理需求消息（通过Claude Code）
    try:
        # 检查是否为需求消息并处理
        requirement_handled = await handle_requirement_message(user_id, message, client)
        
        if requirement_handled:
            logger.info(f"Requirement message handled for user {user_id}")
            return
            
    except Exception as e:
        logger.error(f"Requirement processing error: {e}")
    
    # AI Agent 智能回复（非需求消息）
    try:
        logger.info(f"Processing message with AI Agent: {message[:50]}...")
        ai_response = await process_message_with_agent(message)
        await client.send_private_message(user_id, ai_response)
        logger.info(f"AI response sent to {user_id}")
        
    except Exception as e:
        logger.error(f"AI Agent processing error: {e}")
        fallback_response = "抱歉，AI助手暂时出现了一些问题，请稍后再试。"
        await client.send_private_message(user_id, fallback_response)


async def handle_group_message(data):
    """处理群聊消息"""
    global client
    group_id = data.get('group_id')
    user_id = data.get('user_id')
    message = data.get('raw_message', '')
    message_id = data.get('message_id')
    
    logger.info(f"Group message in {group_id} from {user_id}: {message}")
    
    # 简单的群聊自动回复示例
    if message == "群帮助":
        help_text = """群聊可用命令：
- 群帮助：显示此帮助信息
- 群时间：显示当前时间
- @机器人：@机器人测试
- 测试群聊：测试群聊功能"""
        await client.send_group_message(group_id, help_text)
    elif message == "群时间":
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await client.send_group_message(group_id, f"当前时间：{current_time}")
    elif message == "测试群聊":
        # 测试@消息
        await client.send_at_message(group_id, user_id, "这是@消息测试")
        
        # 测试回复消息
        if message_id:
            await client.send_reply_message("group", group_id, message_id, "这是群聊回复消息")


async def handle_notice(data):
    """处理通知事件"""
    global client
    notice_type = data.get('notice_type', 'unknown')
    logger.info(f"Notice event: {notice_type} - {data}")
    
    if notice_type == 'group_increase':
        group_id = data.get('group_id')
        user_id = data.get('user_id')
        await client.send_group_message(group_id, f"欢迎新成员 {user_id} 加入群聊！")
    elif notice_type == 'friend_add':
        user_id = data.get('user_id')
        await client.send_private_message(user_id, "你好！很高兴成为你的好友！")


async def handle_request(data):
    """处理请求事件"""
    request_type = data.get('request_type', 'unknown')
    logger.info(f"Request event: {request_type} - {data}")
    
    if request_type == 'friend':
        # 自动同意好友请求
        logger.info("Auto-accepting friend request")
    elif request_type == 'group':
        # 自动同意加群请求
        logger.info("Auto-accepting group request")


async def handle_meta(data):
    """处理元事件"""
    meta_event_type = data.get('meta_event_type', 'unknown')
    logger.info(f"Meta event: {meta_event_type} - {data}")
    
    if meta_event_type == 'heartbeat':
        # 心跳事件，可以在这里做一些健康检查
        pass


async def handle_default(data):
    """处理其他类型的事件"""
    logger.info(f"Unhandled event: {data}")


async def test_message_sending():
    """测试消息发送功能"""
    global client
    logger.info("Testing message sending functionality...")
    
    try:
        # 测试私聊消息发送
        test_user_id = 85178516  # 李阿花
        await client.send_private_message(test_user_id, "这是一条测试私聊消息")
        logger.info("Private message test completed")
        
        # 测试群聊消息发送
        test_group_id = 1019235326  # liahua_dnf1、骑猪...
        await client.send_group_message(test_group_id, "这是一条测试群聊消息")
        logger.info("Group message test completed")
        
        # 测试@消息
        await client.send_at_message(test_group_id, test_user_id, "这是@消息测试")
        logger.info("At message test completed")
        
    except Exception as e:
        logger.error(f"Message sending test failed: {e}")


async def main():
    global client
    client = WebSocketClient()
    
    # 注册事件处理器
    client.on('message', handle_message)
    client.on('notice', handle_notice)
    client.on('request', handle_request)
    client.on('meta', handle_meta)
    client.on('default', handle_default)
    
    logger.info("Starting QQ Bot WebSocket Client...")
    
    try:
        # 启动WebSocket客户端
        await client.connect()
        if client.is_connected():
            logger.info("WebSocket client connected successfully")
            
            # 启动HTTP服务器（在后台运行）
            start_http_server(client, host='127.0.0.1', port=8080)
            logger.info("HTTP server starting on http://127.0.0.1:8080")
            
            # 等待HTTP服务器启动
            await asyncio.sleep(3)
            logger.info("HTTP server should be ready now")
            
            # 启动WebSocket监听
            await client.listen()
            
        else:
            logger.error("Failed to connect WebSocket client")
            
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        await client.disconnect()
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        await client.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
