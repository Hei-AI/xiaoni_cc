#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
MYSQL_USER="${MYSQL_USER:-qqbot_user}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-qqbot_password}"
MYSQL_DATABASE="${MYSQL_DATABASE:-qqbot_db}"
QQBOT_CORE_BASE_URL="${QQBOT_CORE_BASE_URL:-http://127.0.0.1:8081}"
DEMO_USER_ID="${DEMO_USER_ID:-990001}"
DEMO_GROUP_ID="${DEMO_GROUP_ID:-990002}"

"$ROOT_DIR/scripts/demo/clear_virtual_walk_demo.sh"

docker compose exec -T "$MYSQL_SERVICE" mysql --default-character-set=utf8mb4 -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" <<SQL
SET @now = NOW(3);
SET @self_id = 1129974489;
SET @demo_user = ${DEMO_USER_ID};
SET @demo_group = ${DEMO_GROUP_ID};

INSERT INTO agent_observations (
  source_type, field_scope, message_type, user_id, group_id, subject_user_id, content, occurred_at
) VALUES
  ('incoming_message', 'private_chat', 'private', @demo_user, NULL, @demo_user, '我这周准备把作品集补完，想找个时间再聊聊。', DATE_SUB(@now, INTERVAL 18 HOUR)),
  ('incoming_message', 'private_chat', 'private', @demo_user, NULL, @demo_user, '这两天有点忙，不过周末应该能推进。', DATE_SUB(@now, INTERVAL 6 HOUR)),
  ('incoming_message', 'group_chat', 'group', @demo_user, @demo_group, @demo_user, '这个话题我今晚回去整理一下。', DATE_SUB(@now, INTERVAL 5 HOUR));

INSERT INTO agent_beliefs (
  subject_type, subject_id, belief_type, belief_key, claim, normalized_claim, polarity, confidence, status, observation_count, first_observed_at, last_observed_at
) VALUES
  ('user', CAST(@demo_user AS CHAR), 'relationship', CONCAT('relationship:', @demo_user), '用户愿意在自然窗口里继续交流，适合低打扰跟进。', '用户愿意在自然窗口里继续交流，适合低打扰跟进。', 'positive', 0.82, 'active', 2, DATE_SUB(@now, INTERVAL 18 HOUR), DATE_SUB(@now, INTERVAL 6 HOUR)),
  ('user', CAST(@demo_user AS CHAR), 'commitment', CONCAT('commitment:', @demo_user, ':portfolio'), '用户这周准备补完作品集。', '用户这周准备补完作品集。', 'neutral', 0.78, 'active', 2, DATE_SUB(@now, INTERVAL 18 HOUR), DATE_SUB(@now, INTERVAL 6 HOUR));

INSERT INTO agent_memories (
  memory_scope, memory_type, subject_type, subject_id, field_scope, user_id, group_id, title, content, normalized_content, confidence, salience, status, source_kind, last_observed_at
) VALUES
  ('person_global', 'relationship', 'user', CAST(@demo_user AS CHAR), 'private_chat', @demo_user, NULL, 'relationship', '用户对低打扰的近况跟进是开放的。', '用户对低打扰的近况跟进是开放的。', 0.84, 0.86, 'active', 'daily_reflection', DATE_SUB(@now, INTERVAL 6 HOUR)),
  ('person_global', 'commitment', 'user', CAST(@demo_user AS CHAR), 'private_chat', @demo_user, NULL, 'commitment', '用户这周准备补完作品集。', '用户这周准备补完作品集。', 0.79, 0.83, 'active', 'daily_reflection', DATE_SUB(@now, INTERVAL 6 HOUR));

INSERT INTO agent_relationship_memories (
  target_user_id, field_scope, group_id, relationship_summary, interaction_style, boundary_notes, confidence, status, source_reflection_id, last_observed_at, is_current, boundary_strategy, notes_json
) VALUES
  (@demo_user, 'private_chat', NULL, '当前关系允许在自然窗口中做低打扰近况跟进。', '保持自然、简洁、低打扰的私聊节奏，只在明确窗口里谨慎主动。', 'demo seed: 允许主动', 0.84, 'active', NULL, DATE_SUB(@now, INTERVAL 6 HOUR), 1, 'allow_proactive', JSON_OBJECT('manual_override', TRUE, 'demo_seed', TRUE)),
  (@demo_user, 'group_chat', @demo_group, '群里已有自然互动，可先看场域再决定是否发言。', '优先顺着群内上下文自然接话，避免在群里突然转成高频点名推进。', 'demo seed: 群里先看场域', 0.72, 'active', NULL, DATE_SUB(@now, INTERVAL 5 HOUR), 1, 'observe_only', JSON_OBJECT('manual_override', TRUE, 'demo_seed', TRUE));

INSERT INTO agent_plans (
  plan_type, target_field_scope, target_user_id, target_group_id, goal, trigger_condition, status, scheduled_start_at, source_reflection_id, plan_metadata_json
) VALUES
  ('weekly_focus', NULL, NULL, NULL, '本周优先围绕 demo 用户的作品集进展维持低打扰跟进。', 'demo weekly focus', 'queued', @now, NULL, JSON_OBJECT('demo_seed', TRUE, 'story', 'weekly_focus')),
  ('day_plan', NULL, NULL, NULL, '今天先判断 demo 用户和 demo 群哪个场域更值得看。', 'demo day plan', 'queued', @now, NULL, JSON_OBJECT('demo_seed', TRUE, 'story', 'why_today_this_field'));
SQL

curl -fsS -X POST "$QQBOT_CORE_BASE_URL/api/internal/cognition/recompute" \
  -H 'Content-Type: application/json' \
  -d "{\"subject_type\":\"user\",\"subject_id\":${DEMO_USER_ID},\"group_id\":null}" >/dev/null

echo "Seeded virtual walk demo for user ${DEMO_USER_ID} and group ${DEMO_GROUP_ID}."
