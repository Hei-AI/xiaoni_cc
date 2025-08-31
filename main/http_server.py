#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQ机器人HTTP服务器
使用Flask框架提供API接口，保持异步WebSocket通信
"""

import json
import logging
import threading
import time
import asyncio
from datetime import datetime
from flask import Flask, request, jsonify
from websocket_client import WebSocketClient
import config


class QQBotHTTPServer:
    def __init__(self):
        self.app = Flask(__name__)
        self.websocket_client = None
        self.setup_routes()
        self.setup_logging()
        self.server_thread = None
        self.is_running = False
        self.loop = None
        
    def setup_logging(self):
        """设置日志"""
        log_dir = "log"
        import os
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
            
        today = datetime.now().strftime("%Y-%m-%d")
        log_file = os.path.join(log_dir, f"http_server_{today}.log")
        
        # 配置Flask日志
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_file, encoding='utf-8'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
        # 设置Flask日志级别
        self.app.logger.setLevel(logging.INFO)
        
    def setup_routes(self):
        """设置路由"""
        # 健康检查
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return self.health_check_handler()
        
        # 发送私聊消息
        @self.app.route('/api/send_private', methods=['POST'])
        def send_private_message():
            return self.send_private_message_handler()
        
        # 发送群聊消息
        @self.app.route('/api/send_group', methods=['POST'])
        def send_group_message():
            return self.send_group_message_handler()
        
        # 发送@消息
        @self.app.route('/api/send_at', methods=['POST'])
        def send_at_message():
            return self.send_at_message_handler()
        
        # 发送回复消息
        @self.app.route('/api/send_reply', methods=['POST'])
        def send_reply_message():
            return self.send_reply_message_handler()
        
        # 获取机器人状态
        @self.app.route('/api/status', methods=['GET'])
        def get_bot_status():
            return self.get_bot_status_handler()
        
        # 获取连接状态
        @self.app.route('/api/connection', methods=['GET'])
        def get_connection_status():
            return self.get_connection_status_handler()
        
    def health_check_handler(self):
        """健康检查接口"""
        return jsonify({
            "status": "ok",
            "timestamp": datetime.now().isoformat(),
            "service": "QQ Bot HTTP Server (Flask + Async)",
            "framework": "Flask with Async WebSocket"
        })
        
    def send_private_message_handler(self):
        """发送私聊消息API接口
        
        请求体格式:
        {
            "user_id": 123456789,
            "message": "消息内容",
            "message_type": "text"  // 可选: text, segments
        }
        """
        try:
            data = request.get_json()
            if not data:
                return jsonify({
                    "success": False,
                    "error": "Invalid JSON data"
                }), 400
                
            user_id = data.get('user_id')
            message = data.get('message')
            message_type = data.get('message_type', 'text')
            
            if not user_id or not message:
                return jsonify({
                    "success": False,
                    "error": "Missing required parameters: user_id and message"
                }), 400
                
            if not self.websocket_client or not self.websocket_client.is_connected():
                return jsonify({
                    "success": False,
                    "error": "WebSocket client not connected"
                }), 503
                
            # 使用异步方式发送消息
            result = self.run_async(self.websocket_client.send_private_message(user_id, message))
                
            if result:
                self.logger.info(f"Private message sent to {user_id}: {message}")
                return jsonify({
                    "success": True,
                    "message": "Private message sent successfully",
                    "user_id": user_id,
                    "timestamp": datetime.now().isoformat()
                })
            else:
                return jsonify({
                    "success": False,
                    "error": "Failed to send private message"
                }), 500
                
        except Exception as e:
            self.logger.error(f"Error sending private message: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500
            
    def send_group_message_handler(self):
        """发送群聊消息API接口
        
        请求体格式:
        {
            "group_id": 987654321,
            "message": "消息内容",
            "message_type": "text"  // 可选: text, segments
        }
        """
        try:
            data = request.get_json()
            if not data:
                return jsonify({
                    "success": False,
                    "error": "Invalid JSON data"
                }), 400
                
            group_id = data.get('group_id')
            message = data.get('message')
            message_type = data.get('message_type', 'text')
            
            if not group_id or not message:
                return jsonify({
                    "success": False,
                    "error": "Missing required parameters: group_id and message"
                }), 400
                
            if not self.websocket_client or not self.websocket_client.is_connected():
                return jsonify({
                    "success": False,
                    "error": "WebSocket client not connected"
                }), 503
                
            # 使用异步方式发送消息
            result = self.run_async(self.websocket_client.send_group_message(group_id, message))
                
            if result:
                self.logger.info(f"Group message sent to {group_id}: {message}")
                return jsonify({
                    "success": True,
                    "message": "Group message sent successfully",
                    "group_id": group_id,
                    "timestamp": datetime.now().isoformat()
                })
            else:
                return jsonify({
                    "success": False,
                    "error": "Failed to send group message"
                }), 500
                
        except Exception as e:
            self.logger.error(f"Error sending group message: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500
            
    def send_at_message_handler(self):
        """发送@消息API接口
        
        请求体格式:
        {
            "group_id": 987654321,
            "user_id": 123456789,
            "message": "消息内容"
        }
        """
        try:
            data = request.get_json()
            if not data:
                return jsonify({
                    "success": False,
                    "error": "Invalid JSON data"
                }), 400
                
            group_id = data.get('group_id')
            user_id = data.get('user_id')
            message = data.get('message')
            
            if not group_id or not user_id or not message:
                return jsonify({
                    "success": False,
                    "error": "Missing required parameters: group_id, user_id and message"
                }), 400
                
            if not self.websocket_client or not self.websocket_client.is_connected():
                return jsonify({
                    "success": False,
                    "error": "WebSocket client not connected"
                }), 503
                
            # 使用异步方式发送消息
            result = self.run_async(self.websocket_client.send_at_message(group_id, user_id, message))
            
            if result:
                self.logger.info(f"@ message sent to group {group_id} for user {user_id}: {message}")
                return jsonify({
                    "success": True,
                    "message": "@ message sent successfully",
                    "group_id": group_id,
                    "user_id": user_id,
                    "timestamp": datetime.now().isoformat()
                })
            else:
                return jsonify({
                    "success": False,
                    "error": "Failed to send @ message"
                }), 500
                
        except Exception as e:
            self.logger.error(f"Error sending @ message: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500
            
    def send_reply_message_handler(self):
        """发送回复消息API接口
        
        请求体格式:
        {
            "message_type": "private",  // private 或 group
            "target_id": 123456789,     // 用户ID或群ID
            "reply_id": 1001,           // 要回复的消息ID
            "message": "回复内容",
            "message_format": "text"    // 可选: text, segments
        }
        """
        try:
            data = request.get_json()
            if not data:
                return jsonify({
                    "success": False,
                    "error": "Invalid JSON data"
                }), 400
                
            message_type = data.get('message_type')
            target_id = data.get('target_id')
            reply_id = data.get('reply_id')
            message = data.get('message')
            message_format = data.get('message_format', 'text')
            
            if not all([message_type, target_id, reply_id, message]):
                return jsonify({
                    "success": False,
                    "error": "Missing required parameters: message_type, target_id, reply_id, message"
                }), 400
                
            if message_type not in ['private', 'group']:
                return jsonify({
                    "success": False,
                    "error": "Invalid message_type. Must be 'private' or 'group'"
                }), 400
                
            if not self.websocket_client or not self.websocket_client.is_connected():
                return jsonify({
                    "success": False,
                    "error": "WebSocket client not connected"
                }), 503
                
            # 使用异步方式发送消息
            result = self.run_async(self.websocket_client.send_reply_message(message_type, target_id, reply_id, message))
                
            if result:
                self.logger.info(f"Reply message sent to {message_type} {target_id} for message {reply_id}: {message}")
                return jsonify({
                    "success": True,
                    "message": "Reply message sent successfully",
                    "message_type": message_type,
                    "target_id": target_id,
                    "reply_id": reply_id,
                    "timestamp": datetime.now().isoformat()
                })
            else:
                return jsonify({
                    "success": False,
                    "error": "Failed to send reply message"
                }), 500
                
        except Exception as e:
            self.logger.error(f"Error sending reply message: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500
            
    def get_bot_status_handler(self):
        """获取机器人状态"""
        try:
            status = {
                "bot_id": config.WEBSOCKET_CONFIG.get("self_id", "unknown"),
                "status": "online" if self.websocket_client and self.websocket_client.is_connected() else "offline",
                "timestamp": datetime.now().isoformat(),
                "version": "1.0.0",
                "framework": "Flask with Async WebSocket"
            }
            return jsonify(status)
        except Exception as e:
            self.logger.error(f"Error getting bot status: {e}")
            return jsonify({
                "error": str(e)
            }), 500
            
    def get_connection_status_handler(self):
        """获取连接状态"""
        try:
            if self.websocket_client:
                status = {
                    "connected": self.websocket_client.is_connected(),
                    "host": self.websocket_client.host,
                    "port": self.websocket_client.port,
                    "uri": self.websocket_client.uri,
                    "timestamp": datetime.now().isoformat()
                }
            else:
                status = {
                    "connected": False,
                    "error": "WebSocket client not initialized",
                    "timestamp": datetime.now().isoformat()
                }
            return jsonify(status)
        except Exception as e:
            self.logger.error(f"Error getting connection status: {e}")
            return jsonify({
                "error": str(e)
            }), 500
            
    def run_async(self, coro):
        """运行异步协程的辅助方法"""
        try:
            if self.loop and self.loop.is_running():
                # 如果事件循环正在运行，创建新的事件循环
                new_loop = asyncio.new_event_loop()
                asyncio.set_event_loop(new_loop)
                try:
                    return new_loop.run_until_complete(coro)
                finally:
                    new_loop.close()
            else:
                # 使用当前事件循环
                if not self.loop:
                    self.loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(self.loop)
                return self.loop.run_until_complete(coro)
        except Exception as e:
            self.logger.error(f"Error running async operation: {e}")
            return False
            
    def set_websocket_client(self, client):
        """设置WebSocket客户端"""
        self.websocket_client = client
        
    def start_server(self, host='127.0.0.1', port=8080):
        """启动HTTP服务器"""
        self.logger.info(f"Starting Flask HTTP server on {host}:{port}")
        self.is_running = True
        
        # 在单独的线程中运行Flask应用
        def run_flask():
            self.app.run(host=host, port=port, debug=False, use_reloader=False)
            
        self.server_thread = threading.Thread(target=run_flask, daemon=True)
        self.server_thread.start()
        
        # 等待服务器启动
        time.sleep(2)
        self.logger.info(f"Flask HTTP server started on http://{host}:{port}")
        
    def stop_server(self):
        """停止HTTP服务器"""
        self.logger.info("Stopping Flask HTTP server")
        self.is_running = False
        # Flask服务器会在主线程结束时自动停止


# 创建全局HTTP服务器实例
http_server = QQBotHTTPServer()


def start_http_server(websocket_client, host='127.0.0.1', port=8080):
    """启动HTTP服务器的便捷函数"""
    http_server.set_websocket_client(websocket_client)
    http_server.start_server(host, port)


if __name__ == '__main__':
    # 测试Flask HTTP服务器
    print("Starting Flask HTTP server for testing...")
    http_server.start_server()
    
    try:
        # 保持服务器运行
        while http_server.is_running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Shutting down Flask HTTP server...")
        http_server.stop_server()
