-- ============================================================================
-- 🧠 人类化消息处理系统数据库迁移脚本
-- 版本: 004
-- 创建时间: 2024-01-XX
-- 描述: 为事件分离式人类化消息处理系统创建所需的数据表
-- ============================================================================

-- 1. 消息到达队列表
-- 用途: 存储所有到达的消息，支持系统重启后的恢复
CREATE TABLE IF NOT EXISTS message_arrivals (
    id VARCHAR(36) PRIMARY KEY COMMENT '消息唯一标识符',
    source_key VARCHAR(100) NOT NULL COMMENT '源标识符 (user_123, group_456)',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    group_id BIGINT NULL COMMENT '群ID (私聊时为NULL)',
    message_type ENUM('private', 'group') NOT NULL COMMENT '消息类型',
    raw_message JSON NOT NULL COMMENT '原始消息数据',
    event_data JSON NULL COMMENT '事件附加数据',
    arrival_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '消息到达时间',
    trace_id VARCHAR(100) NULL COMMENT '追踪ID',
    status ENUM('queued', 'aggregated', 'consumed') DEFAULT 'queued' COMMENT '消息状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- 索引优化
    INDEX idx_source_key_status (source_key, status),
    INDEX idx_trace_id (trace_id),
    INDEX idx_arrival_timestamp (arrival_timestamp),
    INDEX idx_user_id (user_id),
    INDEX idx_group_id (group_id),
    INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='消息到达队列表 - 存储所有到达的消息';

-- 2. 消息消费事件表
-- 用途: 记录消息批量消费的完整过程和性能指标
CREATE TABLE IF NOT EXISTS message_consumptions (
    id VARCHAR(36) PRIMARY KEY COMMENT '消费批次唯一标识符',
    source_key VARCHAR(100) NOT NULL COMMENT '源标识符',
    batch_size INT NOT NULL COMMENT '批次大小',
    trigger_reason VARCHAR(50) NOT NULL COMMENT '触发原因',
    consumption_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '消费开始时间',
    processing_duration_ms INT NULL COMMENT '处理耗时(毫秒)',
    trace_id VARCHAR(100) NULL COMMENT '追踪ID',
    status ENUM('started', 'completed', 'failed') DEFAULT 'started' COMMENT '消费状态',
    error_message TEXT NULL COMMENT '错误信息',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- 索引优化
    INDEX idx_source_key (source_key),
    INDEX idx_trace_id (trace_id),
    INDEX idx_consumption_timestamp (consumption_timestamp),
    INDEX idx_status_trigger (status, trigger_reason),
    INDEX idx_batch_size (batch_size),
    INDEX idx_processing_duration (processing_duration_ms)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='消息消费事件表 - 记录批量消费过程';

-- 3. 聚合窗口统计表
-- 用途: 记录聚合窗口的生命周期和统计信息
CREATE TABLE IF NOT EXISTS aggregation_windows (
    id VARCHAR(36) PRIMARY KEY COMMENT '窗口唯一标识符',
    source_key VARCHAR(100) NOT NULL COMMENT '源标识符',
    window_start TIMESTAMP NOT NULL COMMENT '窗口开始时间',
    window_end TIMESTAMP NULL COMMENT '窗口结束时间',
    window_duration_ms INT NULL COMMENT '窗口持续时间(毫秒)',
    message_count INT DEFAULT 0 COMMENT '聚合的消息数量',
    first_message_trace_id VARCHAR(100) NULL COMMENT '第一条消息的追踪ID',
    trigger_reason VARCHAR(50) NULL COMMENT '窗口关闭的触发原因',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- 索引优化
    INDEX idx_source_key (source_key),
    INDEX idx_window_start (window_start),
    INDEX idx_window_end (window_end),
    INDEX idx_message_count (message_count),
    INDEX idx_trigger_reason (trigger_reason),
    INDEX idx_duration (window_duration_ms)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='聚合窗口统计表 - 记录窗口生命周期';

-- 4. 生活节奏检查日志表
-- 用途: 记录生活节奏检查的执行情况和统计信息
CREATE TABLE IF NOT EXISTS life_rhythm_logs (
    id VARCHAR(36) PRIMARY KEY COMMENT '检查记录唯一标识符',
    check_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '检查时间',
    current_hour INT NOT NULL COMMENT '当前小时(0-23)',
    time_slot ENUM('work_hours', 'rest_hours', 'sleep_hours') NOT NULL COMMENT '时间段',
    check_probability DECIMAL(3,2) NOT NULL COMMENT '检查概率(0.00-1.00)',
    random_value DECIMAL(3,2) NOT NULL COMMENT '随机值(0.00-1.00)',
    check_performed BOOLEAN NOT NULL COMMENT '是否执行了检查',
    messages_processed INT DEFAULT 0 COMMENT '处理的消息数量',
    sources_checked INT DEFAULT 0 COMMENT '检查的源数量',
    processing_duration_ms INT NULL COMMENT '处理耗时(毫秒)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- 索引优化
    INDEX idx_check_timestamp (check_timestamp),
    INDEX idx_time_slot (time_slot),
    INDEX idx_check_performed (check_performed),
    INDEX idx_current_hour (current_hour),
    INDEX idx_messages_processed (messages_processed)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='生活节奏检查日志表 - 记录节奏检查执行情况';

-- 5. 扩展现有conversations表 (可选) - 添加聚合信息列
-- 注意: 使用ALTER TABLE需要谨慎，确保不影响现有数据

-- 添加聚合处理相关列 (忽略已存在的列错误)
SET sql_mode = '';

ALTER TABLE conversations ADD COLUMN is_aggregated BOOLEAN DEFAULT FALSE COMMENT '是否为聚合处理的消息';
ALTER TABLE conversations ADD COLUMN batch_size INT DEFAULT 1 COMMENT '批次大小';
ALTER TABLE conversations ADD COLUMN aggregation_window_id VARCHAR(36) NULL COMMENT '聚合窗口ID';
ALTER TABLE conversations ADD COLUMN trigger_reason VARCHAR(50) NULL COMMENT '消费触发原因';

-- 为新增列添加索引 (忽略已存在的索引错误)
ALTER TABLE conversations ADD INDEX idx_conv_is_aggregated (is_aggregated);
ALTER TABLE conversations ADD INDEX idx_conv_batch_size (batch_size);
ALTER TABLE conversations ADD INDEX idx_conv_window_id (aggregation_window_id);
ALTER TABLE conversations ADD INDEX idx_conv_trigger_reason (trigger_reason);

-- ============================================================================
-- 数据库视图 - 提供便捷的统计查询
-- ============================================================================

-- 1. 人类化处理统计视图
CREATE OR REPLACE VIEW human_like_processing_stats AS
SELECT
    -- 消息到达统计
    COUNT(ma.id) as total_messages_arrived,
    COUNT(DISTINCT ma.source_key) as unique_sources,

    -- 消费统计
    COUNT(mc.id) as total_batches_processed,
    COALESCE(AVG(mc.batch_size), 0) as average_batch_size,
    COALESCE(AVG(mc.processing_duration_ms), 0) as average_processing_time,

    -- 成功率统计
    COALESCE(
        COUNT(CASE WHEN mc.status = 'completed' THEN 1 END) * 100.0 / NULLIF(COUNT(mc.id), 0),
        0
    ) as success_rate,

    -- 聚合窗口统计
    COUNT(aw.id) as total_windows_created,
    COALESCE(AVG(aw.window_duration_ms), 0) as average_window_duration,
    COALESCE(AVG(aw.message_count), 0) as average_messages_per_window,

    -- 生活节奏统计
    COUNT(lrl.id) as total_rhythm_checks,
    COUNT(CASE WHEN lrl.check_performed = TRUE THEN 1 END) as rhythm_checks_performed,
    COALESCE(AVG(lrl.messages_processed), 0) as average_messages_per_rhythm_check,

    -- 时间范围
    MIN(ma.arrival_timestamp) as first_message_time,
    MAX(ma.arrival_timestamp) as last_message_time
FROM message_arrivals ma
LEFT JOIN message_consumptions mc ON mc.trace_id = ma.trace_id
LEFT JOIN aggregation_windows aw ON aw.first_message_trace_id = ma.trace_id
LEFT JOIN life_rhythm_logs lrl ON DATE(lrl.check_timestamp) = DATE(ma.arrival_timestamp);

-- 2. 源统计视图 - 按源分组的统计信息
CREATE OR REPLACE VIEW source_processing_stats AS
SELECT
    ma.source_key,
    COUNT(ma.id) as messages_received,
    COUNT(mc.id) as batches_processed,
    COALESCE(AVG(mc.batch_size), 0) as avg_batch_size,
    COALESCE(AVG(mc.processing_duration_ms), 0) as avg_processing_time,
    MAX(ma.arrival_timestamp) as last_activity,

    -- 按触发原因分组统计
    COUNT(CASE WHEN mc.trigger_reason = 'window_timeout' THEN 1 END) as timeout_triggers,
    COUNT(CASE WHEN mc.trigger_reason = 'queue_size_limit' THEN 1 END) as size_limit_triggers,
    COUNT(CASE WHEN mc.trigger_reason = 'life_rhythm_check' THEN 1 END) as rhythm_triggers,
    COUNT(CASE WHEN mc.trigger_reason = 'manual_trigger' THEN 1 END) as manual_triggers
FROM message_arrivals ma
LEFT JOIN message_consumptions mc ON mc.source_key = ma.source_key
GROUP BY ma.source_key;

-- 3. 每小时活动统计视图
CREATE OR REPLACE VIEW hourly_activity_stats AS
SELECT
    HOUR(ma.arrival_timestamp) as hour_of_day,
    COUNT(ma.id) as messages_arrived,
    COUNT(mc.id) as batches_processed,
    COUNT(lrl.id) as rhythm_checks,
    COUNT(CASE WHEN lrl.check_performed = TRUE THEN 1 END) as rhythm_checks_performed,
    COALESCE(AVG(mc.processing_duration_ms), 0) as avg_processing_time
FROM message_arrivals ma
LEFT JOIN message_consumptions mc ON DATE(mc.consumption_timestamp) = DATE(ma.arrival_timestamp)
    AND HOUR(mc.consumption_timestamp) = HOUR(ma.arrival_timestamp)
LEFT JOIN life_rhythm_logs lrl ON DATE(lrl.check_timestamp) = DATE(ma.arrival_timestamp)
    AND lrl.current_hour = HOUR(ma.arrival_timestamp)
GROUP BY HOUR(ma.arrival_timestamp)
ORDER BY hour_of_day;

-- ============================================================================
-- 数据清理策略 - 定期清理历史数据
-- ============================================================================

-- 创建数据清理存储过程
DELIMITER //

CREATE PROCEDURE CleanOldHumanLikeData(IN days_to_keep INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- 清理N天前的消息到达记录
    DELETE FROM message_arrivals
    WHERE arrival_timestamp < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);

    -- 清理N天前的消费记录
    DELETE FROM message_consumptions
    WHERE consumption_timestamp < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);

    -- 清理N天前的聚合窗口记录
    DELETE FROM aggregation_windows
    WHERE window_start < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);

    -- 清理N天前的生活节奏日志
    DELETE FROM life_rhythm_logs
    WHERE check_timestamp < DATE_SUB(NOW(), INTERVAL days_to_keep DAY);

    COMMIT;

    SELECT CONCAT('Successfully cleaned data older than ', days_to_keep, ' days') as result;
END //

DELIMITER ;

-- ============================================================================
-- 权限设置 (如果需要)
-- ============================================================================

-- 确保qqbot_user有权限访问新表
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.message_arrivals TO 'qqbot_user'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.message_consumptions TO 'qqbot_user'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.aggregation_windows TO 'qqbot_user'@'%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON qqbot_db.life_rhythm_logs TO 'qqbot_user'@'%';
-- GRANT SELECT ON qqbot_db.human_like_processing_stats TO 'qqbot_user'@'%';
-- GRANT SELECT ON qqbot_db.source_processing_stats TO 'qqbot_user'@'%';
-- GRANT SELECT ON qqbot_db.hourly_activity_stats TO 'qqbot_user'@'%';
-- GRANT EXECUTE ON PROCEDURE qqbot_db.CleanOldHumanLikeData TO 'qqbot_user'@'%';

-- ============================================================================
-- 迁移完成标记
-- ============================================================================

-- 记录迁移版本
INSERT IGNORE INTO schema_migrations (version, description, executed_at)
VALUES ('004', 'Create human-like message processing tables', NOW());

-- 输出迁移结果
SELECT 'Human-like message processing tables created successfully!' as migration_result;