# 可配置LLM参数系统使用指南

## 概述

QQ智能机器人现已支持高度可配置的LLM参数系统，基于最新的 `@google/genai` SDK，支持Gemini模型的所有高级功能。

## 🚀 主要特性

### 1. 基础文本生成配置
- **温度控制**: 0.0-2.0，控制创造性和随机性
- **Top-P核采样**: 0.0-1.0，控制词汇选择的多样性
- **Top-K采样**: 正整数，限制候选词汇数量
- **最大输出令牌**: 控制响应长度
- **停止序列**: 自定义停止生成的关键词

### 2. 🤔 思考模式 (Thinking Mode)
- **动态思考**: `thinkingBudget: -1` 自动调整思考深度
- **固定预算**: 设置具体令牌数 (0-32768)
- **思考摘要**: 可选择是否包含思考过程
- **适用场景**: 复杂推理、数学问题、逻辑分析

### 3. 📊 结构化输出 (Structured Output)
- **JSON模式**: 强制返回有效JSON格式
- **模式验证**: 基于JSON Schema的严格验证
- **属性排序**: 控制JSON属性顺序
- **适用场景**: API集成、数据提取、格式化响应

### 4. 🔧 函数调用 (Function Calling)
- **三种模式**: AUTO（自动）、ANY（强制）、NONE（禁用）
- **工具定义**: 灵活的函数参数配置
- **白名单控制**: 限制可调用的函数
- **适用场景**: 外部服务集成、实时数据查询

### 5. 🔍 Google搜索集成 (Google Search)
- **实时搜索**: 访问最新互联网信息
- **信息源标注**: 自动提供来源链接
- **搜索查询**: 自动生成相关搜索词
- **适用场景**: 实时信息查询、事实核查

### 6. 🌐 URL上下文处理 (URL Context)
- **自动获取**: 直接处理URL中的内容
- **多格式支持**: HTML、PDF、图片等
- **内容限制**: 最多20个URL，单个最大34MB
- **适用场景**: 网页分析、文档处理

## 📖 使用方法

### 基础配置示例

```typescript
import { AIService } from './services/ai-service';

const aiService = new AIService(config, database, loggingService);

// 基础文本生成
const basicConfig = {
  modelName: 'gemini-2.5-flash',
  systemInstruction: '你是一个友好的AI助手',
  generationConfig: {
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 1000
  }
};

const response = await aiService.callWithConfig(
  '你的提示词',
  basicConfig,
  'trace_id_123',
  userId
);
```

### 思考模式配置

```typescript
const thinkingConfig = {
  modelName: 'gemini-2.5-flash',
  systemInstruction: '展示你的思考过程',
  thinkingConfig: {
    thinkingBudget: 1000,     // 思考令牌预算
    includeThoughts: true     // 包含思考过程
  },
  generationConfig: {
    temperature: 0.3,
    maxOutputTokens: 1500
  }
};

const response = await aiService.callWithConfig(
  '解决这个复杂的数学问题...',
  thinkingConfig
);

// 获取思考过程
console.log('思考过程:', response.thoughts);
```

### 结构化输出配置

```typescript
const structuredConfig = {
  modelName: 'gemini-2.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        skills: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['name', 'age']
    }
  },
  structuredOutput: {
    enabled: true
  }
};

const response = await aiService.callWithConfig(
  '创建一个用户档案',
  structuredConfig
);

// 响应自动为有效JSON
const userData = JSON.parse(response.content);
```

### 函数调用配置

```typescript
const functionConfig = {
  modelName: 'gemini-2.5-flash',
  tools: [
    {
      name: 'get_weather',
      description: '获取天气信息',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称'
          }
        },
        required: ['city']
      }
    }
  ],
  toolConfig: {
    functionCallingConfig: {
      mode: 'AUTO',
      allowedFunctionNames: ['get_weather']
    }
  }
};

const response = await aiService.callWithConfig(
  '查询北京的天气',
  functionConfig
);

// 检查函数调用
if (response.functionCalls) {
  console.log('调用的函数:', response.functionCalls);
}
```

### Google搜索配置

```typescript
const searchConfig = {
  modelName: 'gemini-2.5-flash',
  googleSearch: {
    enabled: true
  },
  generationConfig: {
    temperature: 0.5,
    maxOutputTokens: 800
  }
};

const response = await aiService.callWithConfig(
  '2024年AI领域的最新突破',
  searchConfig
);

// 获取搜索信息
console.log('搜索查询:', response.searchQueries);
console.log('信息源:', response.groundingChunks);
```

## 🔧 配置验证和模型能力

### 配置验证

