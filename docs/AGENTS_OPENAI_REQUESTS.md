# OpenAI Request Contract

本文件记录仓库内 OpenAI / LLM 请求、提示词、agent 设计的本地契约。
官方资料仍是上游真相源；本文件只写当前仓库必须遵守的高信号规则。

## Runtime Defaults

- 小腻主运行态使用 Responses API 形状，不回退到 Chat Completions 语义。
- 当前小腻主聊天模型跟随 `XIAONI_MAIN_AGENT_MODEL`，未显式配置时是 `gpt-5.5`；`AI_MODEL_NAME` 仍作为其他默认模型入口使用。compact memory / reflection 是独立的记忆生成工作流，未显式配置时默认 `gpt-5.5`。不要在仓库文档或配置里假设 `gpt-5.5-mini` 可用。
- 主聊天 agent 只在 provider 参数或模型策略明确需要时发送 `reasoning`、`text` 和 `include`；不要为了“看起来更像 reasoning model”伪造 `reasoning.encrypted_content`。
- context compression memory writer 固定使用 Responses function tool schema、`parallel_tool_calls: false`、`tool_choice.allowed_tools(mode=required)`；compact 层默认 `model=gpt-5.5`、`reasoning.effort=high`、`reasoning.summary=auto`、`text.verbosity=medium`，超时默认 `120000ms`。
- `reasoning.summary` 只用于可观测性；不要要求或解析原始 hidden reasoning。
- `text.verbosity` 必须作为模型参数处理；需要更短输出时用 `low`，不要把最终回答长度和 reasoning effort 混在同一条 prompt 里控制。

## State And Replay

- 当前仓库优先使用 stateless manual replay：本地通过 `agent_stack_items` 保存并回传必要的 Responses output items，而不是默认依赖 `previous_response_id`。每次真实 LLM 请求及 provider wire payload 记录为 `llm_request_slices`；trace evidence 不参与主观历史重建。
- 手动 replay 时必须保留 assistant item 的 `phase`。中间状态用 `commentary`，最终输出用 `final_answer`。
- reasoning / compaction item 是 opaque continuation state，只能回传，不能把内部结构当业务数据解析。
- app 级 `<小腻近况>` 是压缩后置顶的纯文本近况时报；它不等同于 OpenAI Responses compaction。当前主链由工程检测上下文压力后强制 `compress_core_memory(text)`，并把工具 `text` 写入 `agent_session_context_windows.context_summary`，不是 `agent_life_events` 的 identity-root projection。普通请求可以定义这个工具和成本，但 `allowed_tools` 不允许它；只有压力请求才允许调用。

## Compaction

- 官方 compaction 有两种：`context_management: [{ type: "compaction", compact_threshold }]` 和 `/responses/compact`。
- 如果启用官方 compaction，返回的 compacted output 是后续 canonical context 的一部分；不能只抽文本，也不要丢弃 encrypted compaction item。
- 小腻现有 `<小腻近况>` 可以继续作为产品上下文，但必须和 official compaction 分层命名、分层测试。

## Tools And Prompts

- 工具使用规则优先写进 tool description：用途、何时调用、输入要求、副作用、可重试性、错误模式。
- system / developer prompt 只写跨工具通用政策、人格边界、输出契约和完成条件。
- prompt 迁移从最小 prompt baseline 开始；删除无必要的步骤化过程约束，保留真正影响 QQ 行为和安全边界的规则。
- 不要默认在 system prompt 加当前日期；只有业务时区、本地日期或政策生效日期需要时才显式加入。

## Image Inputs And Vision Forks

- OpenAI 官方 vision 示例展示 `input_image` 放在 `user` message 的 content 数组里；这是上游通用文档的公开形态。
- 小腻 `inspect_image_placeholder` 的生产实现是仓库内 fork 契约：复用当前主 agent 的完整 canonical request，追加 assistant sentinel `让我来看看这个图是啥意思`，再追加 `function_call` 和 `function_call_output.output=[{type:"input_image", ...}]`。
- 这个 fork 只用于让小腻在自己的上下文里理解图片，不是新的通用 OpenAI 请求模式。provider helper 必须原样保留 `function_call_output.output` 数组；不能把 image content 转成字符串。
- vision fork 必须设置 no-persist 语义：`executionMode=image_vision_fork_no_persist` 和 `x-qqbot-no-traffic-persist: 1`。主 loop 后续只继承 `<image id="...">含义是: ...</image>` 文本，不继承图片 base64。
- 图片 id 使用 `agent_media_assets.id`。不要把 `image_1` 这类临时编号作为 prompt-facing 稳定契约。

