# 异步事件消费架构设计

## 核心问题

QQ Bot服务器会接收到源源不断的消息事件，包括：
- 用户私聊消息
- 群聊消息
- 系统通知
- 好友请求
- 群变动通知

**关键挑战**：这些消息不都需要处理，应该由各服务自主决定是否消费，避免阻塞主事件循环。

## 1. 事件驱动架构设计

### 1.1 整体事件流

```
OneBot WebSocket → Event Bus → Service Filters → Async Consumers
     │                │              │               │
     ▼                ▼              ▼               ▼
  原始消息        消息分发器      服务过滤器      异步处理器
```

### 1.2 核心组件

```python
# 事件总线 - 基于Redis Streams实现
class EventBus:
    def __init__(self, redis_client):
        self.redis = redis_client
        self.stream_name = "qq_bot_events"
        
    async def publish_event(self, event: QQEvent):
        """发布事件到总线"""
        event_data = {
            "event_id": event.id,
            "event_type": event.type,
            "user_id": str(event.user_id) if event.user_id else "",
            "group_id": str(event.group_id) if event.group_id else "",
            "raw_data": json.dumps(event.raw_data),
            "timestamp": event.timestamp.isoformat()
        }
        
        await self.redis.xadd(self.stream_name, event_data)
        
    async def create_consumer_group(self, group_name: str):
        """创建消费者组"""
        try:
            await self.redis.xgroup_create(
                self.stream_name, group_name, id='0', mkstream=True
            )
        except Exception:
            pass  # 组可能已存在

# 服务过滤器 - 每个服务定义自己感兴趣的事件
class ServiceEventFilter:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.filters = []
        
    def add_filter(self, filter_func):
        """添加过滤条件"""
        self.filters.append(filter_func)
        
    def should_consume(self, event: QQEvent) -> bool:
        """判断是否应该消费此事件"""
        return all(f(event) for f in self.filters)

# 异步消费者基类
class AsyncEventConsumer:
    def __init__(self, service_name: str, event_bus: EventBus):
        self.service_name = service_name
        self.event_bus = event_bus
        self.consumer_group = f"{service_name}_consumers"
        self.consumer_name = f"{service_name}_{os.getpid()}"
        self.filters = ServiceEventFilter(service_name)
        self.running = False
        
    async def start_consuming(self):
        """开始异步消费"""
        await self.event_bus.create_consumer_group(self.consumer_group)
        self.running = True
        
        asyncio.create_task(self._consume_loop())
        
    async def _consume_loop(self):
        """消费循环"""
        while self.running:
            try:
                # 从Redis Stream读取消息
                messages = await self.event_bus.redis.xreadgroup(
                    self.consumer_group,
                    self.consumer_name,
                    {self.event_bus.stream_name: '>'},
                    count=10,
                    block=1000  # 1秒超时
                )
                
                for stream, msgs in messages:
                    for msg_id, fields in msgs:
                        event = QQEvent.from_redis_data(fields)
                        
                        # 过滤检查
                        if self.filters.should_consume(event):
                            # 异步处理，不阻塞消费循环
                            asyncio.create_task(
                                self._handle_event_safe(event, msg_id)
                            )
                        else:
                            # 不感兴趣的事件直接ACK
                            await self._ack_message(msg_id)
                            
            except Exception as e:
                logger.error(f"Consumer {self.consumer_name} error: {e}")
                await asyncio.sleep(1)  # 错误恢复延迟
                
    async def _handle_event_safe(self, event: QQEvent, msg_id: str):
        """安全的事件处理"""
        try:
            # 实际业务处理
            await self.handle_event(event)
            
            # 处理成功后ACK
            await self._ack_message(msg_id)
            
        except Exception as e:
            logger.error(f"Handle event {event.id} error: {e}")
            # 可以选择重试或者直接ACK（取决于业务需求）
            await self._ack_message(msg_id)
    
    async def _ack_message(self, msg_id: str):
        """确认消息处理完成"""
        await self.event_bus.redis.xack(
            self.event_bus.stream_name,
            self.consumer_group,
            msg_id
        )
    
    async def handle_event(self, event: QQEvent):
        """子类实现具体的事件处理逻辑"""
        raise NotImplementedError
```

## 2. 各服务的过滤策略

### 2.1 Message Service 过滤器

```python
class MessageServiceConsumer(AsyncEventConsumer):
    def __init__(self, event_bus: EventBus):
        super().__init__("message_service", event_bus)
        
        # Message Service只关心发送相关的事件，不消费接收事件
        self.filters.add_filter(lambda e: e.type in [
            "send_message_request",
            "health_check",
            "service_status_request"
        ])
    
    async def handle_event(self, event: QQEvent):
        """Message Service事件处理"""
        if event.type == "send_message_request":
            await self._handle_send_request(event)
        elif event.type == "health_check":
            await self._handle_health_check(event)
```

