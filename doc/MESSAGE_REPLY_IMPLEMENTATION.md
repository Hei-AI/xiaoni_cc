# 消息引用回复实现指南
## 基于OneBot 11协议的Session链追溯

### 1. OneBot消息引用协议分析

#### 1.1 接收引用消息的格式
当用户引用回复Bot消息时，接收到的消息格式：

```json
{
  "post_type": "message",
  "message_type": "private",
  "sub_type": "friend", 
  "user_id": 85178516,
  "message_id": 987654321,
  "message": [
    {
      "type": "reply",
      "data": {
        "id": "123456789"  // 被引用的消息ID（Bot之前发送的消息）
      }
    },
    {
      "type": "text",
      "data": {
        "text": "继续刚才的话题，我需要添加更多功能"
      }
    }
  ],
  "raw_message": "[CQ:reply,id=123456789]继续刚才的话题，我需要添加更多功能",
  "time": 1693747200
}
```

#### 1.2 发送引用回复的格式
Bot回复时引用用户消息：

```json
{
  "action": "send_private_msg",
  "params": {
    "user_id": 85178516,
    "message": [
      {
        "type": "reply",
        "data": {
          "id": "987654321"  // 引用用户刚发的消息ID
        }
      },
      {
        "type": "text",
        "data": {
          "text": "好的，我理解你要继续之前的需求讨论。让我查看上下文..."
        }
      }
    ]
  }
}
```

### 2. 数据库设计优化

#### 2.1 核心表结构
```sql
-- 消息存储（扩展现有conversations表）
ALTER TABLE conversations ADD COLUMN message_id VARCHAR(50) UNIQUE;
ALTER TABLE conversations ADD COLUMN reply_to_message_id VARCHAR(50);  
ALTER TABLE conversations ADD COLUMN session_id VARCHAR(100);
ALTER TABLE conversations ADD COLUMN message_segments JSON;

-- Session追溯表
CREATE TABLE message_reply_chain (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(50) NOT NULL,
    reply_to_message_id VARCHAR(50),
    user_id BIGINT NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    depth INT DEFAULT 0,  -- 引用链深度
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_message (message_id),
    KEY idx_reply_chain (reply_to_message_id),
    KEY idx_session (session_id),
    KEY idx_user_session (user_id, session_id)
);

-- Session元数据
CREATE TABLE conversation_sessions (
    session_id VARCHAR(100) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    root_message_id VARCHAR(50),  -- Session起始消息
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_count INT DEFAULT 0,
    context_summary TEXT,
    status ENUM('active', 'completed', 'abandoned') DEFAULT 'active'
);
```

#### 2.2 索引优化
```sql
-- 快速引用链查询
CREATE INDEX idx_reply_lookup ON message_reply_chain (reply_to_message_id, session_id);

-- Session活跃度查询  
CREATE INDEX idx_session_activity ON conversation_sessions (user_id, last_activity DESC);

-- 消息ID快速查找
CREATE INDEX idx_conversations_message_id ON conversations (message_id);
```

### 3. 核心实现代码

