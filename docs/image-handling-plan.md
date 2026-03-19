# QQ 图片/表情 Base64 处理方案

## 目标
- 不依赖 Napcat 的本地缓存目录。
- 每条图片/表情消息都能提取到 base64，并带入上下文/LLM 请求和历史记录。

## 处理链路
1. **入口获取 (`websocket-client.ts`)**
   - 顺序尝试：
     1. `segment.data.base64`
     2. `segment.data.url`
     3. raw payload 中 `picElement.originImageUrl / origin_image_url`
     4. （备选）`picElement.sourcePath` 等本地路径
   - 当无 base64 且 URL 可用时，立即使用 `axios.get` 下载，转换为 base64。
   - 下载成功后，直接把 `{ type: 'image', mimeType, base64, source }` 推入 `local_attachments`，不再写磁盘文件。

2. **存储 (`recordIncomingMessageHistory`)**
   - 在将消息写入 `group_message_history` / `private_message_history` 前，确保 `attachLocalMediaMetadata` 已填充 `local_attachments`。
   - 修复 `INSERT` 语句显式列名，避免 “Column count doesn't match value count” 导致图片消息落库失败。
   - `raw_payload` JSON 会包含 `local_attachments`，作为历史上下文的基准。

3. **上下文 (`context-manager.ts`)**
   - `collectImageAttachmentsFromLocalSources` 读取 `local_attachments`，为每张图片生成 `inline_data`。
   - `formatContextForAI` 自动将这些 base64 注入 `parts`，LLM 请求即可携带图片；历史消息同理，从 `raw_payload` 还原。

## 验证步骤
1. 在实际群聊发送图片/表情，观察 `logs/qqbot-core/websocket_*.log`：应有“Downloaded image from origin url”等日志，且不再出现 `Failed to read local image source`。
2. 查询最新 `group_message_history` 记录，确认 `raw_payload` 中包含 `local_attachments`。
3. 运行 `scripts/dump-context.ts` 或检查 AI 请求日志，验证 prompt `parts` 中存在 `inline_data`。

## 注意事项
- 如果 `originImageUrl` 访问受限，可在下载逻辑中注入 Napcat 所需 Cookie/Token。
- 保留本地路径读取作为最后兜底，方便未来在无公网环境运行。
- 若 base64 体积过大，可在写入前做大小限制或压缩，但需保证上下文仍能取到完整图片。
