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