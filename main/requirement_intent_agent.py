#!/usr/bin/env python3
"""
需求意图识别Agent - 基于Gemini 2.5 Flash with Function Calling
专门用于识别用户消息是否为编程需求意图
"""

import requests
import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
import asyncio
import time
from gemini_agent import GeminiAgent
import google.genai as genai


class RequirementIntentAgent(GeminiAgent):
    """专门用于需求意图识别的Gemini Agent，支持Function Calling"""
    
    def __init__(self, config_path: str = "../resource/token.properties"):
        super().__init__(config_path)
        
        # 专门的意图识别系统提示词
        self.intent_system_prompt = """分析用户消息，判断是否为编程开发需求。

需求特征：实现、开发、修改、修复、优化、添加、创建、构建、集成、重构、测试
非需求特征：问候、询问、查看、重启、状态查询

使用function calling返回结果。"""

        # Function定义
        self.function_definitions = [
            {
                "name": "identify_requirement_intent",
                "description": "识别用户消息是否为编程需求意图",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "is_requirement": {
                            "type": "boolean",
                            "description": "是否为编程需求意图"
                        },
                        "intent_type": {
                            "type": "string",
                            "enum": ["development", "modification", "bugfix", "integration", "refactoring", "testing", "none"],
                            "description": "需求意图类型"
                        },
                        "confidence": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": 1,
                            "description": "识别置信度 (0-1)"
                        },
                        "keywords": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "识别到的关键词"
                        },
                        "summary": {
                            "type": "string",
                            "description": "需求摘要（如果是需求的话）"
                        }
                    },
                    "required": ["is_requirement", "intent_type", "confidence"]
                }
            }
        ]

    def _prepare_intent_request_payload(self, message: str) -> Dict[str, Any]:
        """准备意图识别请求载荷"""
        return {
            "contents": [
                {
                    "role": "user", 
                    "parts": [
                        {"text": f"{self.intent_system_prompt}\n\n请分析以下用户消息的意图：\n\n{message}"}
                    ]
                }
            ],
            "tools": [
                {
                    "function_declarations": self.function_definitions
                }
            ],
            "generationConfig": {
                "temperature": 0.1,  # 低温度确保一致性
                "topK": 20,
                "topP": 0.8,
                "maxOutputTokens": 1000  # 增加输出token限制
            },
            "safetySettings": [
                {
                    "category": "HARM_CATEGORY_HARASSMENT",
                    "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    "category": "HARM_CATEGORY_HATE_SPEECH", 
                    "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                    "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                }
            ]
        }

    async def identify_intent(self, message: str, user_id: int) -> Dict[str, Any]:
        """识别消息意图"""
        
        # 预检查：必须是授权用户且为私聊
        if user_id != 85178516:
            return {
                "is_requirement": False,
                "intent_type": "none",
                "confidence": 0.0,
                "reason": "非授权用户"
            }
        
        if not self.api_keys:
            self.logger.error("No API keys available for intent recognition")
            return {
                "is_requirement": False,
                "intent_type": "none", 
                "confidence": 0.0,
                "reason": "API服务不可用"
            }

        try:
            api_key = self._get_current_api_key()
            url = f"{self.base_url}?key={api_key}"
            payload = self._prepare_intent_request_payload(message)
            
            headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'QQ-Bot-Intent-Agent/1.0'
            }

            self.logger.info(f"Analyzing intent for message from user {user_id}")
            
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=20
            )

            # 保存完整的请求和响应到数据库
            await self._save_intent_conversation(user_id, message, payload, response)

            if response.status_code == 200:
                data = response.json()
                
                if 'candidates' in data and data['candidates']:
                    candidate = data['candidates'][0]
                    
                    # 检查finishReason
                    finish_reason = candidate.get('finishReason', '')
                    if finish_reason == 'MAX_TOKENS':
                        self.logger.warning(f"Response truncated due to MAX_TOKENS, falling back to keyword analysis")
                        return self._fallback_intent_analysis(message)
                    
                    # 检查是否有function call
                    if 'content' in candidate:
                        content = candidate['content']
                        if 'parts' in content and content['parts']:
                            for part in content['parts']:
                                if 'functionCall' in part:
                                    function_call = part['functionCall']
                                    
                                    if function_call['name'] == 'identify_requirement_intent':
                                        args = function_call['args']
                                        
                                        result = {
                                            "is_requirement": args.get("is_requirement", False),
                                            "intent_type": args.get("intent_type", "none"),
                                            "confidence": args.get("confidence", 0.0),
                                            "keywords": args.get("keywords", []),
                                            "summary": args.get("summary", ""),
                                            "raw_response": data
                                        }
                                        
                                        self.logger.info(f"Intent analysis result: {result}")
                                        return result
                        else:
                            self.logger.warning(f"No parts in content, finish reason: {finish_reason}")
                    else:
                        self.logger.warning(f"No content in candidate, finish reason: {finish_reason}")
                
                # 如果没有function call，回退到文本分析
                self.logger.warning("No function call in response, using fallback analysis")
                return self._fallback_intent_analysis(message)
                
            else:
                self.logger.error(f"Intent API request failed: {response.status_code} - {response.text}")
                return self._fallback_intent_analysis(message)
                
        except Exception as e:
            self.logger.error(f"Intent recognition error: {e}")
            return self._fallback_intent_analysis(message)

    def _fallback_intent_analysis(self, message: str) -> Dict[str, Any]:
        """回退的意图分析方法"""
        requirement_keywords = [
            "实现", "开发", "添加", "修改", "修复", "优化",
            "创建", "构建", "集成", "升级", "更新", "改进", 
            "重构", "重写", "测试", "部署", "配置", "补充"
        ]
        
        found_keywords = [kw for kw in requirement_keywords if kw in message]
        
        # 更精确的需求识别逻辑
        is_requirement = len(found_keywords) > 0
        
        # 特殊情况：如果消息很长且包含技术描述，提高置信度
        if len(message) > 50 and any(tech_word in message for tech_word in 
                                    ["工作流程", "链路", "数据库", "API", "webui", "响应", "请求"]):
            if found_keywords:
                is_requirement = True
        
        confidence = min(len(found_keywords) * 0.4 + (0.2 if len(message) > 100 else 0), 1.0) if is_requirement else 0.0
        
        # 简单的意图类型判断
        intent_type = "none"
        if is_requirement:
            if any(kw in message for kw in ["实现", "开发", "添加", "创建", "构建"]):
                intent_type = "development"
            elif any(kw in message for kw in ["修改", "优化", "改进", "更新", "升级", "补充"]):
                intent_type = "modification"
            elif any(kw in message for kw in ["修复", "bug", "问题", "错误"]):
                intent_type = "bugfix"
            elif any(kw in message for kw in ["集成", "配置", "部署"]):
                intent_type = "integration"
            elif any(kw in message for kw in ["重构", "重写"]):
                intent_type = "refactoring"
            elif any(kw in message for kw in ["测试"]):
                intent_type = "testing"
            else:
                intent_type = "development"
        
        return {
            "is_requirement": is_requirement,
            "intent_type": intent_type,
            "confidence": confidence,
            "keywords": found_keywords,
            "summary": message[:100] if is_requirement else "",
            "fallback": True
        }

    async def _save_intent_conversation(self, user_id: int, user_message: str, request_payload: Dict, response: requests.Response):
        """保存意图识别对话到数据库，使其在WebUI中可见"""
        try:
            from database import get_database_manager
            
            # 生成唯一的对话ID
            conversation_id = f"intent_{user_id}_{int(time.time() * 1000)}"
            
            # 构建AI响应文本
            if response.status_code == 200:
                response_data = response.json()
                
                # 提取Function Call结果作为AI回复
                ai_response = "🧠 意图识别分析:\n\n"
                
                if 'candidates' in response_data and response_data['candidates']:
                    candidate = response_data['candidates'][0]
                    
                    if 'content' in candidate and 'parts' in candidate['content']:
                        for part in candidate['content']['parts']:
                            if 'functionCall' in part:
                                function_call = part['functionCall']
                                if function_call['name'] == 'identify_requirement_intent':
                                    args = function_call['args']
                                    
                                    ai_response += f"✅ 意图类型: {args.get('intent_type', 'unknown')}\n"
                                    ai_response += f"📊 置信度: {args.get('confidence', 0):.1%}\n"
                                    ai_response += f"🎯 是否需求: {'是' if args.get('is_requirement', False) else '否'}\n"
                                    
                                    keywords = args.get('keywords', [])
                                    if keywords:
                                        ai_response += f"🔑 关键词: {', '.join(keywords)}\n"
                                    
                                    summary = args.get('summary', '')
                                    if summary:
                                        ai_response += f"📝 摘要: {summary}\n"
                                    
                                    break
                    
                    if ai_response == "🧠 意图识别分析:\n\n":
                        # 没有找到function call，使用通用响应
                        ai_response += "意图识别完成，但未检测到结构化结果"
                        
            else:
                ai_response = f"❌ 意图识别失败 (HTTP {response.status_code})"
            
            # 计算响应时间（估算）
            response_time = 2.0  # 意图识别大约2秒
            
            # 准备对话数据
            conversation_data = {
                'id': conversation_id,
                'user_id': user_id,
                'user_message': f"[需求意图识别] {user_message}",  # 添加前缀以便识别
                'ai_response': ai_response,
                'timestamp': datetime.now(),
                'response_time': response_time,
                'model_name': 'Gemini-2.5-Flash-Intent',
                'raw_request': json.dumps(request_payload, ensure_ascii=False),
                'raw_response': json.dumps(response_data if response.status_code == 200 else {'error': response.text, 'status_code': response.status_code}, ensure_ascii=False)
            }
            
            # 保存到数据库
            db = get_database_manager()
            success = db.save_conversation(conversation_data)
            
            if success:
                self.logger.info(f"Intent conversation saved to database: {conversation_id}")
                
                # 同时保存完整的请求响应payload
                await self._save_complete_api_payload(conversation_id, user_id, request_payload, response)
            else:
                self.logger.error(f"Failed to save intent conversation: {conversation_id}")
                
        except Exception as e:
            self.logger.error(f"Error saving intent conversation: {e}")
            import traceback
            traceback.print_exc()

    async def _save_complete_api_payload(self, conversation_id: str, user_id: int, request_payload: Dict, response: requests.Response):
        """保存完整的API请求和响应payload"""
        try:
            from database import get_database_manager
            
            # 准备完整的payload数据
            complete_data = {
                'conversation_id': conversation_id,
                'user_id': user_id,
                'request_url': response.url,
                'request_method': 'POST',
                'request_headers': dict(response.request.headers),
                'request_payload': request_payload,
                'response_status': response.status_code,
                'response_headers': dict(response.headers),
                'response_payload': response.json() if response.status_code == 200 else {'error': response.text},
                'timestamp': datetime.now(),
                'api_type': 'gemini_intent_recognition'
            }
            
            db = get_database_manager()
            
            # 创建API调用记录表的查询（如果表不存在会在第一次使用时创建）
            query = """
            INSERT INTO api_call_logs (conversation_id, user_id, api_type, request_url, 
                                     request_method, request_headers, request_payload,
                                     response_status, response_headers, response_payload, 
                                     timestamp)
            VALUES (%(conversation_id)s, %(user_id)s, %(api_type)s, %(request_url)s,
                   %(request_method)s, %(request_headers)s, %(request_payload)s,
                   %(response_status)s, %(response_headers)s, %(response_payload)s,
                   %(timestamp)s)
            """
            
            # 序列化JSON字段
            serialized_data = complete_data.copy()
            for field in ['request_headers', 'request_payload', 'response_headers', 'response_payload']:
                serialized_data[field] = json.dumps(serialized_data[field], ensure_ascii=False)
            
            try:
                with db.get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute(query, serialized_data)
                    conn.commit()
                    cursor.close()
                    
                self.logger.info(f"Complete API payload saved for conversation: {conversation_id}")
                
            except Exception as db_error:
                # 如果表不存在，尝试创建表
                if "doesn't exist" in str(db_error).lower():
                    await self._create_api_logs_table()
                    # 重试插入
                    with db.get_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute(query, serialized_data)
                        conn.commit()
                        cursor.close()
                        
                    self.logger.info(f"Created api_call_logs table and saved payload for conversation: {conversation_id}")
                else:
                    raise db_error
                    
        except Exception as e:
            self.logger.error(f"Error saving complete API payload: {e}")

    async def _create_api_logs_table(self):
        """创建API调用日志表"""
        try:
            from database import get_database_manager
            
            create_table_query = """
            CREATE TABLE IF NOT EXISTS api_call_logs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                conversation_id VARCHAR(255) NOT NULL,
                user_id BIGINT NOT NULL,
                api_type VARCHAR(100) NOT NULL,
                request_url TEXT NOT NULL,
                request_method VARCHAR(20) NOT NULL,
                request_headers JSON,
                request_payload JSON,
                response_status INT NOT NULL,
                response_headers JSON,
                response_payload JSON,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_conversation_id (conversation_id),
                INDEX idx_user_id (user_id),
                INDEX idx_api_type (api_type),
                INDEX idx_timestamp (timestamp)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """
            
            db = get_database_manager()
            db.execute_update(create_table_query)
            
            self.logger.info("Created api_call_logs table successfully")
            
        except Exception as e:
            self.logger.error(f"Error creating api_call_logs table: {e}")


