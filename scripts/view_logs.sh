#!/bin/bash
# QQ机器人服务日志查看脚本

PROJECT_DIR="/home/liahua/IdeaProject/qq_bot"
LOG_DIR="$PROJECT_DIR/log"

echo "📋 QQ机器人服务日志查看工具"
echo "日志目录: $LOG_DIR"
echo "=" * 50

# 检查日志目录是否存在
if [ ! -d "$LOG_DIR" ]; then
    echo "❌ 日志目录不存在: $LOG_DIR"
    exit 1
fi

# 获取今天的日期
today=$(date +%Y-%m-%d)

# 显示可用日志文件
echo "📁 可用日志文件:"
ls -la "$LOG_DIR" | grep -E "\.log$" | awk '{print "   " $9 " (" $5 " bytes, " $6 " " $7 " " $8 ")"}'

echo ""

# 显示菜单
show_menu() {
    echo "🔍 请选择操作:"
    echo "1. 查看消息服务日志 (Message Service)"
    echo "2. 查看需求服务日志 (Requirement Service)"
    echo "3. 查看聊天服务日志 (Chatbot Service)"
    echo "4. 实时监控所有服务日志"
    echo "5. 查看最近错误日志"
    echo "6. 查看启动日志"
    echo "7. 清理旧日志文件"
    echo "8. 日志统计信息"
    echo "0. 退出"
    echo ""
    echo -n "请输入选项 (0-8): "
}

# 查看指定服务日志
view_service_log() {
    local service_name=$1
    local log_file="$LOG_DIR/${service_name}_${today}.log"
    
    echo "📖 查看 $service_name 日志文件: $log_file"
    echo "=" * 50
    
    if [ -f "$log_file" ]; then
        echo "最近50行日志:"
        echo "- - - - - - - - - - - - - - - - - - - - - -"
        tail -50 "$log_file"
        echo "- - - - - - - - - - - - - - - - - - - - - -"
        
        echo ""
        echo "💡 完整日志查看: tail -f $log_file"
        echo "💡 搜索错误: grep -i error $log_file"
        echo "💡 搜索警告: grep -i warning $log_file"
    else
        echo "❌ 日志文件不存在: $log_file"
        echo ""
        echo "💡 可能的原因:"
        echo "   - 服务未启动"
        echo "   - 服务刚启动，还没有生成日志"
        echo "   - 日志目录权限问题"
    fi
}