#### 3.1 消息解析器
```python
import json
import re
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

@dataclass
class ReplyInfo:
    """回复信息"""
    reply_to_message_id: str
    original_text: str
    segments: List[Dict[str, Any]]

@dataclass  
class SessionContext:
    """Session上下文"""
    session_id: str
    depth: int
    root_message_id: str
    history_summary: str = ""

class MessageReplyParser:
    """消息引用解析器"""
    
    def extract_reply_info(self, message_data: dict) -> Optional[ReplyInfo]:
        """提取消息引用信息"""
        
        message = message_data.get('message', [])
        if not isinstance(message, list):
            return None
            
        # 查找reply类型的消息段
        reply_segment = None
        text_segments = []
        
        for segment in message:
            if segment.get('type') == 'reply':
                reply_segment = segment
            elif segment.get('type') == 'text':
                text_segments.append(segment.get('data', {}).get('text', ''))
        
        if not reply_segment:
            return None
            
        reply_to_id = reply_segment.get('data', {}).get('id')
        if not reply_to_id:
            return None
            
        return ReplyInfo(
            reply_to_message_id=str(reply_to_id),
            original_text=''.join(text_segments),
            segments=message
        )
    
    def extract_reply_from_raw_message(self, raw_message: str) -> Optional[str]:
        """从raw_message中提取引用ID（备用方法）"""
        
        # 匹配 [CQ:reply,id=123456789] 格式
        pattern = r'\[CQ:reply,id=(\d+)\]'
        match = re.search(pattern, raw_message)
        
        if match:
            return match.group(1)
            
        return None

class SessionChainTracker:
    """Session链追溯器"""
    
    def __init__(self, db_manager):
        self.db = db_manager
        
    async def trace_session_chain(self, reply_to_message_id: str) -> Optional[SessionContext]:
        """追溯Session链"""
        
        # 1. 查找被引用消息的Session信息
        query = """
        SELECT session_id, depth, root_message_id 
        FROM message_reply_chain 
        WHERE message_id = %s
        """
        
        result = await self.db.execute_query(query, [reply_to_message_id])
        
        if not result:
            # 检查conversations表（兼容现有数据）
            conv_query = """
            SELECT session_id FROM conversations 
            WHERE message_id = %s AND session_id IS NOT NULL
            """
            conv_result = await self.db.execute_query(conv_query, [reply_to_message_id])
            
            if conv_result:
                return SessionContext(
                    session_id=conv_result[0][0],
                    depth=0,
                    root_message_id=reply_to_message_id
                )
            return None
            
        session_id, depth, root_message_id = result[0]
        
        return SessionContext(
            session_id=session_id,
            depth=depth + 1,  # 新消息的深度+1
            root_message_id=root_message_id
        )
    
    async def create_or_extend_session(self, message_id: str, user_id: int, 
                                       reply_info: ReplyInfo) -> SessionContext:
        """创建或扩展Session"""
        
        # 1. 追溯现有Session
        existing_context = await self.trace_session_chain(reply_info.reply_to_message_id)
        
        if existing_context:
            # 扩展现有Session
            session_id = existing_context.session_id
            depth = existing_context.depth
            root_message_id = existing_context.root_message_id
        else:
            # 创建新Session
            session_id = f"session_{user_id}_{reply_info.reply_to_message_id}_{int(time.time())}"
            depth = 1
            root_message_id = reply_info.reply_to_message_id
            
            # 创建Session记录
            await self._create_session_record(session_id, user_id, root_message_id)
        
        # 2. 记录消息链关系
        await self._record_message_chain(
            message_id=message_id,
            reply_to_message_id=reply_info.reply_to_message_id,
            user_id=user_id,
            session_id=session_id,
            depth=depth
        )
        
        # 3. 更新Session活跃度
        await self._update_session_activity(session_id)
        
        return SessionContext(
            session_id=session_id,
            depth=depth,
            root_message_id=root_message_id
        )
    
    async def _create_session_record(self, session_id: str, user_id: int, 
                                     root_message_id: str):
        """创建Session记录"""
        query = """
        INSERT INTO conversation_sessions 
        (session_id, user_id, root_message_id, message_count, status)
        VALUES (%s, %s, %s, 1, 'active')
        ON DUPLICATE KEY UPDATE last_activity = CURRENT_TIMESTAMP
        """
        await self.db.execute_update(query, [session_id, user_id, root_message_id])
    
    async def _record_message_chain(self, message_id: str, reply_to_message_id: str,
                                    user_id: int, session_id: str, depth: int):
        """记录消息链关系"""
        query = """
        INSERT INTO message_reply_chain 
        (message_id, reply_to_message_id, user_id, session_id, depth)
        VALUES (%s, %s, %s, %s, %s)
        """
        await self.db.execute_update(query, [message_id, reply_to_message_id, 
                                           user_id, session_id, depth])
    
    async def _update_session_activity(self, session_id: str):
        """更新Session活跃度"""
        query = """
        UPDATE conversation_sessions 
        SET last_activity = CURRENT_TIMESTAMP, 
            message_count = message_count + 1
        WHERE session_id = %s
        """
        await self.db.execute_update(query, [session_id])

class SessionHistoryManager:
    """Session历史管理器"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    async def get_session_context(self, session_id: str, limit: int = 10) -> List[dict]:
        """获取Session上下文历史"""
        
        query = """
        SELECT c.user_message, c.bot_response, c.created_at, c.message_id,
               mrc.depth, c.user_id
        FROM message_reply_chain mrc
        JOIN conversations c ON mrc.message_id = c.message_id
        WHERE mrc.session_id = %s
        ORDER BY mrc.depth ASC, c.created_at ASC
        LIMIT %s
        """
        
        result = await self.db.execute_query(query, [session_id, limit])
        
        history = []
        for row in result:
            history.append({
                'user_message': row[0],
                'bot_response': row[1],
                'timestamp': row[2],
                'message_id': row[3],
                'depth': row[4],
                'user_id': row[5]
            })
        
        return history
    
    async def generate_session_summary(self, session_id: str) -> str:
        """生成Session摘要"""
        
        history = await self.get_session_context(session_id, limit=20)
        
        if not history:
            return "空Session"
            
        # 构建对话摘要
        conversation_text = []
        for item in history:
            if item['user_message']:
                conversation_text.append(f"用户: {item['user_message']}")
            if item['bot_response']:
                conversation_text.append(f"机器人: {item['bot_response']}")
        
        # 这里可以集成LLM生成摘要，暂时返回简单摘要
        return f"Session包含{len(history)}轮对话，起始于{history[0]['timestamp']}"
```

