# Embeddings Task Guide

仅在任务明确涉及 embeddings 时阅读本文件。

## Embedding Surface
- 公共 embedding API 由 `provider-service` 提供，不属于业务编排层。
- 对外接口：
  - `GET /v1/models`
  - `POST /v1/embeddings`
- 当前唯一支持模型：`embeddinggemma-300m`。
- 若任务只涉及业务队列、会话、调试页，不要把 `embedding-server` 当作主架构处理。
