# exec_command session 是 runtime 内部机制，不暴露给小腻

修 image-send 确认不可靠时，选择在 agent-service 内部自动 settle 仍在 running 的 xiaoni-executor
session（有界轮询 + 显式 pending 警告），再写那一条模型可见的 tool callback；而不是给小腻加
`poll_exec_session` 工具，也不把 `qq-send-image` 升级成 prompt-facing tool。

理由是可靠性问题出在 runtime 接线，不在她的工具箱。多一个工具就多一条她要学、要判断、
要烧轮次的路径。（`poll_exec_session` 至今没出现在 agent-service 代码里，边界仍然成立。）