### 4. 消息处理集成

#### 4.1 主消息处理器
```python
class EnhancedMessageProcessor:
    """增强的消息处理器（支持Session）"""
    
    def __init__(self, db_manager, websocket_client):
        self.db = db_manager
        self.websocket_client = websocket_client
        self.reply_parser = MessageReplyParser()
        self.session_tracker = SessionChainTracker(db_manager)
        self.history_manager = SessionHistoryManager(db_manager)
    
    async def process_private_message(self, data: dict):
        """处理私聊消息（支持引用Session）"""
        
        user_id = data.get('user_id')
        message_id = str(data.get('message_id'))
        raw_message = data.get('raw_message', '')
        
        # 1. 检查是否为引用回复
        reply_info = self.reply_parser.extract_reply_info(data)
        session_context = None
        
        if reply_info:
            # 处理引用回复
            session_context = await self.session_tracker.create_or_extend_session(
                message_id, user_id, reply_info
            )
            
            logger.info(f"Session引用回复: {session_context.session_id}, 深度: {session_context.depth}")
        
        # 2. 存储消息（扩展现有逻辑）
        await self._store_message_with_session(
            user_id=user_id,
            message_id=message_id,
            user_message=raw_message,
            reply_info=reply_info,
            session_context=session_context
        )
        
        # 3. 业务处理（需求识别、AI对话等）
        if session_context:
            await self._process_with_session_context(data, session_context)
        else:
            await self._process_as_new_conversation(data)
    
    async def _store_message_with_session(self, user_id: int, message_id: str,
                                          user_message: str, reply_info: Optional[ReplyInfo],
                                          session_context: Optional[SessionContext]):
        """存储消息（带Session信息）"""
        
        # 构建扩展的消息数据
        session_id = session_context.session_id if session_context else None
        reply_to_id = reply_info.reply_to_message_id if reply_info else None
        message_segments = json.dumps(reply_info.segments) if reply_info else None
        
        query = """
        INSERT INTO conversations 
        (user_id, user_message, message_id, reply_to_message_id, session_id, 
         message_segments, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        """
        
        await self.db.execute_update(query, [
            user_id, user_message, message_id, reply_to_id, session_id, message_segments
        ])
    
    async def _process_with_session_context(self, data: dict, session_context: SessionContext):
        """带Session上下文的处理"""
        
        # 1. 获取Session历史
        history = await self.history_manager.get_session_context(
            session_context.session_id
        )
        
        # 2. 构建上下文提示
        context_prompt = self._build_context_prompt(data, history)
        
        # 3. 调用相应的业务处理器
        user_id = data.get('user_id')
        
        if user_id == BOT_CONFIG["authorized_user_id"]:
            # 需求管理（带上下文）
            await self._handle_requirement_with_context(data, session_context, context_prompt)
        else:
            # AI对话（带上下文）
            await self._handle_chat_with_context(data, session_context, context_prompt)
    
    def _build_context_prompt(self, data: dict, history: List[dict]) -> str:
        """构建上下文提示"""
        
        current_message = data.get('raw_message', '')
        
        context_lines = ["=== 对话上下文 ==="]
        for item in history[-5:]:  # 最近5轮对话
            if item['user_message']:
                context_lines.append(f"用户: {item['user_message']}")
            if item['bot_response']:
                context_lines.append(f"机器人: {item['bot_response']}")
        
        context_lines.extend([
            "=== 当前消息 ===",
            f"用户: {current_message}",
            "",
            "请基于以上对话上下文进行回复。"
        ])
        
        return '\n'.join(context_lines)

class ReplyMessageSender:
    """引用回复发送器"""
    
    def __init__(self, websocket_client, db_manager):
        self.websocket_client = websocket_client
        self.db = db_manager
    
    async def send_reply_with_reference(self, user_id: int, reply_content: str,
                                        reference_message_id: str, 
                                        session_id: str = None) -> dict:
        """发送引用回复"""
        
        # 1. 构建引用回复消息
        message_data = {
            "action": "send_private_msg",
            "params": {
                "user_id": user_id,
                "message": [
                    {
                        "type": "reply",
                        "data": {
                            "id": reference_message_id
                        }
                    },
                    {
                        "type": "text",
                        "data": {
                            "text": reply_content
                        }
                    }
                ]
            }
        }
        
        # 2. 发送消息
        response = await self.websocket_client.send_message(message_data)
        
        if response.get('status') == 'ok':
            # 3. 记录Bot回复
            bot_message_id = response.get('data', {}).get('message_id')
            
            await self._store_bot_reply(
                user_id=user_id,
                message_id=str(bot_message_id),
                reply_content=reply_content,
                reference_message_id=reference_message_id,
                session_id=session_id
            )
        
        return response
    
    async def _store_bot_reply(self, user_id: int, message_id: str, 
                               reply_content: str, reference_message_id: str,
                               session_id: str = None):
        """存储Bot回复"""
        
        query = """
        UPDATE conversations 
        SET bot_response = %s, responded_at = NOW()
        WHERE message_id = %s
        """
        await self.db.execute_update(query, [reply_content, reference_message_id])
        
        # 如果有Session，也记录到reply_chain表
        if session_id:
            chain_query = """
            INSERT INTO message_reply_chain 
            (message_id, reply_to_message_id, user_id, session_id, depth)
            SELECT %s, %s, %s, %s, depth + 1
            FROM message_reply_chain 
            WHERE message_id = %s
            """
            await self.db.execute_update(chain_query, [
                message_id, reference_message_id, user_id, session_id, reference_message_id
            ])
```

### 5. 使用示例

#### 5.1 集成到现有系统
```python
# 在 main.py 中集成
class QQBotWithSessionSupport:
    
    def __init__(self):
        self.message_processor = EnhancedMessageProcessor(
            self.db_manager, 
            self.websocket_client
        )
        self.reply_sender = ReplyMessageSender(
            self.websocket_client,
            self.db_manager
        )
    
    async def handle_private_message(self, data):
        """处理私聊消息（增强版）"""
        await self.message_processor.process_private_message(data)
    
    async def send_contextual_reply(self, user_id: int, content: str,
                                    reference_message_id: str):
        """发送上下文回复"""
        return await self.reply_sender.send_reply_with_reference(
            user_id, content, reference_message_id
        )
```

这个实现提供了完整的消息引用Session管理，用户可以通过引用回复来延续对话上下文，系统能够准确识别和追溯对话链。