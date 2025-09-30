# 实时LLM参数配置系统 - 使用指南

## 🎯 概述

基于管理端对话时间线调试结果，实时调整各个Agent的LLM参数以达到最佳效果。所有参数以JSON格式存储在数据库中，支持热更新。

## 🏗️ 系统架构

### 核心组件
- **数据库扩展**: `agent_prompts` 表增加 `advanced_config` JSON字段
- **预定义工具库**: 通过key选择预设工具，无需编写代码
- **动态配置加载**: AI Service支持实时读取最新配置
- **管理端API**: 完整的配置管理和测试接口

### 配置层级
```
Agent Prompt (数据库)
├── 基础配置 (model_config)
└── 高级配置 (advanced_config) 🆕
    ├── generationConfig (生成参数)
    ├── thinkingConfig (思考模式)
    ├── safetySettings (安全设置)
    ├── toolsConfig (工具配置) 📌 简化设计
    ├── googleSearchConfig (搜索集成)
    ├── urlContextConfig (URL处理)
    ├── structuredOutputConfig (结构化输出)
    └── promptConfig (提示词配置)
```

## 📋 数据库结构

### Agent Prompts表扩展
```sql
ALTER TABLE agent_prompts
ADD COLUMN advanced_config JSON COMMENT 'Gemini高级配置参数JSON',
ADD COLUMN config_version VARCHAR(20) DEFAULT 'v1.0',
ADD COLUMN last_config_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
```

### Advanced Config JSON结构
```json
{
  "generationConfig": {
    "temperature": 0.7,
    "topP": 0.9,
    "topK": 40,
    "maxOutputTokens": 1000,
    "stopSequences": ["结论:", "总结:"],
    "responseMimeType": "text/plain"
  },
  "thinkingConfig": {
    "thinkingBudget": 1000,  // -1自动, 0禁用, 正数固定
    "includeThoughts": true
  },
  "safetySettings": [
    {
      "category": "HARM_CATEGORY_HARASSMENT",
      "threshold": "BLOCK_MEDIUM_AND_ABOVE"
    }
  ],
  "toolsConfig": {
    "enabled": true,
    "selectedTools": ["sentiment_analysis", "keyword_extraction"], // 🎯 Key选择
    "mode": "AUTO",
    "allowedTools": ["sentiment_analysis", "keyword_extraction"]
  },
  "googleSearchConfig": {
    "enabled": true,
    "dynamicThreshold": false
  },
  "urlContextConfig": {
    "enabled": true,
    "maxUrls": 20,
    "maxSizePerUrl": 34
  },
  "structuredOutputConfig": {
    "enabled": true,
    "jsonSchema": {
      "type": "object",
      "properties": {
        "intent": {"type": "string"},
        "confidence": {"type": "number"}
      }
    }
  },
  "promptConfig": {
    "promptPrefix": "[分析开始]",
    "promptSuffix": "[分析结束]"
  }
}
```

## 🔧 预定义工具库

### 工具分类
- **utility**: 实用工具 (`weather_query`, `url_parser`)
- **search**: 搜索工具 (`web_search`)
- **analysis**: 分析工具 (`sentiment_analysis`, `keyword_extraction`)
- **data**: 数据处理 (`json_validator`)
- **communication**: 通信工具 (`message_formatter`)

### 推荐工具配置
```typescript
const recommendations = {
  'chat_bot': ['weather_query', 'web_search', 'message_formatter'],
  'intent_analyzer': ['sentiment_analysis', 'keyword_extraction'],
  'requirement_processor': ['json_validator', 'url_parser'],
  'persona_chat': ['sentiment_analysis', 'message_formatter']
};
```

## 🚀 API接口使用

### 管理端API (http://localhost:9080/api/llm-config)

#### 1. 获取Agent列表
```bash
GET /api/llm-config/agents
```

#### 2. 获取Agent详细配置
```bash
GET /api/llm-config/agents/{agentId}
```

#### 3. 更新高级配置 🎯 核心功能
```bash
PUT /api/llm-config/agents/{agentId}/advanced-config
Content-Type: application/json

{
  "advancedConfig": {
    "generationConfig": {
      "temperature": 0.3,
      "maxOutputTokens": 800
    },
    "thinkingConfig": {
      "thinkingBudget": 1500,
      "includeThoughts": true
    },
    "toolsConfig": {
      "enabled": true,
      "selectedTools": ["sentiment_analysis"],
      "mode": "AUTO"
    }
  },
  "updatedBy": "admin_user"
}
```

#### 4. 测试配置效果
```bash
POST /api/llm-config/agents/{agentId}/test
Content-Type: application/json

{
  "testPrompt": "分析这条消息的情感倾向",
  "userId": 12345
}
```

#### 5. 获取可用工具
```bash
GET /api/llm-config/tools
GET /api/llm-config/tools/recommended/{agentType}
```

#### 6. 批量更新配置
```bash
POST /api/llm-config/agents/batch-update
Content-Type: application/json

{
  "updates": [
    {
      "agentId": "chat_bot_basic",
      "advancedConfig": { ... }
    }
  ]
}
```

## 💻 代码集成

### AI Service调用方式

