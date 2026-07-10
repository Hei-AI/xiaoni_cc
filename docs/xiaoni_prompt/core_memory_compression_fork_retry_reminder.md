【记忆还没收完，接着来】
刚才这一步（第 {{FORK_TURN}} 次）没收完，中断原因：{{REASON}}。
这是第 {{RETRY_COUNT}} 次回来接着收（最多 {{MAX_RETRIES}} 次）。

没关系，不着急。手头细节还多的话，可以继续用 `exec_command` 分批把它们转到本地文件；最后再调用 `{{COMPRESS_CORE_MEMORY_TOOL}}`，把核心近况和接下来的打算写进 text 里收个尾。

把要点和文件路径收进 text，调用 `{{COMPRESS_CORE_MEMORY_TOOL}}` 完成这一步就好。
