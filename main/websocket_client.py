import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Dict, Any, Callable, Optional, List, Union
import websockets
from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK


class WebSocketClient:
    def __init__(self, host: str = "127.0.0.1", port: int = 3001):
        self.host = host
        self.port = port
        self.uri = f"ws://{host}:{port}?access_token=w@123456"
        self.websocket = None
        self.event_handlers: Dict[str, Callable] = {}
        self.is_running = False
        self.logger = logging.getLogger(__name__)
        
        # 设置文件日志
        self.setup_file_logging()
        
    def setup_file_logging(self):
        """设置文件日志记录"""
        # 确保log目录存在
        log_dir = "log"
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
            
        # 创建文件处理器，按日期分文件
        today = datetime.now().strftime("%Y-%m-%d")
        log_file = os.path.join(log_dir, f"websocket_events_{today}.log")
        
        # 创建文件处理器
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(logging.INFO)
        
        # 设置日志格式
        formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        file_handler.setFormatter(formatter)
        
        # 为当前logger添加文件处理器
        self.logger.addHandler(file_handler)
        self.logger.setLevel(logging.INFO)
        
    def log_event(self, event_type: str, data: Dict[str, Any], direction: str = "received"):
        """记录事件到日志文件"""
        log_message = f"[{direction.upper()}] Event: {event_type} | Data: {json.dumps(data, ensure_ascii=False)}"
        self.logger.info(log_message)
        
    def on(self, event_type: str, handler: Callable):
        """注册事件处理器"""
        self.event_handlers[event_type] = handler
        
    async def connect(self):
        """连接到WebSocket服务器"""
        try:
            self.websocket = await websockets.connect(self.uri)
            self.is_running = True
            self.logger.info(f"Connected to WebSocket server at {self.uri}")
            return True
        except Exception as e:
            self.logger.error(f"Failed to connect to WebSocket server: {e}")
            return False
            
    async def disconnect(self):
        """断开WebSocket连接"""
        self.is_running = False
        if self.websocket:
            await self.websocket.close()
            self.logger.info("WebSocket connection closed")
            
    async def listen(self):
        """监听服务器事件"""
        if not self.websocket:
            self.logger.error("WebSocket is not connected")
            return
            
        try:
            async for message in self.websocket:
                try:
                    data = json.loads(message)
                    
                    # 根据OneBot 11协议，使用post_type作为事件类型
                    post_type = data.get('post_type', 'unknown')
                    message_type = data.get('message_type', 'unknown')
                    
                    # 确定事件类型
                    if post_type == 'message':
                        event_type = 'message'
                    elif post_type == 'notice':
                        event_type = 'notice'
                    elif post_type == 'request':
                        event_type = 'request'
                    elif post_type == 'meta_event':
                        event_type = 'meta'
                    else:
                        event_type = 'default'
                    
                    # 记录接收到的事件到日志文件
                    self.log_event(event_type, data, "received")
                    
                    self.logger.debug(f"Received event: {event_type} (post_type: {post_type})")
                    
                    # 调用对应的事件处理器
                    if event_type in self.event_handlers:
                        await self.event_handlers[event_type](data)
                    elif 'default' in self.event_handlers:
                        await self.event_handlers['default'](data)
                    else:
                        self.logger.warning(f"No handler found for event type: {event_type}")
                        
                except json.JSONDecodeError as e:
                    self.logger.error(f"Failed to parse JSON message: {e}")
                except Exception as e:
                    self.logger.error(f"Error handling message: {e}")
                    
        except (ConnectionClosedError, ConnectionClosedOK):
            self.logger.info("WebSocket connection closed by server")
        except Exception as e:
            self.logger.error(f"Error in listen loop: {e}")
        finally:
            self.is_running = False
            
    async def send_event(self, event_type: str, data: Optional[Dict[str, Any]] = None):
        """向服务器发送事件"""
        if not self.websocket:
            self.logger.error("WebSocket is not connected")
            return False
            
        event_data = {
            'type': event_type,
            'data': data or {}
        }
        
        try:
            message = json.dumps(event_data, ensure_ascii=False)
            await self.websocket.send(message)
            
            # 记录发送的事件到日志文件
            self.log_event(event_type, data or {}, "sent")
            
            self.logger.debug(f"Sent event: {event_type}")
            return True
        except Exception as e:
            self.logger.error(f"Failed to send event: {e}")
            return False

    def is_connected(self) -> bool:
        """检查连接状态"""
        return self.websocket is not None and self.is_running

    async def send_private_message(self, user_id, message):
        """发送私聊消息"""
        try:
            # 如果message是消息段列表，直接使用
            if isinstance(message, list):
                message_data = message
            else:
                # 否则转换为文本消息段
                message_data = [
                    {"type": "text", "data": {"text": str(message)}}
                ]
            
            # 根据OneBot 11协议，发送私聊消息
            data = {
                "action": "send_private_msg",
                "params": {
                    "user_id": user_id,
                    "message": message_data
                }
            }
            
            # 直接发送到WebSocket，不使用send_event
            try:
                message_json = json.dumps(data, ensure_ascii=False)
                await self.websocket.send(message_json)
                
                # 记录发送的事件到日志文件
                self.log_event("send_private_msg", data, "sent")
                
                self.logger.info(f"Sent private message to {user_id}: {message}")
                return True
            except Exception as e:
                self.logger.error(f"Failed to send private message: {e}")
                return False
                
        except Exception as e:
            self.logger.error(f"Error in send_private_message: {e}")
            return False

    async def send_group_message(self, group_id, message):
        """发送群聊消息"""
        try:
            # 如果message是消息段列表，直接使用
            if isinstance(message, list):
                message_data = message
            else:
                # 否则转换为文本消息段
                message_data = [
                    {"type": "text", "data": {"text": str(message)}}
                ]
            
            # 根据OneBot 11协议，发送群聊消息
            data = {
                "action": "send_group_msg",
                "params": {
                    "group_id": group_id,
                    "message": message_data
                }
            }
            
            # 直接发送到WebSocket，不使用send_event
            try:
                message_json = json.dumps(data, ensure_ascii=False)
                await self.websocket.send(message_json)
                
                # 记录发送的事件到日志文件
                self.log_event("send_group_msg", data, "sent")
                
                self.logger.info(f"Sent group message to {group_id}: {message}")
                return True
            except Exception as e:
                self.logger.error(f"Failed to send group message: {e}")
                return False
                
        except Exception as e:
            self.logger.error(f"Error in send_group_message: {e}")
            return False

    async def send_at_message(self, group_id, user_id, message):
        """发送@消息"""
        try:
            # 构建@消息段
            message_data = [
                {"type": "at", "data": {"qq": user_id}},
                {"type": "text", "data": {"text": str(message)}}
            ]
            
            # 根据OneBot 11协议，发送群聊消息
            data = {
                "action": "send_group_msg",
                "params": {
                    "group_id": group_id,
                    "message": message_data
                }
            }
            
            # 直接发送到WebSocket，不使用send_event
            try:
                message_json = json.dumps(data, ensure_ascii=False)
                await self.websocket.send(message_json)
                
                # 记录发送的事件到日志文件
                self.log_event("send_at_msg", data, "sent")
                
                self.logger.info(f"Sent @ message to group {group_id} for user {user_id}: {message}")
                return True
            except Exception as e:
                self.logger.error(f"Failed to send @ message: {e}")
                return False
                
        except Exception as e:
            self.logger.error(f"Error in send_at_message: {e}")
            return False

    async def send_reply_message(self, message_type, target_id, reply_id, message):
        """发送回复消息"""
        try:
            # 如果message是消息段列表，直接使用
            if isinstance(message, list):
                message_data = message
            else:
                # 否则转换为文本消息段
                message_data = [
                    {"type": "text", "data": {"text": str(message)}}
                ]
            
            # 添加回复消息段
            message_data.insert(0, {
                "type": "reply",
                "data": {"id": reply_id}
            })
            
            # 根据消息类型选择发送方式
            if message_type == "private":
                data = {
                    "action": "send_private_msg",
                    "params": {
                        "user_id": target_id,
                        "message": message_data
                    }
                }
            elif message_type == "group":
                data = {
                    "action": "send_group_msg",
                    "params": {
                        "group_id": target_id,
                        "message": message_data
                    }
                }
            else:
                self.logger.error(f"Invalid message_type: {message_type}")
                return False
            
            # 直接发送到WebSocket，不使用send_event
            try:
                message_json = json.dumps(data, ensure_ascii=False)
                await self.websocket.send(message_json)
                
                # 记录发送的事件到日志文件
                self.log_event("send_reply_msg", data, "sent")
                
                self.logger.info(f"Sent reply message to {message_type} {target_id} for message {reply_id}: {message}")
                return True
            except Exception as e:
                self.logger.error(f"Failed to send reply message: {e}")
                return False
                
        except Exception as e:
            self.logger.error(f"Error in send_reply_message: {e}")
            return False
            
    async def start(self):
        """启动WebSocket客户端"""
        if await self.connect():
            await self.listen()
        else:
            self.logger.error("Failed to start WebSocket client")