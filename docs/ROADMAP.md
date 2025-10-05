# 项目路线图

> 本文聚合现阶段与未来计划，后续如有变更请在此更新。

## 近期目标（上线前）
- **消息队列事件分离**：接入 `HumanLikeMessageProcessor`，验证直连/拟人化两种模式并补齐监控接口。
- **LLM Function Calling 修复**：补充 `job_completed`/`job_failed` 事件 payload，完善单测与端到端自验证。
- **HTTP 流量重放 MVP**：实现日志导入、重放 API、响应对比服务，并完成 Admin Panel 基础界面（参考 `docs/HTTP_TRAFFIC_REPLAY_DESIGN.md`）。

## 中期计划（下一迭代）
- **Admin Panel 队列与 LLM 监控**：统一展示 message queue、LLM job 状态以及告警阈值。
- **ToolRegistry 覆盖度提升**：补全动态工具管理页、权限控制，以及 search/invoke 的异常兜底策略。
- **透明代理运维增强**：根据 `docs/TRANSPARENT_PROXY_IMPLEMENTATION.md` 推进自动化脚本、容器化部署与监控。

## 远期方向（评估中）
- **知识记忆体系**：扩展对话长期记忆和事实存储，规划数据同步与清理策略。
- **多通道接入**：在验证 QQ 主链路稳定后，评估是否需要接入额外 IM 渠道或 HTTP API。
- **成本与性能优化**：结合运行数据，对 LLM 并发、缓存、推理成本进行分层优化。

## 参考
- `docs/PROJECT_STATUS.md`
- `docs/HUMAN_LIKE_PROCESSOR_FLOW.md`
- `docs/HUMAN_LIKE_PROCESSOR_FLOW_LLM_TOOLS.md`
- `docs/HTTP_TRAFFIC_REPLAY_DESIGN.md`
