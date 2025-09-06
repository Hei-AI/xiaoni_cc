# QQ Bot "数字伙伴·阿正" 全盘演进方案

## 📋 演进策略概述

**渐进式演进路线**：从简单的LLM驱动系统，逐步进化为高度智能的数字伙伴。每个阶段都是完整可用的产品，后续阶段在前一阶段基础上增强。

**最终目标**：实现docs中描述的完整"数字伙伴"系统，具备向量检索、工具调用、高级拟人化等全部能力。

**演进原则**：
- 🎯 每个阶段都有明确的交付物和价值
- 🔄 架构前瞻性设计，支持平滑升级
- 📊 持续跟踪和量化进展
- ⚡ 快速验证，快速迭代

---

## 🗺️ 四阶段演进路线图

### Stage 1: Smart Responder (智能应答者) - 4周
**目标**: 基于LLM的智能QQ机器人，具备基本的对话能力和决策逻辑

### Stage 2: Context-Aware Assistant (上下文感知助手) - 6周  
**目标**: 增加上下文理解、用户状态跟踪、基础人格化

### Stage 3: Proactive Companion (主动伙伴) - 8周
**目标**: 实现主动参与、情感识别、关系管理、工具调用

### Stage 4: Digital Teammate (数字伙伴) - 10周
**目标**: 完整的向量检索、高级拟人化、学习能力、复杂工具编排

---

## 🏗️ 系统架构演进设计

### 架构分层设计
```
┌─────────────────────────────────────────┐
│          Presentation Layer             │  
│  (WebSocket/HTTP API + Admin Panel)    │
├─────────────────────────────────────────┤
│           Decision Layer                │
│  (Smart Router + Intent Engine)         │
├─────────────────────────────────────────┤
│          Processing Layer               │
│ (Persona Engine + Context Manager)     │
├─────────────────────────────────────────┤
│           Intelligence Layer            │
│ (LLM Service + Tool Orchestrator)      │
├─────────────────────────────────────────┤
│            Memory Layer                 │
│ (SQL + Redis + Vector DB)              │
└─────────────────────────────────────────┘
```

### 模块架构演进
```
modules/
├── qqbot-core/                 # 核心智能服务
│   ├── src/
│   │   ├── engines/           # 各种引擎 (新增)
│   │   │   ├── decision-engine.ts
│   │   │   ├── persona-engine.ts  
│   │   │   ├── context-engine.ts
│   │   │   └── tool-orchestrator.ts
│   │   ├── services/          # 现有服务 (升级)
│   │   │   ├── ai-service.ts
│   │   │   ├── session-manager.ts
│   │   │   ├── database.ts
│   │   │   └── memory-service.ts (新增)
│   │   ├── agents/            # AI代理 (新增)
│   │   │   ├── chat-agent.ts
│   │   │   ├── intent-agent.ts
│   │   │   └── persona-agent.ts
│   │   └── tools/             # 工具插件 (新增)
│   │       ├── web-search.ts
│   │       ├── knowledge-base.ts
│   │       └── code-executor.ts
├── http-api/                  # API网关 (保持现有)
├── admin-panel/               # 管理控制台
│   ├── backend/              # 管理API (扩展)
│   └── frontend/             # 管理界面 (大幅扩展)
└── vector-service/           # 向量检索服务 (Stage 4新增)
    ├── src/
    │   ├── embeddings/
    │   ├── retrieval/
    │   └── similarity/
```

---

## 🎯 Stage 1: Smart Responder (4周)

### 目标与交付物
- ✅ 智能判断是否回复消息 (基于规则+LLM)
- ✅ 基础人格化回复 (统一的"阿正"风格)
- ✅ 简单的上下文理解 (最近N条消息)
- ✅ 管理界面查看对话统计

### 核心组件设计

#### 1.1 Decision Engine v1
```typescript
// src/engines/decision-engine.ts
export class DecisionEngine {
  async analyzeMessage(message: QQMessage): Promise<DecisionResult> {
    // 规则层过滤
    const ruleResult = await this.applyRules(message);
    if (ruleResult.shouldSkip) return ruleResult;
    
    // LLM意图分析
    const intentResult = await this.analyzeIntent(message);
    
    // 组合决策
    return this.combineResults(ruleResult, intentResult);
  }
  
  private async applyRules(message: QQMessage): Promise<DecisionResult> {
    // 1. @消息必须回复
    if (message.message.includes('@') || message.message.includes('[CQ:at')) {
      return { shouldRespond: true, confidence: 95, source: 'direct_mention' };
    }
    
    // 2. 私聊默认回复
    if (message.message_type === 'private') {
      return { shouldRespond: true, confidence: 90, source: 'private_message' };
    }
    
    // 3. 群聊需要进一步分析
    return { shouldRespond: null, confidence: 0, source: 'needs_analysis' };
  }
  
  private async analyzeIntent(message: QQMessage): Promise<IntentResult> {
    const prompt = this.buildIntentPrompt(message);
    const response = await this.aiService.callGemini(prompt, 'intent_analyzer');
    return this.parseIntentResponse(response);
  }
}

interface DecisionResult {
  shouldRespond: boolean | null;
  confidence: number;
  source: string;
  reasoning?: string;
}
```

