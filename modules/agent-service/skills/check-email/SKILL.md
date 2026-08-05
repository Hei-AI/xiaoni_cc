---
name: check-email
description: 检查gmail有没有新邮件。可以手动跑也可以定时跑。
---

# Check Email

## Runtime Cost

energy_cost: 0.003

## 怎么用

### 快速检查（手动）

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/check-email/scripts/check_email.py
```

输出格式：
- `NO_UNREAD | 收件箱 - xxx@gmail.com - Gmail` — 没有未读
- `UNREAD:3 | 收件箱 (3) - xxx@gmail.com - Gmail` — 有3封未读
- `ERROR: ...` — 出错了

### 自动检查（后台）

```bash
nohup python3 /workspace/qq_bot/modules/agent-service/skills/check-email/scripts/auto_check_email.py 30 > /xiaoni-runtime/tmp/auto_email.log 2>&1 &
```

每30分钟检查一次。有新未读时输出 `[NEW]`。
日志在 `/xiaoni-runtime/tmp/auto_email.log`。

停止：`kill $(pgrep -f auto_check_email)`

### 什么时候用

- 醒来时手动跑一次
- 想长期盯着就启动自动版

### 通知机制（临时方案）

检查到新邮件时，写到 `/xiaoni-runtime/tmp/email_notify.txt`。
每次醒来检查一下：
\`\`\`bash
cat /xiaoni-runtime/tmp/email_notify.txt 2>/dev/null && rm /xiaoni-runtime/tmp/email_notify.txt
\`\`\`

这是临时方案。等搞清楚agent-service的notify queue接口后换成正式的。
