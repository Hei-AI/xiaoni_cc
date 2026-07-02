# 小腻 QQ Profile Ops 调研（头像 / 个性签名 / 在线状态）

> 目标：给小腻补齐 qq-usage 里的「资料面」能力——查看/更换头像（含别人）、改个性签名、改在线状态。
> 本文只做调研 + 真机验证，**不改任何生产代码**。验证方式：直接打 NapCat HTTP API（真机 `napcat` 容器，v4.8.113，账号 `1129974489` 小腻）。
> 验证日期：2026-07-02。所有 curl 结果见文末附录，可复现。

## TL;DR（能不能跑通）

| 能力 | 结论 | 走哪条路 | 真机验证 |
|---|---|---|---|
| 查看自己头像 | ✅ 可行 | qlogo URL（无需 API） | ✅ `200 image/png` 554KB |
| 查看别人头像 | ✅ 可行 | qlogo URL（任意 QQ 号） | ✅ `200 image/png` |
| **更换自己头像** | ✅ **已跑通** | NapCat `set_qq_avatar`（`file`=路径/URL/base64） | ✅ set 测试图`retcode 0`→用备份原图还原`retcode 0` |
| **更换别人头像** | ❌ **不可能** | QQ 协议无此能力，NapCat 也没有对应 action | — |
| 查看自己/别人个性签名 | ✅ 可行 | `get_stranger_info` → `long_nick` | ✅ 返回字段 |
| **更改自己个性签名** | ✅ **已跑通** | NapCat `set_self_longnick`（`longNick`） | ✅ `retcode 0 {"result":0}`（对空值做了无副作用 set） |
| 查看自己/别人在线状态 | ✅ 可行 | `get_stranger_info`（`status`/`ext_status`/`custom_status`）或 `nc_get_user_status` | ✅ 返回字段 |
| **更改自己在线状态** | ✅ **已跑通** | NapCat `set_online_status`（`status`+`ext_status`+`battery_status`） | ✅ set 忙碌(50)→readback 50→还原 在线(10) |

一句话：**除了「换别人头像」在协议层就不可能，其余五项全部真机跑通**（改签名、换自己头像、改在线状态都做了 set→验证/还原的落地写入验证；查看类走 URL / `get_stranger_info`）。

---

## 一、真机链路与鉴权

NapCat 独立部署（`docker-compose.napcat.yml`），HTTP API 在宿主 `127.0.0.1:3000`，容器内 `http://napcat:3000`。鉴权是 `Authorization: Bearer <NAPCAT_HTTP_ACCESS_TOKEN>`。

现有出站已收口在 `modules/provider-service/src/services/napcat-client.ts`：
- `NapcatClient.callAction(action, params)` → `POST /${action}`，自动带 Bearer，`retcode!==0 || status==='failed'` 抛错。
- 配置在 `modules/provider-service/src/config.ts:50` `napcatConfig`。

所有资料面 action 都能复用这个 `callAction`，**不需要新客户端**，只加方法。

### NapCat 响应约定（本次实测）

- 未知 action：`{"status":"failed","retcode":200,"message":"不支持的Api <name>"}`——用它可无副作用探测 action 是否存在。
- 参数不合法（action 存在）：`{"status":"failed","retcode":400,"message":"... must have required property 'xxx'"}`。
- 成功：`{"status":"ok","retcode":0,"data":{...}}`。

---

## 二、逐能力契约

### 2.1 头像 —— 查看（自己 + 别人）

QQ 头像是公开资源，**不用 API**，按 QQ 号拼 URL 即可（小腻可以直接把 URL 当图发，或让 provider 下载）：

```
https://q1.qlogo.cn/g?b=qq&nk=<QQ号>&s=640          # s=100/140/640，640 最大
https://q.qlogo.cn/headimg_dl?dst_uin=<QQ号>&spec=640
```

实测：自己 640px 返回 `200 image/png` 554080 bytes；`10000` 100px 返回 `200 image/png` 2642 bytes。两个域名都通。

> 群头像：`https://p.qlogo.cn/gh/<群号>/<群号>/640/`（本次未验，QQ 群头像通用 URL，可后续补验）。

### 2.2 头像 —— 更换自己

NapCat action：**`set_qq_avatar`**，参数 `file`（本地路径 / http(s) URL / `base64://...`，与发图 `file` 语义一致）。

实测 `{"file":""}` 返回 `EISDIR ... copyfile '.' -> '.../temp/...'`——说明 action 存在、进入了 handler。

