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
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py send_group 123 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py send_group 123 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png --caption "可选配文"
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py send_private 85178516 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py send_private 85178516 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png --caption "可选配文"
```

- `send_group group_id image_path` sends the image to a QQ group, for example group `123`.
- `send_private user_id image_path` sends the image to a QQ private chat, for example user `85178516`.
- `image_path` must be the exact local image path under `/xiaoni-runtime` unless the operator explicitly configured extra image roots.
- `--caption` is optional text sent with the image. Write it exactly like a normal private/group reply — plain text, with 表情 written as `[表情:名字]` (例如 `[表情:笑哭]`) or a Unicode emoji like 😂. Omit it when you only want to send the image.
- Successful sends include `message_id` when NapCat returns one, plus a local `status_key`.

## Check Status

If the send command returned a `message_id` or `status_key`, prefer checking by that value:

```bash
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py check --message-id 123456
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py check --status-key abc123
```

If the send command did not return a final `<QQ_IMAGE_SEND_RESULT ...>` or `<QQ_IMAGE_SEND_ERROR ...>`, use `check` with the same mode, target id, image path, and caption:

```bash
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py check group 123 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py check group 123 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png --caption "可选配文"
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py check private 85178516 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py check private 85178516 /xiaoni-runtime/picture/task_artifact_1780760127856_0.png --caption "可选配文"
```

The check result is `<QQ_IMAGE_SEND_STATUS ...>` with `status="sent"`, `status="failed"`, `status="pending"`, or `status="unknown"`.

## Boundaries

- This skill only sends images to QQ groups or QQ private chats.
- It does not generate images, inspect images, send files, or navigate QQ.
- Do not pass `thread_key` or `session_key`. Use the plain QQ group id or QQ user id.
- Supported local image formats: PNG, JPEG, WebP, GIF.
- By default the allowed image root is `XIAONI_RUNTIME_ROOT`; operators can set `QQ_SEND_IMAGE_ALLOWED_ROOTS` to a comma- or path-separator-delimited list when a deployment intentionally exposes more image mounts.

## Failure

If sending fails, the result is `<QQ_IMAGE_SEND_ERROR ...>`. Treat the reason as the real boundary: the file may be missing, outside `/xiaoni-runtime` or the configured image roots, too large, not an image, or NapCat/provider-service may have rejected the send.
