#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
MYSQL_USER="${MYSQL_USER:-qqbot_user}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-qqbot_password}"
MYSQL_DATABASE="${MYSQL_DATABASE:-qqbot_db}"
DEMO_USER_ID="${DEMO_USER_ID:-990001}"
DEMO_GROUP_ID="${DEMO_GROUP_ID:-990002}"

docker compose exec -T "$MYSQL_SERVICE" mysql --default-character-set=utf8mb4 -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" <<SQL
SET @demo_user = ${DEMO_USER_ID};
SET @demo_group = ${DEMO_GROUP_ID};

DELETE FROM agent_walk_candidates
WHERE target_user_id = @demo_user
   OR target_group_id = @demo_group;
DELETE FROM agent_action_logs WHERE target_user_id = @demo_user OR target_group_id = @demo_group;
DELETE FROM agent_plans WHERE target_user_id = @demo_user OR target_group_id = @demo_group OR JSON_EXTRACT(plan_metadata_json, '$.demo_seed') IS NOT NULL;
DELETE FROM agent_relationship_memories WHERE target_user_id = @demo_user;
DELETE FROM agent_memories WHERE user_id = @demo_user OR CAST(subject_id AS UNSIGNED) = @demo_user;
DELETE FROM agent_beliefs WHERE CAST(subject_id AS UNSIGNED) = @demo_user;
DELETE FROM agent_observations WHERE user_id = @demo_user OR group_id = @demo_group OR subject_user_id = @demo_user;
UPDATE agent_social_fields
SET status = 'archived', updated_at = CURRENT_TIMESTAMP(3)
WHERE user_id = @demo_user OR group_id = @demo_group;
SQL

echo "Cleared virtual walk demo rows for user ${DEMO_USER_ID} and group ${DEMO_GROUP_ID}."
