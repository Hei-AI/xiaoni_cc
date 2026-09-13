# OS 文本准入、复核与工具字段隔离

本页维护当前契约；2026-08-27 的单条改写流程和 2026-09-09 的完整上下文填充 fork 的历史实现可查 Git。主 loop 与 Plan 投递边界见 [stack ledger](../XIAONI_AGENT_STACK_LEDGER.md)。

## 两个开关不是同一通道

管理端设置通过 admin-backend 的 runtime control PATCH 写入持久层，agent-service supervisor 每次 poll 读取并热下发。字段名保留兼容，不做数据库迁移。

| 管理面 | API / DB | 开启 | 关闭 |
| --- | --- | --- | --- |
| 工具 OS 字段隔离 | `stripXiaoniOsFromRequests` / `strip_xiaoni_os_from_requests` | 对新产生的工具参数/结构化结果中的 `xiaoni_os` 冻结隐藏标记，组装请求时剥离该字段 | 新工具 OS 字段照常回传 |
| Assistant 文本准入与改写（旧称心理评估门控） | `psychAssessmentGateEnabled` / `psych_assessment_gate_enabled` | 运行文本分类及按需润色/复核，按结果冻结准入 | 不运行文本处理，不给新 Assistant 文本准入 |

两者同时为 true 时：**工具 OS 字段隐藏，获准的 Assistant 文本仍进入上下文**。关闭文本准入不删除已准入历史，开启工具隔离也不回溯改写旧工具记录。都不是“抹掉所有历史 OS”的总开关。

这里的 Assistant 文本在 canonical request 中通常是 `type:message, role:assistant`，内容为 `output_text`；口语中的“assistant type:text”不是另一条通道。工具 JSON 字段、Assistant 文本、原始 provider response 和管理面审计不能混为一谈。非 JSON 的工具输出不由工具字段剥离器扫描。

## 文本处理

只有文本准入开关开启时才进入以下流程：

| 处理结果 | 后续主请求 |
| --- | --- |
| action，正文无需整理 | `kept`，原文准入 |
| action，需要润色 | `polished`，润色正文准入；失败则 `failed_open` 保留原文 |
| 分类失败或无法识别 | `failed_open`，原文准入 |
| idle，完整上下文 fork 返回有效修订 | `rewritten, rewrite_stage=fill`，修订正文准入 |
| idle，完整上下文 fork 原样返回 | `kept, rewrite_stage=fill`，原文准入 |
| idle，完整上下文 fork 失败、拒答、无块、超长或清理后为空 | `failed_open, rewrite_stage=fill`，原文准入 |
| idle，显式关闭完整上下文 fork 后使用单条改写 | 保持旧路径：成功准入改写；失败 `evicted`，不准入 |

完整上下文 fork 由进程环境变量 `XIAONI_OS_FILL_FORK_ENABLED` 控制，默认开启（只有字符串 `false` 关闭）；它仍受文本准入总开关约束。管理面的旧“心理评估门控”不绑定旧 `runPsychAssessmentGate`，而绑定 `runXiaoniOsRewriteForItem`。旧心理评估 trace 仍可查看，但不能拿来解释现行开关。

分类和单条润色/改写走独立小请求；fill 克隆当前主请求，追加本轮原始自述与 `xiaoni_os_fill_reminder.md`，看得到已有 Plan 和上下文。fill 不执行工具、不投 Notify、不替主 agent 发言。其模型输出中的工具调用仅是审计，不是已执行动作。

2026-09-13 修正：辅助模型拒答/超时/格式错误不能证明原文无效，fill 失败不再导致原 OS 丢失。复核允许保留原文、休息与主动暂停；只按已有证据整理，不替她制造新承诺。分类、润色与关闭 fill 后的旧改写策略未整体重做，仍需分别评估。

## Plan 与刺激

两条现役路径职责不同：

- **OS 复核**：在文本第一次进入后续请求前整理备注；使用已有 Plan/事实，仍写入 Assistant 文本。
- **自驱动 Plan**：主循环在符合空桶/收口条件时运行 fork，将方向经既有 Plan 提交/Notify Bucket 进入主 loop；不是 Assistant 自述，也不由文本准入开关控制。

两份 fork 提示统一要求对照“已有方向、实际结果、新信息”，把有依据的新变化接到相关 Plan；无关的新兴趣不硬接。没有外部证据只能提供待查入口，不能把未访问的站点写成“刚更新”、不能伪造新消息。自驱动 fork 只允许配置开启时的 Plan 提交命令，不能自己搜索/浏览。

独立的外界信息采集器（world feed）不属于当前这条实现；“提示词提到外界”不等于已经具备采集和核验能力。现有 QQ 入站和已执行工具结果可以提供真实外源信息。计划是否改善自主选择，需观察后续行为，不以工具数、作品数或少休息作为单独验收指标。

## 冻结与缓存

`text_admit=true` 与最终正文在首次落栈前决定，live input 和 stack 持久化同源；无 stamp 的文本从主 replay 过滤。出线时移除内部 stamp，**不移除获准正文**。旧历史不重新分类。

- fork 缓存：主 system/tools 与已有输入不变；fill/Plan 提示只追加在克隆尾部，fill 与自驱动请求不写主栈。每个多轮 fork 的尾部模板在启动时固定。
- 下一次主 run 缓存：原文兜底沿用已有 `kept/failed_open → stampTextAdmitInPlace` 分支，正文和准入首次冻结；下个 run 逐字节 replay。新增可见文本会增加后续上下文，但不重写此前前缀。
- 模板改动不要求修改主 system prompt 或 tools；片段在下一次相应 fork 构造时读取。切换不回溯修复已经丢弃的 OS。
- 必须通过四组冻结缓存回归，并用相邻真实 wire request 与 usage 验证；测试通过不能替代线上缓存读数。

## 证据与诊断

2026-09-13 14:05:16–14:43:06（UTC+8），改动前最近 100 条记录：kept 38、rewritten/fill 26、polished 15、evicted/fill 21。仅代表此时间窗，不是长期比例。

主 slice `166532 / llm_1789281776731_18240d01` 的 canonical request 含 403 条 Assistant message。逐条比对其真实 wire request：

- rewrite 12219：原文保留，stack index 370387 有准入 stamp，wire 中有原文。
- rewrite 12215：fill 修订后保留，stack index 370371 有 stamp，wire 有修订、无原文。
- rewrite 12213：润色后正文进入 wire。
- rewrite 12214：fill 失败被剔除，stack index 370369 无 stamp，wire 无该原文。

`llm_1789281666341_a0e953ec` 等 fill slice 明确拒绝旧提示中“让她以为是自己写的”要求，并请求发私聊；fork 不执行该工具。旧路径最终以无 OS 块为由剔除了原文。这是本次修复的具体故障证据，不代表所有 fill 失败都有相同原因。

观测入口：

- `xiaoni_os_rewrites`：原文、修订、分类与 outcome、rewrite_stage、fill_fork_run_id。
- `subconscious_agent_fork_runs/slices`：`metadata.trigger=xiaoni_os_idle_fill` 与普通 Plan fork 可分开统计。
- `agent_stack_items`：冻结正文与 text_admit。
- `llm_request_slices.wire_request`：模型实际收到的正文；不能仅凭管理面能看见或原始 response 存在判定已进上下文。

## 历史旁路

`exec_command` 整行注释剥离保持既有实现：执行路由、stack 和 live 从同一 canonical response 派生；provider slice 保留原始响应。该机制不由上述两个 OS 开关切换。本次不恢复被剥除的历史注释或文本。
