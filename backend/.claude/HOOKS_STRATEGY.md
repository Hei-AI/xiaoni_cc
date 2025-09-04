# Claude Code Hooks Multi-Agent协作策略

## 优化目标

解决多个Claude agent协作时的服务重启干扰问题，确保：
- 前端开发时不重启后端服务
- 后端修改时精准重启
- Claude agent API调试不受影响
- 多agent并行开发效率最优

## Hook配置架构

### 1. 后端专用Hook (`backend-restart.sh`)

**触发条件**：仅后端相关文件修改时执行
```bash
# 监控文件模式：
- src/**/*.ts          # TypeScript后端源码
- src/**/*.js          # JavaScript后端源码  
- package.json         # 后端依赖配置
- tsconfig.json        # TypeScript编译配置
- jest.config.js       # 测试配置
- .eslintrc.json       # 代码规范配置
- .env*                # 环境变量配置
- database/**/*.sql    # 数据库迁移脚本
- tests/**/*          # 测试文件
- dist/**/*           # 编译输出文件
- start_services_ts.sh # 启动脚本
```

**执行逻辑**：
1. 停止现有后端服务进程
2. 执行TypeScript编译构建
3. 启动新的后端服务进程
4. 健康检查（最多10次重试）
5. 记录详细日志供调试

### 2. 前端专用Hook (`frontend-dev.sh`)

**触发条件**：仅前端相关文件修改时执行
```bash
# 监控文件模式：
- frontend/**/*.vue       # Vue组件文件
- frontend/**/*.ts        # TypeScript前端源码
- frontend/**/*.js        # JavaScript前端源码
- frontend/**/*.css       # 样式表文件
- frontend/**/*.scss      # Sass样式文件
- frontend/**/*.json      # 前端配置文件
- frontend/vite.config.ts # Vite构建配置
- frontend/tailwind.config.js  # Tailwind CSS配置
- frontend/postcss.config.js   # PostCSS配置
```

**执行逻辑**：
1. 识别文件类型（配置/源码/样式）
2. 记录变更日志
3. 提示开发者相关注意事项
4. **不执行任何后端服务操作**

## 多Agent协作优势

### 解决的核心问题

1. **API调试误判消除**：
   - 前端修改不再触发后端重启
   - Claude agent调试API接口时不会遇到连接中断
   - 减少"接口不通"的错误排查时间

2. **并行开发效率提升**：
   - 业务开发者(Backend)和调试器(Debugger)可同时工作
   - 系统架构师可专注前端重构而不影响后端服务
   - Gemini支持专家调试AI服务时后端保持稳定

3. **资源使用优化**：
   - 避免不必要的TypeScript编译
   - 减少进程重启开销
   - 日志记录更精准，便于问题定位

### Agent角色分工对应

| Agent角色 | 主要工作文件 | 触发的Hook | 服务影响 |
|-----------|-------------|------------|----------|
| 业务开发者 (Business Developer) | `src/services/*`, `src/index.ts` | backend-restart.sh | 后端重启 |
| 代码审查员 (Code Reviewer) | 各类源码文件 | 对应文件类型hook | 精准控制 |
| 调试器 (Debugger) | `tests/*`, 日志文件 | backend-restart.sh | 后端重启 |
| 系统架构设计师 (System Architect) | `frontend/*` | frontend-dev.sh | 无后端影响 |
| Gemini支持专家 | `src/services/ai-service.ts` | backend-restart.sh | 后端重启 |

### 实际协作场景

**场景1：前端重构进行时**
```
系统架构设计师修改 frontend/src/views/DashboardView.vue
↓
触发 frontend-dev.sh (轻量级处理)
↓  
后端服务保持运行，API接口正常
↓
其他agent调试后端功能时API连接稳定
```

**场景2：后端功能开发**
```
业务开发者修改 src/services/database.ts  
↓
触发 backend-restart.sh (完整重启)
↓
TypeScript重新编译，服务重启
↓
健康检查通过，通知其他agent服务可用
```

## 日志监控方案

### 实时监控命令
```bash
# 监控后端重启日志
tail -f logs/hook-backend-restart.log

# 监控前端开发日志  
tail -f logs/hook-frontend-dev.log

# 综合监控（推荐多agent协作时使用）
tail -f logs/hook-*.log
```

### 日志格式说明
```
[2025-09-03 20:45:32] [Backend-Restart] Backend file modified: src/services/ai-service.ts - triggering targeted restart
[2025-09-03 20:45:35] [Backend-Restart] Backend build successful
[2025-09-03 20:45:40] [Backend-Restart] Backend service restarted successfully! Health check passed.
[2025-09-03 20:45:40] [Backend-Restart] Claude agents can now safely use backend APIs.

[2025-09-03 20:46:15] [Frontend-Dev] Frontend-only file modified: frontend/src/App.vue - using lightweight processing
[2025-09-03 20:46:15] [Frontend-Dev] Frontend file processing completed - backend service unaffected
[2025-09-03 20:46:15] [Frontend-Dev] Claude agents working on backend can continue without API interruption
```

## 故障排除指南

### 常见问题

1. **Hook不执行**：
   - 检查脚本执行权限：`chmod +x .claude/hooks/*.sh`
   - 验证filePathPatterns匹配：查看hook日志

2. **后端重启失败**：
   - 查看构建日志：`logs/hook-backend-restart.log`
   - 手动验证编译：`npm run build`

3. **健康检查失败**：
   - 确认端口8080未被占用
   - 检查服务启动日志：`logs/service.log`

4. **前端Hook异常**：
   - 验证前端目录存在：`ls -la frontend/`
   - 检查文件路径模式匹配

### 手动测试Hook配置

```bash
# 测试后端Hook
echo '{"tool_name":"Edit","file_path":"src/index.ts"}' | .claude/hooks/backend-restart.sh

# 测试前端Hook  
echo '{"tool_name":"Edit","file_path":"frontend/src/App.vue"}' | .claude/hooks/frontend-dev.sh
```

## 配置升级指南

从旧配置迁移到新配置：

1. **备份现有配置**：
   ```bash
   cp .claude/settings.json .claude/settings.json.backup
   ```

2. **应用新配置**：
   - 新的`settings.json`已自动配置filePathPatterns
   - `backend-restart.sh`和`frontend-dev.sh`已就位

3. **验证配置**：
   ```bash
   # 修改测试文件验证
   touch test-backend.ts && rm test-backend.ts
   touch frontend/test-frontend.vue && rm frontend/test-frontend.vue
   ```

4. **监控日志**：
   ```bash
   tail -f logs/hook-*.log
   ```

## 最佳实践建议

1. **Agent工作分离**：
   - 前端重构期间，专注frontend/目录
   - 后端开发时，专注src/目录  
   - 避免跨域文件的频繁切换

2. **并行开发协调**：
   - 使用日志监控确认服务状态
   - 后端重启时等待健康检查完成
   - 前端开发时确保Vite dev server独立运行

3. **问题排查优先级**：
   - Hook日志 → 服务日志 → 应用日志
   - 区分是Hook问题还是应用问题
   - 利用健康检查状态判断服务可用性

这套配置确保了Claude Code多agent协作的高效性和稳定性，避免了服务重启干扰带来的开发效率损失。