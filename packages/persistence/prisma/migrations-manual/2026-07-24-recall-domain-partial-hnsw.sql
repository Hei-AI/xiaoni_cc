-- 海马体分域检索的分域 partial HNSW 索引(design-20260723 / 交叉 review ASK-1)。
--
-- 背景:listRecallCandidates 按 cueClass 分两域各自 top-K 后,单一全量 HNSW 索引出现两个病:
--   ① 他人域(少数类,~13% 行)查询被 planner 判为 seq scan(实测 ~236ms 扫全 88k 行,每条落地×2);
--   ② 若 planner 翻回全量 HNSW,post-filter 会把少数域截断在真 top-K 之下(ef_search 语义只覆盖无过滤扫描)。
-- 修法:每域一个带 WHERE 的 partial HNSW——域内自己的图,既无 seq scan 也无截断。
--
-- 谓词必须与查询逐字对齐(planner 需在 plan 时证明蕴含):
--   自我域查询: provenance->>'cueClass' = ANY('{db_file_provenance,db_spoken_fragment}')
--   他人域查询: (provenance->>'cueClass' = ANY('{db_life_cue}') OR provenance->>'cueClass' IS NULL)
-- 配套:listRecallCandidates 在 cueClasses 分支下 SET LOCAL plan_cache_mode = force_custom_plan,
-- 保证参数化 ANY 以字面量参与规划,partial 索引才可被匹配(generic plan 证明不了蕴含)。
--
-- 应用方式(CONCURRENTLY 不能进事务,逐条执行):
--   docker exec qqbot-postgres psql -U qqbot_user -d qqbot_db -c "<每条语句>"
-- 幂等:IF NOT EXISTS。

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xiaoni_recall_cue_hnsw_self
  ON xiaoni_recall_cues USING hnsw (embedding_vec vector_cosine_ops)
  WHERE provenance->>'cueClass' IN ('db_file_provenance', 'db_spoken_fragment');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xiaoni_recall_cue_hnsw_peer
  ON xiaoni_recall_cues USING hnsw (embedding_vec vector_cosine_ops)
  WHERE provenance->>'cueClass' = 'db_life_cue' OR provenance->>'cueClass' IS NULL;

-- 追补(同日): scope fence(RECALL_SCOPE_SQL,召回桶)合流后,self 索引把 fence 谓词一并烤进——
-- 否则 fence 作为后置过滤要爬过 ~47k 读物向量(实测 178ms/借 iterative_scan 才凑满 k);
-- 烤进后 6.5ms 返满 150。已在主栈 DB 用 DROP+CREATE CONCURRENTLY 重建为如下最终定义:
DROP INDEX CONCURRENTLY IF EXISTS idx_xiaoni_recall_cue_hnsw_self;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xiaoni_recall_cue_hnsw_self
  ON xiaoni_recall_cues USING hnsw (embedding_vec vector_cosine_ops)
  WHERE provenance->>'cueClass' IN ('db_file_provenance', 'db_spoken_fragment')
    AND (source_kind IN ('inbound','action_stream')
      OR (source_kind = 'file_chunk'
        AND (source_ref LIKE '%/notes/diary/%' OR source_ref LIKE '%xiaoni-identity-anchor%')));
-- 配套代码: listRecallCandidates cueClasses 分支 SET LOCAL force_custom_plan + hnsw.iterative_scan=relaxed_order。
