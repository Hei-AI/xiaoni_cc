-- 030_expand_agent_observation_trace_id.sql
-- Phase 1 hotfix: current runtime trace_id can exceed 36 chars.

ALTER TABLE agent_observations
  MODIFY COLUMN trace_id VARCHAR(128) NULL COMMENT '关联 trace_id';
