# Token管理系统升级指南

## 概述

本项目已将原有的基于文件的Token管理系统升级为数据库驱动的智能Token管理系统，提供了更强大的功能和更好的可维护性。

## 新功能特性

### 🔄 智能轮换策略
- **优先级调度**: 支持Token优先级设置，高优先级Token优先使用
- **权重分配**: 可为Token设置权重，控制使用频率
- **负载均衡**: 根据使用率智能选择Token，避免单点过载

### 📊 每日使用限制
- **每日限额**: 每个Token支持设置每日最大使用次数
- **自动重置**: 每日自动重置使用计数
- **超限保护**: 超过限额的Token自动暂停使用

### 🏥 健康检查机制
- **定期检查**: 定时检查所有Token的有效性
- **实时验证**: 使用Gemini API进行真实健康状态验证
- **自动恢复**: 健康检查通过后自动恢复Token状态

### 🚫 智能黑名单管理
- **自动拉黑**: 连续错误超过阈值自动加入黑名单
- **定时恢复**: 黑名单Token在指定时间后自动恢复
- **手动管理**: 支持手动清除黑名单

### 📈 完整的使用统计
- **详细日志**: 记录每次Token使用的详细信息
- **性能监控**: 记录响应时间、成功率等指标
- **使用分析**: 提供Token使用趋势分析

## 迁移步骤

### 1. 运行数据库迁移

```bash
# 执行迁移脚本，将token.properties中的数据迁移到数据库
npm run ts-node scripts/migrate_tokens_to_db.ts
```

### 2. 验证迁移结果

```bash
# 检查数据库中的Token数据
mysql -u your_user -p your_database -e "SELECT COUNT(*) FROM api_tokens;"

# 查看Token统计
curl http://localhost:8080/api/tokens/stats
```

### 3. 配置健康检查

数据库迁移会自动插入默认的健康检查配置：

```sql
-- 查看健康检查配置
SELECT * FROM api_token_health_config;

-- 自定义配置示例
UPDATE api_token_health_config SET 
  check_interval_minutes = 15,  -- 15分钟检查一次
  max_error_count = 5,          -- 5次错误后拉黑
  blacklist_duration_minutes = 600  -- 拉黑10小时
WHERE id = 1;
```

## HTTP API接口

### Token统计信息
```bash
# 获取Token概览统计
GET /api/tokens/stats

# 获取详细Token信息
GET /api/tokens
```

### Token管理操作
```bash
# 激活/停用Token
POST /api/tokens/:id/activate
POST /api/tokens/:id/deactivate

# 运行健康检查
POST /api/tokens/health-check
POST /api/tokens/:id/health-check

# 清除黑名单
DELETE /api/tokens/blacklist
```

### 使用日志查询
```bash
# 获取Token使用日志
GET /api/tokens/:id/logs?limit=50&offset=0
```

## 数据库表结构

### api_tokens - Token信息表
```sql
CREATE TABLE api_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  token VARCHAR(255) UNIQUE NOT NULL,
  project_name VARCHAR(100) NOT NULL,
  project_id VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  is_healthy BOOLEAN DEFAULT TRUE,
  daily_limit INT DEFAULT 1000,
  daily_used INT DEFAULT 0,
  priority INT DEFAULT 1,
  weight DECIMAL(3,2) DEFAULT 1.00,
  blacklisted_until DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### api_token_logs - 使用日志表
```sql
CREATE TABLE api_token_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  token_id INT NOT NULL,
  action ENUM('use', 'success', 'error', 'health_check'),
  result ENUM('success', 'error', 'timeout', 'quota_exceeded'),
  response_time_ms INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 配置参数说明

### Token优先级设置
```sql
-- 设置Token优先级（1=最高优先级）
UPDATE api_tokens SET priority = 1 WHERE project_name = 'premium_project';
UPDATE api_tokens SET priority = 2 WHERE project_name = 'standard_project';
```

### 每日使用限制
```sql
-- 设置不同项目的每日使用限制
UPDATE api_tokens SET daily_limit = 2000 WHERE project_name = 'high_volume_project';
UPDATE api_tokens SET daily_limit = 500 WHERE project_name = 'low_volume_project';
```

