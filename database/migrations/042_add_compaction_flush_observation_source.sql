-- 042_add_compaction_flush_observation_source.sql
-- Phase 2/3: allow silent flush journaling before context compaction.

ALTER TABLE agent_observations
  MODIFY COLUMN source_type ENUM(
    'incoming_message',
    'outgoing_message',
    'reply_anchor',
    'tool_result',
    'compaction_flush',
    'tick'
  ) NOT NULL;
