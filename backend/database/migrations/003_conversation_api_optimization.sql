-- QQ机器人对话历史API优化索引
-- 文件: 003_conversation_api_optimization.sql
-- 目的: 为对话历史管理API提供高性能查询支持

-- 创建复合索引优化常用查询模式

-- 1. 用户+时间复合索引（最常用的查询模式）
-- 优化: user_id筛选 + 时间排序的分页查询
CREATE INDEX IF NOT EXISTS idx_conversations_user_time 
ON conversations (user_id, timestamp DESC);

-- 2. 时间索引（全局时间范围查询）
-- 优化: start_date/end_date 时间范围筛选
CREATE INDEX IF NOT EXISTS idx_conversations_timestamp 
ON conversations (timestamp DESC);

-- 3. AI模型索引
-- 优化: model_name筛选查询
CREATE INDEX IF NOT EXISTS idx_conversations_model 
ON conversations (model_name);

-- 4. 创建时间索引
-- 优化: 按创建时间排序的查询
CREATE INDEX IF NOT EXISTS idx_conversations_created 
ON conversations (created_at DESC);

-- 5. 复合索引：用户+模型+时间
-- 优化: 多条件组合查询
CREATE INDEX IF NOT EXISTS idx_conversations_user_model_time 
ON conversations (user_id, model_name, timestamp DESC);

-- 6. Session相关索引（支持未来扩展）
CREATE INDEX IF NOT EXISTS idx_conversations_session 
ON conversations (session_id) WHERE session_id IS NOT NULL;

-- 7. 消息ID索引（OneBot协议支持）
CREATE INDEX IF NOT EXISTS idx_conversations_message_id 
ON conversations (message_id) WHERE message_id IS NOT NULL;

-- 创建对话统计视图（可选，用于仪表板统计）
CREATE OR REPLACE VIEW conversation_daily_stats AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_conversations,
    COUNT(DISTINCT user_id) as unique_users,
    AVG(response_time) as avg_response_time,
    MIN(timestamp) as first_conversation,
    MAX(timestamp) as last_conversation,
    COUNT(CASE WHEN model_name = 'gemini-2.5-flash' THEN 1 END) as gemini_flash_count,
    COUNT(CASE WHEN response_time > 5.0 THEN 1 END) as slow_responses
FROM conversations 
WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- 创建用户活跃度统计视图
CREATE OR REPLACE VIEW user_activity_stats AS
SELECT 
    user_id,
    COUNT(*) as total_conversations,
    AVG(response_time) as avg_response_time,
    MAX(timestamp) as last_conversation,
    MIN(timestamp) as first_conversation,
    DATEDIFF(MAX(timestamp), MIN(timestamp)) as active_days,
    COUNT(DISTINCT DATE(timestamp)) as conversation_days
FROM conversations 
WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY user_id
HAVING total_conversations >= 2
ORDER BY total_conversations DESC;

-- 创建模型使用统计视图
CREATE OR REPLACE VIEW model_usage_stats AS
SELECT 
    model_name,
    COUNT(*) as usage_count,
    AVG(response_time) as avg_response_time,
    MIN(response_time) as min_response_time,
    MAX(response_time) as max_response_time,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(CASE WHEN response_time > 5.0 THEN 1 END) as slow_responses,
    (COUNT(CASE WHEN response_time > 5.0 THEN 1 END) * 100.0 / COUNT(*)) as slow_response_rate
FROM conversations 
WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY model_name
ORDER BY usage_count DESC;

-- 分析索引使用情况的查询（用于性能监控）
-- 使用方法: SELECT * FROM conversation_index_analysis;
CREATE OR REPLACE VIEW conversation_index_analysis AS
SELECT 
    'conversations' as table_name,
    INDEX_NAME as index_name,
    COLUMN_NAME as column_name,
    SEQ_IN_INDEX as position,
    CARDINALITY as cardinality,
    CASE 
        WHEN INDEX_NAME = 'PRIMARY' THEN 'Primary Key'
        WHEN INDEX_NAME LIKE 'idx_conversations_user%' THEN 'User Queries'
        WHEN INDEX_NAME LIKE 'idx_conversations_time%' THEN 'Time Range Queries'  
        WHEN INDEX_NAME LIKE 'idx_conversations_model%' THEN 'Model Filter Queries'
        ELSE 'Other'
    END as index_purpose
FROM information_schema.STATISTICS 
WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'conversations'
    AND INDEX_NAME != 'PRIMARY'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- 性能监控查询示例
-- 1. 检查慢查询模式
-- SELECT * FROM conversations WHERE user_id = 85178516 ORDER BY timestamp DESC LIMIT 20;

-- 2. 检查索引命中情况  
-- EXPLAIN SELECT * FROM conversations WHERE user_id = 85178516 AND timestamp >= '2025-09-01' ORDER BY timestamp DESC LIMIT 20;

-- 3. 检查统计信息
-- SELECT * FROM conversation_daily_stats WHERE date >= CURDATE() - INTERVAL 7 DAY;

-- 创建存储过程用于索引维护
DELIMITER //

CREATE PROCEDURE OptimizeConversationIndexes()
BEGIN
    -- 分析表以更新索引统计信息
    ANALYZE TABLE conversations;
    
    -- 检查表状态
    SELECT 
        TABLE_NAME,
        TABLE_ROWS,
        AVG_ROW_LENGTH,
        DATA_LENGTH,
        INDEX_LENGTH,
        (INDEX_LENGTH / DATA_LENGTH * 100) as index_ratio
    FROM information_schema.TABLES 
    WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'conversations';
END //

DELIMITER ;

-- 创建清理旧数据的存储过程（可选）
DELIMITER //

CREATE PROCEDURE CleanOldConversations(IN days_to_keep INT)
BEGIN
    DECLARE total_deleted INT DEFAULT 0;
    
    -- 删除超过指定天数的对话记录
    DELETE FROM conversations 
    WHERE timestamp < DATE_SUB(CURDATE(), INTERVAL days_to_keep DAY);
    
    SET total_deleted = ROW_COUNT();
    
    -- 返回删除统计信息
    SELECT 
        total_deleted as deleted_rows,
        days_to_keep as retention_days,
        NOW() as cleanup_time;
        
    -- 优化表
    OPTIMIZE TABLE conversations;
END //

DELIMITER ;

-- 使用说明注释
/*
索引使用指南:

1. 最常用查询优化:
   - 用户对话列表: SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?;
   - 时间范围查询: SELECT * FROM conversations WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp DESC;
   - 用户+时间查询: SELECT * FROM conversations WHERE user_id = ? AND timestamp >= ? ORDER BY timestamp DESC;

2. 性能监控:
   - 运行 CALL OptimizeConversationIndexes(); 定期更新统计信息
   - 查看 conversation_index_analysis 检查索引状态
   - 使用 EXPLAIN 分析具体查询的执行计划

3. 数据清理:
   - 运行 CALL CleanOldConversations(90); 清理90天前的数据
   - 定期运行以控制数据库大小

4. 统计视图:
   - conversation_daily_stats: 每日对话统计
   - user_activity_stats: 用户活跃度分析  
   - model_usage_stats: AI模型使用情况

注意事项:
- 索引会增加写操作开销，但显著提升读取性能
- 定期运行 ANALYZE TABLE 更新索引统计信息
- 监控索引使用情况，移除不必要的索引
- 在生产环境中逐步应用，观察性能影响
*/