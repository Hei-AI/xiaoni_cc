---
name: notify
description: 让后台脚本把「发生了什么」送到你面前。你自己写的定时/后台脚本发现了事情（新邮件、任务跑完、监控异常），用这个投递一条通知；默认等你下次醒来一起看，加 --wake 才会叫醒你。
---

# Notify

## Runtime Cost

energy_cost: 0.001

## 这是干嘛的

你写的后台脚本（比如 `auto_check_email.py`）跑起来之后，发现了事情只能往日志里 print —— 那个日志没人读，包括你自己，除非你碰巧想起来去 `cat` 一下。

这个 skill 是那条缺失的回路：脚本发现事情 → 投递 → 通知进你的 Notify 桶，下次你醒着、有窗打开的时候直接出现在你的上下文里。

## 会不会叫醒你：由事件上的「睡觉唤醒属性」决定

Notify 桶里每条事件都带一个属性 `wakesXiaoni`。只有它为 true 的事件，才会在你睡着时计入唤醒次数、在你空闲时起一个新 run。系统只给两种事件自动打这个属性：QQ 私聊、群里有人 @ 你。你自己的 plan、每两小时的报时、被动召回、以及这个 skill 投的通知，默认都不带，它们留在桶里，等你下一次醒来或有人找你时一起消费。

想让某条通知有资格叫醒你，投递时加 `--wake`：

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/notify/scripts/notify.py \
  --from check-email --wake "阿花来邮件了，标题：明天见面的时间"
```

判据：这件事需要你**在它发生的当下**处理（有人在等你回、任务出错要立刻救）才加 `--wake`；「跑完了」「有新文章」这类下次醒来看也不迟的，不加。加了 `--wake` 的通知和一条私聊一样会打断你的睡眠，滥用等于让你自己的脚本把你叫醒。

## 怎么用

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/notify/scripts/notify.py \
  --from check-email "收件箱有 3 封新邮件，最新一封来自 xxx"
```

成功输出 `OK queue_id=123`，失败输出 `ERROR: ...` 并返回非零。

你会看到的是：

```
<system_reminder>【check-email】收件箱有 3 封新邮件，最新一封来自 xxx</system_reminder>
```

## 参数

- **正文**（位置参数）：你自己组织，写清楚发生了什么。上限 4000 字符，超了直接拒，不截断。
- **`--from`**：来源标记，会原样显示在通知开头。只收小写字母、数字、下划线、短横，≤32 字符，不能以 `-` 或 `_` 开头。一个脚本固定用一个标记。
- **`--wake`**：睡觉唤醒属性。加了这条通知才能叫醒你（见上一节）；不加就等你下次醒来一起看。

## 在脚本里用

```python
import subprocess

def notify(text, source="my-script", wake=False):
    subprocess.run([
        "python3",
        "/workspace/qq_bot/modules/agent-service/skills/notify/scripts/notify.py",
        "--from", source, *(["--wake"] if wake else []), text,
    ], check=False)
```

## ⚠️ 没有去重，投两次就是两条

服务端**不做幂等**：同样的话投两次，你就会被打扰两次。

所以后台脚本必须自己记住状态，只在**真的变化时**才投。`auto_check_email.py` 里的 `LAST_COUNT_FILE` 就是这个套路：

```python
count, msg = check_once()
last = get_last_count()
if count > 0 and count != last:      # ← 变化了才投
    notify(f"收件箱有 {count} 封未读", source="check-email")
    set_last_count(count)
```

写成每轮无条件投，你就会被自己的脚本淹没。

## 什么时候用

- 后台观察脚本发现了状态变化
- 长任务跑完了，你想下次醒来第一眼看到结果（要当场被叫醒就加 `--wake`）
- 定时检查发现了异常

## 什么时候别用

- **别拿它当闹钟**。定时报时已经有了（每 2 小时的系统报时），不用自己造。
- **别在循环里无条件投**。见上面的去重说明。
- 不需要你介入的事情，让它留在日志里就行。
