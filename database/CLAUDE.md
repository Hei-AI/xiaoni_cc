# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 数据库架构 (database/)

## 数据库设计概述
MySQL 8.0数据库，支持QQ机器人的对话历史、需求管理、系统日志和状态监控。使用UTF8MB4编码支持emoji和特殊字符。

## 数据库配置

### Docker部署
```bash
# 启动MySQL容器
docker run -d --name qqbot_mysql --restart always \
  -e MYSQL_ROOT_PASSWORD=qqbot_root_password \
  -e MYSQL_DATABASE=qqbot_db \
  -e MYSQL_USER=qqbot_user \
  -e MYSQL_PASSWORD=qqbot_password \
  -p 3306:3306 \
  -v qqbot_mysql_data:/var/lib/mysql \
  -v $(pwd)/database/init.sql:/docker-entrypoint-initdb.d/init.sql \
  mysql:8.0 --default-authentication-plugin=mysql_native_password
```

### 连接参数
- **主机**: localhost:3306
- **数据库**: qqbot_db
- **用户**: qqbot_user/qqbot_password
- **字符集**: utf8mb4_unicode_ci
- **时区**: +08:00

## 核心数据表结构

### conversations - 对话历史表
**存储AI对话记录和上下文信息**
```sql
CREATE TABLE conversations (
    id VARCHAR(36) PRIMARY KEY,              -- UUID对话ID
    user_id BIGINT NOT NULL,                 -- 用户QQ号  
    user_message TEXT NOT NULL,              -- 用户消息内容
    ai_response TEXT NOT NULL,               -- AI回复内容
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, -- 对话时间
    response_time INT DEFAULT 0,             -- AI响应时间(毫秒)
    model_name VARCHAR(50),                  -- AI模型名称
    raw_request TEXT,                        -- 原始API请求JSON
    raw_response TEXT,                       -- 原始API响应JSON
    message_id BIGINT,                       -- 关联的QQ消息ID
    reply_to_message_id BIGINT,              -- 回复的消息ID
    reply_to_text TEXT,                      -- 回复的消息内容
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_id (user_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_message_id (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**使用场景**:
- 用户对话历史查询
- AI响应性能分析
- 上下文相关回复
- 消息链追踪

### group_message_history - 群聊消息历史表
**记录群聊中所有成员与机器人的消息气泡，用于构建上下文窗口**
```sql
CREATE TABLE group_message_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id VARCHAR(36),
    message_id BIGINT,
    group_id BIGINT NOT NULL,
    sender_id BIGINT NOT NULL,
    sender_role ENUM('user', 'bot', 'system') DEFAULT 'user',
    content_type ENUM('text', 'image', 'audio', 'video') DEFAULT 'text',
    content TEXT NOT NULL,
    raw_payload JSON,
    sent_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**使用场景**:
- 群聊上下文构建（ContextManager）
- 历史消息回溯、审计
- 消息级别的洞察与统计