#### 1.2 Persona Engine v1  
```typescript
// src/engines/persona-engine.ts
export class PersonaEngine {
  private basePersona = [
    "你是阿正，团队的技术专家和好伙伴",
    "特点：热情友好、技术专业、适度幽默、关心同事", 
    "语言风格：自然亲切、多用emoji、避免官话"
  ];
  
  async generateResponse(context: MessageContext): Promise<string> {
    const prompt = this.buildResponsePrompt(context);
    const rawResponse = await this.aiService.callGemini(prompt, 'chat_bot');
    return this.applyPersonalityFilters(rawResponse);
  }
  
  private buildResponsePrompt(context: MessageContext): string {
    return `
${this.basePersona.join('\n')}

对话上下文：
${context.recentMessages.map(msg => `${msg.sender.nickname}: ${msg.message}`).join('\n')}

当前消息：${context.currentMessage.message}

请以阿正的身份回复，保持角色一致性。
    `;
  }
  
  private applyPersonalityFilters(response: string): string {
    // 简单的后处理：添加emoji、调整语气等
    return response
      .replace(/。/g, '～')  // 温和语气
      .replace(/！/g, '！😊'); // 添加表情
  }
}
```

#### 1.3 Context Engine v1
```typescript
// src/engines/context-engine.ts  
export class ContextEngine {
  async buildContext(messageId: string): Promise<MessageContext> {
    const currentMessage = await this.database.getMessageById(messageId);
    const recentMessages = await this.getRecentMessages(currentMessage, 10);
    
    return {
      currentMessage,
      recentMessages,
      userInfo: await this.getUserInfo(currentMessage.user_id),
      groupInfo: currentMessage.group_id ? await this.getGroupInfo(currentMessage.group_id) : null
    };
  }
  
  private async getRecentMessages(currentMsg: QQMessage, limit: number): Promise<QQMessage[]> {
    // 简单的时间窗口获取，不做语义筛选
    const timeWindow = 10 * 60 * 1000; // 10分钟
    return await this.database.getMessagesInTimeWindow(
      currentMsg.group_id || currentMsg.user_id,
      currentMsg.time - timeWindow,
      currentMsg.time,
      limit
    );
  }
}
```

### 数据库设计 v1
```sql
-- 决策日志表
CREATE TABLE decision_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  message_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  group_id BIGINT NULL,
  decision_result JSON NOT NULL,
  confidence_score FLOAT,
  processing_time_ms INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_message_id (message_id),
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at)
);

-- 人格化配置表
CREATE TABLE persona_configs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  config_name VARCHAR(100) NOT NULL,
  persona_traits JSON NOT NULL,
  language_style JSON NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 上下文缓存表
CREATE TABLE context_cache (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  cache_key VARCHAR(255) UNIQUE NOT NULL,
  context_data JSON NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cache_key (cache_key),
  INDEX idx_expires_at (expires_at)
);
```

### Stage 1 成功指标
- [ ] 私聊回复率：95%+
- [ ] @消息回复率：98%+  
- [ ] 群聊智能参与准确率：70%+
- [ ] 平均响应时间：<3秒
- [ ] 人格一致性：用户反馈80%认为"像真人"

---

## 🧠 Stage 2: Context-Aware Assistant (6周)

### 目标与交付物
- ✅ 语义相关的上下文检索 (LLM驱动)
- ✅ 用户状态和偏好跟踪
- ✅ 动态人格调节 (技术专家 vs 朋友模式)
- ✅ 消息聚合和等待机制
- ✅ 基础记忆系统

### 核心组件升级

#### 2.1 Context Engine v2 (语义上下文)
```typescript
export class ContextEngine {
  async buildSemanticContext(messageId: string): Promise<EnhancedMessageContext> {
    const currentMessage = await this.database.getMessageById(messageId);
    
    // 语义相关消息检索 (LLM驱动)
    const relevantMessages = await this.getSemanticRelevantMessages(currentMessage);
    
    // 用户历史分析
    const userProfile = await this.buildUserProfile(currentMessage.user_id);
    
    // 对话主题识别
    const topics = await this.identifyTopics(relevantMessages);
    
    return {
      currentMessage,
      relevantMessages,
      userProfile,
      topics,
      conversationState: await this.getConversationState(currentMessage)
    };
  }
  
  private async getSemanticRelevantMessages(message: QQMessage): Promise<QQMessage[]> {
    // 获取候选消息
    const candidates = await this.database.getRecentMessages(message.user_id, 50);
    
    // LLM语义匹配
    const prompt = `
当前消息: "${message.message}"

从以下历史消息中选择最相关的5条 (按相关性排序):
${candidates.map((msg, i) => `[${i}] ${msg.message}`).join('\n')}