### 2.2 Requirement Service 过滤器

```python
class RequirementServiceConsumer(AsyncEventConsumer):
    def __init__(self, event_bus: EventBus):
        super().__init__("requirement_service", event_bus)
        
        # 只处理来自授权用户的私聊消息
        self.filters.add_filter(lambda e: e.type == "message")
        self.filters.add_filter(lambda e: e.message_type == "private")
        self.filters.add_filter(lambda e: e.user_id == 85178516)  # 授权用户
        
        # 进一步过滤：只处理可能的需求消息
        self.filters.add_filter(self._is_potential_requirement)
        
    def _is_potential_requirement(self, event: QQEvent) -> bool:
        """初步判断是否可能是需求消息"""
        message = event.raw_data.get('raw_message', '').lower()
        
        # 快速关键词过滤
        requirement_signals = [
            '实现', '开发', '修改', '修复', '优化', '添加', '创建',
            '功能', '系统', '代码', 'claude', 'bug', '问题'
        ]
        
        return any(signal in message for signal in requirement_signals)
    
    async def handle_event(self, event: QQEvent):
        """需求服务事件处理"""
        # 进行完整的意图分析和Session管理
        await self.process_potential_requirement(event)
```

### 2.3 Chatbot Service 过滤器

```python
class ChatbotServiceConsumer(AsyncEventConsumer):
    def __init__(self, event_bus: EventBus):
        super().__init__("chatbot_service", event_bus)
        
        # 处理普通用户的私聊和@机器人的群聊
        self.filters.add_filter(lambda e: e.type == "message")
        self.filters.add_filter(self._should_handle_chat)
        
    def _should_handle_chat(self, event: QQEvent) -> bool:
        """判断是否应该处理聊天"""
        # 私聊：非授权用户的消息
        if event.message_type == "private":
            return event.user_id != 85178516
        
        # 群聊：@机器人的消息 且群聊功能开启
        elif event.message_type == "group":
            return (
                self.group_reply_enabled and 
                f"[CQ:at,qq=1129974489]" in event.raw_data.get('message', '') and
                (not self.allowed_groups or event.group_id in self.allowed_groups)
            )
        
        return False
    
    async def handle_event(self, event: QQEvent):
        """聊天服务事件处理"""
        if event.message_type == "private":
            await self.handle_private_chat(event)
        elif event.message_type == "group":
            await self.handle_group_chat(event)
```

## 3. 事件发布中心

### 3.1 WebSocket事件适配器

```python
class WebSocketEventAdapter:
    """WebSocket消息到事件总线的适配器"""
    
    def __init__(self, event_bus: EventBus):
        self.event_bus = event_bus
        
    async def handle_websocket_message(self, raw_message: str):
        """处理WebSocket原始消息"""
        try:
            data = json.loads(raw_message)
            
            # 转换为标准事件格式
            event = self._convert_to_event(data)
            
            # 发布到事件总线（非阻塞）
            asyncio.create_task(self.event_bus.publish_event(event))
            
        except Exception as e:
            logger.error(f"Failed to process websocket message: {e}")
    
    def _convert_to_event(self, data: dict) -> QQEvent:
        """转换OneBot数据为标准事件"""
        event_type = data.get('post_type', 'unknown')
        
        if event_type == 'message':
            return QQMessageEvent(
                id=generate_event_id(),
                type="message",
                timestamp=datetime.now(),
                message_type=data.get('message_type'),
                user_id=data.get('user_id'),
                group_id=data.get('group_id'),
                message_id=data.get('message_id'),
                raw_data=data
            )
        elif event_type == 'notice':
            return QQNoticeEvent(
                id=generate_event_id(),
                type="notice",
                timestamp=datetime.now(),
                notice_type=data.get('notice_type'),
                user_id=data.get('user_id'),
                group_id=data.get('group_id'),
                raw_data=data
            )
        else:
            return QQEvent(
                id=generate_event_id(),
                type=event_type,
                timestamp=datetime.now(),
                raw_data=data
            )
```

## 4. 性能与可靠性保证

### 4.1 背压控制