### private_message_history - 私聊消息历史表
**记录私聊窗口的每一条消息（包括机器人回复）**
```sql
CREATE TABLE private_message_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id VARCHAR(36),
    message_id BIGINT,
    user_id BIGINT NOT NULL,
    sender_id BIGINT NOT NULL,
    sender_role ENUM('user', 'bot', 'system') DEFAULT 'user',
    content_type ENUM('text', 'image', 'audio', 'video') DEFAULT 'text',
    content TEXT NOT NULL,
    raw_payload JSON,
    sent_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**使用场景**:
- 私聊上下文拼装
- 精准追踪机器人是否真正回复
- 辅助人类值班查看会话完整轨迹

### requirements - 需求管理表
**Claude Code需求处理状态跟踪**
```sql
CREATE TABLE requirements (
    id VARCHAR(36) PRIMARY KEY,              -- UUID需求ID
    user_id BIGINT NOT NULL,                 -- 需求提出者QQ号
    message TEXT NOT NULL,                   -- 需求描述
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 需求创建时间
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    claude_code_output TEXT,                 -- Claude Code执行输出
    completion_details TEXT,                 -- 完成详情描述
    error_message TEXT,                      -- 错误信息
    processing_start_time DATETIME,          -- 开始处理时间
    processing_end_time DATETIME,            -- 处理完成时间
    
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**状态流转**:
- `pending` → `processing` → `completed`
- `pending` → `processing` → `failed`

### system_logs - 系统日志表
**结构化系统运行日志存储**
```sql
CREATE TABLE system_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    log_level ENUM('DEBUG', 'INFO', 'WARN', 'ERROR') NOT NULL,
    module_name VARCHAR(50) NOT NULL,        -- 模块名称
    message TEXT NOT NULL,                   -- 日志消息
    extra_data JSON,                         -- 额外数据(JSON格式)
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_log_level (log_level),
    INDEX idx_module_name (module_name),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**日志级别**:
- `DEBUG`: 调试信息
- `INFO`: 一般信息  
- `WARN`: 警告信息
- `ERROR`: 错误信息

### bot_status - 机器人状态表
**实时监控机器人运行状态**
```sql
CREATE TABLE bot_status (
    bot_id VARCHAR(20) PRIMARY KEY,          -- 机器人QQ号
    status VARCHAR(20) NOT NULL,             -- 运行状态
    websocket_connected BOOLEAN DEFAULT FALSE, -- WebSocket连接状态
    http_server_running BOOLEAN DEFAULT FALSE, -- HTTP服务器状态
    last_heartbeat DATETIME,                 -- 最后心跳时间
    error_message TEXT,                      -- 错误消息
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_status (status),
    INDEX idx_last_heartbeat (last_heartbeat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 新增数据表 (Token管理和Session管理)

### api_tokens - API Token管理表
**数据库驱动的Gemini API Token轮换系统**
```sql
CREATE TABLE api_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(255) NOT NULL,             -- API Token值
    project_name VARCHAR(100) NOT NULL,      -- 项目名称
    project_id VARCHAR(50) NOT NULL,         -- Google项目ID
    is_active BOOLEAN DEFAULT TRUE,          -- 是否激活
    is_healthy BOOLEAN DEFAULT TRUE,         -- 健康状态
    daily_limit INT DEFAULT 1000,            -- 每日用量限制
    daily_used INT DEFAULT 0,                -- 每日已使用量
    total_used BIGINT DEFAULT 0,             -- 总使用量
    last_reset_date DATE DEFAULT (CURDATE()), -- 上次重置日期
    last_used DATETIME,                      -- 最后使用时间
    last_health_check DATETIME,              -- 最后健康检查时间
    error_count INT DEFAULT 0,               -- 错误计数
    last_error TEXT,                         -- 最后错误信息
    last_error_time DATETIME,                -- 最后错误时间
    priority INT DEFAULT 5,                  -- 优先级 (1-10, 越小越优先)
    weight DECIMAL(3,2) DEFAULT 1.00,        -- 权重 (负载均衡用)
    blacklisted_until DATETIME,              -- 黑名单截止时间
    blacklist_reason TEXT,                   -- 黑名单原因
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE INDEX idx_token (token),
    INDEX idx_is_active_healthy (is_active, is_healthy),
    INDEX idx_priority (priority),
    INDEX idx_blacklisted_until (blacklisted_until),
    INDEX idx_last_used (last_used)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**设计特点**:
- **智能选择**: 基于优先级、权重、健康状态和使用频率的多维度Token选择
- **自动恢复**: 黑名单Token定期自动尝试恢复
- **用量控制**: 每日用量限制和自动重置机制
- **完整日志**: 所有Token使用和健康检查记录

### api_token_logs - Token使用日志表
**详细记录Token使用情况和性能指标**
```sql
CREATE TABLE api_token_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    token_id INT NOT NULL,                   -- 关联Token ID
    action ENUM('use', 'success', 'error', 'health_check') NOT NULL, -- 操作类型
    result ENUM('success', 'error', 'timeout', 'quota_exceeded'), -- 结果
    error_message TEXT,                      -- 错误信息
    response_time_ms INT,                    -- 响应时间(毫秒)
    gemini_usage JSON,                       -- Gemini API使用情况
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (token_id) REFERENCES api_tokens(id) ON DELETE CASCADE,
    INDEX idx_token_id (token_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### api_token_health_config - Token健康检查配置表
**集中管理Token健康检查参数**
```sql
CREATE TABLE api_token_health_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    check_interval_minutes INT DEFAULT 30,   -- 检查间隔(分钟)
    max_error_count INT DEFAULT 5,           -- 最大错误次数
    blacklist_duration_minutes INT DEFAULT 60, -- 黑名单持续时间(分钟)
    health_check_timeout_ms INT DEFAULT 5000,   -- 健康检查超时(毫秒)
    daily_reset_hour INT DEFAULT 0,          -- 每日重置时间(小时)
    enabled BOOLEAN DEFAULT TRUE,            -- 是否启用
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### conversation_sessions - 对话会话管理表
**支持多服务协调的会话状态跟踪**
```sql
CREATE TABLE conversation_sessions (
    session_id VARCHAR(36) PRIMARY KEY,      -- 会话UUID
    user_id BIGINT NOT NULL,                 -- 用户QQ号
    session_type ENUM('chat', 'requirement', 'mixed') NOT NULL, -- 会话类型
    current_service VARCHAR(50) NOT NULL,    -- 当前服务
    status ENUM('active', 'paused', 'completed', 'expired') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expires_at DATETIME,                     -- 过期时间
    conversation_context JSON,               -- 对话上下文
    business_context JSON,                   -- 业务上下文
    message_count INT DEFAULT 0,             -- 消息计数
    
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at),
    INDEX idx_last_activity (last_activity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**使用场景**:
- **智能服务切换**: 根据用户消息内容自动在聊天和需求处理服务间切换
- **上下文保持**: 维护跨服务的对话历史和业务状态
- **会话管理**: 30分钟超时自动清理，支持手动完成和暂停

### session_service_transitions - 服务切换历史表
**记录会话中的服务切换轨迹**
```sql
CREATE TABLE session_service_transitions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,         -- 关联会话ID
    from_service VARCHAR(50),                -- 源服务
    to_service VARCHAR(50) NOT NULL,         -- 目标服务
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, -- 切换时间
    trigger_type ENUM('USER_REQUEST', 'AUTO_DETECT', 'TIMEOUT') NOT NULL, -- 触发原因
    confidence DECIMAL(5,2) DEFAULT 0.00,    -- 切换置信度
    trigger_message TEXT,                    -- 触发消息
    
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(session_id) ON DELETE CASCADE,
    INDEX idx_session_id (session_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_trigger_type (trigger_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### agent_prompts - AI Agent提示词配置表
**动态管理不同类型AI Agent的提示词模板**
```sql
CREATE TABLE agent_prompts (
    id VARCHAR(36) PRIMARY KEY,
    agent_type ENUM('chat_bot', 'intent_analyzer', 'requirement_processor', 'custom') NOT NULL,
    prompt_name VARCHAR(100) NOT NULL,       -- 提示词名称
    system_instructions JSON NOT NULL,       -- 系统指令数组
    user_prompt_template TEXT,               -- 用户提示模板
    context_variables JSON,                  -- 上下文变量
    model_config JSON,                       -- 模型配置
    is_active BOOLEAN DEFAULT TRUE,          -- 是否激活
    version INT DEFAULT 1,                   -- 版本号
    created_by VARCHAR(50) NOT NULL,         -- 创建者
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    description TEXT,                        -- 描述信息
    
    UNIQUE INDEX idx_prompt_name_version (prompt_name, version),
    INDEX idx_agent_type (agent_type),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 数据库视图和存储过程

### requirement_status_stats - 需求状态统计视图
```sql
CREATE VIEW requirement_status_stats AS
SELECT 
    status,
    COUNT(*) as count,
    AVG(TIMESTAMPDIFF(SECOND, processing_start_time, processing_end_time)) as avg_processing_time
FROM requirements 
WHERE processing_start_time IS NOT NULL
GROUP BY status;
```

## 新增视图和存储过程

### token_health_summary - Token健康状况汇总视图
```sql
CREATE VIEW token_health_summary AS
SELECT 
    COUNT(*) as total_tokens,
    SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_tokens,
    SUM(CASE WHEN is_healthy = TRUE THEN 1 ELSE 0 END) as healthy_tokens,
    SUM(CASE WHEN blacklisted_until > NOW() THEN 1 ELSE 0 END) as blacklisted_tokens,
    SUM(CASE WHEN daily_used >= daily_limit THEN 1 ELSE 0 END) as over_limit_tokens,
    ROUND(AVG(daily_used), 2) as avg_daily_usage,
    MAX(last_used) as last_activity
FROM api_tokens;
```

### session_activity_summary - 会话活跃度汇总视图
```sql
CREATE VIEW session_activity_summary AS
SELECT 
    session_type,
    status,
    COUNT(*) as session_count,
    AVG(message_count) as avg_messages,
    AVG(TIMESTAMPDIFF(MINUTE, created_at, last_activity)) as avg_duration_minutes
FROM conversation_sessions
GROUP BY session_type, status;
```

### ResetDailyTokenUsage - 每日Token用量重置存储过程
```sql
DELIMITER //
CREATE PROCEDURE ResetDailyTokenUsage()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE reset_count INT DEFAULT 0;
    
    START TRANSACTION;
    
    -- 重置所有Token的每日用量
    UPDATE api_tokens 
    SET daily_used = 0, 
        last_reset_date = CURDATE()
    WHERE last_reset_date < CURDATE();
    
    SET reset_count = ROW_COUNT();
    
    -- 记录重置操作
    INSERT INTO api_token_logs (token_id, action, result, created_at)
    SELECT id, 'health_check', 'success', NOW()
    FROM api_tokens 
    WHERE last_reset_date = CURDATE();
    
    COMMIT;
    
    SELECT reset_count as tokens_reset, NOW() as reset_time;
END //
DELIMITER ;
```

### CleanExpiredSessions - 过期会话清理存储过程
```sql
DELIMITER //
CREATE PROCEDURE CleanExpiredSessions()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE expired_count INT DEFAULT 0;
    
    START TRANSACTION;
    
    -- 标记过期会话
    UPDATE conversation_sessions 
    SET status = 'expired' 
    WHERE expires_at < NOW() AND status = 'active';
    
    SET expired_count = ROW_COUNT();
    
    -- 删除超过7天的过期会话
    DELETE FROM conversation_sessions 
    WHERE status = 'expired' 
    AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
    
    COMMIT;
    
    SELECT expired_count as sessions_expired, ROW_COUNT() as sessions_deleted;
END //
DELIMITER ;
```

### GetOptimalToken - 最优Token选择存储过程
```sql
DELIMITER //
CREATE PROCEDURE GetOptimalToken()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    
    -- 选择最优Token：优先级最高、健康、未超限、未被黑名单
    SELECT 
        id, token, project_name, priority, weight, daily_used, daily_limit
    FROM api_tokens
    WHERE is_active = TRUE 
      AND is_healthy = TRUE
      AND daily_used < daily_limit
      AND (blacklisted_until IS NULL OR blacklisted_until <= NOW())
    ORDER BY 
        priority ASC,                    -- 优先级越小越优先
        (daily_used / daily_limit) ASC,  -- 使用率越低越优先
        weight DESC,                     -- 权重越大越优先
        last_used ASC                    -- 最久未使用的优先
    LIMIT 1;
END //
DELIMITER ;
```

### TokenUsageReport - Token使用情况报告存储过程
```sql
DELIMITER //
CREATE PROCEDURE TokenUsageReport(IN days_back INT)
BEGIN
    SELECT 
        at.project_name,
        at.project_id,
        at.daily_limit,
        at.daily_used,
        at.total_used,
        COUNT(atl.id) as log_entries,
        AVG(atl.response_time_ms) as avg_response_time,
        SUM(CASE WHEN atl.result = 'success' THEN 1 ELSE 0 END) as successful_calls,
        SUM(CASE WHEN atl.result = 'error' THEN 1 ELSE 0 END) as error_calls,
        ROUND(
            (SUM(CASE WHEN atl.result = 'success' THEN 1 ELSE 0 END) / COUNT(atl.id)) * 100, 
            2
        ) as success_rate
    FROM api_tokens at
    LEFT JOIN api_token_logs atl ON at.id = atl.token_id 
        AND atl.created_at >= DATE_SUB(NOW(), INTERVAL days_back DAY)
    WHERE at.is_active = TRUE
    GROUP BY at.id, at.project_name, at.project_id
    ORDER BY at.priority ASC, success_rate DESC;
END //
DELIMITER ;
```

### CleanOldData - 数据清理存储过程
```sql
DELIMITER //
CREATE PROCEDURE CleanOldData(IN days_to_keep INT)
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE deleted_conversations INT DEFAULT 0;
    DECLARE deleted_logs INT DEFAULT 0;
    
    START TRANSACTION;
    
    -- 清理旧对话记录
    DELETE FROM conversations 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    SET deleted_conversations = ROW_COUNT();
    
    -- 清理旧系统日志
    DELETE FROM system_logs 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    SET deleted_logs = ROW_COUNT();
    
    COMMIT;
    
    SELECT deleted_conversations, deleted_logs;
END //
DELIMITER ;
```

## 数据库操作模式

### TypeScript集成
**通过DatabaseManager类进行类型安全操作**
```typescript
// 查询操作
const conversations = await database.executeQuery<ConversationData>(
    "SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?",
    [userId, limit]
);

// 更新操作  
const affected = await database.executeUpdate(
    "UPDATE requirements SET status = ?, updated_at = NOW() WHERE id = ?",
    ['completed', requirementId]
);

// 批量操作
await database.executeBatch(
    "INSERT INTO system_logs (log_level, module_name, message) VALUES (?, ?, ?)",
    logEntries.map(entry => [entry.level, entry.module, entry.message])
);
```

### 连接池管理
- **连接数限制**: 10个并发连接
- **自动重连**: 连接断开时自动恢复
- **事务支持**: 批量操作使用事务确保一致性
- **字符编码**: UTF8MB4支持emoji和特殊字符

## 索引优化策略

### 查询优化
- `conversations.idx_user_id`: 按用户查询对话历史
- `conversations.idx_timestamp`: 按时间排序查询  
- `requirements.idx_status`: 按状态筛选需求
- `system_logs.idx_log_level`: 按日志级别过滤

### 复合索引考虑
```sql
-- 用户+时间复合索引(如需要)
CREATE INDEX idx_user_timestamp ON conversations(user_id, timestamp DESC);

-- 状态+时间复合索引  
CREATE INDEX idx_status_time ON requirements(status, created_at DESC);
```

## 备份和维护

### 数据备份
```bash
# 定期备份
mysqldump -u qqbot_user -p qqbot_db > backup_$(date +%Y%m%d).sql

# 恢复备份
mysql -u qqbot_user -p qqbot_db < backup_20250901.sql
```

### 数据维护
```bash
# 清理30天前的旧数据
docker exec qqbot_mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  -e "CALL CleanOldData(30);"

# 分析表性能
docker exec qqbot_mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  -e "ANALYZE TABLE conversations, requirements, system_logs;"
```

## 监控和性能

### 关键指标
- 连接池使用率
- 慢查询日志
- 表空间大小
- 索引效率

### 性能调优
- 定期执行`OPTIMIZE TABLE`
- 监控`EXPLAIN`查询计划
- 根据查询模式调整索引策略
- 设置适当的`innodb_buffer_pool_size`
