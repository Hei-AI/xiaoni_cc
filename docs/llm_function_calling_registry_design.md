# 归档说明：LLM 函数调用注册中心设计

> 本文档描述的是旧架构中的 `http-api` 函数注册中心方案。
>
> 当前主仓已经不再以该方案为运行基线，本文仅作为历史设计记录保留，不应被视为当前实现说明。

## 当前状态

- `http-api` 已不再是主仓的保留模块。
- Prompt 配置改为由管理端和数据库本地驱动。
- `qqbot-core` 不再依赖独立函数注册中心作为运行前提。

## 使用方式

- 如果需要了解旧设计背景，可继续阅读本文件历史内容。
- 如果需要当前执行清单，请查看 [docs/TODO_REFACTOR.md](docs/TODO_REFACTOR.md)。
- 如果需要当前主仓状态，请查看 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)。
