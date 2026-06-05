-- UTF-8 Encoding Fix Script for QQ Bot Database
-- 解决数据库表注释乱码问题的完整方案
-- 
-- 使用说明:
-- 1. 以root或具有足够权限的用户执行此脚本
-- 2. 确保MySQL服务器支持utf8mb4字符集
-- 3. 执行前请先备份数据库

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET character_set_client = utf8mb4;
SET character_set_connection = utf8mb4;
SET character_set_database = utf8mb4;
SET character_set_results = utf8mb4;
SET character_set_server = utf8mb4;

-- ============================================
-- 1. 检查并修复数据库级别字符集设置
-- ============================================

-- 切换到目标数据库
USE qqbot_db;

-- 修改数据库字符集为UTF8MB4
ALTER DATABASE qqbot_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================
-- 2. 修复所有表的字符集和注释
-- ============================================

-- 修复 conversations 表
ALTER TABLE conversations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE conversations COMMENT = '对话历史记录表 - 存储用户与AI的对话内容';

-- 修复 requirements 表
ALTER TABLE requirements CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE requirements COMMENT = '需求管理表 - 跟踪开发需求的处理状态';

-- 修复 system_logs 表
ALTER TABLE system_logs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE system_logs COMMENT = '系统日志表 - 结构化存储应用运行日志';

-- 修复 bot_status 表
ALTER TABLE bot_status CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE bot_status COMMENT = 'QQ机器人状态监控表 - 实时跟踪机器人运行状态';

-- 修复 agent_prompts 表 (如果存在)
ALTER TABLE agent_prompts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE agent_prompts COMMENT = 'AI Agent系统指令和配置管理表';

-- 修复 api_tokens 表 (如果存在)
ALTER TABLE api_tokens CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE api_tokens COMMENT = 'API Token管理表 - 存储和管理Gemini API密钥';

-- 修复 api_token_logs 表 (如果存在)
ALTER TABLE api_token_logs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE api_token_logs COMMENT = 'API Token使用日志表';

-- 修复 api_token_health_config 表 (如果存在)
ALTER TABLE api_token_health_config CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE api_token_health_config COMMENT = 'Token健康检查配置表';

-- 修复 conversation_sessions 表 (如果存在)
ALTER TABLE conversation_sessions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE conversation_sessions COMMENT = '对话Session管理表 - 支持连续对话上下文管理';

-- 修复 message_reply_chain 表 (如果存在)
ALTER TABLE message_reply_chain CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE message_reply_chain COMMENT = '消息回复链追溯表 - 追踪消息引用关系';

-- 修复 session_events 表 (如果存在)
ALTER TABLE session_events CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE session_events COMMENT = 'Session事件审计表 - 记录会话生命周期事件';

-- 修复 llm_interactions 表 (如果存在)
ALTER TABLE llm_interactions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE llm_interactions COMMENT = 'LLM交互记录表 - 记录AI模型调用详情和成本';

-- 修复 service_call_logs 表 (如果存在)
ALTER TABLE service_call_logs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE service_call_logs COMMENT = '服务调用日志表 - 微服务间调用链路追踪';

-- 修复 user_confirmations 表 (如果存在)
ALTER TABLE user_confirmations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE user_confirmations COMMENT = '用户确认记录表 - 存储需要用户确认的操作记录';

-- 修复 service_metrics 表 (如果存在)
ALTER TABLE service_metrics CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE service_metrics COMMENT = '服务性能监控表 - 收集各服务性能指标';

-- ============================================
-- 3. 修复表字段的字符集和注释
-- ============================================

-- conversations 表字段注释
ALTER TABLE conversations MODIFY COLUMN id VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '对话唯一标识符';
ALTER TABLE conversations MODIFY COLUMN user_id BIGINT COMMENT '用户QQ号码';
ALTER TABLE conversations MODIFY COLUMN user_message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '用户发送的消息内容';
ALTER TABLE conversations MODIFY COLUMN ai_response TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'AI回复的消息内容';
ALTER TABLE conversations MODIFY COLUMN model_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '使用的AI模型名称';
ALTER TABLE conversations MODIFY COLUMN response_time DECIMAL(10,4) COMMENT 'AI响应时间(秒)';

