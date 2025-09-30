# 🐳 Docker部署实时LLM配置系统 - 一键部署指南

## 🎯 概述

本指南将帮助你在Docker环境中部署包含实时LLM参数配置系统的QQ Bot完整架构。

## 📋 前提条件

### 必需服务
- **Docker** (20.10+)
- **MySQL数据库** (5.7+ 或 8.0+)
- **NapCat QQ协议服务** (独立部署，端口3001)

### 环境变量准备
```bash
# 创建环境变量文件
cp .env.example .env

# 编辑环境变量
vim .env
```

**必填环境变量**:
```bash
# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=qqbot_user
DB_PASSWORD=qqbot_password
DB_NAME=qqbot_db

# QQ机器人配置
BOT_QQ_NUMBER=1129974489
WEBSOCKET_HOST=localhost
WEBSOCKET_PORT=3001
WEBSOCKET_ACCESS_TOKEN=w@123456

# Gemini API配置
GEMINI_API_KEY=your_gemini_api_key_here
AI_MODEL_NAME=gemini-2.5-flash

# 日志配置
LOG_LEVEL=info
```

## 🚀 一键部署流程

### Step 1: 构建所有镜像
```bash
# 构建所有4个模块的Docker镜像
./scripts/docker-deploy.sh all build
```

**预期输出**:
```
[INFO] 构建 qqbot-http-api 镜像...
[INFO] 构建 qqbot-qqbot-core 镜像...
[INFO] 构建 qqbot-admin-backend 镜像...
[INFO] 构建 qqbot-admin-frontend 镜像...
[SUCCESS] 所有镜像构建完成
```

### Step 2: 初始化数据库 🆕
```bash
# 初始化数据库（包含实时LLM配置系统）
./scripts/docker-deploy.sh all init-db
```

**功能**:
- ✅ 创建所有必需的数据表
- ✅ 初始化agent_prompts表和advanced_config字段
- ✅ 插入预设的LLM配置示例
- ✅ 设置触发器和索引

### Step 3: 启动所有服务
```bash
# 启动所有容器（宿主机网络模式）
./scripts/docker-deploy.sh all run
```

**启动的服务**:
- 🌐 **HTTP API Gateway**: localhost:8080
- 🤖 **QQBot Core**: localhost:8081
- 🛠️ **Admin Backend**: localhost:9080
- 📱 **Admin Frontend**: localhost:3003

### Step 4: 验证部署 🆕
```bash
# 检查服务状态
./scripts/docker-deploy.sh all status

# 测试LLM配置API
./scripts/docker-deploy.sh all test-config
```

## 🎛️ 管理界面访问

### Web管理界面
```
🌐 访问地址: http://localhost:3003
📊 功能: 实时LLM参数配置、对话时间线分析
```

### API接口
```
🔗 Admin API: http://localhost:9080/api/llm-config/
📖 主要端点:
  - GET /agents                    # 获取Agent列表
  - GET /agents/{id}               # 获取Agent详细配置
  - PUT /agents/{id}/advanced-config # 🎯 更新高级配置
  - POST /agents/{id}/test         # 测试配置效果
  - GET /tools                     # 获取可用工具
```

## 🔧 实时配置使用示例

### 1. 获取Agent列表
```bash
curl http://localhost:9080/api/llm-config/agents | jq
```

### 2. 实时调整参数 🎯
```bash
curl -X PUT http://localhost:9080/api/llm-config/agents/decision_engine_thinking/advanced-config \
  -H "Content-Type: application/json" \
  -d '{
    "advancedConfig": {
      "generationConfig": {
        "temperature": 0.2,
        "maxOutputTokens": 800
      },
      "thinkingConfig": {
        "thinkingBudget": 1500,
        "includeThoughts": true
      },
      "toolsConfig": {
        "enabled": true,
        "selectedTools": ["sentiment_analysis", "keyword_extraction"],
        "mode": "AUTO"
      }
    },
    "updatedBy": "admin_user"
  }'
```

### 3. 测试配置效果
```bash
curl -X POST http://localhost:9080/api/llm-config/agents/decision_engine_thinking/test \
  -H "Content-Type: application/json" \
  -d '{
    "testPrompt": "分析这条消息的情感倾向和关键信息",
    "userId": 12345
  }'
```

