-- Deprecated migration kept as a no-op for sequence compatibility.
-- Legacy input_prompt expansion was replaced by canonical/wire payload columns
-- in database/migrations/020_replace_llm_call_logs_payload_columns.sql.
USE qqbot_db;

SELECT 'Migration 019 is deprecated; canonical/wire payload schema is managed by migration 020.' AS message;
