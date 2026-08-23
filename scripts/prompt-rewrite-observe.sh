#!/usr/bin/env bash
# 2026-08-23 提示词照 CC 形制重写的前后对比度量。
#
# 分界线 = 上线时刻 2026-08-23 12:44:23+08（压缩提交那一帧，新 prompt + 新 tools 同时落地）。
# 改前基线见 docs/investigations/ 与 commit a65e8a8b / 01e99666 的正文。
#
# 用法: scripts/prompt_rewrite_观察.sh
set -euo pipefail

CUTOVER='2026-08-23 12:44:23+08'
PSQL=(docker exec qqbot-postgres psql -U qqbot_user -d qqbot_db -tAc)

echo "分界线: $CUTOVER"
echo

echo "── ① goal 创建率（改前 11 小时 / 149 run = 0）──"
"${PSQL[@]}" "
select
  (select count(*) from xiaoni_goals where created_at > '$CUTOVER') as goals_after,
  (select count(*) from agent_runs  where created_at > '$CUTOVER') as runs_after,
  (select count(*) from tool_executions
     where created_at > '$CUTOVER'
       and tool_name in ('get_goal','create_goal','update_goal')) as goal_tool_calls,
  (select count(*) from failure_review_fork_slices where created_at > '$CUTOVER') as review_forks"
echo "  列: goals_after | runs_after | goal_tool_calls | review_forks"
echo

echo "── ② exec_command 注释率（改前 67.9%，注释占字节 27.3%）──"
"${PSQL[@]}" "
with c as (
  select (raw_arguments::jsonb->>'cmd') as cmd
  from tool_executions
  where tool_name='exec_command' and created_at > '$CUTOVER'
    and raw_arguments::jsonb->>'cmd' is not null)
select count(*) as total,
       count(*) filter (where cmd ~ '(^|\n)\s*#') as with_comment,
       round(100.0*count(*) filter (where cmd ~ '(^|\n)\s*#')/nullif(count(*),0),1) as pct_calls,
       round(100.0*sum((select coalesce(sum(length(l)),0)
                        from unnest(string_to_array(cmd, chr(10))) l
                        where btrim(l) like '#%'))/nullif(sum(length(cmd)),0),1) as pct_bytes
from c"
echo "  列: total | with_comment | pct_calls | pct_bytes"
echo

echo "── ③ xiaoni_os 使用率（改前 5% = 187/3701）──"
"${PSQL[@]}" "
select count(*) filter (where raw_arguments::jsonb ? 'xiaoni_os') as with_os,
       count(*) as total_tool_calls,
       round(100.0*count(*) filter (where raw_arguments::jsonb ? 'xiaoni_os')/nullif(count(*),0),1) as pct
from tool_executions where created_at > '$CUTOVER'"
echo "  列: with_os | total_tool_calls | pct"
echo

echo "── ④ 缓存健康（冷读应恰好一次，在 12:44:28）──"
"${PSQL[@]}" "
select count(*) as slices,
       count(*) filter (where (token_usage->>'cached_input_tokens')::int = 0) as cold_reads,
       round(avg(100.0*(token_usage->>'cached_input_tokens')::numeric
                 / nullif((token_usage->>'input_tokens')::numeric,0)),2) as avg_hit_pct
from llm_request_slices
where created_at > '$CUTOVER' and token_usage is not null"
echo "  列: slices | cold_reads | avg_hit_pct"
