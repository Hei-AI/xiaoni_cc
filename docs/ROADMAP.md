# 项目路线图

## 当前目标

- 稳定当前主仓最小运行栈：`postgres + provider-service + agent-service + admin-panel`
- 稳定已经落地的 `agent-service` loop runtime、agent run workspace 与 transcript replay
- 继续清理历史兼容代码、陈旧脚本和误导性文档
- 把管理端保留能力收口到当前真实后端能力，避免再出现无效入口
- 让 provider-service 成为唯一外部能力接入层，统一承接调试、模拟、NapCat 发送、queue ingress、embeddings 和 memory side effect 调度

## 近期计划

- 继续把仓库脚本、部署说明、环境变量命名统一到 `provider-service`
- 继续清理残留的旧文案和脚本假设，避免误导运行与排障
- 稳定 admin playground、queue management、traffic replay、agent run workspace、runtime status 等保留调试面
- 完成 transcript snapshot compact/materialize 闭环，让 fixed-anchor replay 不再只靠“从会话开头重放”
- 完成 Xiaoni identity-root continuity 的只读审计、event kind contract 校准和 prompt-safe projection 设计；在切 prompt 前先用 shadow trace 验证 `life_events` 与 session-window summary 的差异
- 收尾 Xiaoni Identity Lineage Phase 1：连续性试验、trace 证据完整性、legacy migration 验证和 compose 级验证
- 为新的业务流程重建预留清晰边界：业务编排在新服务中实现，外部能力接入继续放在 `provider-service`

## 中期计划

- 完成新的业务流程服务落地，并与 `provider-service` 通过稳定契约集成
- 将 provider debug、trace、traffic replay 的语义对齐，减少导入/重跑链路中的语义损失
- 继续优化 Admin 的对象选择、细节查看和排障工作流
- 把群聊参与判断收口到 agent-service 的场景理解与 identity / activation trace；provider 侧只保留硬边界和 observability
- 逐步清理只服务于旧认知架构的数据库表、脚本和文档

## 长期方向

- 在不重新耦合 NapCat 细节的前提下扩展更多 channel adapter 或 provider adapter
- 用统一 trace/span 模型替换更多历史专用调试模型
- 在运行链路稳定后，再评估新的业务侧能力与服务边界
