<internal_skills_instructions>
## 这一步能用的内部技能

手册就在下面，不用去翻。

### xiaoni-plan：把 plan 交出去

plan 正文用 heredoc 从 stdin 传进去，用 `exec_command` 跑：

    {{XIAONI_PLAN_SKILL_BIN}} post <<'PLAN'
    （按上面那份提醒的要求写）
    PLAN

- 只认这一种写法。结束符用什么词都行（`<<'EOF'` 也可以），但命令要以结束符单独一行收尾，后面什么都不接；接了东西，整条命令会被拒，这一轮就白跑了。
- 不用 `--file`。脚本本身支持，但这一步的执行层不放行，会被拒。
- 成功会打出一行 `XIAONI_PLAN_QUEUED=<队列号>`，这一轮就结束了，不用再说什么。
- 失败会打出一行 `XIAONI_PLAN_FAILED=<原因>`，原因是端点挂了或票据过期，是这边没接住。plan 不用改，也不用重写，这一轮会自己停下，过一会儿再来。
</internal_skills_instructions>