-- requirements 表字段注释  
ALTER TABLE requirements MODIFY COLUMN id VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '需求唯一标识符';
ALTER TABLE requirements MODIFY COLUMN user_id BIGINT COMMENT '提交需求的用户QQ号';
ALTER TABLE requirements MODIFY COLUMN message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '需求描述内容';
ALTER TABLE requirements MODIFY COLUMN status ENUM('received', 'analyzing', 'processing', 'completed', 'failed', 'cancelled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '需求处理状态';
ALTER TABLE requirements MODIFY COLUMN claude_code_output LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'Claude Code输出结果';
ALTER TABLE requirements MODIFY COLUMN completion_details TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '需求完成详情';
ALTER TABLE requirements MODIFY COLUMN error_message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '错误信息';

-- system_logs 表字段注释
ALTER TABLE system_logs MODIFY COLUMN log_level ENUM('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '日志级别';
ALTER TABLE system_logs MODIFY COLUMN module_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '模块名称';
ALTER TABLE system_logs MODIFY COLUMN message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '日志消息内容';
ALTER TABLE system_logs MODIFY COLUMN extra_data JSON COMMENT '扩展数据(JSON格式)';

-- bot_status 表字段注释
ALTER TABLE bot_status MODIFY COLUMN bot_id VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '机器人标识符';
ALTER TABLE bot_status MODIFY COLUMN status ENUM('online', 'offline', 'error') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '机器人状态';
ALTER TABLE bot_status MODIFY COLUMN websocket_connected BOOLEAN COMMENT 'WebSocket连接状态';
ALTER TABLE bot_status MODIFY COLUMN http_server_running BOOLEAN COMMENT 'HTTP服务器运行状态';
ALTER TABLE bot_status MODIFY COLUMN error_message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '错误信息描述';

-- ============================================
-- 4. 测试UTF-8编码支持
-- ============================================

-- 创建测试表验证编码
CREATE TEMPORARY TABLE utf8_test (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chinese_text TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '中文测试字段',
    emoji_text VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '表情符号测试字段'
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='UTF-8编码测试表';

-- 插入测试数据
INSERT INTO utf8_test (chinese_text, emoji_text) VALUES 
('这是中文测试数据：你好世界！', '表情符号测试: 😀😃😄😁😆'),
('QQ智能机器人系统', '功能图标: 🤖💬🔧⚙️📊'),
('数据库编码修复完成', '状态指示: ✅🎉🔥💯⭐');

-- 查询测试结果
SELECT '=== UTF-8编码测试结果 ===' AS test_section;
SELECT * FROM utf8_test;

-- 清理测试表
DROP TEMPORARY TABLE utf8_test;

-- ============================================
-- 5. 验证修复结果
-- ============================================

-- 显示数据库字符集信息
SELECT '=== 数据库字符集信息 ===' AS section_title;
SELECT 
    SCHEMA_NAME AS '数据库名',
    DEFAULT_CHARACTER_SET_NAME AS '默认字符集',
    DEFAULT_COLLATION_NAME AS '默认排序规则'
FROM information_schema.SCHEMATA 
WHERE SCHEMA_NAME = 'qqbot_db';

-- 显示所有表的字符集信息
SELECT '=== 表字符集信息 ===' AS section_title;
SELECT 
    TABLE_NAME AS '表名',
    TABLE_COLLATION AS '排序规则',
    TABLE_COMMENT AS '表注释'
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'qqbot_db'
ORDER BY TABLE_NAME;

-- 显示字段字符集信息
SELECT '=== 字段字符集信息 ===' AS section_title;
SELECT 
    TABLE_NAME AS '表名',
    COLUMN_NAME AS '字段名',
    CHARACTER_SET_NAME AS '字符集',
    COLLATION_NAME AS '排序规则',
    COLUMN_COMMENT AS '字段注释'
FROM information_schema.COLUMNS 
WHERE TABLE_SCHEMA = 'qqbot_db' 
    AND CHARACTER_SET_NAME IS NOT NULL
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- ============================================
-- 6. 输出修复完成信息
-- ============================================

SELECT '=== 修复完成 ===' AS completion_status;
SELECT CONCAT(
    '数据库 ', DATABASE(), ' 的UTF-8编码修复已完成！',
    CHAR(10), '所有表和字段已转换为 utf8mb4 字符集',
    CHAR(10), '中文注释应该可以正常显示了'
) AS '修复结果';

-- 显示当前连接的字符集设置
SHOW VARIABLES LIKE 'character_set_%';
SHOW VARIABLES LIKE 'collation_%';