-- 删除未使用的群聊/私聊历史统计资产
-- Migration: 025_drop_unused_chat_stats_assets
-- Date: 2026-03-21

USE qqbot_db;

DROP VIEW IF EXISTS group_chat_overview;
DROP VIEW IF EXISTS private_chat_overview;
DROP VIEW IF EXISTS bot_control_overview;

DROP TRIGGER IF EXISTS group_settings_update_trigger;
DROP TRIGGER IF EXISTS private_chat_settings_update_trigger;

DROP PROCEDURE IF EXISTS UpdateGroupActivity;
DROP PROCEDURE IF EXISTS CleanupGroupChatData;
DROP PROCEDURE IF EXISTS UpdatePrivateChatActivity;
DROP PROCEDURE IF EXISTS BatchUpdateChatSettings;
DROP PROCEDURE IF EXISTS CleanupChatControlData;

DROP TABLE IF EXISTS group_chat_activity;
DROP TABLE IF EXISTS group_chat_stats;
DROP TABLE IF EXISTS private_chat_activity;
DROP TABLE IF EXISTS private_chat_stats;
