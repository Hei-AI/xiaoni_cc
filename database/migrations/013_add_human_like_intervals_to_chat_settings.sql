-- 为群聊与私聊设置引入拟人化调度的细粒度配置
-- Migration: 013_add_human_like_intervals_to_chat_settings
-- Date: 2025-02-15

USE qqbot_db;

ALTER TABLE group_chat_settings
  ADD COLUMN human_like_scan_interval_ms INT NULL COMMENT '拟人化扫描间隔，毫秒' AFTER auto_reply_enabled,
  ADD COLUMN human_like_min_interval_ms INT NULL COMMENT '拟人化最小间隔，毫秒' AFTER human_like_scan_interval_ms,
  ADD COLUMN human_like_max_interval_ms INT NULL COMMENT '拟人化最大发电间隔，毫秒' AFTER human_like_min_interval_ms;

ALTER TABLE private_chat_settings
  ADD COLUMN human_like_scan_interval_ms INT NULL COMMENT '拟人化扫描间隔，毫秒' AFTER auto_reply_enabled,
  ADD COLUMN human_like_min_interval_ms INT NULL COMMENT '拟人化最小间隔，毫秒' AFTER human_like_scan_interval_ms,
  ADD COLUMN human_like_max_interval_ms INT NULL COMMENT '拟人化最大发电间隔，毫秒' AFTER human_like_min_interval_ms;
