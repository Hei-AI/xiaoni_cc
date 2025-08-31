import asyncio
import logging
import json
from datetime import datetime
from websocket_client import WebSocketClient
from http_server import start_http_server
from gemini_agent import process_message_with_agent, get_gemini_agent
from requirement_manager import handle_requirement_message, get_requirement_manager
from requirement_intent_agent import analyze_requirement_intent
from claude_code_manager import get_claude_code_manager
from database import get_database_manager
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


async def extract_reply_context(event) -> tuple:
    """提取消息回复上下文信息"""
    reply_to_message_id = None
    reply_to_text = None
    
    # 检查消息段中的回复信息
    message_segments = event.get('message', [])
    for segment in message_segments:
        if segment.get('type') == 'reply':
            reply_data = segment.get('data', {})
            reply_to_message_id = reply_data.get('id')
            break
    
    # 检查raw数据中的replyElement
    raw_data = event.get('raw', {})
    elements = raw_data.get('elements', [])
    for element in elements:
        reply_element = element.get('replyElement')
        if reply_element:
            reply_to_message_id = reply_element.get('replayMsgId') or reply_element.get('sourceMsgIdInRecords')
            source_text_elems = reply_element.get('sourceMsgTextElems', [])
            if source_text_elems and source_text_elems[0]:
                reply_to_text = source_text_elems[0].get('textElemContent', '')
            break
    
    return reply_to_message_id, reply_to_text

async def get_conversation_context(user_id: int, reply_to_message_id: str = None, limit: int = 5) -> str:
    """获取对话上下文历史"""
    try:
        db_manager = get_database_manager()
        
        if reply_to_message_id:
            # 如果有回复的消息ID，找到被回复的对话
            query = "SELECT user_message, ai_response FROM conversations WHERE user_id = %s AND message_id = %s"
            results = db_manager.execute_query(query, (user_id, reply_to_message_id))
            if results:
                replied_conv = results[0]
                return f"[回复上下文] 用户: {replied_conv['user_message']}\n机器人: {replied_conv['ai_response']}\n\n"
        
        # 获取最近的对话历史作为上下文
        recent_conversations = db_manager.get_conversations(user_id=user_id, limit=limit)
        if not recent_conversations:
            return ""
        
        context_parts = []
        for conv in reversed(recent_conversations[-3:]):  # 最近3条对话
            context_parts.append(f"用户: {conv['user_message']}")
            context_parts.append(f"机器人: {conv['ai_response']}")
        
        if context_parts:
            return "[对话历史]\n" + "\n".join(context_parts) + "\n\n"
        
        return ""
        
    except Exception as e:
        logger.error(f"Error getting conversation context: {e}")
        return ""

async def get_group_conversation_context(group_id: int, user_id: int, reply_to_message_id: str = None, limit: int = 3) -> str:
    """获取群聊对话上下文历史"""
    try:
        db_manager = get_database_manager()
        
        context_parts = []
        
        if reply_to_message_id:
            # 如果有回复的消息ID，查找被回复的群聊消息
            query = """
            SELECT user_message, ai_response, user_id FROM conversations 
            WHERE message_id = %s 
            ORDER BY timestamp DESC LIMIT 1
            """
            results = db_manager.execute_query(query, (reply_to_message_id,))
            if results:
                replied_conv = results[0]
                context_parts.append(f"[回复上下文]")
                context_parts.append(f"用户{replied_conv['user_id']}: {replied_conv['user_message']}")
                if replied_conv['ai_response']:
                    context_parts.append(f"机器人: {replied_conv['ai_response']}")
                context_parts.append("")
        
        # 获取群聊中与机器人相关的最近对话
        query = """
        SELECT user_message, ai_response, user_id, timestamp FROM conversations 
        WHERE user_id IN (SELECT DISTINCT user_id FROM conversations WHERE user_id = %s OR user_id = %s)
        AND (user_message LIKE %s OR ai_response IS NOT NULL)
        ORDER BY timestamp DESC LIMIT %s
        """
        bot_qq = config.BOT_CONFIG['qq_number']
        results = db_manager.execute_query(query, (user_id, bot_qq, f"%@{bot_qq}%", limit))
        
        if results:
            context_parts.append("[群聊历史]")
            for conv in reversed(results):
                context_parts.append(f"用户{conv['user_id']}: {conv['user_message']}")
                if conv['ai_response']:
                    context_parts.append(f"机器人: {conv['ai_response']}")
        
        if context_parts:
            return "\n".join(context_parts) + "\n\n"
        
        return ""
        
    except Exception as e:
        logger.error(f"Error getting group conversation context: {e}")
        return ""

