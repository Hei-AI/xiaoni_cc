#!/bin/bash
# Claude Code Hooks Configuration Validator
# 验证hooks配置是否符合官方最佳实践

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/liahua/IdeaProject/qq_bot}"
SETTINGS_FILE="$PROJECT_DIR/.claude/settings.json"
LOG_FILE="$PROJECT_DIR/logs/hook-validation.log"

mkdir -p "$(dirname "$LOG_FILE")"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Validation] $1" | tee -a "$LOG_FILE"
}

validate_settings_file() {
    log_message "Validating Claude Code settings file..."
    
    if [ ! -f "$SETTINGS_FILE" ]; then
        log_message "❌ Settings file not found: $SETTINGS_FILE"
        return 1
    fi
    
    # 检查JSON格式
    if ! jq empty "$SETTINGS_FILE" 2>/dev/null; then
        log_message "❌ Invalid JSON format in settings file"
        return 1
    fi
    
    log_message "✅ Settings file format is valid"
    return 0
}

validate_hook_structure() {
    log_message "Validating hooks structure..."
    
    # 检查PostToolUse hooks存在
    if ! jq -e '.hooks.PostToolUse' "$SETTINGS_FILE" >/dev/null 2>&1; then
        log_message "❌ PostToolUse hooks not found"
        return 1
    fi
    
    # 检查是否有backend和frontend hooks
    BACKEND_HOOKS=$(jq '.hooks.PostToolUse[] | select(.filePathPatterns[] | test("src/.*\\.ts"))' "$SETTINGS_FILE" | wc -l)
    FRONTEND_HOOKS=$(jq '.hooks.PostToolUse[] | select(.filePathPatterns[] | test("frontend/.*"))' "$SETTINGS_FILE" | wc -l)
    
    if [ "$BACKEND_HOOKS" -eq 0 ]; then
        log_message "❌ No backend hooks configured"
        return 1
    fi
    
    if [ "$FRONTEND_HOOKS" -eq 0 ]; then
        log_message "⚠️  No frontend hooks configured"
    fi
    
    log_message "✅ Hooks structure is valid (Backend: $BACKEND_HOOKS, Frontend: $FRONTEND_HOOKS)"
    return 0
}

validate_hook_scripts() {
    log_message "Validating hook scripts..."
    
    # 获取所有hook脚本路径
    HOOK_SCRIPTS=$(jq -r '.hooks.PostToolUse[].hooks[].command' "$SETTINGS_FILE" | sed "s|\$CLAUDE_PROJECT_DIR|$PROJECT_DIR|g")
    
    for script in $HOOK_SCRIPTS; do
        if [ ! -f "$script" ]; then
            log_message "❌ Hook script not found: $script"
            return 1
        fi
        
        if [ ! -x "$script" ]; then
            log_message "❌ Hook script not executable: $script"
            return 1
        fi
        
        log_message "✅ Hook script valid: $(basename "$script")"
    done
    
    return 0
}

test_hook_execution() {
    log_message "Testing hook execution..."
    
    # 测试后端hook（模拟）
    BACKEND_SCRIPT="$PROJECT_DIR/.claude/hooks/backend-restart.sh"
    if [ -x "$BACKEND_SCRIPT" ]; then
        log_message "Testing backend hook script..."
        # 只测试脚本语法，不实际执行
        bash -n "$BACKEND_SCRIPT" && log_message "✅ Backend hook syntax valid" || {
            log_message "❌ Backend hook syntax error"
            return 1
        }
    fi
    
    # 测试前端hook（模拟）
    FRONTEND_SCRIPT="$PROJECT_DIR/.claude/hooks/frontend-dev.sh"
    if [ -x "$FRONTEND_SCRIPT" ]; then
        log_message "Testing frontend hook script..."
        bash -n "$FRONTEND_SCRIPT" && log_message "✅ Frontend hook syntax valid" || {
            log_message "❌ Frontend hook syntax error"
            return 1
        }
    fi
    
    return 0
}

check_best_practices() {
    log_message "Checking Claude Code best practices..."
    
    # 检查是否使用$CLAUDE_PROJECT_DIR
    NON_RELATIVE_PATHS=$(jq -r '.hooks.PostToolUse[].hooks[].command' "$SETTINGS_FILE" | grep -v "\$CLAUDE_PROJECT_DIR" || true)
    if [ -n "$NON_RELATIVE_PATHS" ]; then
        log_message "⚠️  Found hardcoded paths (consider using \$CLAUDE_PROJECT_DIR):"
        echo "$NON_RELATIVE_PATHS" | while read -r path; do
            log_message "   $path"
        done
    else
        log_message "✅ All hook commands use relative paths"
    fi
    
    # 检查filePathPatterns是否合理
    if jq -e '.hooks.PostToolUse[].filePathPatterns[] | select(. == "dist/**/*")' "$SETTINGS_FILE" >/dev/null 2>&1; then
        log_message "⚠️  Found dist/**/* in filePathPatterns (build output shouldn't trigger hooks)"
    else
        log_message "✅ No build output patterns in filePathPatterns"
    fi
    
    return 0
}

main() {
    log_message "=========================================="
    log_message "Starting Claude Code Hooks Validation"
    log_message "=========================================="
    
    local exit_code=0
    
    validate_settings_file || exit_code=1
    validate_hook_structure || exit_code=1
    validate_hook_scripts || exit_code=1
    test_hook_execution || exit_code=1
    check_best_practices || exit_code=1
    
    log_message "=========================================="
    if [ $exit_code -eq 0 ]; then
        log_message "🎉 All validations passed! Hooks configuration is optimal."
        log_message "Your Claude Code multi-agent collaboration setup is ready."
    else
        log_message "❌ Some validations failed. Please review the issues above."
    fi
    log_message "=========================================="
    
    return $exit_code
}

main "$@"