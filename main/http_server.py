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
import os
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string
from websocket_client import WebSocketClient
from gemini_agent import get_gemini_agent
from requirement_manager import get_requirement_manager
from database import get_database_manager
import config


class QQBotHTTPServer:
    def __init__(self):
        self.app = Flask(__name__)
        self.websocket_client = None
        self.db_manager = get_database_manager()
        self.setup_routes()
        self.setup_logging()
        self.server_thread = None
        self.is_running = False
        self.loop = None
        
    def setup_logging(self):
        """设置日志"""
        log_dir = "../logs/http"
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
        
        # WebUI 管理面板
        @self.app.route('/dashboard', methods=['GET'])
        def dashboard():
            return self.dashboard_handler()
        
        # Gemini对话历史API
        @self.app.route('/api/conversations', methods=['GET'])
        def get_conversations():
            return self.get_conversations_handler()
        
        # 清空对话历史API
        @self.app.route('/api/conversations', methods=['DELETE'])
        def clear_conversations():
            return self.clear_conversations_handler()
        
        # 需求任务API
        @self.app.route('/api/requirements', methods=['GET'])
        def get_requirements():
            return self.get_requirements_handler()
        
        # 获取单个对话详情（包含原始LLM数据）
        @self.app.route('/api/conversations/<conversation_id>', methods=['GET'])
        def get_conversation_detail(conversation_id):
            return self.get_conversation_detail_handler(conversation_id)
        
        # 获取对话的LLM原始请求/响应
        @self.app.route('/api/conversations/<conversation_id>/raw', methods=['GET'])
        def get_conversation_raw_data(conversation_id):
            return self.get_conversation_raw_data_handler(conversation_id)
        
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
    
    def dashboard_handler(self):
        """WebUI管理面板"""
        try:
            # 读取HTML模板
            template_path = os.path.join(os.path.dirname(__file__), 'templates', 'dashboard.html')
            if os.path.exists(template_path):
                with open(template_path, 'r', encoding='utf-8') as f:
                    template_content = f.read()
                return render_template_string(template_content)
            else:
                return jsonify({
                    "error": "Dashboard template not found"
                }), 404
        except Exception as e:
            self.logger.error(f"Error loading dashboard: {e}")
            return jsonify({
                "error": str(e)
            }), 500
    
    def get_conversations_handler(self):
        """获取Gemini对话历史"""
        try:
            agent = get_gemini_agent()
            
            # 获取查询参数
            user_id = request.args.get('user_id', type=int)
            limit = request.args.get('limit', type=int, default=50)
            
            conversations = agent.get_conversations(user_id=user_id, limit=limit)
            
            # 转换为字典格式 - conversations已经是字典列表
            conversations_data = []
            for conv in conversations:
                conversations_data.append({
                    'id': conv['id'],
                    'user_id': conv['user_id'],
                    'user_message': conv['user_message'],
                    'ai_response': conv['ai_response'],
                    'timestamp': conv['timestamp'],
                    'response_time': conv.get('response_time', 0)
                })
            
            return jsonify({
                'success': True,
                'conversations': conversations_data,
                'total': len(conversations_data),
                'timestamp': datetime.now().isoformat()
            })
            
        except Exception as e:
            self.logger.error(f"Error getting conversations: {e}")
            return jsonify({
                'success': False,
                'error': str(e),
                'conversations': []
            }), 500
    
    def clear_conversations_handler(self):
        """清空对话历史"""
        try:
            agent = get_gemini_agent()
            cleared_count = agent.clear_conversations()
            
            return jsonify({
                'success': True,
                'message': f'Successfully cleared {cleared_count} conversation records',
                'cleared_count': cleared_count,
                'timestamp': datetime.now().isoformat()
            })
            
        except Exception as e:
            self.logger.error(f"Error clearing conversations: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    def get_requirements_handler(self):
        """获取需求任务状态"""
        try:
            manager = get_requirement_manager()
            
            # 获取查询参数
            user_id = request.args.get('user_id', type=int)
            
            # 获取需求列表（现在直接从数据库获取）
            if user_id:
                requirements_data = manager.get_user_requirements(user_id)
            else:
                requirements_data = self.db_manager.get_requirements()
            
            # 数据已经是字典格式，且已按时间排序
            
            return jsonify({
                'success': True,
                'requirements': requirements_data,
                'total': len(requirements_data),
                'timestamp': datetime.now().isoformat()
            })
            
        except Exception as e:
            self.logger.error(f"Error getting requirements: {e}")
            return jsonify({
                'success': False,
                'error': str(e),
                'requirements': []
            }), 500
    
    def get_conversation_detail_handler(self, conversation_id: str):
        """获取单个对话详情（包含原始LLM数据）"""
        try:
            conversation = self.db_manager.get_conversation_by_id(conversation_id)
            
            if not conversation:
                return jsonify({
                    'success': False,
                    'error': 'Conversation not found'
                }), 404
            
            # 处理原始数据的JSON解析
            if conversation.get('raw_request'):
                try:
                    conversation['raw_request_parsed'] = json.loads(conversation['raw_request'])
                except json.JSONDecodeError:
                    conversation['raw_request_parsed'] = conversation['raw_request']
            
            if conversation.get('raw_response'):
                try:
                    conversation['raw_response_parsed'] = json.loads(conversation['raw_response'])
                except json.JSONDecodeError:
                    conversation['raw_response_parsed'] = conversation['raw_response']
            
            return jsonify({
                'success': True,
                'conversation': conversation,
                'timestamp': datetime.now().isoformat()
            })
            
        except Exception as e:
            self.logger.error(f"Error getting conversation detail: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    def get_conversation_raw_data_handler(self, conversation_id: str):
        """获取对话的LLM原始请求/响应数据"""
        try:
            conversation = self.db_manager.get_conversation_by_id(conversation_id)
            
            if not conversation:
                return jsonify({
                    'success': False,
                    'error': 'Conversation not found'
                }), 404
            
            raw_data = {
                'conversation_id': conversation_id,
                'raw_request': conversation.get('raw_request'),
                'raw_response': conversation.get('raw_response'),
                'model_name': conversation.get('model_name', 'unknown'),
                'response_time': conversation.get('response_time', 0),
                'timestamp': conversation.get('timestamp')
            }
            
            # 尝试解析JSON格式化显示
            if raw_data['raw_request']:
                try:
                    raw_data['raw_request_formatted'] = json.loads(raw_data['raw_request'])
                except json.JSONDecodeError:
                    raw_data['raw_request_formatted'] = raw_data['raw_request']
            
            if raw_data['raw_response']:
                try:
                    raw_data['raw_response_formatted'] = json.loads(raw_data['raw_response'])
                except json.JSONDecodeError:
                    raw_data['raw_response_formatted'] = raw_data['raw_response']
            
            return jsonify({
                'success': True,
                'raw_data': raw_data,
                'timestamp': datetime.now().isoformat()
            })
            
        except Exception as e:
            self.logger.error(f"Error getting conversation raw data: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
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
        
    def start_server(self, host='0.0.0.0', port=8080):
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


def start_http_server(websocket_client, host='0.0.0.0', port=8080):
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
