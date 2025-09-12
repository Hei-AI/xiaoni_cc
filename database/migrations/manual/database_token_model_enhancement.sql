-- Token-Model绑定管理方案 数据库增强脚本
-- 执行时间: 2025-09-11

-- 1. 增强 agent_prompts 表
ALTER TABLE agent_prompts 
ADD COLUMN model_name VARCHAR(100) DEFAULT 'gemini-2.5-flash' COMMENT '绑定的模型名称';

ALTER TABLE agent_prompts 
ADD COLUMN allowed_token_ids JSON COMMENT '允许使用的token ID数组，如 [1,2,3,8,9]，null表示允许所有token';

-- 2. 增强 api_tokens 表
ALTER TABLE api_tokens 
ADD COLUMN model_blacklist JSON COMMENT '按模型的黑名单信息，格式: {"gemini-2.5-flash": "2025-09-11 14:30:00", "gemini-1.5-pro": null}';

-- 3. 初始化现有数据
-- 为所有现有的 agent_prompts 设置默认模型
UPDATE agent_prompts 
SET model_name = 'gemini-2.5-flash' 
WHERE model_name IS NULL;

-- 为所有现有的 agent_prompts 设置允许所有token (NULL表示不限制)
UPDATE agent_prompts 
SET allowed_token_ids = NULL 
WHERE allowed_token_ids IS NULL;

-- 为所有现有的 api_tokens 初始化空的模型黑名单
UPDATE api_tokens 
SET model_blacklist = JSON_OBJECT() 
WHERE model_blacklist IS NULL;

-- 4. 创建用于查询的辅助视图
CREATE OR REPLACE VIEW token_model_availability AS
SELECT 
    t.id as token_id,
    t.project_name,
    t.token,
    ap.model_name,
    ap.agent_type,
    ap.prompt_name,
    CASE 
        WHEN t.model_blacklist IS NULL THEN 'available'
        WHEN JSON_EXTRACT(t.model_blacklist, CONCAT('$.', '"', ap.model_name, '"')) IS NULL THEN 'available'
        WHEN JSON_UNQUOTE(JSON_EXTRACT(t.model_blacklist, CONCAT('$.', '"', ap.model_name, '"'))) <= NOW() THEN 'recovered'
        WHEN JSON_UNQUOTE(JSON_EXTRACT(t.model_blacklist, CONCAT('$.', '"', ap.model_name, '"'))) >= '2030-01-01' THEN 'permanently_disabled'
        ELSE 'temporarily_disabled'
    END as availability_status,
    JSON_UNQUOTE(JSON_EXTRACT(t.model_blacklist, CONCAT('$.', '"', ap.model_name, '"'))) as blacklisted_until,
    t.daily_used,
    t.daily_limit,
    t.last_error,
    t.last_error_time
FROM api_tokens t
CROSS JOIN agent_prompts ap
WHERE (ap.allowed_token_ids IS NULL OR JSON_CONTAINS(ap.allowed_token_ids, CAST(t.id AS JSON)))
  AND ap.is_active = TRUE
ORDER BY ap.model_name, t.id;

-- 5. 创建获取可用token的存储过程
DELIMITER //

CREATE OR REPLACE PROCEDURE GetAvailableTokenForModel(
    IN p_model_name VARCHAR(100),
    IN p_agent_type VARCHAR(50),
    IN p_prompt_name VARCHAR(100)
)
BEGIN
    DECLARE token_result VARCHAR(500) DEFAULT NULL;
    
    -- 查找符合条件的可用token
    SELECT t.token INTO token_result
    FROM api_tokens t
    JOIN agent_prompts ap ON (
        ap.model_name = p_model_name 
        AND ap.agent_type = p_agent_type 
        AND ap.prompt_name = p_prompt_name
        AND ap.is_active = TRUE
        AND (ap.allowed_token_ids IS NULL OR JSON_CONTAINS(ap.allowed_token_ids, CAST(t.id AS JSON)))
    )
    WHERE t.daily_used < t.daily_limit
      AND (
          t.model_blacklist IS NULL 
          OR JSON_EXTRACT(t.model_blacklist, CONCAT('$.', '"', p_model_name, '"')) IS NULL
          OR JSON_UNQUOTE(JSON_EXTRACT(t.model_blacklist, CONCAT('$.', '"', p_model_name, '"'))) <= NOW()
      )
    ORDER BY 
        t.priority ASC,
        (t.daily_used / t.daily_limit) ASC,
        t.last_used ASC
    LIMIT 1;
    
    SELECT token_result as available_token;
