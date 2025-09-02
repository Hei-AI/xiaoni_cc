# Session管理与业务流程分离设计

## 1. 整体业务流程架构

```
用户85178516私聊消息 → Session路由中心 → 业务服务分发
                        ↓
                   [Session Manager]
                        ↓
            ┌─────────────┴─────────────┐
            ↓                          ↓
    [Chat Session]              [Requirement Session]
    持续对话管理                    开发任务管理
```

## 2. 消息分类处理机制

### 2.1 智能路由决策流程

```python
# 消息接收后的处理流程
def route_user_message(user_id, message, context):
    # 1. 检查现有Session状态
    current_session = SessionManager.get_active_session(user_id)
    
    # 2. Session延续判断
    if current_session and is_continuation(message, current_session):
        return route_to_existing_session(current_session, message)
    
    # 3. 新Session类型判断
    intent = analyze_message_intent(message, context)
    
    # 4. 用户确认机制（模糊情况）
    if intent.confidence < THRESHOLD:
        return request_user_clarification(user_id, intent)
    
    # 5. 创建新Session并路由
    return create_new_session(user_id, intent.type, message)
```

### 2.2 意图分析算法

```python
class MessageIntentAnalyzer:
    def analyze_intent(self, message, session_context):
        """
        综合分析消息意图
        - 关键词匹配权重: 30%
        - 上下文相关性: 40% 
        - AI语义分析: 30%
        """
        
        # 关键词分析
        keyword_score = self.keyword_analysis(message)
        
        # 上下文分析
        context_score = self.context_analysis(message, session_context)
        
        # AI语义分析
        semantic_score = self.ai_semantic_analysis(message)
        
        # 综合评分
        final_score = (
            keyword_score * 0.3 + 
            context_score * 0.4 + 
            semantic_score * 0.3
        )
        
        return IntentResult(
            type="requirement" if final_score > 0.6 else "chat",
            confidence=final_score,
            keywords=self.extract_keywords(message)
        )
```

## 3. Session管理架构设计

### 3.1 多层级Session结构

```python
# 全局Session - 跨服务状态
class GlobalSession:
    session_id: str
    user_id: int
    start_time: datetime
    last_activity: datetime
    session_type: SessionType  # CHAT, REQUIREMENT, MIXED
    active_service: str
    context: Dict[str, Any]

# 服务Session - 特定服务内状态  
class ServiceSession:
    service_session_id: str
    global_session_id: str
    service_name: str
    conversation_history: List[Message]
    service_context: Dict[str, Any]
    
# 任务Session - 具体任务执行
class TaskSession:
    task_session_id: str
    service_session_id: str
    task_type: str
    task_status: TaskStatus
    execution_log: List[TaskStep]
```

### 3.2 Session生命周期管理

```python
class SessionManager:
    def create_session(self, user_id, session_type, initial_message):
        """创建新Session"""
        global_session = GlobalSession(
            session_id=generate_session_id(),
            user_id=user_id,
            session_type=session_type,
            start_time=datetime.now(),
            active_service=self.get_service_for_type(session_type)
        )
        
        # 保存到数据库
        self.db.save_global_session(global_session)
        
        # 通知相关服务
        self.notify_service(global_session.active_service, global_session)
        
        return global_session
    
    def get_active_session(self, user_id):
        """获取用户当前活跃Session"""
        return self.db.get_active_session(user_id)
    
    def switch_session_service(self, session_id, new_service):
        """Session服务切换"""
        session = self.db.get_session(session_id)
        
        # 通知旧服务Session暂停
        self.notify_service(session.active_service, "pause", session)
        
        # 切换到新服务
        session.active_service = new_service
        self.db.update_session(session)
        
        # 通知新服务Session激活
        self.notify_service(new_service, "activate", session)
```

## 4. 持续对话区分机制

### 4.1 对话连续性判断

```python
class ConversationContinuityDetector:
    def is_continuation(self, message, current_session):
        """
        判断消息是否为当前对话的延续
        """
        # 时间窗口检查 (5分钟内)
        time_gap = datetime.now() - current_session.last_activity
        if time_gap.total_seconds() > 300:
            return False
        
        # 上下文相关性检查
        context_relevance = self.calculate_context_relevance(
            message, current_session.context
        )
        
        # 意图一致性检查
        message_intent = self.analyze_intent(message)
        session_intent = current_session.session_type
        
        return (
            context_relevance > 0.7 and 
            message_intent == session_intent
        )
    
    def detect_session_switch_intent(self, message):
        """
        检测用户是否想切换Session类型
        """
        switch_keywords = [
            "换个话题", "现在聊聊", "帮我开发", "我想要实现", 
            "回到刚才", "继续之前的", "切换到"
        ]
        
        for keyword in switch_keywords:
            if keyword in message:
                return True
        
        return False
```

### 4.2 用户确认机制