```python
class BackpressureController:
    """背压控制器"""
    
    def __init__(self, max_pending_tasks=1000):
        self.max_pending_tasks = max_pending_tasks
        self.pending_count = 0
        self.semaphore = asyncio.Semaphore(max_pending_tasks)
        
    async def execute_with_backpressure(self, coro):
        """带背压控制的任务执行"""
        async with self.semaphore:
            try:
                self.pending_count += 1
                return await coro
            finally:
                self.pending_count -= 1
    
    def is_overloaded(self) -> bool:
        """检查是否过载"""
        return self.pending_count > self.max_pending_tasks * 0.8

# 在消费者中使用背压控制
class BackpressureAwareConsumer(AsyncEventConsumer):
    def __init__(self, service_name: str, event_bus: EventBus):
        super().__init__(service_name, event_bus)
        self.backpressure = BackpressureController()
        
    async def _handle_event_safe(self, event: QQEvent, msg_id: str):
        """带背压控制的事件处理"""
        if self.backpressure.is_overloaded():
            logger.warning(f"Service {self.service_name} overloaded, skipping event")
            await self._ack_message(msg_id)  # 直接ACK以避免阻塞
            return
        
        await self.backpressure.execute_with_backpressure(
            self._process_event(event, msg_id)
        )
```

### 4.2 错误恢复与重试机制

```python
class ResilientEventConsumer(BackpressureAwareConsumer):
    def __init__(self, service_name: str, event_bus: EventBus):
        super().__init__(service_name, event_bus)
        self.retry_queue = asyncio.Queue()
        self.max_retries = 3
        
    async def start_consuming(self):
        """启动消费，包括重试处理器"""
        await super().start_consuming()
        asyncio.create_task(self._retry_processor())
        
    async def _retry_processor(self):
        """重试处理器"""
        while self.running:
            try:
                retry_item = await asyncio.wait_for(
                    self.retry_queue.get(), timeout=1.0
                )
                
                event, msg_id, retry_count = retry_item
                
                try:
                    await self.handle_event(event)
                    await self._ack_message(msg_id)
                except Exception as e:
                    if retry_count < self.max_retries:
                        # 指数退避重试
                        delay = 2 ** retry_count
                        await asyncio.sleep(delay)
                        await self.retry_queue.put((event, msg_id, retry_count + 1))
                    else:
                        logger.error(f"Event {event.id} failed after {self.max_retries} retries: {e}")
                        await self._ack_message(msg_id)  # 放弃重试
                        
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Retry processor error: {e}")
                await asyncio.sleep(1)
```

## 5. 监控与调试

### 5.1 事件流监控

```python
class EventFlowMonitor:
    """事件流监控器"""
    
    def __init__(self, event_bus: EventBus):
        self.event_bus = event_bus
        self.metrics = {
            'events_published': 0,
            'events_consumed': 0,
            'events_filtered': 0,
            'events_failed': 0,
            'consumer_lag': {}
        }
        
    async def start_monitoring(self):
        """启动监控"""
        asyncio.create_task(self._collect_metrics())
        
    async def _collect_metrics(self):
        """收集指标"""
        while True:
            try:
                # 检查消费者组状态
                groups_info = await self.event_bus.redis.xinfo_groups(
                    self.event_bus.stream_name
                )
                
                for group in groups_info:
                    group_name = group['name']
                    lag = group['lag']  # 积压消息数量
                    
                    self.metrics['consumer_lag'][group_name] = lag
                    
                    if lag > 1000:  # 告警阈值
                        logger.warning(f"Consumer group {group_name} lag: {lag}")
                
                await asyncio.sleep(30)  # 30秒检查一次
                
            except Exception as e:
                logger.error(f"Metrics collection error: {e}")
                await asyncio.sleep(5)
```

## 6. 服务启动整合

```python
class ServiceManager:
    """服务管理器 - 统一管理异步消费"""
    
    def __init__(self):
        self.event_bus = EventBus(redis_client)
        self.consumers = []
        self.monitor = EventFlowMonitor(self.event_bus)
        
    async def start_all_services(self):
        """启动所有服务和消费者"""
        # 1. 启动事件监控
        await self.monitor.start_monitoring()
        
        # 2. 启动各服务消费者
        message_consumer = MessageServiceConsumer(self.event_bus)
        requirement_consumer = RequirementServiceConsumer(self.event_bus)
        chatbot_consumer = ChatbotServiceConsumer(self.event_bus)
        
        await message_consumer.start_consuming()
        await requirement_consumer.start_consuming()
        await chatbot_consumer.start_consuming()
        
        self.consumers = [message_consumer, requirement_consumer, chatbot_consumer]
        
        # 3. 启动WebSocket适配器
        websocket_adapter = WebSocketEventAdapter(self.event_bus)
        
        logger.info("All services started with async event consumption")
```

## 核心优势

1. **非阻塞处理**：每个服务独立消费，互不影响
2. **智能过滤**：服务只处理感兴趣的事件，减少无效处理
3. **水平扩展**：可以启动多个消费者实例处理同一类事件
4. **错误隔离**：单个事件处理失败不影响其他事件
5. **背压控制**：防止服务过载
6. **可观测性**：完整的监控和调试能力

这个设计确保了QQ Bot服务器能够高效处理大量并发消息，同时保持系统的稳定性和可扩展性。