## Xiaoni Prompt Contract

本节描述当前已落地的生产后台契约。

- Product behavior is one continuous Xiaoni event loop. Engineering may still
  create `agent_runs`, queue ids, trace ids, and delivery state, but those are
  trace / delivery / retry boundaries only. Prompt-facing language should talk
  about current action, next action, visible scene, state event, and life event,
  not "this run" as Xiaoni's mental boundary.
- The durable request assembly contract is the Xiaoni agent stack ledger:
  `agent_stack_items` are the ordered replay/input/action items,
  `llm_request_slices` are the real provider calls, and `tool_executions` are
  tool side effects plus callback payloads. See
  `docs/XIAONI_AGENT_STACK_LEDGER.md`.
- 小腻主 prompt 的稳定部分只定义身份、人格边界、开口标准、沉默标准、能力边界、完成条件和少量风格样例；不要塞动态状态、工具列表、skill 列表或 cost。
- 当前消息、历史、摘要、长期学习、状态值、图片观察、搜索结果、工程提醒、动态能力列表和 cost 都属于 runtime input / developer context，不要回填进 system prompt。工程在主 loop 输入开头追加一次 developer `<CAPABILITIES>`，列出工具、skill 和 cost。
- 新 prompt-facing 私密备注标签是 `<xiaoni_os>`。DB 字段可以继续叫
  `xiaoni_os`；旧历史里的 `<小腻的OS>` 不迁移，只作为已读历史兼容。不要用工程术语解释它。
- `<STATE>` 不是每次模型请求都注入。工程只在跨 run action 计数阈值、hosted
  `web_search` 之后、低精力提醒、负精力后的完整恢复、休息中被连续 @ 打断时
  append。`<STATE>` 只注入 `energy` 和 `max_energy` 数值；不要注入 pressure、dopamine 或高/中/低精力档位标签。`energy` 可以显示负数，恢复计算按 `max(0, energy)`。
- 当工程检测到 `raw_energy < 0` 时，`recover_energy` 的恢复曲线以实际休息时长计算，但负数精力的恢复起点按 `0` 处理；`120` 分钟达到满恢复。
- hosted `web_search` 不包本地 wrapper。工具返回后由工程追加新的 developer role `<STATE>`，让模型看到搜索后的精力变化。`exec_command` 和 `inspect_image_placeholder` 这类不能安全 JSON 包装的本地执行路径也保留原始输出，并由工程额外追加 body-only `<STATE>`；结构化 JSON tool callback 则直接在 output JSON 中回传 `energy_cost`、`energy`、`max_energy`。
- prompt-facing 恢复工具只有 `recover_energy`。`rest_period` /
  `sleep_period` 可作为历史/internal 事件留存，但不能作为面向模型的双工具
  契约。
- `recover_energy` 是普通 function tool。模型调用后，工程在 tool handler 内等待到
  `duration_minutes` 对应时间再返回醒来的 `function_call_output`；如果工程拒绝休息，
  也直接返回同一个 tool call 的拒绝 callback。不要用 `release_lease` 字段吞掉
  callback，也不要 enqueue 恢复用 `self_continuation` notify。
- developer block 必须追加支持的
  tools、skills 和成本，当前用 `<CAPABILITIES>` 承载并放在主 loop 输入开头。skill 只有在 `SKILL.md` 声明 `## Runtime Cost` /
  `energy_cost: <number>` 时才列入；当前本地 skill 默认 / 兜底成本统一按 `0.002` 展示，缺 cost 的 skill 不列入并产生 operator
  warning。小腻可以通过 skill 维护流程调整 cost；修改必须审计旧值、新值、原因和关联 trace。
