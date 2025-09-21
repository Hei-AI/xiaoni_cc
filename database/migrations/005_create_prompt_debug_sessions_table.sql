-- 创建Prompt调试会话存储表
-- 用于存储调试历史记录，支持恢复对话

CREATE TABLE IF NOT EXISTS prompt_debug_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prompt_id VARCHAR(100) NOT NULL,
  session_name VARCHAR(255) NOT NULL,
  messages JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by VARCHAR(100) DEFAULT 'admin',

  INDEX idx_prompt_id (prompt_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 添加注释
ALTER TABLE prompt_debug_sessions
COMMENT = 'Prompt调试会话存储表 - 保存调试历史用于恢复对话';

-- 示例数据 (可选)
INSERT INTO prompt_debug_sessions (prompt_id, session_name, messages, created_by) VALUES
('prompt_1757840390268_2a255cfd8', '用户问候测试', '[{"id":"1","role":"user","content":"你好","timestamp":"2025-09-21T10:00:00.000Z"},{"id":"2","role":"assistant","content":"你好！很高兴和你对话，有什么我可以帮助你的吗？","timestamp":"2025-09-21T10:00:02.000Z","metadata":{"model":"gemini-2.5-flash","tokensUsed":50}}]', 'admin'),
('prompt_1757840390268_2a255cfd8', '复杂问题讨论', '[{"id":"1","role":"user","content":"解释一下量子计算的基本原理","timestamp":"2025-09-21T10:05:00.000Z"},{"id":"2","role":"assistant","content":"量子计算是一种利用量子力学现象进行计算的方法...","timestamp":"2025-09-21T10:05:05.000Z","thought":"这是一个关于量子计算的问题，需要清晰地解释基本概念","metadata":{"model":"gemini-2.5-flash","tokensUsed":320}}]', 'admin');