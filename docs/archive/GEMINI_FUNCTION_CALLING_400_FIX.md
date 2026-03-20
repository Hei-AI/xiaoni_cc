# Gemini Function Calling 400 错误修复方案

**创建日期**: 2025-10-18
**问题ID**: Traffic Log #793
**错误类型**: Gemini API 400 Bad Request

---

## 📋 问题现象

### 错误信息
```json
{
  "error": {
    "code": 400,
    "message": "Please set allowed_function_names only when function calling mode is ANY.",
    "status": "INVALID_ARGUMENT"
  }
}
```

### 失败请求示例
- **URL**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`
- **Method**: POST
- **Status**: 400
- **Traffic Log ID**: 793
- **Timestamp**: 2025-10-18 08:11:57

### 请求体中的问题配置
```json
{
  "toolConfig": {
    "functionCallingConfig": {
      "mode": "AUTO",  // ❌ 模式是AUTO
      "allowedFunctionNames": [  // ❌ 但设置了allowedFunctionNames
        "send_private_chat_message",
        "send_qq_group_message"
      ]
    }
  }
}
```

---

## 🔍 根本原因分析

### Gemini API 规范
根据 [Google Gemini API 文档](https://ai.google.dev/api/generate-content#FunctionCallingConfig)：

| Mode | 说明 | allowedFunctionNames |
|------|------|---------------------|
| `AUTO` | Gemini 自动决定是否调用函数以及调用哪个函数 | ❌ **不允许设置** |
| `ANY` | 强制 Gemini 必须调用一个函数，可指定允许的函数列表 | ✅ **可以设置** |
| `NONE` | 禁用 function calling | ❌ **不允许设置** |

**关键规则**：
> `allowedFunctionNames` 字段**只能在 mode=ANY 时设置**。在 AUTO 或 NONE 模式下设置此字段会导致 400 错误。

### 代码中的问题

#### 问题位置 1: ai-service.ts - 函数注册中心分支
**文件**: `modules/qqbot-core/src/services/ai-service.ts:439-453`

```typescript
// ❌ 当前代码：无条件设置 allowedFunctionNames
if (registryData && registryData.functions.length > 0) {
  const customTools = registryData.functions.map((fn) => ({
    id: fn.id,
    name: fn.name,
    description: fn.description || '',
    parameters: fn.parametersSchema || {}
  }));

  return {
    functionCalling: {
      mode: legacyToolsConfig.functionCalling?.mode || 'AUTO',
      allowedFunctionNames: customTools.map(tool => tool.name),  // ❌ 无条件设置
      allowedFunctionIds: customTools.map(tool => tool.id)
    },
    // ...
  };
}
```

#### 问题位置 2: ai-service.ts - Legacy 配置分支
**文件**: `modules/qqbot-core/src/services/ai-service.ts:474-491`

```typescript
// ❌ 当前代码：无条件设置 allowedFunctionNames
const functionCalling = {
  mode: legacyToolsConfig.functionCalling?.mode || 'AUTO',
  allowedFunctionNames: legacyToolsConfig.functionCalling?.allowedFunctionNames
    || customTools.map((tool) => tool.name),  // ❌ 无条件设置
  allowedFunctionIds: customTools.map(tool => tool.id)
};
```

#### 问题位置 3: index.ts - LLM Job 配置构建
**文件**: `modules/qqbot-core/src/index.ts:1399-1405`

```typescript
// ❌ 当前代码：无条件设置 allowedFunctionNames
jobConfig.toolConfig = {
  functionCallingConfig: {
    mode: normalizedFunctionCallingMode,  // 可能是 AUTO
    allowedFunctionNames: allowedNames,    // ❌ 无条件设置
    allowedFunctionIds: allowedIds
  }
};
```

### 数据库配置验证
```sql
mysql> SELECT prompt_id, function_id, calling_mode
       FROM prompt_function_bindings
       WHERE prompt_id = 'prompt_1757840390268_2a255cfd8';

