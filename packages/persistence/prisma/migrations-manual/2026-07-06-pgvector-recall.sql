-- 小腻被动浮现 pgvector 迁移(P0 止崩)。手动 guarded 应用到主栈 DB。
-- 前置:postgres 镜像必须是 pgvector/pgvector:pg16(stock postgres:16 无 vector 扩展)。
-- 幂等:可重复执行。详见 docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md §4。
--
-- 应用(在主栈 DB 上,worktree 先验回滚):
--   docker exec -i qqbot-postgres psql -U qqbot_user -d qqbot_db < 本文件
-- 回滚:
--   DROP TRIGGER IF EXISTS trg_xiaoni_recall_embedding_vec ON xiaoni_recall_cues;
--   DROP FUNCTION IF EXISTS xiaoni_recall_sync_embedding_vec();
--   DROP INDEX IF EXISTS idx_xiaoni_recall_cue_embedding_hnsw;
--   ALTER TABLE xiaoni_recall_cues DROP COLUMN IF EXISTS embedding_vec;

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE xiaoni_recall_cues
  ADD COLUMN IF NOT EXISTS embedding_vec vector(768);

-- 触发器:embedding_vec 是 Json embedding 的派生镜像。
-- upsert 只写 embedding(typed client 写不了 Unsupported 列),向量由此自动跟随,永不脱漏。
-- 维度不符(非 768)则置 NULL,不阻断写入(坏行不进最近邻检索)。
CREATE OR REPLACE FUNCTION xiaoni_recall_sync_embedding_vec()
RETURNS trigger AS $$
BEGIN
  IF NEW.embedding IS NULL
     OR jsonb_typeof(NEW.embedding) <> 'array'
     OR jsonb_array_length(NEW.embedding) <> 768 THEN
    NEW.embedding_vec := NULL;
  ELSE
    NEW.embedding_vec := NEW.embedding::text::vector;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_xiaoni_recall_embedding_vec ON xiaoni_recall_cues;
CREATE TRIGGER trg_xiaoni_recall_embedding_vec
  BEFORE INSERT OR UPDATE OF embedding ON xiaoni_recall_cues
  FOR EACH ROW EXECUTE FUNCTION xiaoni_recall_sync_embedding_vec();

-- 一次性回填存量(触发器只管未来写入)。
UPDATE xiaoni_recall_cues
SET embedding_vec = embedding::text::vector
WHERE embedding_vec IS NULL
  AND jsonb_typeof(embedding) = 'array'
  AND jsonb_array_length(embedding) = 768;

-- HNSW 余弦索引(boring 好默认;IVFFlat 要训练,不用)。
CREATE INDEX IF NOT EXISTS idx_xiaoni_recall_cue_embedding_hnsw
  ON xiaoni_recall_cues
  USING hnsw (embedding_vec vector_cosine_ops);

COMMIT;

-- 验证:
--   SELECT count(*) FILTER (WHERE embedding_vec IS NOT NULL) AS vec, count(*) AS total FROM xiaoni_recall_cues;
--   EXPLAIN ANALYZE SELECT source_ref FROM xiaoni_recall_cues
--     WHERE embedding_vec IS NOT NULL
--     ORDER BY embedding_vec <=> (SELECT embedding_vec FROM xiaoni_recall_cues WHERE embedding_vec IS NOT NULL LIMIT 1)
--     LIMIT 300;   -- 应走 idx_..._hnsw, 毫秒级
