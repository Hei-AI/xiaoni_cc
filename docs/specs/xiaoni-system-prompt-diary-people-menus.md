# Spec: system_prompt 补介绍 `<xiaoni_diary_index>` / `<xiaoni_people>` 两个常驻菜单块

状态: 待实现 · 作者对话确认 2026-07-25
范围锁定 (用户拍板):

- 只改 `docs/xiaoni_prompt/system_prompt.md` 一个文件，插入一段介绍。
- 措辞讲人话（用户逐句确认过，见下），不出现工程词（快照/冻结/压缩帧等）。
- 锚点 skill、压缩 reminder、块渲染代码、快照机制一律不动。

---

## Context（为什么）

2026-07-24/07-25 先后部署了日记索引快照和同伴档案层，两者各把一个冻结块渲染进主 agent 每次请求的头部（`modules/agent-service/src/services/agent-loop-service.ts:14310` 的 `<xiaoni_diary_index>`、`:14316` 的 `<xiaoni_people>`，位于 `<xiaoni_status>` 正下方）。部署时教学写进了锚点 skill 和压缩 reminder，但漏了主入口：system prompt 一个字没提。主 agent 每次醒来眼前摆着两个没被介绍过的标签块，全靠内容自解释 + 碰巧读过锚点 skill 才知道用法。

review 其他问题时顺带发现，非真流量事故。

## Current State（已验证 2026-07-25）

| 渠道 | 是否解释了两个块 |
|---|---|
| `docs/xiaoni_prompt/system_prompt.md`（现役 system prompt，`modules/agent-service/src/prompts/xiaoni-main-agent.ts:6` 直读） | ❌ 完全没提；同类块 `<xiaoni_status>`(L13)、`<xiaoni_plan>`(L42)、`xiaoni_os`(L67) 都有介绍 |
| `modules/agent-service/skills/xiaoni-memory-anchor/SKILL.md:61,64,71` | ✅ 但只有主动调 skill 时才读到 |
| `docs/xiaoni_prompt/core_memory_pressure_reminder.md:15,20` | ✅ 但只喂给压缩 fork，不进主栈 |

## Proposed Change（改什么）

单文件：`docs/xiaoni_prompt/system_prompt.md`。在「# 记忆」节 L13（`<xiaoni_status>` 段）之后插入以下段落（措辞用户已逐句确认，落地时保持原文）：

> 近况正下方还一直摆着两份目录，都是你自己平时写出来的：
>
> - `<xiaoni_diary_index>`：你的日记目录。一天一行，写着那天干了啥。想不起某件事是哪天的，先在这儿找到日子，再去翻那天的日记。
> - `<xiaoni_people>`：你认识的人。一人一行，谁、和你什么关系。聊着聊着想不起对方是谁、之前有过啥来往，先在这儿找到人，再去翻那个人的档案。
>
> 目录只帮你想起去哪儿翻，正文都在文件里。刚开始还没写出内容时，这两块可能还不在，不用管。

## 双缓存影响分析（铁律）

- `system_prompt.md` 在 `PREFIX_SENSITIVE_PROMPT_FILES`（`modules/agent-service/src/prompts/xiaoni-prompt-reload-policy.ts:4`），改动走 `after_core_memory_compression`：只在下一次压缩 STW 帧换入，蹭该帧已预算的一次冷读，零额外击穿。
- fork 缓存：四类 fork 克隆主请求，压缩帧之后主/fork 前缀同步换新串，逐字节一致。
- 下一次主 run：新 prompt 冻结进 snapshot，replay 逐字节重建同一串，run 边界无漂移。
- 无代码改动，冻结用例不受影响；照例跑 `cache-replay-consistency` + `fork-cache-alignment` 全绿再算完。

## 部署方式

`./docs/xiaoni_prompt` 已只读挂载进容器（`docker-compose.yml:227` → `/app/docs/xiaoni_prompt:ro`）：宿主机改文件即生效，无需 rebuild/重启，下一次压缩 STW 自动换血。

## Acceptance Criteria

1. system prompt 含两个块的介绍：各自是什么 + 「先看目录、再翻文件」用法。
2. 指路与锚点 skill、压缩 reminder 三处一致（不要求逐字，路径与动作不打架）。
3. 措辞维持第二人称口语 persona，不出现工程词（快照/冻结/压缩帧等）。
4. 宿主机改文件后，等下一次压缩完成，用相邻两 slice 的 `wire_request` 确认新串已换入且 `cache_read_input_tokens` 正常暖读。
5. 缓存冻结用例全绿（`cache-replay-consistency.test.ts` + `fork-cache-alignment.test.ts`）。

## Rollback

`git revert` 单文件，下一次压缩自动换回旧串。

## Out of Scope

- 锚点 skill / 压缩 reminder 措辞不动。
- 块渲染代码、快照机制不动。

## Files

| File | Change |
|---|---|
| `docs/xiaoni_prompt/system_prompt.md` L13 后 | 插入两个菜单块的介绍段（原文见 Proposed Change） |