返回JSON格式: {"relevant_indices": [2, 5, 8], "reasoning": "选择理由"}
    `;
    
    const result = await this.aiService.callGemini(prompt, 'context_analyzer');
    const parsed = JSON.parse(result);
    
    return parsed.relevant_indices.map(i => candidates[i]);
  }
  
  private async buildUserProfile(userId: number): Promise<UserProfile> {
    const interactions = await this.database.getUserInteractionHistory(userId, 30);
    
    // LLM生成用户画像
    const prompt = `
基于以下互动历史，生成用户画像:
${interactions.map(i => `- ${i.summary}`).join('\n')}

返回JSON: {
  "personality": "用户性格特点",
  "interests": ["兴趣1", "兴趣2"],
  "communication_style": "沟通风格", 
  "technical_level": "技术水平",
  "relationship_closeness": 0.0-1.0
}
    `;
    
    const profile = await this.aiService.callGemini(prompt, 'user_analyzer');
    return JSON.parse(profile);
  }
}
```

#### 2.2 Enhanced Persona Engine v2
```typescript
export class PersonaEngine {
  async generateContextualResponse(context: EnhancedMessageContext): Promise<PersonaResponse> {
    // 根据上下文选择人格侧面
    const activePersona = await this.selectPersona(context);
    
    // 生成回复内容
    const response = await this.generateWithPersona(context, activePersona);
    
    // 生成执行计划 (分段+延迟)
    const executionPlan = await this.createExecutionPlan(response, context.userProfile);
    
    return { response, executionPlan, usedPersona: activePersona };
  }
  
  private async selectPersona(context: EnhancedMessageContext): Promise<PersonaAspect> {
    const prompt = `
对话上下文: ${context.topics.join(', ')}
用户特征: ${JSON.stringify(context.userProfile)}
当前消息: ${context.currentMessage.message}

选择最合适的人格侧面:
- technical_expert: 技术问题解答
- casual_friend: 轻松聊天 
- empathetic_listener: 情感支持
- team_coordinator: 工作协调

返回JSON: {"persona": "selected_persona", "reason": "选择理由"}
    `;
    
    const result = await this.aiService.callGemini(prompt, 'persona_selector');
    return JSON.parse(result);
  }
  
  private async createExecutionPlan(response: string, userProfile: UserProfile): Promise<ExecutionStep[]> {
    // 根据用户关系亲近程度调整回复节奏
    const baseDelay = userProfile.relationship_closeness > 0.7 ? 1 : 2;
    
    // 将长回复分段
    const segments = this.splitResponse(response);
    
    return segments.map((segment, i) => ({
      delay: baseDelay * (i + 1),
      content: segment,
      action: 'send'
    }));
  }
}
```

#### 2.3 Memory Service v1
```typescript
// src/services/memory-service.ts
export class MemoryService {
  async rememberInteraction(userId: number, context: EnhancedMessageContext, response: string): Promise<void> {
    // 提取关键信息
    const summary = await this.summarizeInteraction(context, response);
    
    // 存储到记忆库
    const memory: MemoryEntry = {
      id: uuidv4(),
      user_id: userId,
      memory_type: 'interaction',
      content: summary.content,
      importance: summary.importance,
      topics: context.topics,
      created_at: new Date()
    };
    
    await this.database.saveMemory(memory);
    
    // 更新用户画像
    await this.updateUserProfile(userId, summary);
  }
  
  async recallRelevantMemories(userId: number, query: string): Promise<MemoryEntry[]> {
    const allMemories = await this.database.getUserMemories(userId, 20);
    
    // LLM筛选相关记忆
    const prompt = `
查询上下文: ${query}

用户记忆:
${allMemories.map((m, i) => `[${i}] ${m.content} (重要性: ${m.importance})`).join('\n')}

选择最相关的3条记忆，返回JSON: {"selected": [0, 2, 5]}
    `;
    
    const result = await this.aiService.callGemini(prompt, 'memory_retrieval');
    const selected = JSON.parse(result).selected;
    
    return selected.map(i => allMemories[i]);
  }
}
```

### Stage 2 数据库扩展
```sql
-- 用户画像表
CREATE TABLE user_profiles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNIQUE NOT NULL,
  personality_traits JSON,
  interests JSON,
  technical_level VARCHAR(50),
  communication_style TEXT,
  relationship_closeness FLOAT DEFAULT 0.0,
  interaction_count INT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 记忆库表
CREATE TABLE memories (
  id VARCHAR(36) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  memory_type ENUM('interaction', 'fact', 'preference', 'context'),
  content TEXT NOT NULL,
  importance_score FLOAT DEFAULT 0.5,
  topics JSON,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_memory_type (memory_type),
  INDEX idx_importance (importance_score),
  INDEX idx_created_at (created_at)
);

-- 对话状态表
CREATE TABLE conversation_states (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  group_id BIGINT NULL,
  current_topic VARCHAR(255),
  topic_context JSON,
  last_message_time TIMESTAMP,
  state_data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_conversation (user_id, group_id)
);
```

### Stage 2 成功指标  
- [ ] 上下文相关性：用户评价80%认为"理解对话背景"
- [ ] 用户画像准确性：70%的预测符合用户反馈
- [ ] 记忆有效性：能够主动提及过往重要信息
- [ ] 人格一致性：同一用户的不同对话保持人格连贯性

