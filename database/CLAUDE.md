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