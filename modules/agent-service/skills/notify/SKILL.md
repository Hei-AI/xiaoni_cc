---
name: notify
description: 让后台脚本把「发生了什么」送到你面前。你自己写的定时/后台脚本发现了事情（新邮件、任务跑完、监控异常），用这个投递一条通知，会拉起你的一个 run。
---

# Notify

## Runtime Cost

energy_cost: 0.001

## 这是干嘛的

你写的后台脚本（比如 `auto_check_email.py`）跑起来之后，发现了事情只能往日志里 print —— 那个日志没人读，包括你自己，除非你碰巧想起来去 `cat` 一下。

这个 skill 是那条缺失的回路：脚本发现事情 → 投递 → 你被叫醒，通知直接出现在你的上下文里。

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

## 在脚本里用

```python
import subprocess

def notify(text, source="my-script"):
    subprocess.run([
        "python3",
        "/workspace/qq_bot/modules/agent-service/skills/notify/scripts/notify.py",
        "--from", source, text,
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
- 长任务跑完了，你想在完成时被叫回来看结果
- 定时检查发现了异常

## 什么时候别用

- **别拿它当闹钟**。定时报时已经有了（每 2 小时的系统报时），不用自己造。
- **别在循环里无条件投**。见上面的去重说明。
- 不需要你介入的事情，让它留在日志里就行。