---

## 🤝 Stage 3: Proactive Companion (8周)

### 目标与交付物
- ✅ 主动识别参与时机 (非@消息的智能参与)
- ✅ 情感识别和共情回复
- ✅ 工具调用系统 (搜索、知识库查询)
- ✅ 注意力动态调节机制
- ✅ 高级关系管理

### 核心组件升级

#### 3.1 Decision Engine v2 (主动决策)
```typescript
export class DecisionEngine {
  async analyzeParticipationOpportunity(context: GroupConversationContext): Promise<ParticipationDecision> {
    // 多层决策漏斗
    const signals = await this.gatherParticipationSignals(context);
    
    // 当前注意力状态
    const attentionScore = await this.getAttentionScore();
    
    // 综合决策
    return await this.makeParticipationDecision(signals, attentionScore);
  }
  
  private async gatherParticipationSignals(context: GroupConversationContext): Promise<ParticipationSignals> {
    return {
      // L1: 关键词和实体识别
      keywordSignals: await this.detectKeywords(context.messages),
      
      // L2: 意图识别
      intentSignals: await this.analyzeGroupIntent(context.messages),
      
      // L3: 语义相关性
      semanticSignals: await this.analyzeSemantic相关性(context.messages),
      
      // L4: 情感状态
      emotionalSignals: await this.analyzeEmotionalState(context.messages)
    };
  }
  
  private async makeParticipationDecision(
    signals: ParticipationSignals, 
    attentionScore: number
  ): Promise<ParticipationDecision> {
    const prompt = `
作为阿正，分析是否应该主动参与这个群聊对话：

当前注意力状态: ${attentionScore}/100
信号分析:
- 关键词匹配: ${JSON.stringify(signals.keywordSignals)}
- 意图识别: ${JSON.stringify(signals.intentSignals)}  
- 语义相关性: ${signals.semanticSignals.score}
- 情感状态: ${JSON.stringify(signals.emotionalSignals)}

参与标准:
1. 技术问题 -> 高概率参与 (我的专长)
2. 求助信息 -> 根据相关性参与
3. 情感支持 -> 根据关系亲近度参与  
4. 闲聊话题 -> 概率性参与 (基于注意力)

返回JSON: {
  "shouldParticipate": true/false,
  "confidence": 0-100,
  "participationType": "technical_help|emotional_support|casual_chat",
  "reasoning": "决策理由"
}
    `;
    
    const decision = await this.aiService.callGemini(prompt, 'participation_analyzer');
    return JSON.parse(decision);
  }
}
```

#### 3.2 Emotional Intelligence Engine
```typescript
// src/engines/emotion-engine.ts
export class EmotionalIntelligenceEngine {
  async analyzeEmotionalState(messages: QQMessage[]): Promise<EmotionalContext> {
    const emotionalAnalysis = await this.detectEmotions(messages);
    const socialDynamics = await this.analyzeSocialDynamics(messages);
    
    return {
      userEmotions: emotionalAnalysis,
      groupMood: socialDynamics.groupMood,
      conflictLevel: socialDynamics.conflictLevel,
      supportNeeded: socialDynamics.supportNeeded
    };
  }
  
  async generateEmpathicResponse(context: EmotionalContext, userMessage: string): Promise<EmpathicResponse> {
    const prompt = `
情感上下文:
- 用户情绪: ${context.userEmotions.dominant}
- 情绪强度: ${context.userEmotions.intensity}
- 群体氛围: ${context.groupMood}

用户消息: "${userMessage}"

作为阿正，生成共情回复:
1. 如果用户沮丧 -> 提供安慰和支持
2. 如果用户兴奋 -> 分享喜悦
3. 如果用户困惑 -> 提供帮助和指导
4. 如果用户愤怒 -> 冷静引导

回复要求: 真诚、适度、不过度热情、保持专业边界

返回JSON: {
  "response": "回复内容",
  "emotionalTone": "supportive|celebratory|helpful|calming",
  "executionPlan": [
    {"delay": 2, "content": "第一段"},
    {"delay": 3, "content": "第二段"}
  ]
}
    `;
    
    const response = await this.aiService.callGemini(prompt, 'empathy_generator');
    return JSON.parse(response);
  }
}
```

#### 3.3 Tool Orchestrator v1
```typescript
// src/engines/tool-orchestrator.ts
export class ToolOrchestrator {
  private tools: Map<string, Tool> = new Map();
  
  constructor() {
    this.registerTool(new WebSearchTool());
    this.registerTool(new KnowledgeBaseTool());
    this.registerTool(new CodeAnalyzerTool());
  }
  
  async analyzeToolNeed(message: string, context: MessageContext): Promise<ToolAnalysis> {
    const prompt = `
用户消息: "${message}"
对话上下文: ${JSON.stringify(context.topics)}

分析是否需要调用工具来更好地回答：

可用工具:
- web_search: 搜索最新信息、技术资料
- knowledge_base: 查询内部知识库、历史讨论
- code_analyzer: 分析代码、提供技术建议