+----------------------------------+--------------------------------------+--------------+
| prompt_1757840390268_2a255cfd8   | 11111111-2222-3333-4444-555555555555 | AUTO         |
| prompt_1757840390268_2a255cfd8   | 66666666-7777-8888-9999-aaaaaaaaaaaa | AUTO         |
+----------------------------------+--------------------------------------+--------------+
```

数据库中配置的 `calling_mode` 是 `AUTO`，但代码仍然设置了 `allowedFunctionNames`，导致 API 拒绝请求。

---

## 🛠️ 修复方案

### 修复原则
**只在 `mode='ANY'` 时才设置 `allowedFunctionNames` 字段**

### 修复位置 1: ai-service.ts - 函数注册中心分支

**文件**: `modules/qqbot-core/src/services/ai-service.ts:439-453`

```typescript
// ✅ 修复后的代码
if (registryData && registryData.functions.length > 0) {
  const customTools = registryData.functions.map((fn) => ({
    id: fn.id,
    name: fn.name,
    description: fn.description || '',
    parameters: fn.parametersSchema || {}
  }));

  const callingMode = legacyToolsConfig.functionCalling?.mode || 'AUTO';
  const functionCallingConfig: any = {
    mode: callingMode
  };

  // ✅ 关键修复：只在 mode=ANY 时设置 allowedFunctionNames
  if (callingMode === 'ANY' && customTools.length > 0) {
    functionCallingConfig.allowedFunctionNames = customTools.map(tool => tool.name);
  }

  return {
    functionCalling: functionCallingConfig,
    predefinedTools: legacyToolsConfig?.predefinedTools || {
      enabledTools: [],
      callingMode: 'AUTO'
    },
    customTools,
    googleSearch: legacyToolsConfig?.googleSearch,
    urlContext: legacyToolsConfig?.urlContext,
    structuredOutput: legacyToolsConfig?.structuredOutput
  };
}
```

### 修复位置 2: ai-service.ts - Legacy 配置分支

**文件**: `modules/qqbot-core/src/services/ai-service.ts:474-491`

```typescript
// ✅ 修复后的代码
const customTools: Array<{
  id: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
}> = Array.isArray(legacyToolsConfig.customTools)
  ? legacyToolsConfig.customTools.map((tool: any) => ({
      id: tool.id || tool.name,
      name: tool.name || tool.id,
      description: tool.description || '',
      parameters: tool.parameters || {}
    }))
  : [];

const callingMode = legacyToolsConfig.functionCalling?.mode || 'AUTO';
const functionCallingConfig: any = {
  mode: callingMode
};

// ✅ 关键修复：只在 mode=ANY 时设置 allowedFunctionNames
if (callingMode === 'ANY') {
  const allowedNames = legacyToolsConfig.functionCalling?.allowedFunctionNames
    || customTools.map((tool) => tool.name);

  if (allowedNames.length > 0) {
    functionCallingConfig.allowedFunctionNames = allowedNames;
  }
}

return {
  functionCalling: functionCallingConfig,
  predefinedTools: legacyToolsConfig.predefinedTools || {
    enabledTools: [],
    callingMode: 'AUTO'
  },
  customTools,
  googleSearch: legacyToolsConfig.googleSearch,
  urlContext: legacyToolsConfig.urlContext,
  structuredOutput: legacyToolsConfig.structuredOutput
};
```

### 修复位置 3: index.ts - LLM Job 配置构建

**文件**: `modules/qqbot-core/src/index.ts:1399-1405`

```typescript
// ✅ 修复后的代码
const functionCallingConfig: any = {
  mode: normalizedFunctionCallingMode
};

// ✅ 关键修复：只在 mode=ANY 时设置 allowedFunctionNames
if (normalizedFunctionCallingMode === 'ANY' && allowedNames.length > 0) {
  functionCallingConfig.allowedFunctionNames = allowedNames;
}

