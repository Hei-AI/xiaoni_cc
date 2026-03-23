-- 041_create_agent_proactivity_controls.sql
-- 小腻 V1 Phase 2+: runtime proactivity controls for followup dispatch

CREATE TABLE IF NOT EXISTS agent_proactivity_controls (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    followup_enabled TINYINT(1) NOT NULL DEFAULT 1,
    is_paused TINYINT(1) NOT NULL DEFAULT 0,
    allowed_user_ids JSON NULL,
    max_per_run INT UNSIGNED NOT NULL DEFAULT 1,
    retry_delay_ms INT UNSIGNED NOT NULL DEFAULT 21600000,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