返回JSON: {
  "needsTools": true/false,
  "suggestedTools": ["tool_name"],
  "reasoning": "为什么需要这些工具",
  "queries": ["具体查询内容"]
}
    `;
    
    const analysis = await this.aiService.callGemini(prompt, 'tool_analyzer');
    return JSON.parse(analysis);
  }
  
  async executeTool(toolName: string, query: string): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }
    
    const startTime = Date.now();
    const result = await tool.execute(query);
    const executionTime = Date.now() - startTime;
    
    // 记录工具使用
    await this.logToolUsage(toolName, query, result, executionTime);
    
    return result;
  }
  
  async synthesizeResponse(
    originalQuery: string, 
    toolResults: ToolResult[], 
    context: MessageContext
  ): Promise<string> {
    const prompt = `
用户问题: "${originalQuery}"
对话背景: ${JSON.stringify(context)}

工具查询结果:
${toolResults.map(result => `
工具: ${result.toolName}
查询: ${result.query}  
结果: ${result.content}
`).join('\n')}

请整合这些信息，以阿正的身份给出自然、有用的回答。
要求:
1. 不要提及"我查询了"或"根据搜索结果"
2. 将信息自然地融入回答中
3. 保持阿正的人格特点
4. 如果信息不足，坦诚说明
    `;
    
    return await this.aiService.callGemini(prompt, 'synthesis_agent');
  }
}
```

#### 3.4 Attention Management System
```typescript
// src/services/attention-manager.ts
export class AttentionManager {
  async calculateCurrentScore(): Promise<number> {
    const factors = await this.gatherAttentionFactors();
    return await this.computeAttentionScore(factors);
  }
  
  private async gatherAttentionFactors(): Promise<AttentionFactors> {
    return {
      timeOfDay: this.getTimeOfDayFactor(),
      recentActivity: await this.getRecentActivityFactor(),
      systemLoad: await this.getSystemLoadFactor(),
      userInteractionHistory: await this.getUserInteractionFactor(),
      randomNoise: Math.random() * 0.1 - 0.05 // ±5%随机波动
    };
  }
  
  private getTimeOfDayFactor(): number {
    const hour = new Date().getHours();
    // 工作时间注意力模式
    if (hour >= 9 && hour <= 11) return 0.3; // 专注工作
    if (hour >= 14 && hour <= 16) return 0.7; // 活跃讨论
    if (hour >= 12 && hour <= 13) return 0.1; // 午休
    if (hour >= 18 && hour <= 22) return 0.5; // 轻松时间
    return 0.2; // 其他时间
  }
  
  async updateAttentionScore(delta: number, reason: string): Promise<void> {
    const current = await this.getCurrentScore();
    const newScore = Math.max(0, Math.min(1, current + delta));
    
    await this.database.updateAttentionState({
      current_score: newScore,
      last_update: new Date(),
      factors: { reason, delta, previous: current }
    });
    
    this.moduleLogger.info('Attention score updated', { 
      previous: current, 
      new: newScore, 
      delta, 
      reason 
    });
  }
}
```

### Stage 3 数据库扩展
```sql
-- 注意力状态表
CREATE TABLE attention_states (
  id INT PRIMARY KEY AUTO_INCREMENT,
  current_score FLOAT NOT NULL DEFAULT 0.5,
  time_of_day_factor FLOAT,
  activity_factor FLOAT, 
  system_factor FLOAT,
  user_factor FLOAT,
  random_factor FLOAT,
  last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  factors_log JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 情感分析表
CREATE TABLE emotional_analysis (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  message_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  detected_emotions JSON NOT NULL,
  emotion_intensity FLOAT,
  group_mood VARCHAR(50),
  confidence_score FLOAT,
  analysis_method VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_message_id (message_id),
  INDEX idx_user_id (user_id)
);

-- 工具使用记录表
CREATE TABLE tool_usage_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(36),
  tool_name VARCHAR(100) NOT NULL,
  query_text TEXT NOT NULL,
  result_summary TEXT,
  execution_time_ms INT,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  user_id BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tool_name (tool_name),
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at)
);

-- 参与决策记录表  
CREATE TABLE participation_decisions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  group_id BIGINT NOT NULL,
  message_context JSON NOT NULL,
  attention_score FLOAT,
  signals_analysis JSON,
  decision_result JSON,
  actual_participated BOOLEAN,
  feedback_score INT, -- 用户反馈 1-5分
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_group_id (group_id),
  INDEX idx_created_at (created_at)
);
```

### Stage 3 成功指标
- [ ] 主动参与准确率：75%+ (群成员认为参与时机恰当)
- [ ] 情感识别准确率：70%+ (与人工标注对比)
- [ ] 工具调用成功率：85%+ (查询结果有效且相关)
- [ ] 注意力模型有效性：用户感知到明显的"忙闲"变化

---

## 🧪 Stage 4: Digital Teammate (10周)

### 目标与交付物
- ✅ 向量数据库集成 (embedding检索)
- ✅ 高级学习系统 (从对话中提取知识)
- ✅ 复杂工具编排 (多步骤任务执行)
- ✅ 完整的拟人化系统 (打字延迟、中断处理)
- ✅ 团队文化适应