```python
class SessionConfirmationHandler:
    def request_clarification(self, user_id, intent_analysis):
        """
        当意图不明确时请求用户确认
        """
        if intent_analysis.confidence < 0.6:
            clarification_message = self.generate_clarification_message(
                intent_analysis
            )
            
            # 发送确认消息
            self.message_client.send_private_message(
                user_id, clarification_message
            )
            
            # 设置等待确认状态
            self.set_waiting_confirmation(user_id, intent_analysis)
    
    def generate_clarification_message(self, intent_analysis):
        """生成确认消息"""
        if intent_analysis.type == "requirement":
            return (
                f"🤔 我理解您可能想要进行开发工作，"
                f"关键词：{', '.join(intent_analysis.keywords)}\n\n"
                f"请确认：\n"
                f"1. 💻 是的，我要进行开发/修改功能\n"
                f"2. 💬 不是，我只是想聊天讨论"
            )
        else:
            return (
                f"🤔 我理解您想要聊天讨论，但检测到一些技术关键词。\n\n"
                f"请确认：\n" 
                f"1. 💬 是的，我只是想聊天\n"
                f"2. 💻 其实我想要开发功能"
            )
```

## 5. 完整Session审计系统

### 5.1 多层级日志记录

```python
class SessionAuditLogger:
    def log_session_event(self, session_id, event_type, data):
        """记录Session级别事件"""
        audit_log = SessionAuditLog(
            session_id=session_id,
            event_type=event_type,
            timestamp=datetime.now(),
            data=data,
            trace_id=generate_trace_id()
        )
        self.db.save_audit_log(audit_log)
    
    def log_llm_interaction(self, session_id, llm_request, llm_response):
        """记录LLM交互详情"""
        llm_log = LLMInteractionLog(
            session_id=session_id,
            request_data=llm_request,
            response_data=llm_response,
            model_used=llm_request.model,
            tokens_used=llm_response.usage,
            timestamp=datetime.now()
        )
        self.db.save_llm_log(llm_log)
    
    def log_service_call(self, session_id, from_service, to_service, call_data):
        """记录服务间调用"""
        service_log = ServiceCallLog(
            session_id=session_id,
            from_service=from_service,
            to_service=to_service,
            call_data=call_data,
            timestamp=datetime.now()
        )
        self.db.save_service_log(service_log)
```

### 5.2 Session查询和分析

```python
class SessionAnalyzer:
    def get_complete_session_trace(self, session_id):
        """获取完整Session轨迹"""
        session = self.db.get_session(session_id)
        audit_logs = self.db.get_session_audit_logs(session_id)
        llm_logs = self.db.get_session_llm_logs(session_id)
        service_logs = self.db.get_session_service_logs(session_id)
        
        return SessionTrace(
            session=session,
            events=audit_logs,
            llm_interactions=llm_logs,
            service_calls=service_logs,
            timeline=self.build_timeline(audit_logs, llm_logs, service_logs)
        )
    
    def analyze_session_performance(self, session_id):
        """分析Session性能和效果"""
        trace = self.get_complete_session_trace(session_id)
        
        return SessionAnalysisReport(
            session_duration=trace.session.duration,
            message_count=len(trace.events),
            llm_calls=len(trace.llm_interactions),
            total_tokens=sum(log.tokens_used for log in trace.llm_interactions),
            service_switches=len([e for e in trace.events if e.event_type == "service_switch"]),
            completion_status=trace.session.status
        )
```

## 6. 数据库Schema设计

```sql
-- 全局Session表
CREATE TABLE global_sessions (
    session_id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    session_type ENUM('chat', 'requirement', 'mixed'),
    active_service VARCHAR(50),
    start_time DATETIME,
    last_activity DATETIME,
    end_time DATETIME,
    status ENUM('active', 'paused', 'completed', 'aborted'),
    context JSON
);

-- Session审计日志表
CREATE TABLE session_audit_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(64),
    event_type VARCHAR(50),
    timestamp DATETIME,
    data JSON,
    trace_id VARCHAR(64),
    INDEX idx_session_time (session_id, timestamp)
);

-- LLM交互日志表
CREATE TABLE llm_interaction_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(64),
    model_used VARCHAR(50),
    request_data JSON,
    response_data JSON,
    tokens_used INT,
    duration_ms INT,
    timestamp DATETIME
);

-- 服务调用日志表
CREATE TABLE service_call_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(64),
    from_service VARCHAR(50),
    to_service VARCHAR(50),
    call_data JSON,
    response_data JSON,
    duration_ms INT,
    timestamp DATETIME
);
```

## 7. 实现优先级

1. **Phase 1**: Session路由中心和基础Session管理
2. **Phase 2**: 意图分析和用户确认机制  
3. **Phase 3**: 完整审计日志系统
4. **Phase 4**: Session分析和性能监控

这个设计确保了：
- 智能的业务流程分离
- 完整的对话上下文管理
- 详细的审计追踪能力
- 灵活的Session切换机制