# AI服务故障排查指南

## 快速诊断清单

当用户反馈"无法处理"或AI服务异常时，按以下顺序排查：

### 1. 检查conversation记录 ⏱️ 2分钟
```bash
# 查询特定conversation的详细信息
node -e "
const { getDatabaseManager } = require('./dist/services/database');
const config = require('./dist/config');
const db = getDatabaseManager(config.default.database);
db.getConversationById('CONVERSATION_ID').then(result => {
  console.log(JSON.stringify(result, null, 2));
  db.close();
});
"
```

**关键字段分析**:
- `ai_response`: 如果是"抱歉，我现在无法处理..."则确认是系统故障
- `raw_response`: 包含具体错误信息
- `response_time`: 异常长的响应时间表明API调用问题

### 2. 检查AI服务日志 ⏱️ 3分钟
```bash
# 查看当日AI服务日志
tail -50 logs/ai-service_$(date +%Y-%m-%d).log

# 查找特定错误模式
grep -E "(error|Error|ERROR)" logs/ai-service_$(date +%Y-%m-%d).log | tail -10
```

**常见错误模式**:
- `cached.updated_at.getTime is not a function` → 缓存类型错误
- `Request failed with status code 400` → API调用参数错误  
- `All tokens are blacklisted` → Token配额问题
- `Failed to extract response text` → API响应格式异常

### 3. 检查Token状态 ⏱️ 1分钟
```bash
# 检查Token管理器状态
node -e "
const { getTokenManager } = require('./dist/utils/token-manager');
console.log(JSON.stringify(getTokenManager().getStats(), null, 2));
"
```

**健康指标**:
- `available > 0`: 至少有可用Token
- `blacklisted < total`: 不是所有Token都被黑名单
- 单个Token的`errorCount < 3`: Token工作正常

## 常见问题解决方案

### Problem 1: 缓存类型错误
**症状**: `cached.updated_at.getTime is not a function`  
**根因**: 数据库返回string类型的时间戳，代码期望Date对象  
**解决**:
```bash
# 验证修复已部署
npm run build && npm start
```

### Problem 2: Token配额耗尽
**症状**: `All tokens are blacklisted` 或 `Request failed with status code 429`  
**临时解决**:
```bash
# 清除Token黑名单
node -e "
const { getTokenManager } = require('./dist/utils/token-manager');
getTokenManager().clearBlacklist();
console.log('Token blacklist cleared');
"
```

**长期解决**: 检查Token使用量，考虑增加新Token

### Problem 3: API响应解析失败
**症状**: `Failed to extract response text from Gemini API`  
**排查步骤**:
1. 检查Gemini API服务状态
2. 验证API响应格式是否变更
3. 检查模型名称是否正确 (`gemini-2.5-flash`)

### Problem 4: 数据库连接问题
**症状**: `Database pool not initialized`  
**解决**:
```bash
# 测试数据库连接
npm test -- --testNamePattern="Database connection"

# 重启服务
pkill -f "node dist/index.js" && npm run build && npm start
```

## 日志分析技巧

### 1. 按时间范围查找问题
```bash
# 查找特定时间段的错误
grep "2025-09-01T18:01" logs/ai-service_2025-09-01.log | grep -E "(error|warn)"
```

### 2. 追踪特定用户的问题
```bash
# 查找特定用户的对话记录
grep "userId.*85178516" logs/ai-service_$(date +%Y-%m-%d).log
```

### 3. 统计错误频次
```bash
# 统计各类错误的出现次数
grep -o '"error":"[^"]*"' logs/ai-service_$(date +%Y-%m-%d).log | sort | uniq -c | sort -nr
```

## 预防性检查

### 每日健康检查
```bash
#!/bin/bash
# daily-health-check.sh

echo "=== AI Service Health Check ==="
echo "Date: $(date)"

# 1. 检查Token状态
echo "--- Token Status ---"
node -e "
const { getTokenManager } = require('./dist/utils/token-manager');
const stats = getTokenManager().getStats();
console.log('Available tokens:', stats.available);
console.log('Blacklisted tokens:', stats.blacklisted);
"

# 2. 检查最近错误
echo "--- Recent Errors ---"
grep -E "(error|Error)" logs/ai-service_$(date +%Y-%m-%d).log | tail -5

# 3. 检查服务状态
echo "--- Service Status ---"
curl -s http://localhost:8080/api/status | jq '.ai_service'

echo "=== Check Complete ==="
```

### 性能监控指标
- **响应时间**: `response_time < 10000ms`
- **成功率**: API调用成功率 > 95%
- **Token轮换**: 单个Token日使用次数均匀分布
- **缓存命中率**: 缓存有效访问比例 > 80%

## 紧急响应流程

### 1. 立即响应 (5分钟内)
- [ ] 确认问题影响范围
- [ ] 检查服务基础状态 (数据库、WebSocket)
- [ ] 查看最近5分钟的错误日志

### 2. 初步诊断 (15分钟内)
- [ ] 使用本指南快速诊断清单
- [ ] 确定问题类别 (Token、缓存、API、数据库)
- [ ] 尝试常见问题解决方案

### 3. 深入排查 (30分钟内)
- [ ] 分析conversation记录和日志
- [ ] 识别问题根因
- [ ] 制定修复方案

### 4. 修复验证 (45分钟内)
- [ ] 实施修复
- [ ] 运行测试验证
- [ ] 监控修复效果

## 测试验证命令

### 基础功能测试
```bash
# 测试AI服务基础功能
npm test tests/cache-fix-simple.test.ts

# 测试数据库连接
npm test -- --testNamePattern="Database connection"
```

### 集成测试
```bash
# 完整的AI服务集成测试
npm test tests/ai-service-cache-fix.test.ts

# 端到端对话测试
npm test tests/end-to-end-conversation.test.ts
```

## 联系升级

当以下情况发生时，立即升级到高级工程师：
- 问题影响超过10个用户
- 连续1小时无法自行解决
- 涉及数据库结构变更
- 需要修改核心AI服务逻辑

---
**文档版本**: v1.0  
**最后更新**: 2025-09-01  
**维护者**: Claude Gemini API Troubleshooter Team