### 架构升级：向量服务模块

#### 4.1 Vector Service 架构
```typescript
// modules/vector-service/src/index.ts
export class VectorService {
  private embeddingModel: EmbeddingModel;
  private vectorStore: VectorStore;
  private similarityEngine: SimilarityEngine;
  
  async indexConversation(conversation: ConversationData): Promise<void> {
    // 生成embedding
    const embedding = await this.embeddingModel.encode(conversation.user_message);
    
    // 存储向量
    await this.vectorStore.store({
      id: conversation.id,
      vector: embedding,
      metadata: {
        user_id: conversation.user_id,
        timestamp: conversation.timestamp,
        topic: await this.extractTopic(conversation.user_message),
        importance: await this.calculateImportance(conversation)
      }
    });
  }
  
  async searchSimilar(query: string, filters: SearchFilters): Promise<SimilarityResult[]> {
    const queryEmbedding = await this.embeddingModel.encode(query);
    
    const results = await this.vectorStore.search(queryEmbedding, {
      ...filters,
      limit: filters.limit || 10,
      threshold: filters.threshold || 0.7
    });
    
    return results;
  }
  
  async buildSemanticContext(query: string, userId: number): Promise<SemanticContext> {
    // 多维度向量检索
    const personalContext = await this.searchSimilar(query, { user_id: userId });
    const globalContext = await this.searchSimilar(query, { exclude_user: userId });
    const topicalContext = await this.searchByTopic(query);
    
    return {
      personalMemories: personalContext,
      teamKnowledge: globalContext,
      topicalDiscussions: topicalContext,
      synthesizedSummary: await this.synthesizeContext([
        ...personalContext,
        ...globalContext,
        ...topicalContext
      ])
    };
  }
}
```

#### 4.2 Advanced Learning System
```typescript
// src/engines/learning-engine.ts
export class LearningEngine {
  async extractKnowledge(conversation: ConversationData[]): Promise<KnowledgeExtraction[]> {
    const extractions = [];
    
    for (const conv of conversation) {
      // 识别知识类型
      const knowledgeType = await this.classifyKnowledge(conv);
      
      if (knowledgeType !== 'casual_chat') {
        const extraction = await this.extractStructuredKnowledge(conv, knowledgeType);
        extractions.push(extraction);
      }
    }
    
    return extractions;
  }
  
  private async extractStructuredKnowledge(
    conv: ConversationData, 
    type: KnowledgeType
  ): Promise<KnowledgeExtraction> {
    const prompt = `
对话内容:
用户: ${conv.user_message}
AI: ${conv.ai_response}

知识类型: ${type}

请提取结构化知识，格式如下:
{
  "factType": "${type}",
  "entities": ["相关实体"],
  "relationships": [{"from": "A", "relation": "关系", "to": "B"}],
  "keyPoints": ["要点1", "要点2"],
  "applicableScenarios": ["应用场景"],
  "confidence": 0.0-1.0,
  "source": "conversation"
}
    `;
    
    const extraction = await this.aiService.callGemini(prompt, 'knowledge_extractor');
    return JSON.parse(extraction);
  }
  
  async consolidateKnowledge(extractions: KnowledgeExtraction[]): Promise<void> {
    // 知识去重和合并
    const consolidated = await this.deduplicateKnowledge(extractions);
    
    // 建立知识图谱连接
    await this.buildKnowledgeGraph(consolidated);
    
    // 更新向量索引
    for (const knowledge of consolidated) {
      await this.vectorService.indexKnowledge(knowledge);
    }
  }
}
```

#### 4.3 Advanced Tool Orchestration
```typescript
export class AdvancedToolOrchestrator extends ToolOrchestrator {
  async planComplexTask(userRequest: string, context: MessageContext): Promise<TaskPlan> {
    const prompt = `
用户请求: "${userRequest}"
可用工具: ${Array.from(this.tools.keys()).join(', ')}

制定执行计划，支持多步骤和条件分支：

返回JSON格式任务计划:
{
  "taskId": "uuid",
  "steps": [
    {
      "stepId": 1,
      "tool": "web_search", 
      "query": "搜索内容",
      "condition": null,
      "onSuccess": 2,
      "onFailure": "fallback"
    },
    {
      "stepId": 2,
      "tool": "knowledge_base",
      "query": "基于前一步结果查询",
      "condition": "step1.results.length > 0",
      "onSuccess": 3,
      "onFailure": "synthesize"
    }
  ],
  "expectedOutcome": "任务预期结果"
}
    `;
    
    const plan = await this.aiService.callGemini(prompt, 'task_planner');
    return JSON.parse(plan);
  }
  
  async executeComplexTask(plan: TaskPlan, context: MessageContext): Promise<TaskResult> {
    const executionContext: ExecutionContext = {
      taskId: plan.taskId,
      currentStep: 0,
      stepResults: new Map(),
      globalContext: context
    };
    
    for (const step of plan.steps) {
      try {
        // 检查执行条件
        if (step.condition && !this.evaluateCondition(step.condition, executionContext)) {
          continue;
        }
        
        // 执行工具
        const result = await this.executeTool(step.tool, step.query);
        executionContext.stepResults.set(step.stepId, result);
        
        // 记录进度 (向用户显示)
        await this.reportProgress(plan.taskId, step.stepId, context.currentMessage.user_id);
        
      } catch (error) {
        // 错误处理和降级
        if (step.onFailure === 'fallback') {
          return await this.executeFallbackPlan(plan, executionContext);
        }
      }
    }
    
    // 最终结果合成
    return await this.synthesizeFinalResult(plan, executionContext);
  }
}
```