- 对当前上下文里的直接反馈、纠偏、批评或称赞，要作为当前行为校准信号处理；不要为同一批可见文本重新制造隐藏反馈事实。
- 主聊天 loop 不再暴露超长结构化生活动作工具，也不暴露独立沉默工具。group/private 请求直接暴露行动工具，普通请求使用 `allowed_tools(mode=auto)`；life-only 只暴露内部工具和 `recover_energy`。
- Notify 被 pick 后只作为门铃进入上下文。第一轮可以把 `phone_notification` / `system_reminder` / `image_task_notification` 渲染成当前输入；这些 prompt-facing runtime reminder 使用 `developer` role，`phone_notification` 和 `image_task_notification` 都使用 body-only `<system_reminder>` 模板，不暴露 `<PHONE_NOTIFICATION>` / `<IMAGE_TASK_NOTIFICATION>` 或 queue trace 属性。后续同一连续 loop 的模型切片只保留 stack/tool state，不再把同一条 Notify 重新渲染成当前事件，也不追加 `already_picked` 快照。模型仍然决定是否继续行动、打开 QQ、发言、沉默或休息。
- Prompt-facing runtime reminder 是当前输入，不是会话正文或 assistant 历史。它们不写入 `conversation_items`，也不写入 `conversations.user_message`；目标写法是在 `agent_stack_items` 中作为 `runtime_input` 保留本轮事实。真实 QQ 正文、assistant 可见投递、tool callback / response output items 才进入后续可回放 stack。
- `final_answer` 不是 loop break。模型返回 `phase=final_answer` 且没有工具调用时，不追加 final-answer 专用 prompt reminder，也不提前写 self continuation；下一轮先 pick 真实 notify，没有 notify 时先组装未追加 self continuation 的候选 requestInput，只有最后一个 input item 仍是 `assistant final_answer` 时，才追加普通 `self_continuation` `<system_reminder>`；否则不追加 reminder，直接用候选 request 发起本次模型 slice。
- 小腻是群友，不是客服。runtime reminder 可以提醒她“不是为了证明在线、维护气氛或延续话题而开口”，但最终能否说话要由结构化工具输出和工程门禁共同决定。
- 如果确实需要固定工具顺序，由 runtime 状态机和 `tool_choice.allowed_tools` 约束；prompt 只说明最终目标、边界和终态工具语义。
- `compress_core_memory(text)` 是压力专用工具。普通请求可以带它的 tool definition 和 `<CAPABILITIES>` 成本，但 `tool_choice.allowed_tools` 不允许它。工程只有在 count-based 压缩阈值或 token hard budget 压力触发时，才追加 body-only `core_memory_pressure` `<system_reminder>`，并通过代码侧 marker 把当前请求的 `tool_choice.allowed_tools` 临时限制为 `compress_core_memory`；不要依赖 prompt XML 属性检测。工具成功后，工程把工具 `text` 写入未来 `<小腻近况>` 并推进 read cutoff；不要再把主链 `<小腻近况>` 交给后台 `context_summary_writer` 客观摘要。

## Memory And Search Routing

