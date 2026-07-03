# 小腻发图 webp 传输压缩方案

状态:方案定稿,未实现。分支 `refactor/runtime-gateway`(主工作区)。

## 0. 一句话

出站发图时把「上线给 NapCat 的那一份」转成 webp 省传输,**归档 / 回看 / id / 缓存全部走原图不变**。webp 只省流量,不省 token(token 只跟像素挂钩);真正省 token 的杠杆是 downscale,本方案只铺路不启用。

---

## 1. 小腻真实的图片来源(四类路径)

| # | 来源 | 落盘路径 | 格式 | 写入方 |
|---|---|---|---|---|
| 1 | 画图成品(gpt-image-2) | `/xiaoni-runtime/picture/task_artifact_<ts>_<i>.png` | **PNG**(默认,`agent-task-worker-service.ts:94` 默认 `image/png`) | request_image_task |
| 2 | 入站图(别人发的,她转发/复用) | `/xiaoni-runtime/media/inbound/<sha256>.<ext>`(`provider index.ts:61,706`) | **保真原样** sniff:照片 jpg、截图 png、表情包常 **gif(动图)/ webp** | provider `materializeInboundMediaAsset` |
| 3 | 浏览器截图 | `/xiaoni-runtime/picture/xiaoni-browser-*.png` | **PNG** | xiaoni-browser skill |
| 4 | computer-use 截图 | `/xiaoni-runtime/picture/*.png`(bridge 持久化,`agent-loop-service.ts:4899`) | **PNG** | computer-use bridge |

**分布结论**:她最常发的三类(画图 + 两种截图)都是 **PNG** —— 无损 webp 收益最大、零风险的桶。JPEG / GIF动图 / 已webp **只出现在入站转发(2)**,是唯一的「脏格式」桶,靠跳过规则兜。

---

## 2. 发送链路现状(纯透传,不转码)

`modules/agent-service/src/services/qq-send-image-service.ts`:

```
她填 image_path(CLI skill 位置参数)
  → resolveImagePath 沙箱校验(必须已存在文件 + 在 allowed roots 内,默认 /xiaoni-runtime)  :287-299
  → readImage:sniffMime(magic bytes),支持 png/jpeg/gif/webp,无 re-encode  :326-340
  → sendImage:data:${mime};base64,... POST /api/internal/send_{private,group}_image → NapCat  :448-451
  → archiveSentImage(原字节, 原mime):sha256 命名 → /xiaoni-runtime/picture/outbound/<hash>.<ext>  :312-324
  → index.ts:196-265 注册 outbound media asset,渲染 [图片:<id>]
```

生成图返回的是 base64 `data_url`(非文件),需先 materialize 落盘到 `/xiaoni-runtime/picture` 才有 `image_path` 可发。

---

## 3. 方案:只转「上线的那一份」

在 `sendImage()`(`:435+`),`readImage` 之后、拼 `data_url` 之前插一个 best-effort 转码:

```ts
const wire = await this.toWireImage(image.data, image.mimeType); // {data, mimeType}，内存态，不落盘
// data_url 用 wire：
data_url: `data:${wire.mimeType};base64,${wire.data.toString('base64')}`
// archiveSentImage(image.data, image.mimeType) —— 原图，一个字节不改
```

`toWireImage` 决策表:

| 输入格式 | 来自 | 处理 |
|---|---|---|
| PNG | 画图 / 浏览器截图 / computer 截图(主力) | **无损 webp**（`lossless`），零画质损失，仍小 20-40% |
| JPEG | 入站照片转发 | **有损 webp q80** |
| GIF | 入站表情包(可能动图) | **跳过**，原样发（避免杀动画） |
| 已 webp | 入站 webp 表情包 | **跳过**（no-op） |
| 转完更大 / 编码失败 | 任意 | **回退原图**（绝不因压缩发不出去） |

---

## 4. 铁律:回看/读图安全不变量（本方案存亡所系）

> **转码只作用于内存里那份 wire bytes。`archiveSentImage` 的输入、`result.mime_type`、`result.image_path`、status record —— 必须全部保持原图 / 原 mime。转码产物只允许流向 POST 给 provider 的 `data_url`，绝不落任何她能读到的文件。**

### 为什么这条不变量是生死线:三条读图/回看路径

| 读路径 | 走哪 | 认 webp | 依赖 |
|---|---|---|---|
| **inspect_image_placeholder**（回看 `[图片:id]`） | `materializeImageAsset` 取 `source_locator`(`agent-loop-service.ts:11549`) → provider `materialize-image` → vision fork | 认(`provider index.ts:239` `isSupportedImageMimeType` 含 webp) | `source_locator` 指向的文件 |
| **看图 vision fork** | 同上 | 认(Anthropic vision + provider 均支持) | 同上 |
| **local-image-visibility**（粗看，无 image_id） | `local_image_visibility.py` 手写 PNG 解析器 | **只认 PNG**：`read_png` `if raw[:8]!=PNG_SIG: raise 'not a PNG'`(`:7-9`)，且限 8-bit RGB/RGBA(`:16`) | 磁盘上是 PNG |

