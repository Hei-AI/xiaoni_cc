# Xiaoni Timezone Migration Plan

本页是小腻时区切换的执行事实源。

## Target

- 存储目标：结构化时间最终按 Instant 存储，PostgreSQL 使用 `TIMESTAMPTZ(3)`。
- 展示目标：管理端页面、小腻 prompt-facing context、运行日志里给人看的时间统一显示 `Asia/Shanghai` / UTC+08:00。
- 历史 stack 文本不回写。已经进入 `agent_stack_items.content` 的 prompt-visible 文本是历史证据，只能在未来新增 context 时使用新的东八区渲染。

## Manual Gate

正式切换必须走人工设闸，不自动迁移。

```text
管理员打开“下次压缩后暂停”
        |
        v
小腻继续运行，等待下一次 compress_core_memory 成功
        |
        v
compression commit 写入 <小腻近况> 和 read cutoff
        |
        v
agent-service 自动设置 runtime enabled=false，并清掉设闸状态
        |
        v
人工确认小腻已暂停后，再执行 TIMESTAMPTZ / 东八区展示切换
```

这个闸门只负责把系统停在低缓存损失窗口。它不是自动迁移器，也不会在暂停后自行改表或改数据。

## Runtime Control Contract

`agent_runtime_control` 保留两个开关：

- `enabled`: 立即暂停或恢复小腻主循环。
- `post_compression_pause_armed`: 手动设闸。开启后，小腻不会立即暂停；下一次核心记忆压缩成功 commit 后才暂停。

状态机：

```text
enabled=true, armed=false   -> 正常运行
enabled=false               -> 立即暂停，不 claim 新 runtime work
armed=true                  -> 等下一次成功 compression commit
compression committed       -> enabled=false, armed=false, triggered_at=now()
compression failed/no tool  -> armed 保持 true
```

如果触发暂停的 DB 更新失败，压缩结果仍然成功写入；工程需要看日志并重新设闸或手动暂停。

## Migration Sequence

1. 先落二级暂停开关，并确认管理端可以手动设闸和取消。
2. 人工打开 `postCompressionPauseArmed`。
3. 等待下一次 `core_memory_compressed`，确认 runtime control 已变成 `enabled=false`。
4. 执行表级时区迁移，低风险表先行，高容量事实表后移：
   - `agent_runtime_control`
   - `agent_life_events` / life state
   - QQ inbox / queue
   - `agent_stack_items`、`llm_request_slices`、tool/fork/traffic/rollup 表
5. 每张表迁移时都要先做 dry-run audit：识别已正确、缺 8 小时、混合来源三类数据，禁止全表盲目 `+8h`。
6. 切换读写 helper：legacy `TIMESTAMP(3)` 继续走兼容 helper；已迁移 `TIMESTAMPTZ(3)` 走 Instant helper；人类和小腻上下文统一用东八区 formatter。
7. 跑 persistence、agent-service、admin frontend/backend 的时间展示测试后，再人工恢复小腻主循环。

## Xiaoni Context Shape

未来进入小腻上下文的新结构化时间应该长这样：

```text
<MESSAGE timestamp="2026-06-14 12:55:30 UTC+08:00">
```

不要把 `2026-06-14T04:55:30.000Z` 直接暴露给小腻作为日常可读时间。
