# OS 文本准入、润色与工具字段隔离

本页维护当前契约；旧分类、完整上下文 fill fork 和旧开关语义可查 Git。主 loop 与 Plan 边界见 [stack ledger](../XIAONI_AGENT_STACK_LEDGER.md)。

## 两条通道

| 管理面 / 配置 | 当前行为 |
| --- | --- |
| `stripXiaoniOsFromRequests` / `strip_xiaoni_os_from_requests` | 新工具参数和结构化结果中的 OS 字段冻结隐藏标记，请求组装时剥离；不回溯修改历史 |
| `psychAssessmentGateEnabled` / `psych_assessment_gate_enabled` | 保留兼容字段名；开启时按下述规则冻结 Assistant 文本准入，不再做 action/idle 分类 |
| `XIAONI_OS_POLISH_ENABLED` | 进程级润色开关，默认开启；关闭时原文准入 |
| `XIAONI_OS_POLISH_MODEL` | 独立润色请求的模型，默认 `claude-sonnet-5-5` |

文本总门关闭时不产生新的准入 stamp；历史已准入文字仍按冻结记录 replay。工具字段隔离和 Assistant 文本准入是不同通道。

## 文本处理

- 中途带工具的 Assistant 文本直接原文准入；只润色最后收尾、无工具的 OS。
- 润色使用独立小请求：system 为 `xiaoni_os_polish_system.md`，user 为当前原文与必要重试反馈。它不克隆主请求、不执行工具、不投 Notify。
- 输出上限为 `max(原文字数, 100)`；正文格式错误或过长按既有重试上限处理，最终过长截断。连续无有效正文或请求失败则保留原文。
- 只改标点或空白算 `kept`，保留原文字节；有效改写为 `rewritten`；失败为 `failed_open`。三者均保留正文并冻结 `text_admit`，不因辅助调用失败丢掉 OS。
- `xiaoni_os_rewrites` 保存结果、原文、改写、调用 id 与重试次数。新润色请求无 `fill_fork_run_id`；历史 fill fork 记录继续可查。

## 缓存与回放

主 tools 和稳定 prompt 的变更会使旧前缀失效，应与已有压缩重读边界对齐。其余 fork 仍逐字节克隆当前主 canonical request；独立 OS 润色请求不共享主请求的巨大前缀。

准入与改写在首次落栈前就地冻结；live 和 replay 使用同一正文。下一 run 不重新润色、重新抽签或重新渲染时间。四支冻结缓存用例必须通过，真实缓存读数另用相邻 `wire_request` 和 usage 检查。

Plan 的生成、身份和投递只维护在 stack ledger；OS 润色不代替 Plan，也不替主 agent 发言。历史分类及 fill fork 证据可通过 Git 和 Raw Trace 查询，不能解释为现行实现。

## 整合验证边界（2026-10-29）

本轮合入及四服务定向部署后，agent 定向 71 项、事件去重含真库 8 项、载荷清理真库 6 项、模型设置真库 3 项、memory-write 81 项、验证码脚本 9 项、provider 定向 28 项、行动流 53 项通过；四支冻结缓存测试文件保持原样。旧 broad runtime suite 的 8 项陈旧断言在合入前 main 同样失败，整套另有超时，不能称全量测试通过。

主 runtime 保持关闭，故没有部署后相邻主 slice 的真实缓存读数；启动缓存心跳遇到 Anthropic OAuth 403（组织不允许 OAuth），不能将健康检查或历史命中率当作模型调用验收。

按操作要求关闭 LLM 探针：runtime control 的 `cache_heartbeat_paused=true`、`debug_cache_heartbeat_interval_ms=0`；本机 `agent-service.env` 的 `AGENT_CACHE_HEARTBEAT_ENABLED=false`、`XIAONI_RECALL_JUDGE_WARM_INTERVAL_MS=0`。这些只关闭主请求缓存保温和召回精排预热，不改变 canonical/replay 字节；普通 HTTP/容器 healthcheck 保留。真实调用与缓存验收待运行恢复且上游认证可用后再做。
