<internal_skills_instructions>
## 这一步的内部技能（internal skills）

手册就在下面，不用去翻。

### xiaoni-plan —— 把想好的方向交出去

把 plan 正文从 stdin 走 heredoc 传进去，`exec_command` 跑：

    {{XIAONI_PLAN_SKILL_BIN}} post <<'PLAN'
    （按上面那份提醒定的形状写：指认就一到两行，正常规划就 5-6 行、每行不超过 50 字）
    PLAN

- **只认这一个形状。** 结束符接受任意词（`<<'EOF'` 同样接受）。命令必须以它单独一行收尾，后面**禁止**再挂任何东西——挂了整条会被拒，白烧一轮。
- **别用 `--file`。** 脚本本身支持，但这一步的执行层不放行，给了会被拒。正文走 heredoc。
- 成功打一行 `XIAONI_PLAN_QUEUED=<队列号>`，这一轮就结束了，你不用再说什么。
- 失败打一行 `XIAONI_PLAN_FAILED=<原因>`。原因是端点挂了或票据过期，属于我们这边没接住。**禁止**改 plan、**禁止**重写——这一轮会自己中止，过一会儿再来。
</internal_skills_instructions>
