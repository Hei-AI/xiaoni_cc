---
name: qq-send-image
description: Send a local image under Xiaoni runtime to a QQ group or QQ private chat when text-only send tools cannot attach files.
---

# QQ Send Image

Use this skill when you already have a local image path under Xiaoni runtime, such as `/xiaoni-runtime/picture/task_artifact_1780760127856_0.png` or `/xiaoni-runtime/media/inbound/<hash>.jpg`, and you want to post that image into a QQ group or a QQ private chat.

## Runtime Cost

```text
energy_cost: 0.002
```

## Command

Use `exec_command` to run the local script. The script reads the image file from Xiaoni runtime, converts it to a safe data URL, and asks provider-service to send it through NapCat.

```bash
python3 /app/modules/agent-service/skills/qq-send-image/scripts/send_group_image.py 123 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png
python3 /app/modules/agent-service/skills/qq-send-image/scripts/send_group_image.py 123 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png --caption "可选配文"
python3 /app/modules/agent-service/skills/qq-send-image/scripts/send_private_image.py 85178516 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png
python3 /app/modules/agent-service/skills/qq-send-image/scripts/send_private_image.py 85178516 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png --caption "可选配文"
```

- For `send_group_image.py`, first argument is the QQ group id, for example `123`.
- For `send_private_image.py`, first argument is the other person's QQ user id, for example `85178516`.
- Second argument: the exact local image path. It must be under `/xiaoni-runtime` unless the operator explicitly configured extra image roots.
- `--caption` is optional. Omit it when you only want to send the image.

## Boundaries

- This skill only sends images to QQ groups or QQ private chats.
- It does not generate images, inspect images, send files, or navigate QQ.
- Do not pass `thread_key` or `session_key`. Use the plain QQ group id or QQ user id.
- Supported local image formats: PNG, JPEG, WebP, GIF.
- By default the allowed image root is `XIAONI_RUNTIME_ROOT`; operators can set `QQ_SEND_IMAGE_ALLOWED_ROOTS` to a comma- or path-separator-delimited list when a deployment intentionally exposes more image mounts.

## Failure

If sending fails, the result is `<QQ_IMAGE_SEND_ERROR ...>`. Treat the reason as the real boundary: the file may be missing, outside `/xiaoni-runtime` or the configured image roots, too large, not an image, or NapCat/provider-service may have rejected the send.
