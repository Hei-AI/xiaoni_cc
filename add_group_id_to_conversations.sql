-- Database migration script: Add group_id column to conversations table
-- This is required for the traceability fix to support group message recording

USE qqbot_db;

-- Check if the column already exists
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'qqbot_db' 
  AND TABLE_NAME = 'conversations' 
  AND COLUMN_NAME = 'group_id';

-- Add group_id column if it doesn't exist
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS group_id INT(11) NULL 
COMMENT 'Group ID for group chat messages, NULL for private messages';

-- Add index for better query performance on group_id
ALTER TABLE conversations 
ADD INDEX IF NOT EXISTS idx_group_id (group_id);

-- Add composite index for group_id + user_id for better group chat analysis performance
ALTER TABLE conversations 
ADD INDEX IF NOT EXISTS idx_group_user (group_id, user_id);

-- Add index for status field to support filtering by message status
ALTER TABLE conversations 
ADD INDEX IF NOT EXISTS idx_status (status);

-- Add composite index for trace_id analysis
ALTER TABLE conversations 
ADD INDEX IF NOT EXISTS idx_trace_status (trace_id, status);

-- Display table structure after migration
DESCRIBE conversations;

-- Verify the migration
SELECT 
  COUNT(*) as total_conversations,
  COUNT(group_id) as group_conversations,
  COUNT(*) - COUNT(group_id) as private_conversations,
  COUNT(DISTINCT status) as distinct_statuses
FROM conversations;

-- Show distinct status values to verify new statuses are supported
SELECT status, COUNT(*) as count 
FROM conversations 
GROUP BY status 
ORDER BY count DESC;

SELECT 'Migration completed successfully. group_id column added to conversations table.' as result;