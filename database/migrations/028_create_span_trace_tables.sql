-- Span-first trace schema bootstrap

CREATE TABLE IF NOT EXISTS traces (
  trace_id VARCHAR(64) PRIMARY KEY,
  root_span_id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unset',
  started_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  duration_ms INT NULL,
  span_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_traces_conversation (conversation_id),
  INDEX idx_traces_status (status),
  INDEX idx_traces_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS spans (
  span_id VARCHAR(64) PRIMARY KEY,
  trace_id VARCHAR(64) NOT NULL,
  parent_span_id VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  kind ENUM('internal', 'client', 'server', 'producer', 'consumer') NOT NULL DEFAULT 'internal',
  status_code ENUM('unset', 'ok', 'error') NOT NULL DEFAULT 'unset',
  status_message TEXT NULL,
  service_name VARCHAR(128) NULL,
  operation_name VARCHAR(255) NULL,
  conversation_id VARCHAR(64) NULL,
  depth INT NOT NULL DEFAULT 0,
  sort_key VARCHAR(255) NOT NULL DEFAULT '',
  started_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  duration_ms INT NULL,
  input_payload JSON NULL,
  output_payload JSON NULL,
  evidence_payload JSON NULL,
  summary TEXT NULL,
  confidence ENUM('observed', 'derived', 'missing') NOT NULL DEFAULT 'observed',
  source_ref VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_spans_trace FOREIGN KEY (trace_id) REFERENCES traces(trace_id) ON DELETE CASCADE,
  INDEX idx_spans_trace_parent (trace_id, parent_span_id),
  INDEX idx_spans_trace_sort (trace_id, sort_key),
  INDEX idx_spans_kind_status (kind, status_code),
  INDEX idx_spans_started_at (started_at),
  INDEX idx_spans_conversation (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS span_attributes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  span_id VARCHAR(64) NOT NULL,
  attr_key VARCHAR(255) NOT NULL,
  attr_type ENUM('string', 'number', 'boolean', 'json') NOT NULL DEFAULT 'string',
  string_value TEXT NULL,
  number_value DOUBLE NULL,
  bool_value BOOLEAN NULL,
  json_value JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_span_attributes_span FOREIGN KEY (span_id) REFERENCES spans(span_id) ON DELETE CASCADE,
  INDEX idx_span_attributes_span (span_id),
  INDEX idx_span_attributes_key (attr_key),
  INDEX idx_span_attributes_span_key (span_id, attr_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS span_events (
  event_id VARCHAR(64) PRIMARY KEY,
  span_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  event_time DATETIME(3) NULL,
  attributes_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_span_events_span FOREIGN KEY (span_id) REFERENCES spans(span_id) ON DELETE CASCADE,
  INDEX idx_span_events_span (span_id),
  INDEX idx_span_events_time (event_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS span_links (
  link_id VARCHAR(64) PRIMARY KEY,
  span_id VARCHAR(64) NOT NULL,
  linked_trace_id VARCHAR(64) NULL,
  linked_span_id VARCHAR(64) NULL,
  attributes_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_span_links_span FOREIGN KEY (span_id) REFERENCES spans(span_id) ON DELETE CASCADE,
  INDEX idx_span_links_span (span_id),
  INDEX idx_span_links_target (linked_trace_id, linked_span_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trace_attributes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  trace_id VARCHAR(64) NOT NULL,
  attr_key VARCHAR(255) NOT NULL,
  attr_type ENUM('string', 'number', 'boolean', 'json') NOT NULL DEFAULT 'string',
  string_value TEXT NULL,
  number_value DOUBLE NULL,
  bool_value BOOLEAN NULL,
  json_value JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_trace_attributes_trace FOREIGN KEY (trace_id) REFERENCES traces(trace_id) ON DELETE CASCADE,
  INDEX idx_trace_attributes_trace (trace_id),
  INDEX idx_trace_attributes_key (attr_key),
  INDEX idx_trace_attributes_trace_key (trace_id, attr_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
