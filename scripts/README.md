# Scripts Overview

本目录只保留当前主仓仍会实际使用的启动、部署、烟测和少量开发辅助脚本。

## 主要入口

- `start_modules.py`
  - 本地启动前端 Vite 联调页，并写出宿主机访问地址
- `process-manager.js`
  - `start_modules.py` 的备用实现
- `self-verification.sh`
  - 当前主栈的自验证入口
- `test-queue-connection.sh`
  - 验证 admin -> provider 的队列代理与消息模拟链路
- `verify-network.sh`
  - 检查 `provider-service`、PostgreSQL、NapCat 之间的网络连通性
- `deploy-admin-public.sh`
  - 重建并发布公网管理端前端
- `prepare_admin_expose_auth.sh`
  - 为公网管理端生成本机保存的 debug token，并写出 Caddy 鉴权片段

## 保留的脚本域

- `development/`
  - 本地模拟与开发辅助脚本
- `testing/unit/`
  - 少量仍贴合当前 runtime 的 HTTP/API 级别检查脚本

## 已移除范围

以下内容已经从当前主仓脚本面移除，不再作为维护对象：

- MySQL 直连检查、修复、备份、建表脚本
- 旧 demo 数据脚本
- 依赖 `qqbot-mysql`、`mysql2`、`3306` 的历史测试与诊断脚本
- 已移除的旧服务与独立注册中心相关脚本

当前仓库不再维护 PostgreSQL 直连脚本。数据库侧排障优先走现有 HTTP 健康检查、管理端接口和 smoke 脚本。
