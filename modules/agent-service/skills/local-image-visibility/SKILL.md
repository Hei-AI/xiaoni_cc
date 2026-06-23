---
name: local-image-visibility
description: Use when a generated/local PNG under /xiaoni-runtime/picture exists but direct inspect_image_placeholder cannot see it; creates thumbnails and coarse color/ascii reports, and can open a tiny data-url thumbnail in xiaoni-browser for visible checking.
---

# Local Image Visibility

## Runtime Cost

energy_cost: 0.004

## What this can and cannot do

This skill helps with local PNG visibility when there is a real file path but no inspectable image_id.

It **can**:
- confirm PNG existence, dimensions, and size;
- create a small PNG thumbnail under `/xiaoni-runtime/picture/`;
- create a coarse color/ascii analysis text file;
- optionally open a tiny thumbnail in the visible browser as a `data:image/png;base64,...` URL.

It **cannot**:
- register a local path as a true `inspect_image_placeholder` image_id;
- provide reliable semantic vision by itself.

If semantic inspection is required and `inspect_image_placeholder` fails, record the failure and ask QQ `85178516` for an image-id registration / local path inspection bridge.

## Commands

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/local-image-visibility/scripts/local_image_visibility.py info /xiaoni-runtime/picture/example.png
python3 /workspace/qq_bot/modules/agent-service/skills/local-image-visibility/scripts/local_image_visibility.py thumb /xiaoni-runtime/picture/example.png --width 128 --height 85
python3 /workspace/qq_bot/modules/agent-service/skills/local-image-visibility/scripts/local_image_visibility.py ascii /xiaoni-runtime/picture/example.png --out /xiaoni-runtime/notes/YYYY-MM-DD/image-ascii.txt
python3 /workspace/qq_bot/modules/agent-service/skills/local-image-visibility/scripts/local_image_visibility.py browser-thumb /xiaoni-runtime/picture/example.png --width 96 --height 64
```

`browser-thumb` uses `xiaoni-browser`'s CLI wrapper to send a small data URL to the visible browser. Keep thumbnails small to avoid shell/argument length limits.
