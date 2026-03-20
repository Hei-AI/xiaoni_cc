-- Compatibility entrypoint for trace logging schema bootstrap.
-- Run from the repository root:
--   mysql -u <user> -p <db> < database/create_logging_tables.sql
--
-- The canonical schema now lives in database/schema/trace_logging_tables.sql.
SOURCE database/schema/trace_logging_tables.sql;