# 实时监控所有日志
monitor_all_logs() {
    echo "🔄 实时监控所有服务日志 (Ctrl+C 退出)"
    echo "=" * 50
    
    local log_files=()
    
    # 收集存在的日志文件
    for service in "message_service" "requirement_service" "chatbot_service"; do
        local log_file="$LOG_DIR/${service}_${today}.log"
        if [ -f "$log_file" ]; then
            log_files+=("$log_file")
        fi
    done
    
    if [ ${#log_files[@]} -eq 0 ]; then
        echo "❌ 没有找到今天的日志文件"
        return
    fi
    
    echo "监控文件:"
    for file in "${log_files[@]}"; do
        echo "   $(basename "$file")"
    done
    echo ""
    
    # 使用tail -f监控所有文件
    tail -f "${log_files[@]}"
}

# 查看错误日志
view_error_logs() {
    echo "🚨 查看最近错误日志"
    echo "=" * 50
    
    local found_errors=false
    
    for service in "message_service" "requirement_service" "chatbot_service"; do
        local log_file="$LOG_DIR/${service}_${today}.log"
        
        if [ -f "$log_file" ]; then
            echo "🔍 检查 $service 错误日志..."
            local errors=$(grep -i "error\|exception\|failed\|traceback" "$log_file")
            
            if [ -n "$errors" ]; then
                echo "❌ 发现错误:"
                echo "$errors" | tail -20
                found_errors=true
            else
                echo "✅ 无错误记录"
            fi
            echo ""
        fi
    done
    
    if [ "$found_errors" = false ]; then
        echo "🎉 所有服务运行正常，无错误记录！"
    fi
}

# 查看启动日志
view_startup_logs() {
    echo "🚀 查看服务启动日志"
    echo "=" * 50
    
    for service in "message_service" "requirement_service" "chatbot_service"; do
        local startup_log="$LOG_DIR/${service}_startup.log"
        
        if [ -f "$startup_log" ]; then
            echo "📋 $service 启动日志:"
            echo "- - - - - - - - - - - - - - - - -"
            cat "$startup_log"
            echo ""
        else
            echo "⚠️ $service 启动日志不存在"
        fi
    done
}

# 清理旧日志
cleanup_old_logs() {
    echo "🗑️ 清理旧日志文件"
    echo "=" * 30
    
    echo "当前日志文件统计:"
    echo "   总文件数: $(ls -1 "$LOG_DIR"/*.log 2>/dev/null | wc -l)"
    echo "   总大小: $(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)"
    echo ""
    
    echo -n "确认删除7天前的日志文件? (y/N): "
    read confirm
    
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        local deleted_count=0
        
        # 删除7天前的日志文件
        find "$LOG_DIR" -name "*.log" -mtime +7 -type f | while read file; do
            echo "   删除: $(basename "$file")"
            rm "$file"
            ((deleted_count++))
        done
        
        echo "✅ 旧日志清理完成"
        echo "清理后统计:"
        echo "   剩余文件数: $(ls -1 "$LOG_DIR"/*.log 2>/dev/null | wc -l)"
        echo "   剩余大小: $(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)"
    else
        echo "❌ 取消清理操作"
    fi
}

# 日志统计信息
show_log_stats() {
    echo "📊 日志统计信息"
    echo "=" * 30
    
    echo "📁 目录信息:"
    echo "   日志目录: $LOG_DIR"
    echo "   总文件数: $(ls -1 "$LOG_DIR"/*.log 2>/dev/null | wc -l)"
    echo "   目录大小: $(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)"
    echo ""
    
    echo "📋 今日日志文件:"
    for service in "message_service" "requirement_service" "chatbot_service"; do
        local log_file="$LOG_DIR/${service}_${today}.log"
        
        if [ -f "$log_file" ]; then
            local size=$(stat -c%s "$log_file" 2>/dev/null)
            local lines=$(wc -l < "$log_file" 2>/dev/null)
            local modified=$(stat -c%y "$log_file" 2>/dev/null | cut -d. -f1)
            
            echo "   $service:"
            echo "     文件大小: ${size} bytes"
            echo "     行数: ${lines}"
            echo "     最后修改: $modified"
        else
            echo "   $service: 无日志文件"
        fi
    done
    
    echo ""
    echo "🔍 错误统计 (今日):"
    for service in "message_service" "requirement_service" "chatbot_service"; do
        local log_file="$LOG_DIR/${service}_${today}.log"
        
        if [ -f "$log_file" ]; then
            local error_count=$(grep -c -i "error" "$log_file" 2>/dev/null || echo "0")
            local warning_count=$(grep -c -i "warning" "$log_file" 2>/dev/null || echo "0")
            
            echo "   $service: ${error_count}错误, ${warning_count}警告"
        fi
    done
}

# 主循环
while true; do
    show_menu
    read choice
    
    case $choice in
        1)
            clear
            view_service_log "message_service"
            echo ""
            echo "按回车键继续..."
            read
            clear
            ;;
        2)
            clear
            view_service_log "requirement_service"
            echo ""
            echo "按回车键继续..."
            read
            clear
            ;;
        3)
            clear
            view_service_log "chatbot_service"
            echo ""
            echo "按回车键继续..."
            read
            clear
            ;;
        4)
            clear
            monitor_all_logs
            clear
            ;;
        5)
            clear
            view_error_logs
            echo ""
            echo "按回车键继续..."
            read
            clear
            ;;
        6)
            clear
            view_startup_logs
            echo ""
            echo "按回车键继续..."
            read
            clear
            ;;
        7)
            clear
            cleanup_old_logs
            echo ""
            echo "按回车键继续..."
            read
            clear
            ;;
        8)
            clear
            show_log_stats
            echo ""
            echo "按回车键继续..."
            read
            clear
            ;;
        0)
            echo "👋 退出日志查看工具"
            exit 0
            ;;
        *)
            echo "❌ 无效选项，请重新选择"
            sleep 2
            clear
            ;;
    esac
done