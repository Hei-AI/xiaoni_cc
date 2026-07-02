# 小腻 Prompt-Cache 契约（0 容忍·可执行）

本文件是 agent-service / provider-service 上**所有缓存行为**的单一真相源。改主 agent、fork、压缩、provider 翻译前先读这里。配套不可变回归用例见 CLAUDE.md「缓存用例不可变 + 失败禁止部署」。

---

## 0. 底层机制（Anthropic prompt caching，按官方语义）

- **前缀匹配 + 不可变条目**：缓存键 = 渲染请求到某个 `cache_control` 断点为止的**逐字节前缀**。前缀里改一个字节,**该断点及其后**全部失效;但**不会 evict / 改写**任何**别的**已写入条目(每条按自己字节 keyed、独立老化)。
- **读 = 最长前缀匹配**:一次请求命中「比它短、且是它前缀的、最近写过的那条」。所以一个请求**不需要在某点自带断点**就能命中那点的条目——只要那条存在、且在回看窗内。
- **20 块回看**:每个断点最多往回看 **20 个 content block** 找前序条目;相邻两个断点之间超过 20 块 → 勾不到 → 整条冷读。
- **TTL**:`ephemeral` 默认 5m;`ttl:'1h'` 扩展缓存。TTL 过期与容量 LRU 淘汰是两回事——**1h 只防过期、不防 LRU**。
- **并发写只在「同一前缀」上抢**:不同前缀各写各的,不互相阻塞。

---

## 1. 断点布局:**每个请求 = 头 1 个 + 尾部集合(最多 3 个,滑窗)**（主 agent 与每个 fork 都一样）

落点:`modules/provider-service/.../anthropic-translate.ts`(`buildMessages` 算出锚点,`placeCacheBreakpoints` 落 `cache_control`)。**全在 wire 翻译期落点,不碰 canonical `input`** → 对 replay/retry 逐字节不变量天然安全(那些用例比的是 canonical)。

- **头断点**:打在 **system 头(身份 + tools 那段永不变的前缀)**最后一块 → 一条**永久共享条目**,主、所有 fork、切换前后**都命中**。
- **尾部集合(最多 3 个,三个各有分工)**:
  - **tail(真·末块)**:请求**真正的最后一个 content block**(不是最后一个 durable 块)。→ 把**整条请求**(含尾部那条会冻结进历史的 `cache_volatile` 提示,`<system_reminder>`/`<xiaoni_plan>`/当前 trigger)也缓存下来,**下一跳整条读暖**。老的「最后一个 durable 块」尾把这条提示甩在断点**之后** → 本帧不缓存、下一帧再以 `cache_creation` 全价重写(**每个带提示的帧都双份冷读**;实测 turn12→13 gap=187 就是这条提示)。
  - **prevBoundary(上一帧尾)**:**最后一个 assistant message 之前**那一块 = 上一条请求的真·末块(非 durability-aware,逐字节等于上一跳的 `tail`)。滑窗:请求 N 打 `tail(N)`,请求 N+1 的 `prevBoundary(N+1)==tail(N)` → 两请求**共享正好这一个断点**,**下一跳确定性地带上一条写过的 `cache_control`**,更老的断点自动丢掉。
  - **lastDurable(最后一个 durable 块)**:`isDurableItem` 跳过 developer/system 与 `cache_volatile`。空闲/心跳老巢:历史以 assistant final 收尾、后面接非 durable 的 trigger/placeholder 时,这条把 `[..final]` 保暖,让**队列唤醒的 wake run(尾巴不同)也能读到 final 暖**。它同时是**漂移兜底**:万一尾部 `cache_volatile` 内容真在历史里变了字节,下一帧退回到这条 durable 条目,前缀不塌。
  - 稳态里三者会**塌并**:纯 `[tool_result]` 帧 tail==lastDurable → 只 2 个断点;带提示的帧才需要 3 个。
- **预算 4 个,严格优先级填充**(`placeCacheBreakpoints`,tight 时按此顺序丢):① system 头 → ② prevBoundary(确定性滑窗共享)→ ③ true-end tail(缓存冻结提示)→ ④ 压缩头 anchor(`[..H_X]` 连续性)→ ⑤ lastDurable(**最低**,只是空闲 final 保暖 + 漂移兜底)。所以**空闲帧**(无 anchor 竞争)照样给 lastDurable 留槽保住 final;**压缩期的带提示帧**(prevBoundary+tail+anchor 已占满)则丢 lastDurable、**保住 anchor**(lastDurable 在活跃帧本就低价值)。稳态无提示帧尾部塌到 2,四槽都够。
- **TTL = 1h**(`ANTHROPIC_CACHE_TTL` 可回退 5m);每个断点同 TTL,无排序约束。
- **`cache_volatile`**:仍是内部标记、**绝不上 wire**。但它**不再等于「绝不打断点」**——真·末块即便是 `cache_volatile` 也会被 `tail` 打上(因为它下一帧就冻结进历史);真正防漂移靠的是**始终存在的 `lastDurable` 兜底断点**,不是「不给 volatile 打断点」。**前提**:尾部内容一旦进历史必须逐字节冻结(已对活体 slice 验证;`[当前时间]` 这类会在历史里漂移的戳早已移除)。**若将来重新引入会漂移的尾部内容,它必须排在 `lastDurable` 之后、且明知 `tail` 那次写入会被浪费**。

