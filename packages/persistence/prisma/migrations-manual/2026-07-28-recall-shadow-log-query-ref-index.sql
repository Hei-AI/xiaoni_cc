-- 时间腿(第二/三条腿)去重冷却的窗口索引:(identity_key, query_ref, occurred_at DESC)。
--
-- 背景:listRecallShadowLog 加了 queryRef 下推(SQL 里 AND query_ref = $2)后,时间腿的查询是
--   WHERE identity_key = $1 AND query_ref = $2 ORDER BY occurred_at DESC, id DESC LIMIT 40
-- 现有索引 idx_xiaoni_recall_shadow_log_identity_occurred (identity_key, occurred_at DESC) 的前缀
-- 不含 query_ref,planner 只能沿 occurred_at 扫下去逐行 Filter。真库实测(35307 行,其中
-- diary_resurface 654 / open_loop_scan 224,~97% 是语义腿每次落地写的 stack:*/inbound:* 留痕):
--   Index Scan ... Filter: query_ref = 'diary_resurface'
--   Rows Removed by Filter: 2066   Buffers: shared hit=783 read=823   Execution Time: 3.7 ms
-- 语料每天新增约 2000 行语义腿留痕,这个 Filter 代价随流量线性长;复合索引让它退化成读 40 行。
--
-- 应用方式(CONCURRENTLY 不能进事务,单条执行;不取 SHARE 锁,不挡语义腿的并发 INSERT ——
-- 裸 DDL 在这个库有过独占锁 convoy 事故,一律走 CONCURRENTLY):
--   docker exec qqbot-postgres psql -U qqbot_user -d qqbot_db -c "<下面那条语句>"
-- 幂等:IF NOT EXISTS。
-- 校验: \d xiaoni_recall_shadow_log  以及
--   EXPLAIN ANALYZE SELECT id FROM xiaoni_recall_shadow_log
--     WHERE identity_key = 'xiaoni' AND query_ref = 'diary_resurface'
--     ORDER BY occurred_at DESC, id DESC LIMIT 40;   -- 期望 Index Scan,无 Rows Removed by Filter
-- 失败善后:CONCURRENTLY 中断会留 INVALID 索引,DROP INDEX CONCURRENTLY 后重跑。
-- 回滚: DROP INDEX CONCURRENTLY IF EXISTS idx_xiaoni_recall_shadow_log_identity_ref_occurred;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xiaoni_recall_shadow_log_identity_ref_occurred
  ON xiaoni_recall_shadow_log (identity_key, query_ref, occurred_at DESC);
