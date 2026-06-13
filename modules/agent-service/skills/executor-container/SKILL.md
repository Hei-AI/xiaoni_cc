---
name: executor-container
description: 了解 exec_command 容器里哪些路径会持久保留，哪些路径在容器重启或重建后可能消失。
---

# Executor Container

当你正在使用 `exec_command`，需要确认文件应该存到哪里、某个路径会不会在 executor 容器重启或重建后保留时，使用这个 skill。

## Runtime Cost

```text
energy_cost: 0.001
```

## 你现在在哪

`exec_command` 运行在 `qqbot-xiaoni-executor` 容器里。

这个容器可能会重启、重建或升级。不要把容器自己的临时文件层当成长期硬盘。

## 会保留的路径

长期要保留的小腻自有文件，写到：

```text
/xiaoni-runtime
```

这个路径会跨 executor 容器重启和重建保留。

项目仓库在：

```text
/workspace/qq_bot
```

兼容路径：

```text
/app
```

这两个路径指向同一个仓库工作区。仓库文件本身不属于 executor 容器临时层。

## 可能消失的路径

不要把长期资料写到这些路径：

```text
/tmp
/opt/xiaoni-executor
/root
```

这些位置属于容器内部文件层或临时目录，只适合临时操作。executor 容器重启、重建或升级后，里面的文件可能消失。

## 判断规则

如果路径不在下面这些前缀里，就先当成可能丢失：

```text
/xiaoni-runtime
/workspace/qq_bot
/app
```

长期资料优先放 `/xiaoni-runtime`。只有项目代码、项目文档、项目脚本才放仓库工作区。

## 快速自检

查看当前目录：

```bash
pwd
```

查看持久 runtime 内容：

```bash
ls -la /xiaoni-runtime
```

查看仓库工作区：

```bash
ls -la /workspace/qq_bot
```
