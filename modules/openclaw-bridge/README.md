# OpenClaw Bridge (OneBot11 -> OpenClaw)

把 OneBot11 收到的 QQ 消息转发给 OpenClaw Gateway，并将回复再发回 QQ。

## 功能

- 支持私聊、群聊
- 群聊可配置：仅 @bot 时触发
- 支持白名单（群/用户）
- 支持固定会话键（按 `qq:<type>:<id>`）保证上下文连续
- OpenClaw 支持两种接口：
  - `v1/responses`（默认，推荐）
  - `v1/chat/completions`

## 目录

- `src/index.js`：桥接服务
- `.env.example`：配置模板

## 快速开始

```bash
cd modules/openclaw-bridge
cp .env.example .env
npm install
npm run start
```

默认监听：`http://127.0.0.1:8090`

## OneBot 回调配置

把 OneBot 上报地址改成：

- `POST http://<bridge-host>:8090/onebot/event`

## 必填配置

- `ONEBOT_API_BASE_URL`：OneBot API 地址（用于 send_private_msg / send_group_msg）
- `OPENCLAW_TOKEN`：OpenClaw Gateway 认证 token/password
- `OPENCLAW_BASE_URL`：OpenClaw Gateway 地址

## OpenClaw 侧要求

需启用至少一个接口：

- `gateway.http.endpoints.responses.enabled=true`（推荐）
- 或 `gateway.http.endpoints.chatCompletions.enabled=true`

## 常用策略

- 群里仅 @bot 才触发：`GROUP_REQUIRE_AT=true`
- 群里也允许前缀触发：`GROUP_TRIGGER_PREFIX=/oc`
- 限制用户/群白名单：`USER_WHITELIST` / `GROUP_WHITELIST`

## 健康检查

```bash
curl http://127.0.0.1:8090/health
```

返回：

```json
{"ok":true,"service":"openclaw-bridge"}
```