#### 4.4 Full Humanization System
```typescript
// src/engines/humanization-engine.ts
export class HumanizationEngine {
  async generateHumanizedExecution(
    response: string, 
    context: MessageContext
  ): Promise<HumanizedExecution> {
    // 分析回复复杂度
    const complexity = await this.analyzeResponseComplexity(response);
    
    // 生成打字模拟
    const typingSimulation = await this.simulateTyping(response, complexity);
    
    // 考虑中断可能性
    const interruptPlan = await this.planInterruptHandling(context);
    
    return {
      typingSteps: typingSimulation,
      interruptHandling: interruptPlan,
      humanizedDelay: this.calculateHumanDelay(complexity),
      emotionalCues: await this.addEmotionalCues(response, context)
    };
  }
  
  private async simulateTyping(response: string, complexity: ResponseComplexity): Promise<TypingStep[]> {
    // 智能分段：按语义切分而非机械分割
    const semanticSegments = await this.semanticSegmentation(response);
    
    const steps: TypingStep[] = [];
    let accumulatedDelay = 0;
    
    for (const [i, segment] of semanticSegments.entries()) {
      // 计算思考时间 (复杂内容需要更多思考)
      const thinkingTime = this.calculateThinkingTime(segment, complexity);
      
      // 计算打字时间 (基于字符数和打字速度)
      const typingTime = this.calculateTypingTime(segment.content);
      
      accumulatedDelay += thinkingTime;
      
      steps.push({
        delay: accumulatedDelay,
        action: 'start_typing',
        metadata: { segment: i }
      });
      
      accumulatedDelay += typingTime;
      
      steps.push({
        delay: accumulatedDelay,
        action: 'send_message',
        content: segment.content,
        metadata: { segment: i }
      });
      
      // 段间暂停
      if (i < semanticSegments.length - 1) {
        accumulatedDelay += this.calculatePauseBetweenSegments(segment, semanticSegments[i + 1]);
      }
    }
    
    return steps;
  }
}
```

### Stage 4 数据库完善
```sql
-- 向量索引表 (配合专门的向量数据库)
CREATE TABLE vector_indices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  content_id VARCHAR(36) NOT NULL,
  content_type ENUM('conversation', 'knowledge', 'memory'),
  vector_id VARCHAR(255) NOT NULL, -- 向量数据库中的ID
  metadata JSON,
  embedding_model VARCHAR(100),
  indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_content_id (content_id),
  INDEX idx_content_type (content_type)
);

-- 知识图谱表
CREATE TABLE knowledge_graph (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  subject_entity VARCHAR(255) NOT NULL,
  relationship_type VARCHAR(100) NOT NULL,
  object_entity VARCHAR(255) NOT NULL,
  confidence_score FLOAT DEFAULT 1.0,
  source_type ENUM('conversation', 'extraction', 'manual'),
  source_id VARCHAR(36),
  properties JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_subject (subject_entity),
  INDEX idx_object (object_entity),
  INDEX idx_relationship (relationship_type)
);

-- 复杂任务执行表
CREATE TABLE task_executions (
  id VARCHAR(36) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  task_plan JSON NOT NULL,
  execution_steps JSON,
  current_step INT DEFAULT 0,
  status ENUM('planning', 'executing', 'completed', 'failed', 'interrupted'),
  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_time TIMESTAMP NULL,
  result_data JSON,
  error_log TEXT,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status)
);

-- 拟人化执行记录表
CREATE TABLE humanization_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  message_id BIGINT NOT NULL,
  execution_plan JSON NOT NULL,
  actual_timing JSON,
  interruption_events JSON,
  user_perception_feedback JSON,
  effectiveness_score FLOAT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_message_id (message_id)
);
```

### Stage 4 成功指标
- [ ] 向量检索精度：85%+ (相关性人工评估)
- [ ] 知识学习有效性：能够在新对话中应用学到的知识
- [ ] 复杂任务完成率：80%+ (多步骤任务成功执行)
- [ ] 拟人化效果：90%用户认为"非常像真人在聊天"
- [ ] 团队文化适应：能够使用团队特有的术语和梗

---

## 📊 进展跟踪 (Progress Tracking)

### 📅 当前状态
- **当前阶段**: Stage 0 (准备阶段)
- **开始时间**: 2025-01-06
- **下一个里程碑**: Stage 1 启动
- **整体进度**: 0% (设计完成，准备开发)

### 🎯 Stage 1: Smart Responder (进度: 0/4 完成)

