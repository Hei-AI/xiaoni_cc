-- shadow log 加一列:记 Haiku 在这一次召回里干了什么。
--
-- 背景:query 展开和投递闸判官都走小模型,但它们的调用经 /api/internal/llm/debug,
-- 那条路径是 executeProviderRequest(..., persistAgentSlice=false) —— **不落 llm_request_slices**。
-- 真库核查(2026-08-21):近 3 天 5264 条 slice 全是 claude-opus-4-6,一条 Haiku 都没有。
-- 也就是说这两处的工作内容此前在管理端完全不可见。
--
-- 为什么放在 shadow log 而不是新建表:这张表已经是召回的观察面,管理端
-- /xiaoni/passive-recall/shadow-log 直接读它,前端按腿分组展示。新建表就要再建一条通路。
--
-- 形状(两种,靠 kind 区分):
--   {"kind":"expansion","model":...,"tags":[...],"queries":[...],"added":N,"raw":"…"}
--   {"kind":"judge","model":...,"anchor":"…","candidates":[{id,text}],"picks":[{id,hook}],"parsed":bool,"raw":"…"}
ALTER TABLE xiaoni_recall_shadow_log
  ADD COLUMN IF NOT EXISTS llm_work JSONB;