#### 1. 使用Agent配置调用 (推荐)
```typescript
import { AIService } from './services/ai-service';

// 使用Agent Prompt配置 (自动加载最新配置)
const response = await aiService.callWithAgentPrompt(
  '用户消息内容',
  'decision_engine_thinking', // Agent Prompt ID
  'trace_id_123',
  userId
);

console.log('AI响应:', response.content);
console.log('思考过程:', response.thoughts);
console.log('工具调用:', response.functionCalls);
```

#### 2. 直接使用配置对象
```typescript
const advancedConfig = {
  modelName: 'gemini-2.5-flash',
  generationConfig: { temperature: 0.3 },
  thinkingConfig: { thinkingBudget: 1000, includeThoughts: true },
  toolsConfig: {
    enabled: true,
    selectedTools: ['sentiment_analysis'],
    mode: 'AUTO'
  }
};

const response = await aiService.callWithConfig(
  'prompt',
  advancedConfig,
  'trace_id'
);
```

### 动态配置更新
```typescript
// 更新Agent配置
await aiService.updateAgentAdvancedConfig(
  'chat_bot_basic',
  {
    generationConfig: { temperature: 0.8 },
    toolsConfig: {
      enabled: true,
      selectedTools: ['web_search', 'weather_query'],
      mode: 'AUTO'
    }
  },
  'admin_user'
);

// 下次调用自动使用新配置
const response = await aiService.callWithAgentPrompt(
  'latest prompt',
  'chat_bot_basic'
);
```

## 🎛️ 管理界面工作流

### 典型调试流程
1. **查看对话时间线** → 发现Agent响应不理想
2. **打开配置界面** → 选择对应的Agent Prompt
3. **调整参数配置** → 修改temperature、启用工具、调整思考模式
4. **保存并测试** → 实时测试新配置效果
5. **应用到生产** → 配置立即生效，无需重启服务

### 配置建议

#### 决策引擎优化
```json
{
  "generationConfig": {
    "temperature": 0.2,  // 低温度提高准确性
    "maxOutputTokens": 500
  },
  "thinkingConfig": {
    "thinkingBudget": 800,  // 充分思考
    "includeThoughts": true
  },
  "toolsConfig": {
    "enabled": true,
    "selectedTools": ["sentiment_analysis", "keyword_extraction"],
    "mode": "AUTO"
  }
}
```

#### 聊天机器人优化
```json
{
  "generationConfig": {
    "temperature": 0.7,  // 平衡创造性
    "maxOutputTokens": 1200
  },
  "toolsConfig": {
    "enabled": true,
    "selectedTools": ["web_search", "weather_query"],
    "mode": "AUTO"
  },
  "googleSearchConfig": {
    "enabled": true
  }
}
```

#### 意图分析优化
```json
{
  "generationConfig": {
    "temperature": 0.1,  // 高精度
    "responseMimeType": "application/json"
  },
  "structuredOutputConfig": {
    "enabled": true,
    "jsonSchema": {
      "type": "object",
      "properties": {
        "intent": {"type": "string"},
        "confidence": {"type": "number"},
        "emotion": {"type": "string"}
      }
    }
  }
}
```

## 🔒 最佳实践

### 配置管理
1. **渐进式调整**: 每次只调整1-2个参数，观察效果
2. **A/B测试**: 保留多个配置版本，对比效果
3. **备份配置**: 重要调整前先备份原配置
4. **监控指标**: 关注响应质量、处理时间、Token使用量

### 工具选择
1. **按需启用**: 只启用必要的工具，避免干扰
2. **分类使用**: 不同Agent使用不同类别的工具
3. **权限控制**: 使用allowedTools限制可调用工具
4. **性能考虑**: 工具数量影响响应时间

### 安全配置
1. **阈值设置**: 根据应用场景调整安全阈值
2. **内容过滤**: 使用stopSequences控制输出内容
3. **输出限制**: 合理设置maxOutputTokens
4. **监控日志**: 定期检查AI调用日志

## 🚀 部署和运维

### 数据库迁移
```bash
# 执行数据库迁移
mysql -u qqbot_user -p qqbot_db < database/migrations/005_extend_agent_prompts_advanced_configs.sql
```

### 服务重启 (可选)
```bash
# 重启Admin Panel Backend以加载新API
npm run restart:admin-backend

# 重启QQBot Core以支持新功能
npm run restart:qqbot-core
```

### 配置验证
```bash
# 测试API接口
curl http://localhost:9080/api/llm-config/agents

# 测试Agent配置
curl -X POST http://localhost:9080/api/llm-config/agents/chat_bot_basic/test \
  -H "Content-Type: application/json" \
  -d '{"testPrompt": "测试消息"}'
```

## 🎉 总结

实时LLM参数配置系统让你能够：

✅ **实时调整**: 无需重启服务，配置立即生效
✅ **简化工具**: 通过key选择预定义工具，无需编程
✅ **完整功能**: 支持思考模式、结构化输出、函数调用等Gemini高级特性
✅ **管理友好**: 直观的API接口，便于管理界面集成
✅ **性能监控**: 完整的调用追踪和性能指标

现在你可以根据对话时间线的分析结果，实时优化各个Agent的表现，让QQ机器人更智能、更精准！