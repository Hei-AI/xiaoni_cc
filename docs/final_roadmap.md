# QQ Bot "数字伙伴·阿正" MVP Final Roadmap

## 📋 项目概述

基于现有4模块微服务架构，快速实现"数字伙伴·阿正"的MVP版本。通过LLM驱动的决策系统和拟人化表现，创造一个能主动参与群聊、理解上下文、具备基本人格的AI助手。

**核心设计理念**：
- ✅ 快速MVP交付，基于现有架构扩展
- ✅ 全LLM驱动，无embedding/向量数据库依赖  
- ✅ 简化版三层模型：决策层、表现层、知识层
- ✅ 上下文全部通过prompt传递，无性能优化考虑

## 🎯 MVP功能目标

### Phase 1: 基础拟人化 (2-3周)
- **智能决策系统** - 判断何时参与对话
- **人格化表达** - 一致的"阿正"人格和语言风格  
- **上下文理解** - 基于消息历史的语义理解
- **概率性行为** - 模拟人类的注意力和兴趣

### Phase 2: 高级交互 (3-4周)
- **对话聚合** - 等用户说完再回复
- **情感识别** - 理解用户情绪并适当回应
- **关系记忆** - 记住不同用户的交互历史
- **延迟回复** - 模拟人类打字节奏

### Phase 3: 知识增强 (2-3周)
- **工具调用** - 基础的网络搜索和内部知识查询
- **学习能力** - 从群聊中提取和记忆有用信息
- **专业领域** - 在技术话题上表现专业性

## 🏗️ 技术架构升级

### 核心架构保持不变
```
modules/
├── http-api/           # HTTP网关 (端口8080)
├── qqbot-core/         # 核心AI逻辑 (端口8081) [主要改动]
├── admin-panel/
│   ├── backend/        # 管理API (端口9080)
│   └── frontend/       # 管理界面 (端口3003)
```

### 重点升级：qqbot-core模块

#### 1. 新增核心服务
```typescript
// src/services/decision-engine.ts
class DecisionEngine {
  async shouldRespond(context: MessageContext): Promise<boolean>
  async analyzeIntent(messages: QQMessage[]): Promise<IntentResult>
  async calculateAttentionScore(): Promise<number>
}

// src/services/persona-engine.ts  
class PersonaEngine {
  async generateResponse(context: ResponseContext): Promise<string>
  async applyPersonality(rawResponse: string): Promise<string>
  async createExecutionPlan(response: string): Promise<ExecutionStep[]>
}

// src/services/context-manager.ts
class ContextManager {
  async buildMessageContext(messageId: string): Promise<MessageContext>
  async aggregateUserMessages(userId: number): Promise<string>
  async getRelevantHistory(query: string): Promise<QQMessage[]>
}

// src/services/memory-service.ts
class MemoryService {
  async rememberFact(fact: string, userId: number): Promise<void>
  async recallRelevant(query: string): Promise<string[]>
  async updateRelationship(userId: number, interaction: InteractionData): Promise<void>
}
```

#### 2. 升级现有服务
```typescript
// 升级 AIService 支持多Agent
class AIService {
  // 新增方法
  async analyzeDecision(context: MessageContext): Promise<DecisionResult>
  async generatePersonalizedResponse(context: ResponseContext): Promise<string>
  async summarizeConversation(messages: QQMessage[]): Promise<string>
}

// 升级 SessionManager 支持消息聚合
class SessionManager {
  async aggregateUserInput(userId: number, timeWindow: number): Promise<string>
  async isInputComplete(userId: number): Promise<boolean>
  async waitForComplete(userId: number): Promise<string>
}
```

## 🤖 核心功能实现

### 1. 智能决策系统 (DecisionEngine)

#### 决策流程
```typescript
interface MessageContext {
  message: QQMessage;
  recentHistory: QQMessage[];
  userRelationship: UserRelationship;
  groupContext?: GroupContext;
  attentionScore: number;
}

interface DecisionResult {
  shouldRespond: boolean;
  confidence: number;
  reason: string;
  responseType: 'immediate' | 'delayed' | 'skip';
}
```

#### LLM决策Prompt模板
```
你是阿正，一个热情的技术专家。分析是否应该参与这个对话：

当前注意力状态: {attentionScore}/100
消息内容: {currentMessage}
最近对话历史: {recentHistory}
与用户关系: {relationship}

判断标准:
1. 被@时优先响应
2. 技术问题主动参与  
3. 闲聊根据注意力概率参与
4. 避免打断正常对话流

返回JSON: {"shouldRespond": true/false, "confidence": 0-100, "reason": "原因"}
```

### 2. 拟人化表现系统 (PersonaEngine)

#### 人格化配置
```typescript
interface PersonaConfig {
  basePersonality: string[];      // 基础人格
  technicalExpert: string[];      // 技术专家侧面
  casualFriend: string[];         // 轻松朋友侧面  
  empathicListener: string[];     // 共情倾听侧面
  responsePattern: ExecutionPattern;
}

interface ExecutionStep {
  delay: number;                  // 延迟秒数
  content: string;                // 回复内容
  action?: 'typing' | 'send';     // 动作类型
}
```

