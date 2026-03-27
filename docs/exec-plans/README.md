# Execution Plans

Execution plan 是仓库内的一等工作产物。
用于跨模块、多阶段、长时间运行、需要交接或需要保留决策/验证记录的工作。

## When To Create A Plan
- 任务跨多个服务或文档
- 预期需要多次提交或多轮验证
- 需要记录权衡、未决问题、回滚点
- 聊天上下文不够稳定，后续还要继续接手

## Layout
- `active/`: 正在进行中的计划
- `completed/`: 已完成计划

## Suggested Template
```md
# <task title>

## Goal
- ...

## Scope
- ...

## Constraints
- ...

## Steps
- [ ] ...
- [ ] ...

## Progress Log
- YYYY-MM-DD: ...

## Decision Log
- ...

## Verification
- ...
```

## Rules
- execution plan 是工作记录，不是宣传稿。
- 只保留仍然真实的决策和状态。
- 小改动可以用轻量计划；复杂任务要维护 progress log 和 decision log。
- 完成后移到 `completed/`，不要把失效计划继续留在 `active/`。