---

## 2. fork = 主 agent 血缘线在「自己 fork 点 `P_n`」的冻结克隆

- 每个 fork 在 spawn 时**冻结**主 agent 当时的请求(= `P_n`),整段 4-5 turn **只克隆这同一份冻结 base**,**从不回读主 live**(实证:压缩 fork `agent-loop-service.ts` runCoreMemoryCompressionFork、潜意识 fork runSubconsciousAgentFork、看图 fork runImageVisionForkToFile 均循环克隆 `params.baseRequest`)。
- **fork 走同一条 wire 翻译 → 同一套滑窗**,所以三种切换都满足「下一跳带上一条的 cache_control」:
  - **主 → 派生 fork(fork 点)**:fork 克隆主请求后追加合成尾(inspect/图片/reminder)。fork 的 `prevBoundary` = 「fork 合成 assistant 之前那一块」= **主派生它那一刻的真·末块**(逐位相同)→ fork 直接带着主写过的尾断点,命中主的 `P_n` 条目;fork 的 `lastDurable` 落在主历史 final 上,再兜一层。
  - **fork 内部 → 下一条 fork 内部**:fork 每轮追加 durable exec 结果,滑窗把**上一轮 fork 的真·末块(那条 reminder)**当作本轮 `prevBoundary` → fork 自身链逐轮共享那条 reminder(合成图片块**永不**被打断点)。
  - **主 → 下一跳主**:同 §1 滑窗。
- 兜底:fork 尾断点回看 ≤20 块也能勾到 `P_n`;滑窗是把它变**确定性**(不依赖回看窗口)。
- 6 个 fork 在不同点 = 老血缘线上 **6 条独立 keyed、各自命中**的条目;互不干涉。

---

## 3. 两条硬结构约束（违反 = 确定性击穿）

1. **单帧新增 < 20 个 content block**:相邻两个尾断点跨度 >20 → 回看勾不到 → 整条冷读。fork ≤5 块 ✓;**主 agent 一帧里 >~10 对并行 `tool_use`/`tool_result`(>20 块)时,必须用留出的额度在中间补一个桥接断点**。
2. **头必须逐字节稳定**:system + tools 在整个 session(含切换前后、含所有 fork)字节不变;volatile 内容一律 `cache_volatile` 或排在尾断点后。

外加运行时不变量(已有用例守):**进了 live 请求的内容必须能被 stack replay 逐字节重建**(run 边界),否则 replay 变短击穿。

---

## 4. REQ2 STW — 压缩切换

落点:`agent-loop-service.ts` `applyPendingCompressionMidRunIfSilent`(主 loop turn 循环顶,turn 间静默点)。

- **何时切**:① 有 pending 压缩(`pendingCompressionAppliedCutoffBySession`)且 live session cutoff 已推进过本 run 启动 cutoff;② **只等「产出本次 cutoff 的压缩 fork」跑完**(`coreMemoryCompressionForks` 该 key 空)。**不等潜意识/图像/心跳 fork。**
- **为什么不等其它 fork**:它们是冻结在各自 `P_n` 的克隆,`P_n` 与切换写出的 `P_new` 是**互不波及的独立不可变条目**,切换既不 evict 也不改写 `P_n` → 在飞 fork 继续命中各自 `P_n`,**不穿透**。反之「等所有 fork」会在忙时(多 fork 错时)**确定性饿死**切换。
- **切换动作(原子)**:用新 cutoff 重建 `requestInput` = 逐出 ≤cutoff 旧会话 + 换新近况 + **保留本 run 的 loopContinuation** + 复用本 run 那份 `cache_volatile` 当前 trigger;清 latch 使**只切一次**。
- **只冷一次,且不全冷**:切换帧的尾前缀 `P_new` 没有前序尾条目可匹配,但**仍命中头条目** → 只冷读 `[新history][新近况][loopContinuation]`,**system+tools 不冷**。之后所有主 turn 延伸 `P_new`(暖)、之后 spawn 的新 fork 克隆 `P_new`(暖)。
- **顺序**:切换帧必须**先于**「之后 spawn 的新 fork」冷写出 `P_new`(loop 里 fork 在主 turn 后才 spawn,天然满足),否则切换帧与新 fork 抢冷写 `P_new` = 两次冷读。

---

## 5. 不可变回归用例（任一失败禁止部署 agent-service）

- `modules/agent-service/src/__tests__/cache-replay-consistency.test.ts`
- `modules/agent-service/src/__tests__/fork-cache-alignment.test.ts`
- `packages/persistence/__tests__/agent-stack-event-id-dedup{,.realdb}.test.js`

每条都验过「改坏即红」。这些用例只能新增、不能为了通过而弱化断言(行为变更需 user 显式批准)。
