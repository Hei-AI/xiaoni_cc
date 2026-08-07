-- 被动浮现投递闸的管理端控制位。
--
-- 为什么进 agent_runtime_control 而不是留环境变量:这是第一个会**主动发东西给小腻**的
-- 召回通道(在此之前整条链 shadow-only)。环境变量要改 docker-compose.yml + 重启
-- agent-service 才生效 —— 一个能主动打扰她的开关,出问题时必须能在页面上一键关掉。
-- 本表的其余开关都走 agent-service 每 poll 热下发(一迭代延迟,无重启),这两列同路。
--
-- daily_cap 允许 0(= 等同关闭)。默认 6 是保守起步值,不是防打扰的主力
-- (主力是 dedupeKey 的「同一段记忆永不重投」);她每天已有 170-716 条 system_reminder。
--
-- agent-runtime-control.js 的 ensureSchema 里有同样的 ADD COLUMN IF NOT EXISTS,
-- 这份文件是给「不跑 ensureSchema 的环境」用的显式迁移记录,两处必须一致。

ALTER TABLE agent_runtime_control
  ADD COLUMN IF NOT EXISTS passive_recall_delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE agent_runtime_control
  ADD COLUMN IF NOT EXISTS passive_recall_delivery_daily_cap INTEGER NOT NULL DEFAULT 6;