#### 里程碑完成情况
- [ ] **M1.1 决策引擎基础实现** (目标: Week 1)
  - [ ] 创建DecisionEngine类架构 
  - [ ] 实现规则过滤逻辑
  - [ ] 集成LLM意图分析
  - [ ] 决策结果记录和分析
  
- [ ] **M1.2 人格化引擎v1** (目标: Week 2)
  - [ ] 设计PersonaEngine架构
  - [ ] 实现基础人格prompt系统
  - [ ] 实现响应后处理过滤器
  
- [ ] **M1.3 基础上下文引擎** (目标: Week 3)
  - [ ] 设计ContextEngine v1
  - [ ] 实现消息历史检索
  - [ ] 集成上下文到决策和响应
  
- [ ] **M1.4 管理面板集成** (目标: Week 4)
  - [ ] 集成基础的对话统计功能
  - [ ] 实现实时监控界面
  - [ ] 添加配置管理功能

#### 当前周进展 (Week of 2025-01-06)
**本周计划:**
- 完成Stage 1详细技术设计
- 搭建开发环境
- 开始M1.1的开发工作

**完成情况:**
- ✅ 完成整体架构设计和演进路线图
- ⏳ 待完成: 开始具体代码实现

**下周计划:**
- 实现DecisionEngine基础架构
- 开始规则过滤逻辑开发
- 设置测试环境

**遇到的问题:**
- 无

**风险评估:**
- 🟢 绿灯: 设计清晰，技术可行
- 📅 时间风险: 低
- 🔧 技术风险: 低

### 📈 质量指标跟踪

#### Stage 1 目标指标
| 指标 | 目标值 | 当前值 | 状态 |
|------|--------|--------|------|
| 私聊回复率 | 95%+ | - | 🔄 待测量 |
| @消息回复率 | 98%+ | - | 🔄 待测量 |
| 群聊智能参与准确率 | 70%+ | - | 🔄 待测量 |
| 平均响应时间 | <3秒 | - | 🔄 待测量 |
| 人格一致性 | 80%+ | - | 🔄 待测量 |

### 📋 待完成的后续阶段

#### Stage 2: Context-Aware Assistant (计划: 6周)
- **状态**: 🔲 未开始
- **里程碑**: 0/4
- **预计开始**: Stage 1 完成后

#### Stage 3: Proactive Companion (计划: 8周)  
- **状态**: 🔲 未开始
- **里程碑**: 0/4
- **预计开始**: Stage 2 完成后

#### Stage 4: Digital Teammate (计划: 10周)
- **状态**: 🔲 未开始  
- **里程碑**: 0/4
- **预计开始**: Stage 3 完成后

### 📝 更新日志

#### 2025-01-06
- ✅ 完成演进路线图设计
- ✅ 确定4个Stage的详细技术方案
- ✅ 建立进展跟踪机制
- 🎯 下一步: 开始Stage 1开发

---

## 💡 使用说明

### 如何更新进展
1. **每周更新**: 更新当前周的进展情况
2. **里程碑完成**: 将对应的 `[ ]` 改为 `[x]` 
3. **添加日志**: 在更新日志部分记录重要进展
4. **更新指标**: 定期测量和更新质量指标表格

### 进展状态图标
- ✅ 已完成
- ⏳ 进行中  
- 🔄 待开始
- ❌ 已阻塞
- 🔲 未开始

---

## 🎯 开始开发

现在您可以开始Stage 1的开发了！建议的开发顺序：

1. **首先创建新的引擎目录结构**
   ```bash
   mkdir -p modules/qqbot-core/src/engines
   ```

2. **开始实现DecisionEngine**
   - 参考上面Stage 1的详细设计
   - 先实现基础架构，再逐步添加功能

3. **定期更新这个文档的进展跟踪部分**
   - 每完成一个任务就更新对应的checkbox
   - 每周更新当前周进展
   - 遇到问题记录在风险评估中

---

## 🎯 最终交付标准

### Stage 4 完成后的系统能力
- ✅ **智能决策**: 准确判断何时参与对话 (80%+准确率)
- ✅ **拟人化交互**: 自然的对话节奏和人格表达
- ✅ **上下文理解**: 基于向量检索的深度语义理解  
- ✅ **学习能力**: 从团队对话中学习和适应
- ✅ **工具编排**: 复杂任务的多步骤自动执行
- ✅ **情感智能**: 识别情感并给予适当回应
- ✅ **团队融入**: 成为真正的"数字伙伴"

### 量化成功指标
| 维度 | 指标 | 目标值 |
|------|------|--------|
| 技术性能 | 消息响应率 | 95%+ |
| 智能决策 | 参与时机准确率 | 80%+ |
| 用户体验 | 拟人化满意度 | 90%+ |
| 学习能力 | 知识应用有效性 | 75%+ |
| 系统稳定性 | 服务可用性 | 99%+ |

这个全盘演进方案提供了从当前基础到最终"数字伙伴"的完整路径，每个阶段都有明确的目标、详细的技术设计和量化的成功标准，确保项目能够持续跟踪和成功交付。