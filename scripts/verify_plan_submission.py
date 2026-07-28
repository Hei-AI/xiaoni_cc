#!/usr/bin/env python3
"""自驱动 plan 提交链路的活体验收（只读）。

一条命令出三样数，不用每次重新想该查什么 SQL：

  1. 自转连续性 —— 相邻两条 plan notify 的间隔。出现远大于常态的空档就是断过链。
  2. fork 成败分布 —— 按失败模式分桶。400 prefill 归零是本票的核心指标。
  3. 缓存 —— 相邻两个 slice 的 cache_read_input_tokens。塌陷即击穿，必须为 0。

用法：
    python3 scripts/verify_plan_submission.py            # 默认看最近 6 小时
    python3 scripts/verify_plan_submission.py --hours 24

只读，不写任何东西。接主栈 Postgres（docker exec），与 CLAUDE.md 的
「worktree 里也必须连主工作区主栈 DB」一致。
"""

import argparse
import subprocess
import sys

CONTAINER = "qqbot-postgres"
DB_USER = "qqbot_user"
DB_NAME = "qqbot_db"


def query(sql: str) -> str:
    result = subprocess.run(
        ["docker", "exec", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-c", sql],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return "  查询失败：%s" % result.stderr.strip().splitlines()[-1:] or result.stderr
    return result.stdout.rstrip()


def section(title: str, body: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)
    print(body)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=6, help="回看窗口（小时），默认 6")
    args = parser.parse_args()
    window = "%d hours" % args.hours

    section(
        "① 自转连续性：相邻两条 plan notify 的间隔（秒）",
        query(
            """
            WITH plan_notifies AS (
              SELECT created_at,
                     LAG(created_at) OVER (ORDER BY id) AS prev_at
              FROM agent_queue_messages
              WHERE source = 'system_reminder'
                AND body_for_agent LIKE '<xiaoni_plan>%%'
                AND created_at > now() - interval '%s'
            )
            SELECT count(*)                                              AS plan_notify_数,
                   round(avg(EXTRACT(EPOCH FROM created_at - prev_at)))  AS 平均间隔秒,
                   round(max(EXTRACT(EPOCH FROM created_at - prev_at)))  AS 最大空档秒,
                   max(created_at)                                       AS 最近一条
            FROM plan_notifies WHERE prev_at IS NOT NULL;
            """
            % window
        ),
    )

    section(
        "② 潜意识 fork 成败分布（400 prefill 应为 0）",
        query(
            """
            SELECT CASE
                     WHEN status <> 'failed' THEN '✅ ' || status
                     WHEN error_message LIKE '%%assistant message prefill%%' THEN '❌ 400 prefill'
                     WHEN error_message LIKE '%%orphaned%%'                  THEN '⚠️  orphaned_on_restart'
                     WHEN error_message LIKE '%%plan_submission_failed%%'    THEN '⚠️  skill 提交失败'
                     ELSE '❌ ' || left(coalesce(error_message, '?'), 40)
                   END AS 结果,
                   count(*) AS 次数,
                   max(created_at) AS 最近
            FROM subconscious_agent_fork_runs
            WHERE created_at > now() - interval '%s'
            GROUP BY 1 ORDER BY 2 DESC;
            """
            % window
        ),
    )

    section(
        "③ 缓存：主 agent 相邻 slice 的 cache_read（塌陷=击穿，必须没有）",
        query(
            """
            WITH s AS (
              SELECT created_at,
                     (token_usage->>'cached_input_tokens')::bigint AS cache_read,
                     LAG((token_usage->>'cached_input_tokens')::bigint)
                       OVER (ORDER BY id) AS prev_cache_read
              FROM llm_request_slices
              WHERE created_at > now() - interval '%s'
                AND token_usage ? 'cached_input_tokens'
            )
            SELECT count(*)                          AS slice_数,
                   min(cache_read)                   AS 最低cache_read,
                   max(cache_read)                   AS 最高cache_read,
                   count(*) FILTER (
                     WHERE prev_cache_read > 100000 AND cache_read < prev_cache_read / 2
                   )                                 AS 塌陷次数
            FROM s WHERE prev_cache_read IS NOT NULL;
            """
            % window
        ),
    )

    print(
        "\n判读：① 最大空档远大于平均 = 断过链；② 400 prefill 必须为 0；"
        "③ 塌陷次数必须为 0（>0 就去比对相邻两 slice 的 wire_request 找漂移点）。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
