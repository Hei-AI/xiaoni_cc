#!/bin/bash
# LLM 工具系统数据库迁移脚本
# 用途：执行 010_create_llm_tool_system_tables.sql 迁移

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION_FILE="$PROJECT_ROOT/database/migrations/010_create_llm_tool_system_tables.sql"

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}[LLM Tools Migration]${NC} Starting database migration..."

# 检查迁移文件是否存在
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}[ERROR]${NC} Migration file not found: $MIGRATION_FILE"
    exit 1
fi

# 检查 Docker 是否运行
if ! docker ps >/dev/null 2>&1; then
    echo -e "${RED}[ERROR]${NC} Docker is not running. Please start Docker first."
    echo -e "${YELLOW}[HINT]${NC} Run: sudo service docker start"
    exit 1
fi

# 检查 MySQL 容器是否运行
if ! docker ps --filter "name=qqbot-mysql" --format "{{.Names}}" | grep -q "qqbot-mysql"; then
    echo -e "${RED}[ERROR]${NC} MySQL container (qqbot-mysql) is not running."
    echo -e "${YELLOW}[HINT]${NC} Start it with: docker compose up -d mysql"
    exit 1
fi

echo -e "${GREEN}[INFO]${NC} Executing migration: 010_create_llm_tool_system_tables.sql"

# 执行迁移
docker exec -i qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db < "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} Migration completed successfully!"

    # 验证表是否创建
    echo -e "${GREEN}[INFO]${NC} Verifying table creation..."
    docker exec qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "
        SELECT
            'llm_jobs' as table_name, COUNT(*) as column_count
        FROM information_schema.COLUMNS
        WHERE table_schema = 'qqbot_db' AND table_name = 'llm_jobs'
        UNION ALL
        SELECT
            'llm_tools' as table_name, COUNT(*) as column_count
        FROM information_schema.COLUMNS
        WHERE table_schema = 'qqbot_db' AND table_name = 'llm_tools'
        UNION ALL
        SELECT
            'tool_execution_logs' as table_name, COUNT(*) as column_count
        FROM information_schema.COLUMNS
        WHERE table_schema = 'qqbot_db' AND table_name = 'tool_execution_logs';
    "

    echo -e "${GREEN}[SUCCESS]${NC} All tables created successfully!"
else
    echo -e "${RED}[ERROR]${NC} Migration failed!"
    exit 1
fi