**已端到端跑通**（2026-07-02）：先把小腻当前 640px 头像备份到 `/tmp/xiaoni_orig_avatar.png`（PNG 554080 bytes），`docker cp` 进 napcat 容器；`set_qq_avatar {file:"/tmp/test_avatar.png"}` → `retcode 0`（换成测试图）；`set_qq_avatar {file:"/tmp/xiaoni_orig_avatar.png"}` → `retcode 0`（用备份原图字节还原）。`file` 传**容器内可读路径**最稳。
注：qlogo CDN 有缓存，改完后 URL 不一定立刻刷新，验证以 `retcode 0` 为准；还原用的是备份的原始字节，视觉等同原图。

落地时 `file` 建议走已有的 image materialize 通道（和 `qq-send-image` 一样先落到 `/xiaoni-runtime/picture` 再传路径），避免 base64 撑大请求。

### 2.3 头像 —— 更换别人 ❌

**协议层不可能。** QQ 不允许任何客户端修改他人头像，NapCat 也没有任何对应 action。这一项从需求里划掉，改成「查看别人头像」即可满足「包括别人」的合理部分。

### 2.4 个性签名 —— 查看

`get_stranger_info { user_id }` 返回里带 `long_nick`（=`longNick`，个性签名）。任意 QQ 号可查（实测自己空串、`10000` 空串）。

### 2.5 个性签名 —— 更改自己 ✅ 已跑通

NapCat action：**`set_self_longnick`**，参数 `longNick`（字符串）。

实测 `{"longNick":""}` → `{"status":"ok","retcode":0,"data":{"result":0,"errMsg":""}}`。因为小腻当前签名本就为空，这次是无副作用的 no-op set，**已证明动作端到端可写且返回成功**。
（相近别名 `set_longnick` / `_set_self_longnick` 都返回「不支持的Api」，**只有 `set_self_longnick` 是对的**。）

### 2.6 在线状态 —— 查看

- `get_stranger_info { user_id }` → `status` / `ext_status` / `custom_status`（含自定义状态文案/emoji）。
- `nc_get_user_status { user_id }` → 精简版 `{ status, ext_status }`（实测小腻返回 `{status:0,ext_status:0}`）。

### 2.7 在线状态 —— 更改自己

NapCat action：**`set_online_status`**，schema 要求 `status`（number），另有 `ext_status`、`battery_status`。

**已端到端跑通**（2026-07-02）：`set_online_status {status:50,ext_status:0,battery_status:100}`（忙碌）→ `retcode 0`；`nc_get_user_status` readback = `{status:50}` 确认生效；`set_online_status {status:10,...}` 还原成 在线 → `nc_get_user_status`=`{status:10}`、`get_status`=`{online:true}`。

主状态码（go-cqhttp / NapCat 通用枚举）：

| status | 含义 |
|---|---|
| 10 | 在线 |
| 30 | 离开 |
| 40 | 隐身 |
| 50 | 忙碌 |
| 60 | Q 我吧 |
| 70 | 请勿打扰 |

「自定义/DIY 状态」（如 学习中 / 摸鱼中 / 我崩溃了）用 `status:10` + `ext_status:<扩展码>`（+ 可选 `battery_status` 0-100）。扩展码是一张大表（QQ 版本相关），落地前建议在小腻真号上实测 1-2 个确认映射。

> 注意：`get_stranger_info` 读回来的 `status:20` 是 QQNT 内部态编码，和 `set_online_status` 的入参枚举（10/30/40…）不是同一套，**写入用枚举、读取用内部码**，接线时不要混用。

### 2.8 附带能力：`set_qq_profile`

存在（`{}` → `400 required property 'nickname'`）。参数以 `nickname` 为主（还有 personal_note / sex 等）。可用于改昵称/备注，但本次需求不含改昵称，先记录不接。

---

## 三、接入 qq-usage 的建议（不在本 PR 实现，仅设计）

现有 qq-usage 是 **CLI skill**，链路（已核对）：

```
qq_usage.py  --(exec_command)-->  POST agent-service :8092 /api/internal/qq-usage
   agent-service index.ts:141  -->  qq-usage-service.ts（当前只读写 PostgreSQL）
```

NapCat 类动作要多下一跳到 provider-service（NapCat 只在 provider 侧可达）。**现成模板 = `qq-send-image`**：

```
qq_usage.py 新子命令
  -> agent-service /api/internal/qq-usage（新 action 分支）
  -> provider-service /api/internal/<profile-op>（新端点，参考 /api/internal/send_group_image）
  -> NapcatClient 新方法（setQqAvatar / setSelfLongnick / setOnlineStatus / getStrangerProfile）
```