async def handle_private_message(data):
    """处理私聊消息 - 增强AI Agent支持"""
    global client
    user_id = data.get('user_id')
    message = data.get('raw_message', '')
    message_id = data.get('message_id')
    
    # 提取回复上下文
    reply_to_message_id, reply_to_text = await extract_reply_context(data)
    
    logger.info(f"Private message from {user_id}: {message}")
    if reply_to_message_id:
        logger.info(f"Message replies to: {reply_to_message_id} - '{reply_to_text}'")
    
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
    
    # 智能需求处理流程
    try:
        # 步骤1: 验证来源(用户ID 85178516)和类型(私聊)
        if user_id != 85178516:
            logger.debug(f"Message from non-authorized user {user_id}, proceeding to AI agent")
        else:
            # 优先检查Git提交许可处理
            requirement_manager = get_requirement_manager(client)
            commit_handled = await requirement_manager.handle_commit_permission(user_id, message)
            if commit_handled:
                logger.info(f"Git commit permission handled for user {user_id}")
                return
            
            # 步骤2: 使用Gemini进行需求意图识别
            logger.info(f"Analyzing intent for message from authorized user {user_id}")
            intent_result = await analyze_requirement_intent(user_id, message)
            
            # 步骤3: 根据意图识别结果决定处理方式
            if intent_result.get("is_requirement", False) and intent_result.get("confidence", 0) > 0.6:
                logger.info(f"Requirement intent detected with confidence {intent_result.get('confidence', 0):.2f}")
                
                # 通知用户意图识别结果
                intent_notification = f"""🧠 需求意图识别完成
意图类型: {intent_result.get('intent_type', 'unknown')}
置信度: {intent_result.get('confidence', 0):.1%}
关键词: {', '.join(intent_result.get('keywords', []))}

正在下发至Claude Code处理..."""
                await client.send_private_message(user_id, intent_notification)
                
                # 步骤4: 下发给Claude Code处理
                requirement_handled = await handle_requirement_message(user_id, message, client)
                
                if requirement_handled:
                    logger.info(f"Requirement message handled for user {user_id}")
                    return
                else:
                    await client.send_private_message(user_id, "需求下发失败，请稍后重试或联系管理员")
                    return
            else:
                logger.info(f"No requirement intent detected (confidence: {intent_result.get('confidence', 0):.2f})")
                
    except Exception as e:
        logger.error(f"Requirement intent analysis error: {e}")
        await client.send_private_message(user_id, "需求意图分析出现错误，消息将转给AI助手处理")
    
    # AI Agent 智能回复（非需求消息）
    try:
        # 获取对话上下文
        context = await get_conversation_context(user_id, reply_to_message_id)
        
        logger.info(f"Processing message with AI Agent: {message[:50]}...")
        if context:
            logger.info(f"Using conversation context for user {user_id}")
        
        ai_response = await process_message_with_agent_context(message, user_id, context, message_id, reply_to_message_id, reply_to_text)
        await client.send_private_message(user_id, ai_response)
        logger.info(f"AI response sent to {user_id}")
        
    except Exception as e:
        logger.error(f"AI Agent processing error: {e}")
        fallback_response = "抱歉，AI助手暂时出现了一些问题，请稍后再试。"
        await client.send_private_message(user_id, fallback_response)


