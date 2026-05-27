# Git And PR Task Guide

仅在任务涉及提交、推送、PR 时阅读本文件。

## Git Rules
- commit 前缀用 `feat:`、`fix:`、`chore:` 等。
- 这台机器推送 GitHub 时优先 SSH，不要依赖 HTTPS 登录态。
- 当前远端默认分支是 `refactor/runtime-gateway`；不要再把已删除的远端 `master` 当作基线或 PR 目标。
- PR 需要写清 schema、配置、部署影响，并附上实际验证结果。