END //

DELIMITER ;

-- 6. 创建标记token在特定模型下失败的存储过程
DELIMITER //

CREATE OR REPLACE PROCEDURE MarkTokenFailedForModel(
    IN p_token_id INT,
    IN p_model_name VARCHAR(100),
    IN p_error_message TEXT,
    IN p_blacklist_minutes INT DEFAULT 5
)
BEGIN
    DECLARE current_blacklist JSON;
    DECLARE new_blacklist JSON;
    DECLARE blacklist_until DATETIME;
    
    -- 计算黑名单截止时间
    SET blacklist_until = DATE_ADD(NOW(), INTERVAL p_blacklist_minutes MINUTE);
    
    -- 获取当前的模型黑名单
    SELECT IFNULL(model_blacklist, JSON_OBJECT()) INTO current_blacklist
    FROM api_tokens WHERE id = p_token_id;
    
    -- 更新特定模型的黑名单时间
    SET new_blacklist = JSON_SET(current_blacklist, CONCAT('$.', '"', p_model_name, '"'), DATE_FORMAT(blacklist_until, '%Y-%m-%d %H:%i:%s'));
    
    -- 更新数据库
    UPDATE api_tokens 
    SET model_blacklist = new_blacklist,
        error_count = error_count + 1,
        last_error = p_error_message,
        last_error_time = NOW()
    WHERE id = p_token_id;
    
    SELECT CONCAT('Token ', p_token_id, ' blacklisted for model ', p_model_name, ' until ', blacklist_until) as result;
END //

DELIMITER ;

-- 7. 创建清除token在特定模型下黑名单的存储过程
DELIMITER //

CREATE OR REPLACE PROCEDURE ClearTokenBlacklistForModel(
    IN p_token_id INT,
    IN p_model_name VARCHAR(100)
)
BEGIN
    DECLARE current_blacklist JSON;
    DECLARE new_blacklist JSON;
    
    -- 获取当前的模型黑名单
    SELECT IFNULL(model_blacklist, JSON_OBJECT()) INTO current_blacklist
    FROM api_tokens WHERE id = p_token_id;
    
    -- 移除特定模型的黑名单
    SET new_blacklist = JSON_REMOVE(current_blacklist, CONCAT('$.', '"', p_model_name, '"'));
    
    -- 更新数据库
    UPDATE api_tokens 
    SET model_blacklist = new_blacklist
    WHERE id = p_token_id;
    
    SELECT CONCAT('Token ', p_token_id, ' blacklist cleared for model ', p_model_name) as result;
END //

DELIMITER ;

-- 8. 示例数据插入
-- 创建一些示例的 agent_prompts 配置
INSERT INTO agent_prompts (id, agent_type, prompt_name, model_name, allowed_token_ids, system_instructions, is_active, version, created_by)
VALUES 
    (UUID(), 'chat_bot', 'gemini_2_5_flash', 'gemini-2.5-flash', '[1,2,3,4,5]', '["你是智能助手，使用gemini-2.5-flash模型"]', TRUE, 1, 'system'),
    (UUID(), 'chat_bot', 'gemini_1_5_pro', 'gemini-1.5-pro', '[6,7,8,9,10]', '["你是专业助手，使用gemini-1.5-pro模型"]', TRUE, 1, 'system'),
    (UUID(), 'technical_expert', 'gemini_2_5_flash', 'gemini-2.5-flash', '[1,3,5,7,9]', '["你是技术专家，使用gemini-2.5-flash模型"]', TRUE, 1, 'system')
ON DUPLICATE KEY UPDATE id = id;

-- 9. 验证查询
-- 查看token-model可用性
SELECT * FROM token_model_availability LIMIT 20;

-- 测试获取可用token
CALL GetAvailableTokenForModel('gemini-2.5-flash', 'chat_bot', 'gemini_2_5_flash');

-- 检查表结构
DESCRIBE agent_prompts;
DESCRIBE api_tokens;

PRINT('Token-Model绑定管理方案数据库增强完成！');