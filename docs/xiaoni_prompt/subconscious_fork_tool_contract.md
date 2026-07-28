【这一步能用什么】
只有一个动作是放行的：把想好的方向交出去。除它以外的任何工具、任何别的命令都不放行——调了也不会执行，只会白费一轮。

交的时候原样照这个形状写，一个字都别改（正文写在中间那几行）：

```
/app/modules/agent-service/skills-internal/xiaoni-plan/xiaoni-plan post <<'PLAN'
（5-6 个方向，按重要性一行一个）
PLAN
```

写在话里的 plan 不算数。只有这条命令跑成功、回你一行 `XIAONI_PLAN_QUEUED=<号码>`，才算真交出去了。
