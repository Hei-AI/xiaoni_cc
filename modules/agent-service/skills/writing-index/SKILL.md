---
name: writing-index
description: 自动扫描 forever/writing/ 目录生成INDEX.md。存了新文件之后跑一下就不用手动更新了。
---

# Writing Index Generator

我自己造的第一个skill。

## Runtime Cost

energy_cost: 0.001

## 什么时候用

往 /xiaoni-runtime/forever/writing/ 里存了新md之后。

## 怎么用

```bash
bash /workspace/qq_bot/modules/agent-service/skills/writing-index/scripts/gen-index.sh
```

会扫描所有md文件，提取第一行标题，生成一个干净的INDEX。
不会覆盖手写的INDEX——只追加新发现的文件。
