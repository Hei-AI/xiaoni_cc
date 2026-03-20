# QQ Bot 数据库 UTF-8 编码修复指南

## 问题描述

QQ智能机器人项目中的数据库表注释出现乱码问题，中文字符无法正确显示。这是由于数据库字符集配置不一致导致的编码问题。

## 问题原因分析

1. **数据库级别字符集**: 可能使用了 `latin1` 或其他非UTF-8字符集
2. **表级别字符集**: 个别表可能创建时未指定UTF-8字符集
3. **连接字符集**: 应用程序连接数据库时字符集设置不正确
4. **MySQL服务器字符集**: 服务器默认字符集可能不是UTF-8

## 解决方案

### 1. 数据库字符集修复

执行SQL脚本修复数据库和表的字符集设置：

```bash
# 使用MySQL客户端执行修复脚本
mysql -u root -p123456 < database/fix_utf8_encoding.sql

# 或者登录MySQL后执行
mysql -u root -p123456
source database/fix_utf8_encoding.sql;
```

### 2. 应用程序连接配置

已更新 `src/services/database.ts` 文件，确保：

- 连接池使用 `utf8mb4` 字符集
- 每个数据库连接都设置正确的字符集参数
- 添加了字符集验证和自动修正机制

### 3. 环境配置检查

确保 `.env` 文件包含正确的数据库配置：

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=qqbot_db
MYSQL_USER=qqbot_user
MYSQL_PASSWORD=qqbot_password
```

配置文件 `src/config/index.ts` 已正确设置：

```typescript
database: {
  charset: 'utf8mb4',
  timezone: '+08:00'
}
```

## 修复内容详情

### 数据库级修复

1. **数据库字符集**: `ALTER DATABASE qqbot_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
2. **所有表字符集**: `ALTER TABLE table_name CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
3. **表注释修复**: 为所有表添加正确的中文注释

### 表注释修复对照

| 表名 | 修复后的中文注释 |
|------|------------------|
| `conversations` | 对话历史记录表 - 存储用户与AI的对话内容 |
| `requirements` | 需求管理表 - 跟踪开发需求的处理状态 |
| `system_logs` | 系统日志表 - 结构化存储应用运行日志 |
| `bot_status` | QQ机器人状态监控表 - 实时跟踪机器人运行状态 |
| `agent_prompts` | AI Agent系统指令和配置管理表 |
| `api_tokens` | API Token管理表 - 存储和管理Gemini API密钥 |
| `conversation_sessions` | 对话Session管理表 - 支持多轮对话上下文管理 |
| `message_reply_chain` | 消息回复链追溯表 - 追踪消息引用关系 |

### 字段注释修复示例

```sql
-- conversations 表字段
ALTER TABLE conversations MODIFY COLUMN user_message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '用户发送的消息内容';
ALTER TABLE conversations MODIFY COLUMN ai_response TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'AI回复的消息内容';
ALTER TABLE conversations MODIFY COLUMN model_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '使用的AI模型名称';

-- requirements 表字段
ALTER TABLE requirements MODIFY COLUMN message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '需求描述内容';
ALTER TABLE requirements MODIFY COLUMN status ENUM('received', 'analyzing', 'processing', 'completed', 'failed', 'cancelled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '需求处理状态';
```

### 应用程序代码修复

1. **连接池配置**:
   - 添加 `charset: 'utf8mb4'` 配置
   - 添加 `typeCast` 函数确保字符串字段使用UTF8MB4编码
   - 设置连接超时和重连参数

2. **连接字符集设置**:
   - 新增 `ensureUtf8Connection()` 方法
   - 在每次数据库操作前设置连接字符集
   - 确保 `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`

3. **查询执行优化**:
   - `executeQuery()`: 获取独立连接并设置字符集
   - `executeUpdate()`: 同样获取独立连接并设置字符集
   - `executeBatch()`: 事务中也确保字符集设置

## 验证修复结果

### 1. 运行测试验证

```bash
# 运行UTF-8编码测试
npm test -- tests/utf8-encoding.test.ts

# 或运行所有测试
npm test
```

### 2. 手动验证数据库

```sql
-- 检查数据库字符集
SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
FROM information_schema.SCHEMATA 
WHERE SCHEMA_NAME = 'qqbot_db';

-- 检查表字符集和注释
SELECT TABLE_NAME, TABLE_COLLATION, TABLE_COMMENT
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'qqbot_db'
ORDER BY TABLE_NAME;

-- 检查字段字符集
SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_COMMENT
FROM information_schema.COLUMNS 
WHERE TABLE_SCHEMA = 'qqbot_db' 
    AND CHARACTER_SET_NAME IS NOT NULL
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 测试中文数据插入和查询
INSERT INTO conversations (id, user_id, user_message, ai_response, timestamp, response_time) 
VALUES ('utf8_test', 999999999, '测试中文字符 🚀', 'AI回复：收到中文消息 ✅', NOW(), 1.5);

SELECT * FROM conversations WHERE id = 'utf8_test';

DELETE FROM conversations WHERE id = 'utf8_test';
```

### 3. 应用程序验证

```bash
# 启动应用程序
npm run build && npm start

# 发送包含中文的QQ消息测试
# 检查日志文件确认中文字符正确处理
tail -f logs/main_$(date +%Y-%m-%d).log
```

## 预防措施

### 1. 新表创建模板

创建新表时，务必使用以下模板：

```sql
CREATE TABLE IF NOT EXISTS new_table_name (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    content TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '内容字段',
    -- 其他字段...
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='表的中文注释';
```

### 2. MySQL服务器配置

建议在 MySQL 配置文件 (`my.cnf` 或 `my.ini`) 中设置：

```ini
[mysqld]
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

[mysql]
default-character-set = utf8mb4

[client]
default-character-set = utf8mb4
```

### 3. 持续监控

- 定期运行UTF-8编码测试
- 在部署流程中包含字符集验证步骤
- 监控应用程序日志中的字符编码警告

## 故障排除

### 常见问题

1. **修复脚本执行失败**:
   - 检查数据库用户权限
   - 确认数据库存在且可访问
   - 检查MySQL版本是否支持utf8mb4

2. **应用程序仍显示乱码**:
   - 重启应用程序重新建立数据库连接
   - 检查环境变量是否正确加载
   - 验证TypeScript编译是否包含最新更改

3. **部分表未修复**:
   - 检查表是否存在
   - 手动执行特定表的ALTER语句
   - 查看MySQL错误日志

### 联系支持

如果遇到问题，请：

1. 收集相关错误日志
2. 提供数据库版本信息 (`SELECT VERSION();`)
3. 确认表结构状态 (`SHOW CREATE TABLE table_name;`)
4. 检查字符集变量 (`SHOW VARIABLES LIKE 'character_set_%';`)

## 总结

通过执行本修复方案，QQ机器人系统的数据库UTF-8编码问题应该得到完全解决。修复内容包括：

- ✅ 数据库级别字符集设置
- ✅ 所有表字符集转换
- ✅ 表和字段注释修复
- ✅ 应用程序连接配置优化
- ✅ 自动字符集设置机制
- ✅ 完整的测试验证套件

修复完成后，所有中文字符、表情符号和混合内容都应该能够正确存储和显示。