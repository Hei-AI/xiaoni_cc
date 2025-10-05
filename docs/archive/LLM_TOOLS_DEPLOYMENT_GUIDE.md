# LLM 工具系统部署指南

> 创建时间: 2025-10-03
> 当前状态: 代码集成完成 ✅ | 待部署测试 🚧

---

## 📋 部署前检查清单

### ✅ 已完成
- [x] 数据库表结构设计 (`010_create_llm_tool_system_tables.sql`)
- [x] 核心服务实现 (ToolRegistryService, FunctionCallDispatcher, LLMJobWorker)
- [x] 静态工具库 (get_current_time, calculate, log_memo)
- [x] AIService.generateContent() 方法
- [x] 消息流集成 (handleEnhancedAIConversation)
- [x] 事件监听和响应发送
- [x] 环境变量配置
- [x] 迁移脚本 (`scripts/migrate-llm-tools.sh`)
- [x] TypeScript 编译验证

### 🚧 待完成
- [ ] 执行数据库迁移
- [ ] Docker 重新构建镜像
- [ ] 启动服务验证初始化
- [ ] 端到端功能测试

---

## 🚀 部署步骤

### 步骤 1: 启动 Docker 服务

```bash
# 启动 Docker
sudo service docker start

# 验证 Docker 状态
docker ps
```

### 步骤 2: 启动 MySQL 容器

```bash
# 启动所有服务
docker compose up -d

# 仅启动 MySQL
docker compose up -d mysql

# 验证 MySQL 运行
docker ps --filter "name=qqbot-mysql"
```

### 步骤 3: 执行数据库迁移

```bash
# 使用迁移脚本（推荐）
./scripts/migrate-llm-tools.sh

# 手动执行迁移（备选）
docker exec -i qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  < database/migrations/010_create_llm_tool_system_tables.sql
```

**迁移内容**:
- 创建 `llm_jobs` 表（LLM 异步任务队列）
- 创建 `llm_tools` 表（动态工具注册表）
- 创建 `tool_execution_logs` 表（工具执行日志）
- 扩展 `llm_call_logs` 表（添加工具相关字段）
- 扩展 `timeline_events` 表（支持工具事件）

### 步骤 4: 验证表结构

```bash
# 检查表是否创建成功
docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "
  SHOW TABLES LIKE 'llm_%';
  SHOW TABLES LIKE 'tool_%';
"

# 查看 llm_jobs 表结构
docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "
  DESCRIBE llm_jobs;
"
```

### 步骤 5: 重新构建 qqbot-core 镜像

```bash
# 使用 docker compose 构建
docker compose build qqbot-core

# 手动构建
docker build -t qqbot-core:latest -f modules/qqbot-core/Dockerfile modules/qqbot-core/
```

**重要**: 确保新代码（AIService.generateContent(), LLMJobWorker 集成等）被打包进镜像。

### 步骤 6: 启动 qqbot-core 服务

```bash
# 停止旧容器（如果在运行）
docker stop qqbot-qqbot-core
docker rm qqbot-qqbot-core

# 启动新容器
docker compose up -d qqbot-core

# 查看启动日志
docker logs -f qqbot-qqbot-core
```

**期望日志输出**:
```
[info] ✅ Database connected
[info] [FunctionCallDispatcher] Initialized
[info] [FunctionCallDispatcher] Registered static tool: get_current_time
[info] [FunctionCallDispatcher] Registered static tool: calculate
[info] [FunctionCallDispatcher] Registered static tool: log_memo
[info] ✅ LLMJobWorker started (tools enabled)  # 如果 ENABLE_LLM_TOOLS=true
[info] ✅ HTTP server started
[info] ✅ WebSocket client connected
```

### 步骤 7: 验证工具系统初始化

```bash
# 检查容器日志
docker logs qqbot-qqbot-core 2>&1 | grep -i "llm\|tool\|worker"

# 进入容器检查环境变量
docker exec qqbot-qqbot-core env | grep LLM

# 查询 llm_jobs 表
docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "
  SELECT COUNT(*) as job_count FROM llm_jobs;
"
```

---

## 🧪 测试验证

### 测试 1: 静态工具注册验证

```bash
# 进入容器
docker exec -it qqbot-qqbot-core /bin/sh

# 运行测试
npm test -- static-tools.test.ts
```

### 测试 2: 创建测试 Job

**方法 A**: 使用 HTTP API（如果有暴露接口）

```bash
curl -X POST http://localhost:8081/api/llm/test-job \
  -H "Content-Type: application/json" \
  -d '{
    "message": "现在几点了？"
  }'
```

**方法 B**: 直接插入数据库测试

```sql
-- 在 MySQL 中执行
INSERT INTO llm_jobs (
  id, trace_id, source_key, source_type, status,
  retry_count, max_retries, contents_json, current_turn, max_turns,
  created_at, updated_at
) VALUES (
  UUID(),
  'test-trace-001',
  'user_12345',
  'private',
  'pending',
  0,
  3,
  '[{"role":"user","parts":[{"text":"测试消息：现在几点了？"}]}]',
  1,
  10,
  NOW(),
  NOW()
);

-- 查看 Job 状态
SELECT id, status, current_turn, final_response, error_message
FROM llm_jobs
ORDER BY created_at DESC
LIMIT 5;
```