# 全局意图识别Agent实例
requirement_intent_agent = None


def get_requirement_intent_agent() -> RequirementIntentAgent:
    """获取全局需求意图识别Agent实例"""
    global requirement_intent_agent
    if requirement_intent_agent is None:
        requirement_intent_agent = RequirementIntentAgent()
    return requirement_intent_agent


async def analyze_requirement_intent(user_id: int, message: str) -> Dict[str, Any]:
    """分析消息的需求意图"""
    agent = get_requirement_intent_agent()
    return await agent.identify_intent(message, user_id)


if __name__ == "__main__":
    # 测试代码
    import asyncio
    
    async def test_intent_agent():
        agent = RequirementIntentAgent()
        
        if not agent.is_available():
            print("Intent agent not available - no API keys loaded")
            return
            
        test_messages = [
            "你好，机器人工作正常吗？",  # 非需求
            "请帮我实现一个用户登录功能",  # 开发需求
            "修复数据库连接问题",  # 修复需求
            "优化查询性能",  # 优化需求
            "今天天气怎么样？",  # 非需求
            "需要集成微信支付接口"  # 集成需求
        ]
        
        for message in test_messages:
            print(f"\n测试消息: {message}")
            result = await agent.identify_intent(message, 85178516)
            print(f"识别结果: {result}")

    asyncio.run(test_intent_agent())