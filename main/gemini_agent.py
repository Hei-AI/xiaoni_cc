import requests
import json
import logging
from typing import Optional, Dict, Any, List
import configparser
import os
from datetime import datetime
from dataclasses import dataclass, asdict
from database import get_database_manager


@dataclass
class ConversationRecord:
    """对话记录数据结构"""
    id: str
    user_id: int
    user_message: str
    ai_response: str
    timestamp: str
    response_time: float


class GeminiAgent:
    """Gemini 2.5 Flash LLM Agent for intelligent message processing"""
    
    def __init__(self, config_path: str = "../resource/token.properties"):
        self.logger = self._setup_logger()
        self.api_keys = self._load_api_keys(config_path)
        self.current_key_index = 0
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
        self.db_manager = get_database_manager()
        
        # Agent 系统提示词
        self.system_prompt = """你是一个智能的QQ机器人助手。你需要对用户的消息提供有用、友好、准确的回复。

特点：
- 回复要简洁明了，避免过长
- 保持友好和礼貌的语调
- 如果遇到问题或不确定的内容，要诚实回答
- 可以进行日常对话、回答问题、提供建议等
- 回复要符合中文习惯表达

请根据用户的消息内容，提供合适的回复。"""

    def _setup_logger(self) -> logging.Logger:
        """设置日志记录器"""
        logger = logging.getLogger('gemini_agent')
        logger.setLevel(logging.INFO)
        
        if not logger.handlers:
            # Console handler
            console_handler = logging.StreamHandler()
            
            # File handler with new log structure
            import os
            log_dir = "../logs/gemini"
            os.makedirs(log_dir, exist_ok=True)
            
            today = datetime.now().strftime("%Y-%m-%d")
            log_file = os.path.join(log_dir, f"gemini_{today}.log")
            file_handler = logging.FileHandler(log_file, encoding='utf-8')
            
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            
            console_handler.setFormatter(formatter)
            file_handler.setFormatter(formatter)
            
            logger.addHandler(console_handler)
            logger.addHandler(file_handler)
        
        return logger

    def _load_api_keys(self, config_path: str) -> List[str]:
        """从配置文件加载API密钥"""
        api_keys = []
        
        try:
            # 构建绝对路径
            script_dir = os.path.dirname(os.path.abspath(__file__))
            full_path = os.path.join(script_dir, config_path)
            
            # 直接解析.properties文件格式
            with open(full_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                for line in lines:
                    line = line.strip()
                    if line and 'token=' in line and not line.startswith('#'):
                        # 解析 key=value 格式
                        parts = line.split('=', 1)
                        if len(parts) == 2 and parts[0].strip().endswith('.token'):
                            token = parts[1].strip()
                            if token and token not in api_keys:
                                api_keys.append(token)
                                self.logger.info(f"Loaded token for: {parts[0].strip()}")
            
            self.logger.info(f"Successfully loaded {len(api_keys)} API keys")
            return api_keys
            
        except Exception as e:
            self.logger.error(f"Failed to load API keys: {e}")
            return []

    def load_conversations_from_db(self, limit: int = 100):
        """从数据库加载对话历史"""
        try:
            conversations = self.db_manager.get_conversations(limit=limit)
            self.logger.info(f"Loaded {len(conversations)} conversation records from database")
            return conversations
        except Exception as e:
            self.logger.error(f"Error loading conversation history from database: {e}")
            return []

    def save_conversation_to_db(self, conversation_data: Dict[str, Any]) -> bool:
        """保存对话历史到数据库"""
        try:
            return self.db_manager.save_conversation(conversation_data)
        except Exception as e:
            self.logger.error(f"Error saving conversation to database: {e}")
            return False

    def add_conversation_record(self, user_id: int, user_message: str, ai_response: str, response_time: float, raw_request: str = None, raw_response: str = None, message_id: str = None, reply_to_message_id: str = None, reply_to_text: str = None):
        """添加对话记录到数据库"""
        conv_id = f"conv_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        
        conversation_data = {
            'id': conv_id,
            'user_id': user_id,
            'user_message': user_message,
            'ai_response': ai_response,
            'timestamp': datetime.now(),
            'response_time': response_time,
            'model_name': 'gemini-2.5-flash',
            'raw_request': raw_request,
            'raw_response': raw_response,
            'message_id': message_id,
            'reply_to_message_id': reply_to_message_id,
            'reply_to_text': reply_to_text
        }
        
        success = self.save_conversation_to_db(conversation_data)
        if success:
            self.logger.info(f"Added conversation record {conv_id} to database with raw LLM data")
        else:
            self.logger.error(f"Failed to save conversation record {conv_id}")

    def get_conversations(self, user_id: Optional[int] = None, limit: Optional[int] = 50) -> List[Dict[str, Any]]:
        """从数据库获取对话记录"""
        try:
            return self.db_manager.get_conversations(user_id=user_id, limit=limit)
        except Exception as e:
            self.logger.error(f"Error getting conversations from database: {e}")
            return []

    def clear_conversations(self) -> int:
        """从数据库清空对话历史，返回清空的记录数"""
        try:
            # Get current count before clearing
            current_conversations = self.db_manager.get_conversations(limit=10000)
            count = len(current_conversations)
            
            # Clear all conversations
            cleared_count = self.db_manager.clear_conversations()
            
            self.logger.info(f"Cleared {cleared_count} conversation records from database")
            return cleared_count
        except Exception as e:
            self.logger.error(f"Error clearing conversations from database: {e}")
            return 0

    def _get_current_api_key(self) -> Optional[str]:
        """获取当前API密钥"""
        if not self.api_keys:
            return None
        return self.api_keys[self.current_key_index % len(self.api_keys)]

    def _rotate_api_key(self):
        """轮换到下一个API密钥"""
        if len(self.api_keys) > 1:
            self.current_key_index = (self.current_key_index + 1) % len(self.api_keys)
            self.logger.info(f"Rotated to API key index: {self.current_key_index}")

    def _prepare_request_payload(self, message: str, context: str = "") -> Dict[str, Any]:
        """准备请求载荷"""
        prompt_text = f"{self.system_prompt}\n\n"
        if context:
            prompt_text += f"{context}"
        prompt_text += f"用户消息: {message}"
        
        return {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": prompt_text}
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.7,
                "topK": 40,
                "topP": 0.95,
                "maxOutputTokens": 1000,
                "stopSequences": []
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

    async def generate_response(self, message: str, user_id: Optional[int] = None, max_retries: int = 3, context: str = "", message_id: str = None, reply_to_message_id: str = None, reply_to_text: str = None) -> str:
        """生成智能回复"""
        start_time = datetime.now()
        raw_request = None
        raw_response = None
        
        if not self.api_keys:
            return "抱歉，Agent服务暂时不可用，请稍后再试。"

        for attempt in range(max_retries):
            try:
                api_key = self._get_current_api_key()
                if not api_key:
                    return "API密钥配置错误"

                url = f"{self.base_url}?key={api_key}"
                payload = self._prepare_request_payload(message, context)
                raw_request = json.dumps(payload, ensure_ascii=False, indent=2)
                
                headers = {
                    'Content-Type': 'application/json',
                    'User-Agent': 'QQ-Bot-Gemini-Agent/1.0'
                }

                self.logger.info(f"Sending request to Gemini API (attempt {attempt + 1})")
                
                response = requests.post(
                    url, 
                    json=payload, 
                    headers=headers, 
                    timeout=30
                )
                
                raw_response = response.text

                if response.status_code == 200:
                    data = response.json()
                    
                    if 'candidates' in data and data['candidates']:
                        candidate = data['candidates'][0]
                        
                        # 检查finishReason
                        finish_reason = candidate.get('finishReason', '')
                        if finish_reason in ['SAFETY', 'RECITATION']:
                            self.logger.warning(f"Response blocked due to {finish_reason}")
                            return "抱歉，无法回复此消息。请尝试换个话题。"
                        
                        if 'content' in candidate and 'parts' in candidate['content']:
                            parts = candidate['content']['parts']
                            response_text = ""
                            
                            # 遍历所有parts，寻找text内容
                            for part in parts:
                                if 'text' in part:
                                    response_text = part['text'].strip()
                                    break
                                elif 'functionCall' in part:
                                    # 如果是function call，记录但继续寻找text
                                    self.logger.debug(f"Function call detected: {part['functionCall']['name']}")
                                    continue
                            
                            if response_text:
                                # 记录对话历史
                                if user_id:
                                    response_time = (datetime.now() - start_time).total_seconds()
                                    self.add_conversation_record(user_id, message, response_text, response_time, raw_request, raw_response, message_id, reply_to_message_id, reply_to_text)
                                
                                self.logger.info(f"Generated response: {response_text[:100]}...")
                                return response_text
                            else:
                                self.logger.warning(f"No text content found in response parts, finish_reason: {finish_reason}")
                                return "我理解了你的消息，但暂时无法给出合适的回复。"
                        else:
                            self.logger.warning(f"No content/parts in candidate, finish_reason: {finish_reason}")
                    
                    return "收到了你的消息，但生成回复时遇到了一些问题。"

                elif response.status_code == 400:
                    self.logger.error(f"Bad request: {response.text}")
                    return "请求格式有误，请稍后再试。"
                    
                elif response.status_code == 403:
                    self.logger.warning(f"API key may be invalid, rotating keys")
                    self._rotate_api_key()
                    continue
                    
                elif response.status_code == 429:
                    self.logger.warning(f"Rate limit exceeded, rotating keys")
                    self._rotate_api_key()
                    continue
                    
                else:
                    self.logger.error(f"API request failed: {response.status_code} - {response.text}")
                    
            except requests.exceptions.Timeout:
                self.logger.error(f"Request timeout on attempt {attempt + 1}")
                
            except requests.exceptions.ConnectionError:
                self.logger.error(f"Connection error on attempt {attempt + 1}")
                
            except Exception as e:
                self.logger.error(f"Unexpected error on attempt {attempt + 1}: {e}")

            if attempt < max_retries - 1:
                self._rotate_api_key()

        return "抱歉，当前无法处理你的消息，请稍后再试。"

    def is_available(self) -> bool:
        """检查Agent是否可用"""
        return len(self.api_keys) > 0


# 全局Agent实例
gemini_agent = None

def get_gemini_agent() -> GeminiAgent:
    """获取全局Gemini Agent实例"""
    global gemini_agent
    if gemini_agent is None:
        gemini_agent = GeminiAgent()
    return gemini_agent


async def process_message_with_agent(message: str, user_id: Optional[int] = None) -> str:
    """使用Agent处理消息"""
    agent = get_gemini_agent()
    if not agent.is_available():
        return "AI助手暂时不可用，稍后会恢复正常。"
    
    return await agent.generate_response(message, user_id)

async def process_message_with_agent_context(message: str, user_id: Optional[int] = None, context: str = "", message_id: str = None, reply_to_message_id: str = None, reply_to_text: str = None) -> str:
    """使用Agent处理带上下文的消息"""
    agent = get_gemini_agent()
    if not agent.is_available():
        return "AI助手暂时不可用，稍后会恢复正常。"
    
    return await agent.generate_response(message, user_id, context=context, message_id=message_id, reply_to_message_id=reply_to_message_id, reply_to_text=reply_to_text)


if __name__ == "__main__":
    # 测试代码
    import asyncio
    
    async def test_agent():
        agent = GeminiAgent()
        
        if not agent.is_available():
            print("Agent not available - no API keys loaded")
            return
            
        test_message = "你好，请介绍一下自己"
        response = await agent.generate_response(test_message)
        print(f"Test message: {test_message}")
        print(f"Agent response: {response}")

    asyncio.run(test_agent())