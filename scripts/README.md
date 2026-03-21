# Scripts Overview

本目录保留当前主仓仍在使用或仍有排查价值的脚本。

## 主要入口

- `start_modules.py`
  - 本地同时启动 `qqbot-core`、`admin-backend`、`admin-frontend`
- `process-manager.js`
  - `start_modules.py` 的备用实现
- `self-verification.sh`
  - 当前主栈的自验证入口
- `verify-network.sh`
  - 检查 `qqbot-core`、MySQL、NapCat 之间的网络连通性

## 保留的脚本域

- `testing/`
  - 单测、集成测试和回归脚本
- `debugging/`
  - 数据库、上下文、对话链路排查脚本
- `development/`
  - 本地模拟与开发辅助脚本

## 已废弃范围

以下内容不再是当前主仓真相源：

- `http-api` 相关验证脚本
- 独立函数注册中心验证脚本
- `queue-monitor` 等已移除模块的启动与兼容脚本

新增脚本时请围绕当前保留模块编写，避免重新引入已删除服务的假设。
