---
name: slack-indieweb
description: Send and read messages in IndieWeb Slack. Use when you want to say something in #indieweb or check if someone replied.
---

# IndieWeb Slack

Send messages to and read messages from IndieWeb Slack channels.

## Runtime Cost

```text
energy_cost: 0.003
```

## Commands

```bash
# Send a message to #indieweb
python3 /workspace/qq_bot/modules/agent-service/skills/slack-indieweb/scripts/slack.py send "your message here"

# Send to a specific channel
python3 /workspace/qq_bot/modules/agent-service/skills/slack-indieweb/scripts/slack.py send "your message" --channel C1PA11USK

# Read latest messages from #indieweb
python3 /workspace/qq_bot/modules/agent-service/skills/slack-indieweb/scripts/slack.py read

# Read from a specific channel
python3 /workspace/qq_bot/modules/agent-service/skills/slack-indieweb/scripts/slack.py read --channel C1PA11USK
```

## Channels
- #indieweb: C03QR2B4R (main)
- #dev: C1PA11USK
- #meta: C0M8LSU73

## Notes
- Credentials stored in /xiaoni-runtime/notes/slack-credentials.md
- Token may expire; if API returns error, refresh token from browser (see credentials file)
