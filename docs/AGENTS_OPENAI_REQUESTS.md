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

- 当前仓库优先使用 stateless manual replay：本地保存并回传必要的 Responses output items，而不是默认依赖 `previous_response_id`。
- 手动 replay 时必须保留 assistant item 的 `phase`。中间状态用 `commentary`，最终输出用 `final_answer`。
- reasoning / compaction item 是 opaque continuation state，只能回传，不能把内部结构当业务数据解析。
- app 级 `<小腻近况>` 是压缩后置顶的纯文本近况时报；它从压缩前整段 in-context 生成，包括上一轮 `<小腻近况>`，不等同于 OpenAI Responses compaction。当前实现仍把它写入 `agent_session_context_windows.context_summary`，不是 `agent_life_events` 的 identity-root projection。

## Compaction

- 官方 compaction 有两种：`context_management: [{ type: "compaction", compact_threshold }]` 和 `/responses/compact`。
- 如果启用官方 compaction，返回的 compacted output 是下一轮 canonical context 的一部分；不能只抽文本，也不要丢弃 encrypted compaction item。
- 小腻现有 `<小腻近况>` 可以继续作为产品上下文，但必须和 official compaction 分层命名、分层测试。

## Tools And Prompts

- 工具使用规则优先写进 tool description：用途、何时调用、输入要求、副作用、可重试性、错误模式。
- system / developer prompt 只写跨工具通用政策、人格边界、输出契约和完成条件。
- prompt 迁移从最小 prompt baseline 开始；删除无必要的步骤化过程约束，保留真正影响 QQ 行为和安全边界的规则。
- 不要默认在 system prompt 加当前日期；只有业务时区、本地日期或政策生效日期需要时才显式加入。

## Xiaoni Prompt Contract

- 小腻主 prompt 的稳定部分只定义身份、人格边界、开口标准、沉默标准、能力边界、完成条件和少量风格样例。
- 当前消息、历史、摘要、长期学习、状态值、图片观察、搜索结果和工程提醒都属于 runtime input / developer context，不要回填进 system prompt。
- 对当前上下文里的直接反馈、纠偏、批评或称赞，要作为本轮行为校准信号处理；不要为同一批可见文本重新制造隐藏反馈事实。
- 主 agent 要把“这轮有没有具体可说点”和“下一步生活动作”作为结构化中间态，而不是用 `has_own_thought` 这类不可检查布尔值。当前主契约是在 `submit_life_action` 中输出 `action_type / reason / evidence_refs / confidence`，并在 `participation_judgment` 中输出 `status / basis / sayable_point / evidence_refs / memory_refs`。
- `participation_judgment.status=no_sayable_point` 时，工程层必须把最终动作压成 `stay_silent`，即使模型同时给了 `action_type=speak`。直接请求能力或事实时走 `direct_request`，并且仍需当前消息明确把小腻拉入现场。
- 小腻是群友，不是客服。runtime reminder 可以提醒她“不是为了证明在线、维护气氛或延续话题而开口”，但最终能否说话要由结构化工具输出和工程门禁共同决定。
- 如果确实需要固定工具顺序，由 runtime 状态机和 `tool_choice.allowed_tools` 约束；prompt 只说明最终目标、边界和终态工具语义。

## Memory And Search Routing

- 当前上下文窗口、摘要、最近历史、图片观察和已有工具结果是第一信息源；这些足够时禁止为了“多想一点”补长期记忆。
- 主聊天 loop 不再暴露 pre-reply recall 工具。长期记忆后续应由 typed recall projection 在进入主 loop 前准备好，作为 runtime input / developer context 注入。
- 三层长期记忆的生成发生在 context compression：生产默认不跟随主聊天 `AI_MODEL_NAME`，当前 compact / reflection 默认都是 `gpt-5.5`，除非显式设置 `AGENT_COMPACT_MEMORY_MODEL` 或 `AGENT_COMPACT_MEMORY_REFLECTION_MODEL`。reflection 必须由至少两条 episodic observations 支撑。
- 三层 writer 都使用强制 function schema：`write_episodic_observations`、`write_semantic_assertions`、`write_memory_reflections`。允许空数组；不要用 prose JSON 或 prompt 里的强格式要求替代 schema。
- semantic assertions 必须保留 `scope`、`owners`、`directed_to`、`evidence_summary` 和 `xiaoni_relevance`。能识别说话人、回复对象或 @ 对象时，禁止把事实写成“群里/有人/大家”。
- reflections 必须从已经落库的 observations 抽象，优先写 `person_pattern`、`dyad_pattern`、`self_continuity`、`xiaoni_perception`；只有证据真的覆盖多人时才写 `group_norm`。`self_continuity_note` 说明这条记忆如何帮助小腻保持自己，不写“少说/换口吻/接梗/避免解答腔”这类行为指令。
- 群聊内部梗、别的小群/私聊里可能发生过的内容不能猜。当前上下文没有投影到相关记忆时，要少说、问群友来源，或沉默；公开事实、新鲜资料和互联网实体优先走 `web_search`。
- 当前空闲生活事件不是第二套 agent，也不能直接发 QQ。它以 `presence_tick` append 到同一事件流；presence 起源的场景读取全局 conversation append stream，并使用 `xiaoni:global` 作为 context summary / read-cutoff 兼容 key。即使因为存在游标后的未读 IM 而 materialize 成 `proactive_im_open`，上下文也不能退回单个群/私聊的局部历史；没有具体 IM 目标时可以选择内部 `submit_life_action`、hosted `web_search` 或 `stay_silent`。如果产生“想回头分享”的残留，只能写进 `xiaoni_os` / `<小腻的OS>` 供后续上下文或压缩摘要延续。只有真实 `web_search` trace 能使用“查到 / 刚看到”这类来源措辞；代码里禁止写固定兴趣、动机或读书 seed 来伪装自发。

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
