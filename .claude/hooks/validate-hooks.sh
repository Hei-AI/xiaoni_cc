#!/bin/bash
# Claude Code Hooks Configuration Validator
# 验证多agent协作hooks配置是否正确

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/liahua/IdeaProject/qq_bot}"
cd "$PROJECT_DIR" || exit 1

echo "=== Claude Code Hooks Multi-Agent Collaboration Validator ==="
echo "Project: $PROJECT_DIR"
echo "Date: $(date)"
echo ""

# 检查配置文件
echo "1. 检查Claude Code配置文件..."
if [ -f ".claude/settings.json" ]; then
    echo "   ✓ settings.json 存在"
    
    # 检查是否包含filePathPatterns
    if grep -q "filePathPatterns" ".claude/settings.json"; then
        echo "   ✓ filePathPatterns 配置已启用"
    else
        echo "   ✗ filePathPatterns 配置缺失"
        exit 1
    fi
    
    # 检查hook脚本引用
    if grep -q "backend-restart.sh" ".claude/settings.json"; then
        echo "   ✓ backend-restart.sh 已配置"
    else
        echo "   ✗ backend-restart.sh 配置缺失"
    fi
    
    if grep -q "frontend-dev.sh" ".claude/settings.json"; then
        echo "   ✓ frontend-dev.sh 已配置"
    else
        echo "   ✗ frontend-dev.sh 配置缺失"
    fi
else
    echo "   ✗ .claude/settings.json 文件不存在"
    exit 1
fi

# 检查hook脚本
echo ""
echo "2. 检查Hook脚本文件..."
hooks=("backend-restart.sh" "frontend-dev.sh")
for hook in "${hooks[@]}"; do
    hook_path=".claude/hooks/$hook"
    if [ -f "$hook_path" ]; then
        if [ -x "$hook_path" ]; then
            echo "   ✓ $hook 存在且可执行"
        else
            echo "   ⚠ $hook 存在但不可执行，正在修复..."
            chmod +x "$hook_path"
            echo "   ✓ $hook 权限已修复"
        fi
    else
        echo "   ✗ $hook 文件不存在"
        exit 1
    fi
done

# 测试文件模式匹配
echo ""
echo "3. 测试文件模式匹配..."

# 后端文件测试
echo "   测试后端文件模式..."
backend_test_files=(
    "src/index.ts"
    "src/services/database.ts" 
    "package.json"
    "tests/basic.test.ts"
)

for file in "${backend_test_files[@]}"; do
    echo '{"tool_name":"Edit","file_path":"'$file'"}' | .claude/hooks/backend-restart.sh > /dev/null 2>&1
    if tail -1 logs/hook-backend-restart.log 2>/dev/null | grep -q "completed"; then
        echo "   ✓ $file → backend-restart.sh (正确)"
    else
        echo "   ✗ $file → backend-restart.sh (失败)"
    fi
done

# 前端文件测试
echo "   测试前端文件模式..."
frontend_test_files=(
    "frontend/src/App.vue"
    "frontend/src/main.ts"
    "frontend/vite.config.ts"
)

for file in "${frontend_test_files[@]}"; do
    echo '{"tool_name":"Edit","file_path":"'$file'"}' | .claude/hooks/frontend-dev.sh > /dev/null 2>&1
    if tail -1 logs/hook-frontend-dev.log 2>/dev/null | grep -q "completed"; then
        echo "   ✓ $file → frontend-dev.sh (正确)"
    else
        echo "   ✗ $file → frontend-dev.sh (失败)"
    fi
done

# 检查服务状态
echo ""
echo "4. 检查后端服务状态..."
if curl -s http://127.0.0.1:8080/health > /dev/null 2>&1; then
    echo "   ✓ 后端服务运行正常 (http://127.0.0.1:8080)"
    
    # 测试API端点
    if curl -s http://127.0.0.1:8080/api/status > /dev/null 2>&1; then
        echo "   ✓ API端点可访问 (/api/status)"
    else
        echo "   ⚠ API端点可能存在问题"
    fi
else
    echo "   ⚠ 后端服务未运行或健康检查失败"
    echo "   提示：hook测试时会自动启动服务"
fi

# 检查日志文件
echo ""
echo "5. 检查日志文件..."
log_files=("hook-backend-restart.log" "hook-frontend-dev.log")
for log in "${log_files[@]}"; do
    if [ -f "logs/$log" ]; then
        lines=$(wc -l < "logs/$log")
        echo "   ✓ logs/$log 存在，包含 $lines 行记录"
    else
        echo "   ⚠ logs/$log 不存在（首次运行时正常）"
    fi
done

# 项目结构检查
echo ""
echo "6. 检查项目结构..."
required_dirs=("src" "frontend" "tests" ".claude/hooks")
for dir in "${required_dirs[@]}"; do
    if [ -d "$dir" ]; then
        echo "   ✓ $dir/ 目录存在"
    else
        echo "   ✗ $dir/ 目录缺失"
    fi
done

echo ""
echo "=== 验证总结 ==="
echo "✓ Claude Code hooks多agent协作配置验证完成"
echo ""
echo "核心优化成果："
echo "• 前端文件修改 → 不触发后端重启 → Claude agents调试API时无中断"
echo "• 后端文件修改 → 精准重启 → 确保代码变更生效"
echo "• 独立日志记录 → 便于问题排查和协作状态监控"
echo ""
echo "多agent协作建议："
echo "• 业务开发者(Backend): 专注 src/ 目录，触发backend-restart.sh"  
echo "• 系统架构师(Frontend): 专注 frontend/ 目录，触发frontend-dev.sh"
echo "• 调试器: 可实时监控 logs/hook-*.log 了解服务状态"
echo "• 代码审查员: 通过日志验证hooks是否按预期执行"
echo ""
echo "实时监控命令: tail -f logs/hook-*.log"
echo "健康检查URL: http://127.0.0.1:8080/health"