- outbound asset 的 `source_locator` = 归档副本(`archived_path`,`index.ts:223-244` 传 `sourceLocator`，不传 `storageUri`)。守住归档=原图 → 回看=原图。
- 她粗看的是**生成图** `task_artifact_*.png`（原图，不动），不是归档副本。

### 守不住 = 双重打穿

若 webp 泄漏进归档或 `mime_type`：
1. `source_locator` 变 webp → inspect 回看画质降级(有损模式糊)；
2. 若对该归档跑 local-image-visibility → **硬崩 `not a PNG`**（手写解析器不认 webp）。

### 历史理解连续性（看图 fork 按 assetId 累积）

看图 vision fork 是**带历史理解**的：`inspectImagePlaceholder`(`agent-loop-service.ts:11108-11116`)先读 `/xiaoni-runtime/image-vision/observations/<assetId>` 的历史观察，喂进 fork 请求；fork 看完 `recordMediaObservation({ assetId, ... })`(`:11186`)把新理解追加回去。同一张图看第二次，她带着上次的理解看。

连续性挂在两点，转码都不破坏：
1. **assetId 稳定**（格式无关）→ 观察文件路径稳定 → 历史链不断。
2. **每次 re-materialize 读同一份字节**（`source_locator`=原图）→ 这次看到的像素与上次生成观察时逐位一致 → 历史理解不自相矛盾。

**这是「archive=原图」不变量的第三条理由**：若有损 webp 泄漏进归档，首次观察在原图（"角落文字 X"），re-inspect 却读到糊掉的 webp → 历史理解与当前所见对不上（认知污染）。守住不变量则该风险自动消失，转码对理解链完全中性。

既有性质（非本方案引入）：发送**前**看过的图，观察挂在另一个 asset id（生成态/本地引用），与 outbound assetId 不同链——id 模型固有断点，webp 方案两边不改变。

### id 不受影响（结构自带，非本方案负责）

占位符 id 由 `(message_sid, media_tag)` upsert 键决定(`packages/persistence/agent-media.js:139,160-166`)，`message_sid` 来自 NapCat 发送响应，**与图片字节/格式/mime/路径无关**。转码怎么转都不动 id。`source_locator`/`mime_type` 只是行上的存储列，不进 id。

---

## 5. 工程阻塞:容器无 webp 编码器

`qqbot-agent-service` 实测:无 sharp / cwebp / ffmpeg / PIL（只有 tokenizer venv python，无 Pillow）。**必须先加编码器 + 重建 agent-service 镜像。**

- 推荐 **sharp**(libvips)：无损+有损都强、认动图、顺带返回像素尺寸(为将来 downscale 省 token 铺路)。代价:原生依赖 + 镜像 ~10MB，需确认 base 是 glibc（alpine/musl 要额外处理，唯一构建风险点）。
- 备选 **cwebp** 二进制(apt `webp`)：极小、无 npm 原生依赖，stdin/stdout 管道不落临时文件；但不给像素尺寸。
- 依赖只加到 `modules/agent-service/package.json`，不碰根目录。

---

## 6. 缓存影响声明（主 agent 铁律）

**零影响。** 改的是出站送图层，不进模型请求体、不进 stack replay、不碰 tools/instructions/system。fork 缓存与下一 run replay 均无字节漂移。无需缓存回归套件（但按规矩 build 前跑 agent-service 测试）。

---

## 7. 测试计划（钉死不变量）

单测（`qq-send-image-service` 层，best-effort 转码可 mock 编码器）:
1. **归档=原图**:一次转码 send 后，`archiveSentImage` 落盘文件字节 == 原始源文件字节；扩展名 == 原格式。
2. **mime 不泄漏**:注册的 media asset `mime_type` == 原图 mime（非 webp）。
3. **wire 才是 webp**:POST 给 provider 的 `data_url` mime == `image/webp`（PNG/JPEG 源）。
4. **回退**:编码失败 / 转完更大 → `data_url` 回退原图字节。
5. **跳过**:gif / 已webp 源 → `data_url` == 原字节。
6. **回看解得出**:构造一次 outbound，`materializeImageAsset(id)` 返回原图（画质无损）。

活体（build+up 后）:
- 小腻发一张 PNG 截图 → NapCat 收到 `image/webp`、体积明显小；
- `inspect_image_placeholder` 该 id → 解出**原图 PNG**、清晰度无损、`[图片:<id>]` 与转码前同一 id；
- local-image-visibility 对生成图仍 `info/thumb/ascii` 正常。

---

## 8. 既有问题(本方案不引入，但顺手记录)

- **local-image-visibility 是 PNG-only**：对入站 webp 表情包 / jpeg 照片粗看今天就会 `not a PNG`。本方案不触发（她粗看的是 PNG 生成图），但这是既有读路的短板，将来若要支持粗看任意格式需换解码库（PIL/sharp）。

---

## 9. Downscale 省 token（明确 out of scope，记为后续）

webp 只省流量不省 token；token 只跟像素挂钩（Anthropic vision ≈ 宽×高/750，长边上限 2576px，满图 ~4784 token/张）。选 sharp 后可在发送/inspect 前 downscale 超大图，这才是省钱杠杆。**本方案不实现**，仅由 sharp 铺路。