#### 人格化Prompt模板
```
你是阿正，团队的技术专家和好伙伴。你的特点：
- 热情友好，喜欢用emoji
- 技术专业但表达轻松
- 有点幽默感，但把握分寸
- 会关心同事的情况

对话上下文: {context}
用户消息: {userMessage}
关系状态: {relationship}

请生成分段回复计划(模拟打字节奏)：
[
  {"delay": 2, "content": "第一段回复"},
  {"delay": 3, "content": "第二段回复"}  
]
```

### 3. 上下文理解系统 (ContextManager)

#### 消息聚合逻辑
```typescript
class ContextManager {
  async buildContext(messageId: string): Promise<MessageContext> {
    // 1. 获取当前消息
    const message = await this.getMessageById(messageId);
    
    // 2. 获取相关历史(通过LLM相似度判断)
    const relevantHistory = await this.getRelevantHistory(message.message, 50);
    
    // 3. 构建用户关系状态
    const relationship = await this.getUserRelationship(message.user_id);
    
    // 4. 获取当前注意力分数
    const attentionScore = await this.getAttentionScore();
    
    return { message, relevantHistory, relationship, attentionScore };
  }
  
  async getRelevantHistory(query: string, limit: number): Promise<QQMessage[]> {
    // LLM驱动的语义相似度匹配
    const allHistory = await this.database.getRecentMessages(limit * 2);
    
    const prompt = `
    查询: ${query}
    
    从以下消息中选出最相关的${limit}条：
    ${allHistory.map((msg, i) => `${i}: ${msg.message}`).join('\n')}
    
    返回相关消息的索引数组: [0,3,5,...]
    `;
    
    const indices = await this.aiService.callGemini(prompt);
    return JSON.parse(indices).map(i => allHistory[i]);
  }
}
```

### 4. 记忆系统 (MemoryService)

#### 简化版记忆(基于数据库+LLM摘要)
```typescript
class MemoryService {
  async rememberInteraction(userId: number, summary: string): Promise<void> {
    // 存储到数据库，用LLM生成摘要
    const memoryEntry = {
      user_id: userId,
      memory_type: 'interaction',
      content: summary,
      timestamp: new Date(),
      importance: await this.calculateImportance(summary)
    };
    
    await this.database.saveMemory(memoryEntry);
  }
  
  async recallMemories(userId: number, context: string): Promise<string[]> {
    const memories = await this.database.getUserMemories(userId, 10);
    
    // LLM筛选相关记忆
    const prompt = `
    当前对话: ${context}
    用户记忆: ${memories.map(m => m.content).join('\n')}
    
    选择相关的记忆(最多3条)，返回JSON数组。
    `;
    
    const relevant = await this.aiService.callGemini(prompt);
    return JSON.parse(relevant);
  }
}
```

## 📊 数据库扩展

### 新增表结构
```sql
-- 注意力状态表
CREATE TABLE attention_states (
  id INT PRIMARY KEY AUTO_INCREMENT,
  current_score FLOAT DEFAULT 0.5,
  last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  factors JSON,  -- 影响因素
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户关系表
CREATE TABLE user_relationships (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  affinity_score FLOAT DEFAULT 0.0,  -- 亲和度 (-1 到 1)
  interaction_count INT DEFAULT 0,
  last_interaction TIMESTAMP,
  personality_notes TEXT,  -- LLM生成的人格观察
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 记忆表
CREATE TABLE memories (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT,
  memory_type ENUM('fact', 'interaction', 'preference'),
  content TEXT NOT NULL,
  importance_score FLOAT DEFAULT 0.5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL
);

-- 消息上下文缓存表  
CREATE TABLE message_contexts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  message_id BIGINT,
  user_id BIGINT,
  group_id BIGINT NULL,
  aggregated_input TEXT,  -- 聚合后的用户输入
  context_summary TEXT,   -- LLM生成的上下文摘要
  decision_result JSON,   -- 决策结果
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🔄 消息处理流程升级

### 新的消息处理逻辑
```typescript
class QQBot {
  async handlePrivateMessage(message: QQMessage): Promise<void> {
    // 1. 检查是否需要聚合用户输入
    const isInputComplete = await this.sessionManager.isInputComplete(message.user_id);
    
    if (!isInputComplete) {
      // 等待用户完成输入
      await this.sessionManager.aggregateInput(message);
      return;
    }
    
    // 2. 构建消息上下文
    const context = await this.contextManager.buildMessageContext(message.message_id);
    
    // 3. 决策是否响应
    const decision = await this.decisionEngine.shouldRespond(context);
    
    if (!decision.shouldRespond) {
      // 记录但不回复
      await this.memoryService.observeMessage(context);
      return;
    }
    
    // 4. 生成拟人化回复
    const executionPlan = await this.personaEngine.generateResponse(context);
    
    // 5. 执行分段回复
    await this.executeResponsePlan(executionPlan, message);
    
    // 6. 更新用户关系和记忆
    await this.memoryService.updateInteraction(message.user_id, context);
  }
  
