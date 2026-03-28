# Execution Plans

Execution plan 是仓库内的一等工作产物。
用于跨模块、多阶段、长时间运行、需要交接或需要保留决策/验证记录的工作。
这份文档承接 `AGENTS.md` 中不宜展开的 planning 细则：符合 OpenAI Codex best practices 里“`AGENTS.md` 保持简洁，细节下沉到任务专属 markdown”的做法。

## When To Create A Plan
- 任务跨多个服务或文档
- 预期需要多次提交或多轮验证
- 需要记录权衡、未决问题、回滚点
- 聊天上下文不够稳定，后续还要继续接手
- 任务完成需要明确的 build / test / deploy /回归记录，不能只靠聊天说明“应该已经好了”

## Layout
- `active/`: 仍有剩余实现、验证、决策或交接动作的计划
- `completed/`: 已完成并已写清最终验证结果的计划

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
- plan 必须服务于可验证交付；没有验证记录的“完成”不算完成。
- `active/` 不是待清账堆栈；它只保留当前真的还没完成的工作。
- 只要同一轮交付里已经完成了计划 scope 内的实现和验证，就必须在同一轮交付里同步更新 `Steps`、`Progress Log`、`Verification`，并立即移到 `completed/`。
- 不允许把“代码已经做完，只差之后有人顺手归档”的计划继续留在 `active/`。
- 如果计划范围变化、被拆分、被后续计划接管或确认失效，也要在当次交付里写清楚去向；不要留下状态落后的 active plan。
- 完成后移到 `completed/`，不要把失效计划继续留在 `active/`。

## Lifecycle

### Start
- 任务进入执行后，先在 `active/` 建立计划，再开始跨模块实现。
- 计划初稿至少要写清 `Goal`、`Scope`、`Constraints`、`Steps`。

### During Work
- 每次完成一个阶段性里程碑、做出重要裁决、或发现范围变化时，同步更新 `Progress Log` / `Decision Log`。
- 如果真实完成度和 `Steps` 不一致，先修计划状态，再交接或结束当前轮工作。
- 如果任务要求构建、测试、部署或回归，执行记录要及时写进 `Verification`，不要等到最后凭记忆补。

### Finish
- 计划完成的判定，不只是“代码大致写完”，还包括该计划承诺的验证已记录。
- 一旦完成，直接把文件移到 `completed/`；归档动作本身就是 done 的一部分，不留给后续被动清账。
- 如果确认计划不再继续，也要写明原因和接替位置，然后移出 `active/`。