```typescript
const validation = await aiService.validateConfig(config);
if (!validation.valid) {
  console.log('配置错误:', validation.errors);
}
```

### 模型能力查询

```typescript
const capabilities = await aiService.getModelCapabilities('gemini-2.5-flash');
console.log('支持的功能:', {
  functionCalling: capabilities.supportsFunctionCalling,
  thinking: capabilities.supportsThinking,
  googleSearch: capabilities.supportsGoogleSearch,
  urlContext: capabilities.supportsUrlContext,
  structuredOutput: capabilities.supportsStructuredOutput
});
```

## 📋 配置接口定义

### LLMCallConfig

```typescript
interface LLMCallConfig {
  // 必需
  modelName: string;

  // 可选
  systemInstruction?: string;
  generationConfig?: GenerationConfig;
  thinkingConfig?: ThinkingConfig;
  safetySettings?: SafetyConfig[];
  tools?: FunctionDeclaration[];
  toolConfig?: ToolConfig;
  googleSearch?: GoogleSearchConfig;
  urlContext?: UrlContextConfig;
  structuredOutput?: StructuredOutputConfig;
  promptPrefix?: string;
  promptSuffix?: string;
}
```

### 响应结构

```typescript
interface LLMCallResponse {
  content: string;                    // 主要响应内容
  rawResponse?: any;                  // 原始API响应
  usedConfig: LLMCallConfig;          // 使用的配置
  thoughts?: string;                  // 思考过程 (如果启用)
  functionCalls?: Array<{             // 函数调用结果
    name: string;
    args: any;
    result?: any;
  }>;
  searchQueries?: string[];           // 搜索查询
  groundingChunks?: Array<{           // 信息源
    title: string;
    uri: string;
  }>;
  metrics: {                          // 性能指标
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    processingTimeMs: number;
    apiCallTimeMs: number;
  };
  error?: {                           // 错误信息
    message: string;
    code?: string;
    details?: any;
  };
}
```

## 🎯 最佳实践

### 1. 模型选择
- **gemini-2.5-flash**: 快速响应，适合实时对话
- **gemini-2.5-pro**: 高质量输出，适合复杂任务
- **gemini-1.5-pro**: 成熟稳定，不支持思考模式

### 2. 温度设置
- **0.0-0.3**: 精确性任务（翻译、代码生成）
- **0.4-0.7**: 平衡性任务（对话、解释）
- **0.8-2.0**: 创造性任务（写作、头脑风暴）

### 3. 思考模式使用
- **简单问题**: `thinkingBudget: 0` (禁用)
- **中等复杂**: `thinkingBudget: -1` (动态)
- **高度复杂**: `thinkingBudget: 2000+` (固定预算)

### 4. 结构化输出
- 使用详细的JSON Schema
- 提供清晰的字段描述
- 标记必需字段

### 5. 函数调用
- 限制工具数量 (推荐≤20)
- 使用描述性的函数名
- 提供完整的参数说明

## 🔒 安全配置

```typescript
const safetyConfig = {
  modelName: 'gemini-2.5-flash',
  safetySettings: [
    {
      category: 'HARM_CATEGORY_HARASSMENT',
      threshold: 'BLOCK_MEDIUM_AND_ABOVE'
    },
    {
      category: 'HARM_CATEGORY_HATE_SPEECH',
      threshold: 'BLOCK_MEDIUM_AND_ABOVE'
    }
  ]
};
```

## 📊 监控和调试

所有LLM调用都会自动记录到数据库的 `llm_call_logs` 表中，包含：
- 配置参数
- 输入/输出令牌
- 响应时间
- 错误信息
- 成本估算

可以通过Admin Panel查看详细的调用记录和性能分析。

## 🚀 性能优化

1. **缓存配置验证结果**
2. **合理设置maxOutputTokens**
3. **根据任务类型选择合适的模型**
4. **监控Token使用情况**
5. **使用连接池管理数据库连接**

## 🔧 故障排除

### 常见错误
1. **Token失效**: 检查api_tokens表的健康状态
2. **配置验证失败**: 使用validateConfig检查参数
3. **模型不支持功能**: 查询getModelCapabilities
4. **响应超时**: 调整maxOutputTokens和thinking budget

### 调试技巧
- 启用详细日志记录
- 检查rawResponse获取完整API响应
- 使用validation检查配置
- 监控metrics中的性能指标

## 📝 测试

运行测试脚本验证功能：

```bash
node test_configurable_llm.js
```

这将测试所有主要功能并输出详细的结果。

---

🎉 **恭喜！** 你现在掌握了QQ智能机器人的完整可配置LLM系统。这个系统支持所有Gemini高级功能，让你能够构建更智能、更灵活的AI应用。