jobConfig.toolConfig = {
  functionCallingConfig
};
```

### 额外优化：移除 allowedFunctionIds

`allowedFunctionIds` 是内部自定义字段，不是 Gemini API 的标准字段。建议：
- 从 `functionCallingConfig` 中移除
- 如需保留，移到 `metadata` 或其他自定义字段中

---

## 📊 修复后效果对比

### 修复前（错误）
```json
{
  "toolConfig": {
    "functionCallingConfig": {
      "mode": "AUTO",
      "allowedFunctionNames": ["send_private_chat_message", "send_qq_group_message"]  // ❌
    }
  }
}
```

### 修复后（正确）

#### Case 1: mode=AUTO
```json
{
  "toolConfig": {
    "functionCallingConfig": {
      "mode": "AUTO"
      // ✅ 不包含 allowedFunctionNames
    }
  }
}
```

#### Case 2: mode=ANY
```json
{
  "toolConfig": {
    "functionCallingConfig": {
      "mode": "ANY",
      "allowedFunctionNames": ["send_private_chat_message", "send_qq_group_message"]  // ✅
    }
  }
}
```

#### Case 3: mode=NONE
```json
{
  "toolConfig": {
    "functionCallingConfig": {
      "mode": "NONE"
      // ✅ 不包含 allowedFunctionNames
    }
  }
}
```

---

## 🧪 验证计划

### 1. 代码修改验证
- [ ] 修改 `modules/qqbot-core/src/services/ai-service.ts` 的两处
- [ ] 修改 `modules/qqbot-core/src/index.ts` 的一处
- [ ] 代码审查确认逻辑正确

### 2. 编译验证
```bash
cd modules/qqbot-core
npm run build
```

### 3. 单元测试（如有）
```bash
npm test -- ai-service.test.ts
npm test -- function-registry-client.test.ts
```

### 4. 集成测试
```bash
# 重启服务
docker compose restart qqbot-core

# 查看日志
docker logs -f qqbot-qqbot-core

# 模拟消息触发 AI 调用
curl -X POST http://localhost:8081/api/simple-queue/simulate/private \
  -H "Content-Type: application/json" \
  -d '{"user_id": 123456, "message": "测试消息"}'
```

### 5. 流量监控验证
```bash
# 查看最新的 Gemini API 调用
docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  -e "SELECT id, method, url, response_status, error_message
      FROM http_traffic_logs
      WHERE is_ai_request = 1
      ORDER BY request_timestamp DESC
      LIMIT 5\G"
```

**期望结果**：
- 响应状态码为 200（成功）
- 无 400 错误
- error_message 为 NULL

### 6. 不同 Mode 场景测试

#### 测试场景 1: AUTO mode
```sql
UPDATE prompt_function_bindings
SET calling_mode = 'AUTO'
WHERE prompt_id = 'prompt_1757840390268_2a255cfd8';
```
**期望**：API 请求成功，Gemini 自动选择是否调用函数

#### 测试场景 2: ANY mode
```sql
UPDATE prompt_function_bindings
SET calling_mode = 'ANY'
WHERE prompt_id = 'prompt_1757840390268_2a255cfd8';
```
**期望**：API 请求成功，Gemini 强制调用指定函数之一

#### 测试场景 3: NONE mode
```sql
UPDATE prompt_function_bindings
SET calling_mode = 'NONE'
WHERE prompt_id = 'prompt_1757840390268_2a255cfd8';
```
**期望**：API 请求成功，不使用 function calling

---

## 📝 相关文档

- [Gemini API Function Calling 文档](https://ai.google.dev/api/generate-content#FunctionCallingConfig)
- [项目 LLM 函数调用注册中心设计](./llm_function_calling_registry_design.md)
- [LLM 工具执行设计](./LLM_TOOL_EXECUTION_DESIGN.md)
- [Traffic Log #793 详情](http://localhost:3003/traffic/793)

---

## 🔄 后续改进建议

### 1. 增加配置验证
在构建配置时添加验证逻辑：
```typescript
function validateFunctionCallingConfig(config: FunctionCallingConfig): void {
  if (config.mode !== 'ANY' && config.allowedFunctionNames) {
    throw new Error(
      `allowedFunctionNames can only be set when mode is ANY, current mode: ${config.mode}`
    );
  }
}
```

### 2. 添加单元测试
```typescript
describe('buildToolsConfig', () => {
  it('should not include allowedFunctionNames when mode is AUTO', async () => {
    const config = await aiService.buildToolsConfig({
      /* prompt with mode=AUTO */
    });
    expect(config.functionCalling.allowedFunctionNames).toBeUndefined();
  });

  it('should include allowedFunctionNames when mode is ANY', async () => {
    const config = await aiService.buildToolsConfig({
      /* prompt with mode=ANY */
    });
    expect(config.functionCalling.allowedFunctionNames).toBeDefined();
  });
});
```

### 3. 日志增强
添加更详细的配置日志：
```typescript
this.moduleLogger.debug('Function calling config built', {
  mode: functionCallingConfig.mode,
  hasAllowedFunctionNames: !!functionCallingConfig.allowedFunctionNames,
  functionCount: customTools.length
});
```

### 4. 文档更新
更新 `CLAUDE.md` 和相关文档，明确说明 function calling mode 的使用规范。

---

**最后更新**: 2025-10-18
