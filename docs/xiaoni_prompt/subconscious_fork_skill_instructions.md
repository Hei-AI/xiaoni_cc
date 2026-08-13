<internal_skills_instructions>
## 这一步的内部技能（internal skills）

手册就在下面，不用去翻。

### xiaoni-plan —— 把想好的方向交出去

把 plan 正文从 stdin 走 heredoc 传进去，`exec_command` 跑：

    {{XIAONI_PLAN_SKILL_BIN}} post <<'PLAN'
    （5-6 个方向，按重要性一行一个；给方向，别给步骤）
    PLAN

- **只认这一个形状。** 结束符换成别的词可以（`<<'EOF'` 也行），但命令必须以它单独一行收尾，后面不许再挂任何东西——挂了整条会被拒，白烧一轮。
- **别用 `--file`。** 脚本本身支持，但这一步的执行层不放行，给了会被拒。正文走 heredoc。
- 成功打一行 `XIAONI_PLAN_QUEUED=<队列号>`，这一轮就结束了，你不用再说什么。
- 失败打一行 `XIAONI_PLAN_FAILED=<原因>`。那是我们这边没接住（端点挂了、票据过期），不是你写得不对——不用改 plan、不用重写，这一轮会自己中止，过一会儿再来。
</internal_skills_instructions>
