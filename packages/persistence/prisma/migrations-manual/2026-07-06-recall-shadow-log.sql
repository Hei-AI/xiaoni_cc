-- 触发2 shadow 留痕表(每次落地自动召回的结果,只记录不投递)。手动 guarded 应用。
-- 幂等。详见 docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md §4。
--   docker exec -i qqbot-postgres psql -U qqbot_user -d qqbot_db < 本文件
-- 回滚: DROP TABLE IF EXISTS xiaoni_recall_shadow_log;

BEGIN;

CREATE TABLE IF NOT EXISTS xiaoni_recall_shadow_log (
  id             BIGSERIAL PRIMARY KEY,
  identity_key   VARCHAR(64)  NOT NULL,
  occurred_at    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  query_ref      VARCHAR(512),
  query_text     TEXT,
  task_locked    BOOLEAN NOT NULL DEFAULT false,
  band_floor     DOUBLE PRECISION,
  band_ceiling   DOUBLE PRECISION,
  silent         BOOLEAN NOT NULL DEFAULT true,
  corpus_count   INTEGER NOT NULL DEFAULT 0,
  top_k          INTEGER NOT NULL DEFAULT 0,
  surfaced       JSONB NOT NULL DEFAULT '[]',
  dropped_counts JSONB NOT NULL DEFAULT '{}',
  dropped_sample JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_xiaoni_recall_shadow_log_identity_occurred
  ON xiaoni_recall_shadow_log (identity_key, occurred_at DESC);

COMMIT;
