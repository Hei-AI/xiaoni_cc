# OpenAI Request Contract

本文件记录仓库内 OpenAI / LLM 请求、提示词、agent 设计的本地契约。
官方资料仍是上游真相源；本文件只写当前仓库必须遵守的高信号规则。

## GPT-5.5 Runtime Defaults

- 小腻主运行态使用 Responses API 形状，不回退到 Chat Completions 语义。
- `gpt-5.5` 默认按 reasoning model 处理；主 agent 迁移时显式发送 `reasoning.effort = "medium"`，不要只依赖模型默认值。
- `reasoning.summary` 默认使用 `auto`，用于可观测性；不要要求或解析原始 hidden reasoning。
- 对持续运行、工具密集、`store: false` 的 agent，请求必须包含 `include: ["reasoning.encrypted_content"]`，并在后续轮次把返回的 reasoning item 作为 opaque Responses item 回传。
- `text.verbosity` 必须作为模型参数处理；默认 `medium`，需要更短输出时用 `low`，不要把最终回答长度和 reasoning effort 混在同一条 prompt 里控制。
- Codex provider 是当前工作站支持 `gpt-5.5` 的目标传输层；不要把 `gpt-5.5 -> codex` 当作风险点本身。需要验证的是参数透传、replay、日志和上下文预算。

## State And Replay

- 当前仓库优先使用 stateless manual replay：本地保存并回传必要的 Responses output items，而不是默认依赖 `previous_response_id`。
- 手动 replay 时必须保留 assistant item 的 `phase`。中间状态用 `commentary`，最终输出用 `final_answer`。
- reasoning / compaction item 是 opaque continuation state，只能回传，不能把内部结构当业务数据解析。
- app 级 `<对话历史摘要>` 只是人类可读摘要，不等同于 OpenAI Responses compaction。

## Compaction

- 官方 compaction 有两种：`context_management: [{ type: "compaction", compact_threshold }]` 和 `/responses/compact`。
- 如果启用官方 compaction，返回的 compacted output 是下一轮 canonical context 的一部分；不能只抽文本，也不要丢弃 encrypted compaction item。
- 小腻现有 transcript summary 可以继续作为产品上下文，但必须和 official compaction 分层命名、分层测试。

## Tools And Prompts

- 工具使用规则优先写进 tool description：用途、何时调用、输入要求、副作用、可重试性、错误模式。
- system / developer prompt 只写跨工具通用政策、人格边界、输出契约和完成条件。
- GPT-5.5 prompt 迁移从最小 prompt baseline 开始；删除无必要的步骤化过程约束，保留真正影响 QQ 行为和安全边界的规则。
- 不要默认在 system prompt 加当前日期；只有业务时区、本地日期或政策生效日期需要时才显式加入。

## Xiaoni Prompt Contract

- 小腻主 prompt 的稳定部分只定义身份、人格边界、开口标准、沉默标准、能力边界、完成条件和少量风格样例。
- 当前消息、历史、摘要、长期学习、状态值、图片观察、搜索结果和工程提醒都属于 runtime input / developer context，不要回填进 system prompt。
- 对当前上下文里的直接反馈、纠偏、批评或称赞，要作为本轮行为校准信号处理；不要为同一批可见文本重新制造隐藏反馈事实。
- GPT-5.5 更适合 outcome-first 表达：写清“这一轮什么算成功”和“什么时候收口”，不要把自然社交判断拆成过长流程。
- 如果确实需要固定工具顺序，由 runtime 状态机和 `tool_choice.allowed_tools` 约束；prompt 只说明最终目标、边界和终态工具语义。

## Memory And Search Routing

- 当前上下文窗口、摘要、最近历史、图片观察和已有工具结果是第一信息源；这些足够时禁止为了“多想一点”补长期记忆。
- 主聊天 loop 不再暴露 pre-reply recall 工具。长期记忆后续应由 typed recall projection 在进入主 loop 前准备好，作为 runtime input / developer context 注入。
- 三层长期记忆的生成发生在 context compression：生产默认跟随 `AI_MODEL_NAME`，当前是 `gpt-5.4-mini`；memory reflections 也跟随同一生产默认，除非显式设置 `AGENT_COMPACT_MEMORY_REFLECTION_MODEL`。reflection 必须由至少两条 episodic observations 支撑。
- 三层 writer 都使用强制 function schema：`write_episodic_observations`、`write_semantic_assertions`、`write_memory_reflections`。允许空数组；不要用 prose JSON 或 prompt 里的强格式要求替代 schema。
- 群聊内部梗、别的小群/私聊里可能发生过的内容不能猜。当前上下文没有投影到相关记忆时，要少说、问群友来源，或沉默；公开事实、新鲜资料和互联网实体优先走 `web_search`。

## Official References

OpenAI / LLM 请求、提示词、agent 设计默认遵循以下官方资料：

- [Prompting | OpenAI API](https://developers.openai.com/api/docs/guides/prompting)
- [Prompt engineering | OpenAI API](https://developers.openai.com/api/docs/guides/prompt-engineering)
- [Prompt guidance | OpenAI API](https://developers.openai.com/api/docs/guides/prompt-guidance)
- [GPT-5.5 Model | OpenAI API](https://developers.openai.com/api/docs/models/gpt-5.5)
- [Reasoning models | OpenAI API](https://developers.openai.com/api/docs/guides/reasoning)
- [Reasoning best practices | OpenAI API](https://developers.openai.com/api/docs/guides/reasoning-best-practices)
- [Agent definitions | OpenAI API](https://developers.openai.com/api/docs/guides/agents/define-agents)
- [Running agents | OpenAI API](https://developers.openai.com/api/docs/guides/agents/running-agents)
- [Compaction | OpenAI API](https://developers.openai.com/api/docs/guides/compaction)
- [Better performance from reasoning models using the Responses API | OpenAI Cookbook](https://developers.openai.com/cookbook/examples/responses_api/reasoning_items)
