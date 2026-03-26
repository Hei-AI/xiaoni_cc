# 项目路线图

## 当前目标

- 稳定当前主仓最小运行栈：`postgres + provider-service + admin-panel`
- 继续清理旧 `qqbot-core` 业务编排痕迹、陈旧脚本和误导性文档
- 把管理端保留能力收口到当前真实后端能力，避免再出现无效入口
- 让 provider-service 成为唯一外部能力接入层，统一承接调试、模拟、NapCat 发送和 embeddings

## 近期计划

- 继续把仓库脚本、部署说明、环境变量命名统一到 `provider-service`
- 继续清理残留的 `qqbot-core` 文案和旧脚本假设，避免误导运行与排障
- 稳定 admin playground、queue management、traffic replay、conversation trace 等保留调试面
- 为新的业务流程重建预留清晰边界：业务编排在新服务中实现，外部能力接入继续放在 `provider-service`

## 中期计划

- 完成新的业务流程服务落地，并与 `provider-service` 通过稳定契约集成
- 将 provider debug、trace、traffic replay 的语义对齐，减少导入/重跑链路中的语义损失
- 继续优化 Admin 的对象选择、细节查看和排障工作流
- 逐步清理只服务于旧认知架构的数据库表、脚本和文档

## 长期方向

- 在不重新耦合 NapCat 细节的前提下扩展更多 channel adapter 或 provider adapter
- 用统一 trace/span 模型替换更多历史专用调试模型
- 在运行链路稳定后，再评估新的业务侧能力与服务边界