**预期响应**:
```json
{
  "success": true,
  "data": {
    "traceId": "test_decision_engine_thinking_1692345678",
    "response": {
      "content": "分析结果...",
      "thoughts": "我的思考过程：...",
      "functionCalls": [
        {
          "name": "analyze_sentiment",
          "args": {"text": "..."},
          "result": {"sentiment": "positive", "confidence": 0.85}
        }
      ],
      "metrics": {
        "inputTokens": 120,
        "outputTokens": 350,
        "processingTimeMs": 1250
      }
    }
  }
}
```

### 4. 热更新配置
```bash
# 更新配置到数据库
./scripts/docker-deploy.sh all update-config

# 配置立即生效，无需重启容器
```

## 📊 配置建议

### 决策引擎优化配置
```json
{
  "generationConfig": {
    "temperature": 0.2,
    "topP": 0.8,
    "maxOutputTokens": 500
  },
  "thinkingConfig": {
    "thinkingBudget": 800,
    "includeThoughts": true
  },
  "toolsConfig": {
    "enabled": true,
    "selectedTools": ["sentiment_analysis", "keyword_extraction"],
    "mode": "AUTO"
  }
}
```

### 聊天机器人增强配置
```json
{
  "generationConfig": {
    "temperature": 0.7,
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

## 🔍 故障排除

### 常见问题

#### 1. 数据库连接失败
```bash
# 检查MySQL容器状态
docker ps | grep mysql

# 检查网络连接
docker exec qqbot-qqbot-core ping mysql
```

#### 2. API调用失败
```bash
# 检查容器日志
./scripts/docker-deploy.sh admin-backend logs

# 检查端口状态
netstat -tulpn | grep :9080
```

#### 3. LLM配置不生效
```bash
# 检查数据库表结构
docker exec mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  -e "DESCRIBE agent_prompts;"

# 检查配置更新时间
docker exec mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  -e "SELECT id, config_version, last_config_update FROM agent_prompts;"
```

### 日志查看
```bash
# 查看特定模块日志
./scripts/docker-deploy.sh qqbot-core logs
./scripts/docker-deploy.sh admin-backend logs

# 查看所有容器状态
./scripts/docker-deploy.sh all status
```

### 重新部署
```bash
# 停止所有服务
./scripts/docker-deploy.sh all stop

# 删除容器（保留数据）
./scripts/docker-deploy.sh all remove

# 重新启动
./scripts/docker-deploy.sh all run

# 重新初始化数据库（如果需要）
./scripts/docker-deploy.sh all init-db
```

## 🛠️ 运维操作

### 备份配置
```bash
# 导出Agent配置
docker exec mysql mysqldump -u qqbot_user -pqqbot_password qqbot_db agent_prompts > backup_agent_prompts.sql

# 导出完整数据库
docker exec mysql mysqldump -u qqbot_user -pqqbot_password qqbot_db > backup_full.sql
```

### 监控指标
```bash
# 检查容器资源使用
docker stats qqbot-qqbot-core qqbot-admin-backend

# 检查API响应时间
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:9080/api/llm-config/agents

# 查看LLM调用统计
docker exec mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  -e "SELECT agent_type, COUNT(*) as call_count, AVG(processing_time_ms) as avg_time
      FROM llm_call_logs
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
      GROUP BY agent_type;"
```

### 性能优化
```bash
# 清理旧日志
find logs/ -name "*.log" -mtime +7 -delete

# 清理Docker缓存
docker system prune -f

# 重启性能低的容器
./scripts/docker-deploy.sh qqbot-core stop
./scripts/docker-deploy.sh qqbot-core run
```

## 🎉 部署完成确认

部署成功后，你应该能够：

✅ **访问管理界面**: http://localhost:3003
✅ **查看Agent列表**: 4个预设Agent配置
✅ **实时调整参数**: 在界面中修改LLM配置
✅ **测试配置效果**: 立即验证参数变更
✅ **查看调用日志**: 完整的LLM调用追踪
✅ **工具选择**: 7个预定义工具可选择

现在你可以根据对话时间线的分析结果，实时优化各个Agent的LLM参数，让QQ机器人更智能！🚀

## 📞 技术支持

如遇问题，请检查：
1. 所有环境变量是否正确配置
2. MySQL和NapCat服务是否正常运行
3. 容器日志中的错误信息
4. 网络端口是否可访问