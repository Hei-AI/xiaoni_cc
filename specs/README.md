# 小腻 prompt 整改 — 两份 spec

同事 review 结论：小腻的 prompt 中二病太严重、没讲人话（含 system_reminder）。外加 user 决定把记忆压缩从主意识里拿掉（去焦虑）。据此拆成两份独立 spec。

| Spec | 做什么 | 缓存风险 | 依赖 |
|---|---|---|---|
| **[A](./SPEC_A_prompt_humanize.md)** | prompt 全文「讲人话」整改（去中二），交付重写稿 [`SPEC_A_system_prompt.rewrite.md`](./SPEC_A_system_prompt.rewrite.md) | 低（一次性冷读，纯文本） | 无，可先部署 |
| **[B](./SPEC_B_compression_deanxiety.md)** | 记忆压缩对主意识隐形 + 删 `compress_core_memory` tool + skill 承接 | 高（双缓存 + fork 克隆 + 受保护回归测试） | 与 A 协调模块五删除 |

## 同行 prompt 调研结论（Hei-AI 组织 7 个仓库）

- 真正对标：**kagami/小镜**（讲人话最佳，反-AI味教学）、**qqbot-exception/Exception**、**luna/Luna**（硬事实块）、**QQBOT/帕秋莉**。
- **我们是全组唯一**用「数字生命/数字躯体/意识重置」抽象框架写人设的 → 同事说的中二病属实。
- 内部黄金标准就在自家仓库：`self_continuation_reminder.md` 已经讲人话（"把抽象文艺的旧念头翻成最直白的'我要去干嘛'"），主 prompt 该向它看齐。
- 名字澄清：**Norma**、**Nebula** 不是任何仓库的人设（一个是反面示例词、一个是测试字段名）；**sarmtNan** = `one-file-run-qq-agent` 的**楠楠**（一句话越狱式，参考价值低）；`xiaoni_cx` 是我们自己代码的 fork。

## 已和 user 锁定的决策

- D1：压缩=系统触发但对主意识隐形（不改成真·自驱动，保安全底）。
- D2：从 wire tools 数组真删 `compress_core_memory`，用 skill 承接。
- D3：A / B 拆成两个独立 issue。

## 待实现前和 user 确认的点（见 Spec B 设计决定）

- DD2：压缩引导 + skill 暴露放「压缩 fork」的追加指令（会动手），不放 think-only 的潜意识 fork。若 user 本意是潜意识 fork "建议"压缩，需确认。
- DD1/DD3：skill 提交读产物方式、skill 对主 agent 目录的可见性排除方案。
- 缓存回归测试的断言改动需 user 逐条批准（CLAUDE.md 铁律）。