### Token权重调整
```sql
-- 调整Token使用权重
UPDATE api_tokens SET weight = 2.0 WHERE project_name = 'preferred_project';
UPDATE api_tokens SET weight = 0.5 WHERE project_name = 'backup_project';
```

## 使用示例

### TypeScript代码示例
```typescript
import { getTokenManager } from './src/utils/token-manager';

// 获取Token管理器实例
const tokenManager = getTokenManager();

// 获取下一个可用Token
const token = await tokenManager.getNextToken();

// 报告使用成功
await tokenManager.reportSuccess(token, 1200, { tokens: 150 });

// 报告使用错误
await tokenManager.reportError(token, 'API quota exceeded', 5000);

// 获取统计信息
const stats = await tokenManager.getStats();
console.log(`总计: ${stats.total}, 活跃: ${stats.active}, 健康: ${stats.healthy}`);

// 运行健康检查
await tokenManager.runHealthCheck();
```

### REST API示例
```bash
# 获取Token状态
curl -X GET "http://localhost:8080/api/tokens/stats"

# 清除黑名单
curl -X DELETE "http://localhost:8080/api/tokens/blacklist"

# 激活Token
curl -X POST "http://localhost:8080/api/tokens/1/activate"

# 获取Token日志
curl -X GET "http://localhost:8080/api/tokens/1/logs?limit=10"
```

## 监控和运维

### 日常监控指标
1. **Token健康度**: `/api/tokens/stats`中的`healthy`字段
2. **黑名单数量**: `blacklisted`字段应保持较低水平
3. **每日限制**: `over_daily_limit`显示超限Token数量
4. **使用分布**: 观察各Token的使用频率是否均衡

### 告警设置建议
```bash
# 健康Token数量过低告警
healthy_tokens=$(curl -s http://localhost:8080/api/tokens/stats | jq '.data.healthy')
if [ "$healthy_tokens" -lt 3 ]; then
  echo "WARNING: Only $healthy_tokens healthy tokens available"
fi

# 黑名单Token过多告警
blacklisted_tokens=$(curl -s http://localhost:8080/api/tokens/stats | jq '.data.blacklisted')
if [ "$blacklisted_tokens" -gt 2 ]; then
  echo "WARNING: $blacklisted_tokens tokens are blacklisted"
fi
```

### 常见问题解决

#### Q: 所有Token都被拉黑了怎么办？
```bash
# 手动清除黑名单
curl -X DELETE "http://localhost:8080/api/tokens/blacklist"

# 或在数据库中直接操作
UPDATE api_tokens SET blacklisted_until = NULL, blacklist_reason = NULL WHERE blacklisted_until IS NOT NULL;
```

#### Q: Token使用不均衡怎么办？
```sql
-- 调整Token权重
UPDATE api_tokens SET weight = 1.5 WHERE daily_used < 100;
UPDATE api_tokens SET weight = 0.5 WHERE daily_used > 800;

-- 调整优先级
UPDATE api_tokens SET priority = 1 WHERE project_name = 'underused_project';
```

#### Q: 如何添加新Token？
```sql
INSERT INTO api_tokens 
(token, project_name, project_id, is_active, is_healthy, daily_limit, priority)
VALUES 
('your_new_token_here', 'new_project', 'proj_001', TRUE, TRUE, 1000, 1);
```

## 性能优化建议

1. **索引优化**: 确保关键查询字段有适当的索引
2. **日志清理**: 定期清理过旧的Token使用日志
3. **连接池**: 使用数据库连接池避免频繁建连
4. **缓存策略**: 对频繁查询的Token状态进行缓存

## 测试验证

运行测试套件验证系统功能：

```bash
# 运行Token管理测试
npm test tests/token-management.test.ts

# 运行HTTP API测试
npm test tests/token-http-api.test.ts

# 运行完整测试套件
npm test
```

## 更新日志

- **v2.0.0**: 完全重构为数据库驱动的Token管理系统
- **v2.0.1**: 增加健康检查和自动恢复机制
- **v2.0.2**: 完善HTTP API接口和监控功能

## 技术支持

如遇到问题，请按以下步骤排查：

1. 检查数据库连接状态
2. 查看Token健康检查日志
3. 验证Gemini API的可达性
4. 检查Token配置是否正确

更多技术细节请参考源码注释和测试用例。