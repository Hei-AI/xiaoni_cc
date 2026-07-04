# Xiaoni Files API 图片外置（治 32MB wire 上限）

状态：worktree `feat/files-api-image-upload` 实现中。研究已用真号实测通过（见 §1）。

## 0. 目标

图片当前以 base64 内联进 canonical stack，是 32MB 单请求上限（`request_too_large`）的主要燃料——见
`docs/investigations/` 与记忆 payload_413。改为：**在图片首次落库前上传到 Anthropic Files API，
wire 里用 `{type:'image',source:{type:'file',file_id}}` 引用（≈60 字节）替代几 MB 的 base64；
Files API 降级则回退 base64。**

## 1. 可达性实测（2026-07-04，真订阅 token，走 provider 一致的 cloak 头）

账号 subType=max / tier=default_claude_max_5x。beta 头带 `files-api-2025-04-14`（cloak 不挡）。

| 调用 | 结果 |
|---|---|
| `GET /v1/files` | 200 `{"data":[],"has_more":false}` |
| `POST /v1/files`（multipart 上传 96×96 PNG） | 200，返回 `file_id`、`size_bytes`、`downloadable` |
| `POST /v1/messages?beta=true`，image source=`{type:'file',file_id}` | 200，模型正常看图 |
| `DELETE /v1/files/{id}` | 200 |

**关键：file_id 与 base64 的 `input_tokens` 相同（都 48）。** 只省 **wire 字节**，不省 token /
不减上下文压力 / 不动 `keepBlocks=30` 滑窗。1×1 PNG 会被判 400 "Could not process image"（图太小被
视觉管线拒，非 file_id 路径问题）。

## 2. 双缓存铁律约束（核心）

图存 canonical（`agent_stack_items` 的 `input_image.image_url` = `data:` URI），wire 每次从
canonical 重建（`anthropic-translate.ts` `parseImageSource`，**纯函数不发网络**）。file_id 必须：

1. **在 canonical 里** —— fork clone 主请求 requestInput，四个 fork 才带同一个 file_id → 前缀逐字节一致。
2. **持久化** —— 下一 run 靠 stack replay 逐字节重建历史；file_id 不能每请求现上传（现上传 = 每次新
   id = run 边界前缀击穿）。
3. **老图不回改** —— 已作 base64 进过上下文的图绝不回头改 file_id（违反历史不可变铁律，会一次性打穿
   那个 block 之后的整段前缀）。

由此：**在 ingest 落库那刻决定表示形式并冻结**。新图天生带 file_id，老图永远 base64。这与已有的
at-ingest webp 转码（`transcodeInputImageItemsToWebpLossless`）是**同一模式同一位置**——那段注释已
写明「transcode BEFORE the image enters the stack … replay reads back the exact bytes → zero
cache drift」，Files API 上传紧接其后。

## 3. 双存 base64 + file_id

canonical 的 `input_image` item 同时保留：
- `image_url`（webp base64，**真源**：归档 / 回看 / trace / inspect_image fork 都读它，对齐 webp 那次
  「只改 data_url 不动归档」）
- `file_id`（**仅 wire 优化**）

wire 构建优先 emit file_id；`file_id` 缺失或（未来）失效则回退 base64。Files 无文档 TTL（persist
until deleted）但有 100GB org 上限：live 上下文里的 file 若被删 → replay 引用死 file_id 会 400，双存的
base64 兜底可回退（代价 = 那次一次性前缀 bust，同 413 的 trace_only 兜底思路）。

## 4. 三层改动

1. **provider-service** —— 新增内部端点 `POST /api/internal/media/upload-anthropic-file`
   `{ data_url }` → `{ file_id }`（或 `{ file_id: null }` 降级）。复用 anthropic OAuth + cloak 头，
   multipart 上传。按 **内容 hash（sha256）去重**，映射持久化，避免同截图重复上传。
   `DEFAULT_ANTHROPIC_BETA` 追加 `files-api-2025-04-14`（上传 + 引用都要）。
2. **agent-service** —— `externalizeInputImageItemsToFileId(items)`：对超过尺寸阈值的 `input_image`
   调上传端点，把 `file_id` 盖回 item（保留 `image_url`）。与 webp 转码串成一个 ingest helper，在
   `executeComputerAction`（screenshot，line ~11240）等 ingest 点调用。降级 → 不盖 file_id，保持
   base64（一次性决策，持久化进 stack；**绝非**运行时 try-file_id-400-retry-base64）。
   小尺寸固化头像（`buildXiaoniHeadAvatarInputItem`）不外置——它本就 byte-stable 在暖前缀里。
3. **anthropic-translate** —— `partsToBlocks` / `parseImageSource`：input_image part 带 `file_id`
   时 emit `{type:'image',source:{type:'file',file_id}}`，否则走 base64。纯函数，单测覆盖。

## 5. 部署门禁

改主 agent，受「缓存用例不可变 + 失败禁止部署」契约。**必须全绿**：
- `cache-replay-consistency.test.ts`、`fork-cache-alignment.test.ts`、`event-id-dedup{,.realdb}`
- 新增 file_id 版本的 fork/replay 逐字节一致断言

部署后须用相邻两 slice 的 `wire_request` 实测 `cache_read_input_tokens` 未塌，并核 wire 字节回落。
commit/PR 写明双缓存影响分析。