关键约束（务必遵守 CLAUDE.md 铁律）：
- **零 prompt/tool-schema 缓存影响**：qq-usage 是 CLI skill，新增子命令不动 tools 定义、不动 system prompt，天然零缓存击穿（与 memory 里「qq_usage=CLI skill so zero tool-schema/prompt cache impact」一致）。这是选它做载体的核心理由。
- **持久化收口**：若要把改动落库审计，写查询必须进 `packages/persistence`，不在路由里裸写 SQL。
- **provider 出站收口**：新 NapCat 方法全部加在 `napcat-client.ts` 的 `NapcatClient`，复用 `callAction`。

### 建议的 CLI 子命令面（草案）

```bash
qq_usage.py view_avatar <qq> [size]        # 拼 qlogo URL 返回（自己/别人）
qq_usage.py set_avatar <file>              # set_qq_avatar，file 走 materialize 通道
qq_usage.py view_profile <qq>              # get_stranger_info：昵称/签名/在线态一把梭
qq_usage.py set_signature "<文本>"          # set_self_longnick
qq_usage.py set_status <online|away|invisible|busy|qme|dnd> [ext_status]  # set_online_status，名字映射到枚举
```

`set_avatar` / `set_status` 涉及对外可见的真号改动，建议在 SKILL.md 里明确「这是对小腻本人 QQ 资料的真实修改，会被所有人看到」的语义，并给小腻清晰的能力边界（不能改别人头像/签名/状态）。

---

## 四、验证边界（诚实说明）

- **已端到端跑通（含落地写入 + 还原）**：改签名（`set_self_longnick`）、换自己头像（`set_qq_avatar`，备份原图→换测试图→还原原图，均 retcode 0）、改在线状态（`set_online_status`，set 50→readback 50→还原 10）、查看头像 URL（真机 200）、查看自己/别人资料（`get_stranger_info` 真机返回）。全部 set 类都做了 set→验证→还原，小腻真号资料已恢复原状。
- **已证否**：换别人头像/签名/状态——协议层不存在，不要围绕它堆适配层。

---

## 附录：真机 curl 复现记录（2026-07-02）

```
# TOKEN=<NAPCAT_HTTP_ACCESS_TOKEN>；均 POST http://127.0.0.1:3000/<action>

get_login_info {}           -> {"retcode":0,"data":{"user_id":1129974489,"nickname":"小腻"}}
get_status {}               -> {"retcode":0,"data":{"online":true,"good":true}}
get_supported_actions {}    -> {"retcode":200,"message":"不支持的Api get_supported_actions"}   # 无法枚举
get_stranger_info {user_id:1129974489}
                            -> {"retcode":0,"data":{...,"long_nick":"","status":20,"ext_status":0,"custom_status":null,...}}
get_stranger_info {user_id:10000}
                            -> {"retcode":0,"data":{"nickname":"系统消息","long_nick":"","status":20,...}}
nc_get_user_status {user_id:1129974489}
                            -> {"retcode":0,"data":{"status":0,"ext_status":0}}

set_qq_avatar {file:""}     -> {"retcode":200,"message":"EISDIR ... copyfile '.' -> '.../temp/...'"}   # 存在，需合法 file
set_self_longnick {longNick:""}
                            -> {"retcode":0,"data":{"result":0,"errMsg":""}}                            # ✅ 跑通
set_online_status {}        -> {"retcode":400,"message":"must have required property 'status'"}          # 存在

# --- 落地写入验证（set -> verify -> restore，小腻真号，已还原）---
set_online_status {status:50,ext_status:0,battery_status:100}  -> {"retcode":0}          # 设忙碌
nc_get_user_status {user_id:1129974489}                        -> {"status":50}          # readback 生效
set_online_status {status:10,ext_status:0,battery_status:100}  -> {"retcode":0}          # 还原在线
nc_get_user_status {user_id:1129974489}                        -> {"status":10}          # readback 还原
get_status {}                                                  -> {"online":true,"good":true}

# 备份原头像 640px(PNG 554080B) -> docker cp 进 napcat:/tmp/
set_qq_avatar {file:"/tmp/test_avatar.png"}          -> {"retcode":0}   # 换成测试图(200x200)
set_qq_avatar {file:"/tmp/xiaoni_orig_avatar.png"}   -> {"retcode":0}   # 用备份原图字节还原
set_qq_profile {}           -> {"retcode":400,"message":"must have required property 'nickname'"}         # 存在
set_longnick {}             -> {"retcode":200,"message":"不支持的Api set_longnick"}                       # 别名不存在
_set_self_longnick {}       -> {"retcode":200,"message":"不支持的Api _set_self_longnick"}                 # 别名不存在

# 头像 URL（GET，非 API）
q1.qlogo.cn/g?b=qq&nk=1129974489&s=640          -> 200 image/png 554080 bytes
q.qlogo.cn/headimg_dl?dst_uin=10000&spec=100    -> 200 image/png 2642 bytes
```