- 当前上下文窗口、摘要、最近历史、图片观察和已有工具结果是第一信息源；这些足够时禁止为了“多想一点”补长期记忆。
- 主聊天 loop 不再暴露 pre-reply recall 工具。长期记忆后续应由 typed recall projection 在进入主 loop 前准备好，作为 runtime input / developer context 注入。
- 三层长期记忆的生成发生在 context compression：生产默认不跟随主聊天 `AI_MODEL_NAME`，当前 compact / reflection 默认都是 `gpt-5.5`，除非显式设置 `AGENT_COMPACT_MEMORY_MODEL` 或 `AGENT_COMPACT_MEMORY_REFLECTION_MODEL`。reflection 必须由至少两条 episodic observations 支撑。
- 三层 writer 都使用强制 function schema：`write_episodic_observations`、`write_semantic_assertions`、`write_memory_reflections`。允许空数组；不要用 prose JSON 或 prompt 里的强格式要求替代 schema。
- semantic assertions 必须保留 `scope`、`owners`、`directed_to`、`evidence_summary` 和 `xiaoni_relevance`。能识别说话人、回复对象或 @ 对象时，禁止把事实写成“群里/有人/大家”。
- reflections 必须从已经落库的 observations 抽象，优先写 `person_pattern`、`dyad_pattern`、`self_continuity`、`xiaoni_perception`；只有证据真的覆盖多人时才写 `group_norm`。`self_continuity_note` 说明这条记忆如何帮助小腻保持自己，不写“少说/换口吻/接梗/避免解答腔”这类行为指令。
- 群聊内部梗、别的小群/私聊里可能发生过的内容不能猜。当前上下文没有投影到相关记忆时，要少说、问群友来源，或沉默；公开事实、新鲜资料和互联网实体优先走 `web_search`。
- 当前小腻只有一条连续主 runtime stream，不存在第二套 presence/self-action runner。QQ 输入只以 `phone_notification` 感官事件形式进入 prompt，正文必须由模型主动通过 `$qq-usage` 打开 QQ 后才可见；没有 notify 时，`agent-service` 先组装未追加 self continuation 的候选 request，并检查真正要发给模型的最后一个 input item。只有尾项是 `assistant final_answer`，才在发起前追加 `self_continuation` developer reminder；尾项不是 `final_answer` 时不追加 reminder，照常用候选 request 发起本次模型 slice。它不是旧 `consciousness_tick` / `presence_tick`，也不生产 `self_continuation` queue trigger。成功 runtime slice 之间没有固定 sleep/poll interval，工具结果或 `final_answer` 后直接回主 `while` 顶部先 pick notify。连续性目标来自模型 response output items、tool result、状态与记忆被保存为 `agent_stack_items`，并由 `llm_request_slices` 记录每次真实请求。整个小腻主 loop 只有 `xiaoni:global` 一条 prompt-facing history / context summary / read-cutoff / prompt cache key；`qq:direct:*` / `qq:group:*` 只做真实会话 metadata、投递目标和 QQ app 未读游标，不形成任何 QQ 维度 prompt history/cache key。如果产生“想回头分享”的残留，只能写进 `xiaoni_os` 字段并渲染成 `<xiaoni_os>` 供后续上下文或压缩摘要延续；旧 `<小腻的OS>` 只兼容读取。只有真实 `web_search` trace 能使用“查到 / 刚看到”这类来源措辞；代码里禁止写固定兴趣、动机或读书 seed 来伪装自发。

## Local Request Captures

以下文件是本机抓包和对照讨论材料，被 `.gitignore` 忽略，不是上游 API 契约或仓库可交付 fixture：

- [codex-request-body-latest.json](../tmp/codex-request-body-latest.json)
- [codex-request-body-latest.pretty.json](../tmp/codex-request-body-latest.pretty.json)

## Official References

OpenAI / LLM 请求、提示词、agent 设计默认遵循以下官方资料：

- [Prompting | OpenAI API](https://developers.openai.com/api/docs/guides/prompting)
- [Prompt engineering | OpenAI API](https://developers.openai.com/api/docs/guides/prompt-engineering)
- [Prompt guidance | OpenAI API](https://developers.openai.com/api/docs/guides/prompt-guidance)
- [Using GPT-5.5 | OpenAI API](https://developers.openai.com/api/docs/guides/latest-model)
- [Models | OpenAI API](https://developers.openai.com/api/docs/models)
- [Using tools | OpenAI API](https://developers.openai.com/api/docs/guides/tools)
- [Function calling | OpenAI API](https://developers.openai.com/api/docs/guides/function-calling)
- [Reasoning models | OpenAI API](https://developers.openai.com/api/docs/guides/reasoning)
- [Reasoning best practices | OpenAI API](https://developers.openai.com/api/docs/guides/reasoning-best-practices)
- [Agent definitions | OpenAI API](https://developers.openai.com/api/docs/guides/agents/define-agents)
- [Running agents | OpenAI API](https://developers.openai.com/api/docs/guides/agents/running-agents)
- [Compaction | OpenAI API](https://developers.openai.com/api/docs/guides/compaction)
- [Better performance from reasoning models using the Responses API | OpenAI Cookbook](https://developers.openai.com/cookbook/examples/responses_api/reasoning_items)
