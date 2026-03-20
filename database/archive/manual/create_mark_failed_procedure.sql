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