### 测试 3: 端到端消息处理（需要启用工具系统）

**前置条件**: 设置 `ENABLE_LLM_TOOLS=true` 并重启服务

```bash
# 1. 修改 .env 文件
# ENABLE_LLM_TOOLS=true

# 2. 重启服务
docker compose stop qqbot-core
docker compose up -d qqbot-core

# 3. 发送测试消息（通过 QQ）
# 向机器人发送："现在几点了？"

# 4. 观察日志
docker logs -f qqbot-qqbot-core

# 5. 查询 Job 记录
docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "
  SELECT
    id,
    source_key,
    status,
    current_turn,
    LEFT(final_response, 100) as response_preview,
    created_at,
    completed_at
  FROM llm_jobs
  ORDER BY created_at DESC
  LIMIT 10;
"
```

---

## 🔧 故障排查

### 问题 1: LLMJobWorker 未启动

**症状**: 日志中没有 "✅ LLMJobWorker started"

**原因**: `ENABLE_LLM_TOOLS=false` 或未设置

**解决**:
```bash
# 检查环境变量
docker exec qqbot-qqbot-core env | grep ENABLE_LLM_TOOLS

# 修改 modules/qqbot-core/.env
ENABLE_LLM_TOOLS=true

# 重新构建和启动
docker compose build qqbot-core
docker compose up -d qqbot-core
```

### 问题 2: 数据库表不存在

**症状**: 错误日志 "Table 'qqbot_db.llm_jobs' doesn't exist"

**原因**: 未执行迁移或迁移失败

**解决**:
```bash
# 重新执行迁移
./scripts/migrate-llm-tools.sh

# 验证表存在
docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "SHOW TABLES LIKE 'llm%';"
```

### 问题 3: Job 创建但不处理

**症状**: `llm_jobs` 表中 status 一直是 'pending'

**可能原因**:
1. LLMJobWorker 未启动（`ENABLE_LLM_TOOLS=false`）
2. Worker 轮询间隔过长
3. Worker 崩溃或错误

**解决**:
```bash
# 检查 Worker 状态
docker logs qqbot-qqbot-core 2>&1 | grep -i "worker\|polling"

# 查看错误日志
docker logs qqbot-qqbot-core 2>&1 | grep -i error

# 检查 Job 队列
docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "
  SELECT status, COUNT(*) as count FROM llm_jobs GROUP BY status;
"
```

### 问题 4: 工具调用失败

**症状**: `tool_execution_logs` 表中 status='failed'

**解决**:
```bash
# 查看失败的工具执行记录
docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "
  SELECT
    tool_name,
    error_message,
    arguments,
    started_at
  FROM tool_execution_logs
  WHERE status = 'failed'
  ORDER BY started_at DESC
  LIMIT 10;
"

# 检查静态工具实现
cat modules/qqbot-core/src/tools/static-tools.ts
```

---

## 📊 监控和调试

### 实时监控 Job 处理

```bash
# 终端 1: 监控日志
docker logs -f qqbot-qqbot-core

# 终端 2: 监控数据库
watch -n 2 'docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "
  SELECT status, COUNT(*) FROM llm_jobs GROUP BY status;
"'

# 终端 3: 监控工具执行
watch -n 2 'docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "
  SELECT tool_name, status, COUNT(*) FROM tool_execution_logs GROUP BY tool_name, status;
"'
```

### 性能统计查询

```sql
-- Job 处理性能
SELECT
  status,
  COUNT(*) as count,
  AVG(TIMESTAMPDIFF(SECOND, created_at, completed_at)) as avg_duration_sec,
  MAX(TIMESTAMPDIFF(SECOND, created_at, completed_at)) as max_duration_sec
FROM llm_jobs
WHERE completed_at IS NOT NULL
GROUP BY status;

-- 工具调用统计
SELECT
  tool_name,
  COUNT(*) as total_calls,
  SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success_count,
  AVG(duration_ms) as avg_duration_ms,
  MAX(duration_ms) as max_duration_ms
FROM tool_execution_logs
GROUP BY tool_name;

-- 最近的失败记录
SELECT
  trace_id,
  source_key,
  error_message,
  created_at
FROM llm_jobs
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 🎯 下一步计划

### 短期目标
1. ✅ 完成基础集成部署
2. ⏳ 测试静态工具功能
3. ⏳ 验证端到端消息流
4. ⏳ 性能和稳定性测试

### 中期目标
1. 动态工具注册和管理
2. Admin Panel 工具管理界面
3. 工具权限和安全控制
4. 时间线可视化扩展

### 长期目标
1. 多租户工具隔离
2. 工具市场和共享
3. A/B 测试支持
4. 自动化工具发现和推荐

---

## 📚 相关文档

- **设计文档**: `docs/LLM_TOOL_EXECUTION_DESIGN.md`
- **实现总结**: `docs/HUMAN_LIKE_PROCESSOR_IMPLEMENTATION.md`
- **集成状态**: `docs/LLM_TOOLS_INTEGRATION_STATUS.md`
- **数据库迁移**: `database/migrations/010_create_llm_tool_system_tables.sql`
- **迁移脚本**: `scripts/migrate-llm-tools.sh`

---

**最后更新**: 2025-10-03
**维护者**: Claude Code
