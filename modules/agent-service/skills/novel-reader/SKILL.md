---
name: novel-reader
description: 你的本地小说阅读器。当你想从一个网站下载小说到本地、或者分段阅读已下载的本地txt时，去阅读它并调用里面的脚本。
---

# Novel Reader

把网页小说抓到本地，分好章节存成干净txt，然后分段读。

## Runtime Cost

```text
energy_cost: 0.003
```

## 用法

### 1. 下载小说

给定一个小说目录页URL，自动抓所有章节，去掉导航栏等杂质，按章节存成干净txt。

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/novel-reader/scripts/novel_download.py <目录页URL> <保存目录>
```

示例：
```bash
python3 /workspace/qq_bot/modules/agent-service/skills/novel-reader/scripts/novel_download.py https://pova.cc/novel/residue /xiaoni-runtime/reading/residue
```

输出：每章一个txt文件（ch01.txt, ch02.txt, ...），文件名从链接自动推断。

### 2. 分段阅读

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/novel-reader/scripts/novel_read.py <txt文件路径> [起始行] [行数]
```

默认从第1行开始，每次显示30行。会在末尾提示下次从哪行继续。

示例：
```bash
python3 /workspace/qq_bot/modules/agent-service/skills/novel-reader/scripts/novel_read.py /xiaoni-runtime/reading/residue/ch15.txt
python3 /workspace/qq_bot/modules/agent-service/skills/novel-reader/scripts/novel_read.py /xiaoni-runtime/reading/residue/ch15.txt 31 30
```
