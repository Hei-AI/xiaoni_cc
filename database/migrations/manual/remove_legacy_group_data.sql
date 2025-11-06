-- 移除不再需要的群聊数据，只保留指定群号
-- 执行前请确认已经备份数据库

USE qqbot_db;

SET @allowed_groups := '253631878,1019235326';

SET @cleanup_group_chat_activity := IF(
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'group_chat_activity') > 0,
  'DELETE FROM group_chat_activity WHERE group_id NOT IN (253631878, 1019235326)',
  'SELECT ''group_chat_activity table not found, skip cleanup'' AS info'
);
PREPARE stmt_group_chat_activity FROM @cleanup_group_chat_activity;
EXECUTE stmt_group_chat_activity;
DEALLOCATE PREPARE stmt_group_chat_activity;

SET @cleanup_group_message_history := IF(
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'group_message_history') > 0,
  'DELETE FROM group_message_history WHERE group_id NOT IN (253631878, 1019235326)',
  'SELECT ''group_message_history table not found, skip cleanup'' AS info'
);
PREPARE stmt_group_message_history FROM @cleanup_group_message_history;
EXECUTE stmt_group_message_history;
DEALLOCATE PREPARE stmt_group_message_history;

SET @cleanup_conversations := IF(
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'conversations') > 0,
  'DELETE FROM conversations WHERE JSON_EXTRACT(raw_request, ''$.group_id'') IS NOT NULL AND CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_request, ''$.group_id'')) AS UNSIGNED) NOT IN (253631878, 1019235326)',
  'SELECT ''conversations table not found, skip cleanup'' AS info'
);
PREPARE stmt_conversations FROM @cleanup_conversations;
EXECUTE stmt_conversations;
DEALLOCATE PREPARE stmt_conversations;

SET @cleanup_group_chat_stats := IF(
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'group_chat_stats') > 0,
  'DELETE FROM group_chat_stats WHERE group_id NOT IN (253631878, 1019235326)',
  'SELECT ''group_chat_stats table not found, skip cleanup'' AS info'
);
PREPARE stmt_group_chat_stats FROM @cleanup_group_chat_stats;
EXECUTE stmt_group_chat_stats;
DEALLOCATE PREPARE stmt_group_chat_stats;

SET @cleanup_group_chat_settings := IF(
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'group_chat_settings') > 0,
  'DELETE FROM group_chat_settings WHERE group_id NOT IN (253631878, 1019235326)',
  'SELECT ''group_chat_settings table not found, skip cleanup'' AS info'
);
PREPARE stmt_group_chat_settings FROM @cleanup_group_chat_settings;
EXECUTE stmt_group_chat_settings;
DEALLOCATE PREPARE stmt_group_chat_settings;

SET @has_message_queue := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'message_queue'
);
SET @cleanup_message_queue := IF(
  @has_message_queue > 0,
  'DELETE FROM message_queue WHERE partition_key LIKE ''group_%'' AND SUBSTRING_INDEX(partition_key, ''_'', -1) NOT IN (''253631878'', ''1019235326'')',
  'SELECT ''message_queue table not found, skip cleanup'' AS info'
);
PREPARE stmt_message_queue FROM @cleanup_message_queue;
EXECUTE stmt_message_queue;
DEALLOCATE PREPARE stmt_message_queue;

SET @cleanup_websocket_logs := IF(
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'websocket_logs') > 0,
  'DELETE FROM websocket_logs WHERE group_id IS NOT NULL AND group_id NOT IN (253631878, 1019235326)',
  'SELECT ''websocket_logs table not found, skip cleanup'' AS info'
);
PREPARE stmt_websocket_logs FROM @cleanup_websocket_logs;
EXECUTE stmt_websocket_logs;
DEALLOCATE PREPARE stmt_websocket_logs;