async def handle_group_message(data):
    """处理群聊消息 - 支持@机器人智能回复"""
    global client
    group_id = data.get('group_id')
    user_id = data.get('user_id')
    message = data.get('raw_message', '')
    message_id = data.get('message_id')
    
    # 提取回复上下文
    reply_to_message_id, reply_to_text = await extract_reply_context(data)
    
    logger.info(f"Group message in {group_id} from {user_id}: {message}")
    if reply_to_message_id:
        logger.info(f"Group message replies to: {reply_to_message_id} - '{reply_to_text}'")
    
    # 检查是否@了机器人
    bot_qq = config.BOT_CONFIG['qq_number']  # 1129974489
    
    # 防止机器人回复自己的消息
    if user_id == bot_qq:
        logger.debug(f"Ignoring message from bot itself: {message}")
        return
    is_at_bot = False
    clean_message = message
    
    # 检查消息中是否包含@机器人 - 支持多种@格式
    at_patterns = [
        f"@{bot_qq}",
        f"[CQ:at,qq={bot_qq}]",
        f"＠{bot_qq}",  # 全角@
    ]
    
    for pattern in at_patterns:
        if pattern in message:
            is_at_bot = True
            clean_message = message.replace(pattern, "").strip()
            break
    
    # 检查是否回复了机器人的消息
    is_reply_to_bot = reply_to_message_id is not None
    
    if is_at_bot:
        logger.info(f"Bot was @ed in group {group_id}, clean message: {clean_message}")
    elif is_reply_to_bot:
        logger.info(f"Message replies to bot in group {group_id}: {clean_message}")
    
    # 如果@了机器人或回复了机器人消息，转发给Gemini AI进行智能回复
    if (is_at_bot or is_reply_to_bot) and config.BOT_CONFIG['group_ai_enabled']:
        try:
            logger.info(f"Processing group message with Gemini AI: {clean_message}")
            
            # 获取群聊上下文
            context = await get_group_conversation_context(group_id, user_id, reply_to_message_id)
            
            # 调用Gemini AI处理消息（注意：这是聊天，不是需求识别）
            ai_response = await process_message_with_agent_context(clean_message, user_id, context, message_id, reply_to_message_id, reply_to_text)
            
            if ai_response:
                # 在群聊中回复，@发送消息的用户
                await client.send_at_message(group_id, user_id, ai_response)
                logger.info(f"AI response sent to group {group_id} for user {user_id}")
            else:
                await client.send_at_message(group_id, user_id, "抱歉，AI助手暂时无法响应，请稍后再试")
                
        except Exception as e:
            logger.error(f"Error processing @bot message with AI: {e}")
            await client.send_at_message(group_id, user_id, "抱歉，AI助手出现错误，请稍后再试")
        
        return  # 处理完@消息就返回
    
    # 原有的群聊指令处理
    if message == "群帮助":
        help_text = """群聊可用命令：
- 群帮助：显示此帮助信息
- 群时间：显示当前时间
- @机器人 [消息]：与AI助手智能对话
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
    
    # 启动Claude Code交互进程
    claude_code_manager = get_claude_code_manager()
    logger.info("Starting Claude Code interactive process...")
    await claude_code_manager.start_claude_code_process()
    
    # 启动HTTP服务器（独立于WebSocket连接状态）
    start_http_server(client, host='0.0.0.0', port=8080)
    logger.info("HTTP server starting on http://0.0.0.0:8080")
    
    # 等待HTTP服务器启动
    await asyncio.sleep(3)
    logger.info("HTTP server should be ready now")
    
    try:
        # 启动WebSocket客户端
        await client.connect()
        if client.is_connected():
            logger.info("WebSocket client connected successfully")
            
            # 发送服务启动通知给授权用户
            startup_message = f"""🚀 QQ智能机器人服务启动成功
启动时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
WebSocket: ✅ 已连接 (ws://127.0.0.1:3001)
HTTP服务: ✅ 运行中 (http://0.0.0.0:8080)
Gemini AI: ✅ 已就绪
Claude Code: ✅ 交互进程已启动
系统状态: 🟢 全部服务正常运行"""
            
            await client.send_private_message(85178516, startup_message)
            logger.info("Startup notification sent")
            
            # 启动WebSocket监听
            await client.listen()
            
        else:
            logger.error("Failed to connect WebSocket client - HTTP server still running")
            # WebSocket连接失败时保持HTTP服务器运行
            while True:
                await asyncio.sleep(10)
                logger.info("HTTP server continues running despite WebSocket connection failure")
            
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        await claude_code_manager.stop_claude_code_process()
        await client.disconnect()
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        await claude_code_manager.stop_claude_code_process()
        await client.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
