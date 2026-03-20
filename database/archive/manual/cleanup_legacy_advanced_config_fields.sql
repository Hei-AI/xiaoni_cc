-- ================================================================
-- 清理 advanced_config 中的旧版顶层配置字段
--
-- 背景：之前版本将某些配置字段保存在 advanced_config 顶层
-- 新版本统一迁移到 generationConfig 下，需要清理旧字段避免冲突
--
-- 影响：agent_prompts 表的 advanced_config 字段
-- 创建时间：2025-10-25
-- ================================================================

USE qqbot_db;

-- 显示清理前的状态
SELECT
    id,
    prompt_name,
    JSON_CONTAINS_PATH(advanced_config, 'one', '$.thinkingConfig') as has_legacy_thinking,
    JSON_CONTAINS_PATH(advanced_config, 'one', '$.temperature') as has_legacy_temp,
    JSON_CONTAINS_PATH(advanced_config, 'one', '$.generationConfig.thinkingConfig') as has_new_thinking
FROM agent_prompts
WHERE advanced_config IS NOT NULL;

-- 清理顶层的旧配置字段
UPDATE agent_prompts
SET advanced_config = JSON_REMOVE(
    advanced_config,
    '$.thinkingConfig',
    '$.temperature',
    '$.topP',
    '$.topK',
    '$.maxOutputTokens',
    '$.stopSequences'
)
WHERE JSON_CONTAINS_PATH(advanced_config, 'one',
    '$.thinkingConfig',
    '$.temperature',
    '$.topP',
    '$.topK',
    '$.maxOutputTokens',
    '$.stopSequences'
);

-- 显示清理后的状态
SELECT
    id,
    prompt_name,
    JSON_CONTAINS_PATH(advanced_config, 'one', '$.thinkingConfig') as has_legacy_thinking,
    JSON_CONTAINS_PATH(advanced_config, 'one', '$.temperature') as has_legacy_temp,
    JSON_CONTAINS_PATH(advanced_config, 'one', '$.generationConfig.thinkingConfig') as has_new_thinking,
    'CLEANED' as status
FROM agent_prompts
WHERE advanced_config IS NOT NULL;

-- 显示受影响的记录数
SELECT COUNT(*) as affected_prompts FROM agent_prompts WHERE advanced_config IS NOT NULL;