  async executeResponsePlan(plan: ExecutionStep[], originalMessage: QQMessage): Promise<void> {
    for (const step of plan) {
      await new Promise(resolve => setTimeout(resolve, step.delay * 1000));
      
      if (step.action === 'send') {
        await this.websocketClient.sendPrivateMessage(
          originalMessage.user_id, 
          step.content
        );
      }
    }
  }
}
```

## 🎨 管理界面扩展

### 新增管理功能 (admin-panel)
```typescript
// backend新增API端点
app.get('/api/persona/config', getPersonaConfig);
app.post('/api/persona/config', updatePersonaConfig);
app.get('/api/attention/status', getAttentionStatus);
app.post('/api/attention/adjust', adjustAttentionScore);
app.get('/api/memories', getUserMemories);
app.get('/api/relationships', getUserRelationships);

// frontend新增管理页面
- 人格配置页面 - 调整阿正的性格和语言风格
- 注意力监控 - 实时查看和调整注意力状态
- 关系图谱 - 查看与不同用户的关系状态
- 记忆管理 - 查看和管理AI的记忆内容
- 决策日志 - 分析AI的决策过程和准确性
```

## ⚡ 实施计划

### Week 1-2: 基础框架
- [ ] 设计新服务接口和数据库表
- [ ] 实现DecisionEngine基础决策逻辑
- [ ] 实现PersonaEngine人格化系统
- [ ] 升级消息处理流程

### Week 3-4: 智能化功能
- [ ] 实现ContextManager上下文理解
- [ ] 实现MemoryService记忆系统
- [ ] 添加消息聚合和延迟回复
- [ ] 完善用户关系管理

### Week 5-6: 体验优化
- [ ] 实现注意力动态调节机制
- [ ] 添加情感识别和共情回复
- [ ] 完善群聊场景的智能参与
- [ ] 实现管理界面

### Week 7-8: 测试和调优
- [ ] 端到端功能测试
- [ ] 人格一致性测试
- [ ] 性能和稳定性测试
- [ ] 用户体验优化

## 🎯 MVP成功标准

### 用户体验标准
- ✅ 能够智能判断何时参与对话(准确率>80%)
- ✅ 回复具有一致的"阿正"人格特征
- ✅ 能够理解对话上下文并给出相关回复
- ✅ 展现概率性行为，避免机械感
- ✅ 能够记住用户互动历史

### 技术标准  
- ✅ 基于现有架构，无需重大重构
- ✅ 全LLM驱动，无复杂基础设施依赖
- ✅ 消息处理延迟<3秒(不含故意的人性化延迟)
- ✅ 系统稳定运行，错误率<5%
- ✅ 支持同时处理多用户对话

### 业务标准
- ✅ 能够作为"数字伙伴"自然融入团队群聊
- ✅ 在技术讨论中能提供有价值的参与
- ✅ 用户反馈积极，认为AI有"人味"
- ✅ 管理员能通过后台调整AI行为

## 🚀 部署和运维

### 现有部署方式保持不变
```bash
# 使用现有的启动脚本
npm start
python3 scripts/start_modules.py start

# 新增环境变量配置
export PERSONA_MODE=active          # 人格化模式
export ATTENTION_BASE_SCORE=0.5     # 基础注意力分数
export MEMORY_RETENTION_DAYS=30     # 记忆保留天数
export DECISION_CONFIDENCE_THRESHOLD=0.7  # 决策置信度阈值
```

### 监控指标
- AI决策准确率和响应率
- 用户交互满意度(通过反馈)
- 系统响应时间和稳定性
- 记忆系统有效性

---

## 💡 关键设计决策说明

### 为什么选择全LLM驱动？
1. **快速实现** - 无需构建复杂的embedding和向量数据库
2. **灵活性高** - 通过prompt engineering快速调整行为
3. **维护简单** - 基于现有Gemini集成，技术栈统一
4. **成本可控** - MVP阶段，上下文长度可接受

### 为什么基于现有架构？
1. **风险可控** - 在稳定基础上增量改进
2. **开发效率** - 复用现有数据库、配置、监控体系
3. **团队熟悉** - 减少学习成本，专注业务逻辑

### 如何保证MVP的"拟人化"效果？
1. **多层人格Prompt** - 技术专家+朋友+共情者的组合人格
2. **概率性决策** - 基于注意力分数的概率响应
3. **分段式回复** - 模拟人类打字和思考节奏
4. **记忆和关系** - 体现对用户的了解和关怀

这个MVP方案在保持技术现实性的同时，最大程度实现了"数字伙伴"的核心体验，为后续的高级功能奠定了solid foundation。