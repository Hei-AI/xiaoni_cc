/* eslint-disable no-console */
/**
 * 创建链路追踪相关的数据库表
 * 使用现有的数据库服务来执行SQL
 */

import { DatabaseManager } from '../services/database';
import { config } from '../config';

// 数据库表创建SQL语句
const CREATE_TABLES_SQL = [
  // 1. WebSocket通信日志表
  `CREATE TABLE IF NOT EXISTS websocket_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '日志ID',
    
    -- 追踪信息
    trace_id VARCHAR(64) NULL COMMENT 'TraceID，用于链路追踪',
    session_id VARCHAR(36) NULL COMMENT '会话ID',
    
    -- 消息基本信息
    direction ENUM('IN', 'OUT') NOT NULL COMMENT '消息方向：IN接收，OUT发送',
    message_type VARCHAR(50) NOT NULL COMMENT '消息类型：private_message, group_message等',
    event_priority ENUM('HIGH', 'MEDIUM', 'LOW', 'IGNORE') DEFAULT 'MEDIUM' COMMENT '事件优先级',
    
    -- 消息内容（JSON格式）
    raw_payload JSON NOT NULL COMMENT '原始JSON数据',
    processed_payload JSON NULL COMMENT '处理后的数据结构',
    
    -- QQ相关信息
    user_id BIGINT NULL COMMENT 'QQ用户ID',
    group_id BIGINT NULL COMMENT '群ID（群聊时存在）',
    message_id BIGINT NULL COMMENT 'QQ消息ID',
    
    -- 处理信息
    processing_time_ms INT NULL COMMENT '处理耗时（毫秒）',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间戳',
    status ENUM('SUCCESS', 'ERROR', 'TIMEOUT', 'IGNORED') DEFAULT 'SUCCESS' COMMENT '处理状态',
    error_message TEXT NULL COMMENT '错误信息',
    
    -- 额外元数据
    metadata JSON NULL COMMENT '额外的元数据信息',
    
    -- 索引
    INDEX idx_trace_id (trace_id),
    INDEX idx_session_id (session_id),
    INDEX idx_user_id (user_id),
    INDEX idx_group_id (group_id),
    INDEX idx_message_type (message_type),
    INDEX idx_timestamp (timestamp),
    INDEX idx_direction_status (direction, status),
    INDEX idx_event_priority (event_priority)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
  COMMENT='WebSocket通信日志表'`,

  // 2. LLM调用记录表
  `CREATE TABLE IF NOT EXISTS llm_call_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '日志ID',
    
    -- 追踪信息
    trace_id VARCHAR(64) NOT NULL COMMENT 'TraceID，关联WebSocket日志',
    session_id VARCHAR(36) NULL COMMENT '会话ID',
    call_sequence INT DEFAULT 1 COMMENT '同一TraceID下的调用序号',
    
    -- 调用基本信息
    agent_type VARCHAR(50) NOT NULL COMMENT 'AI代理类型：chat_bot, intent_analyzer等',
    model_name VARCHAR(100) NOT NULL COMMENT '使用的模型名称',
    model_provider VARCHAR(50) DEFAULT 'google-gemini-cli' COMMENT '模型提供商',
    
    -- 输入信息
    prompt_template TEXT NULL COMMENT 'Prompt模板名称或描述',
    canonical_request JSON NOT NULL COMMENT '统一规范的请求体快照',
    wire_request JSON NOT NULL COMMENT '实际发送给 provider 的请求体快照',
    request_format_version VARCHAR(32) NOT NULL DEFAULT 'openresponse/v1' COMMENT '统一请求格式版本',
    wire_provider_format VARCHAR(64) NOT NULL COMMENT 'provider wire payload 格式标识',
    input_tokens INT NULL COMMENT '输入token数量',
    
    -- 输出信息
    canonical_response JSON NULL COMMENT '统一规范的响应体快照',
    wire_response JSON NULL COMMENT 'provider 原始响应快照',
    processed_response TEXT NULL COMMENT '处理后的回复内容',
    output_tokens INT NULL COMMENT '输出token数量',
    
    -- 性能统计
    api_call_time_ms INT NOT NULL COMMENT 'API调用耗时（毫秒）',
    processing_time_ms INT NOT NULL COMMENT '总处理耗时（毫秒）',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '调用时间戳',
    
    -- 结果状态
    status ENUM('SUCCESS', 'ERROR', 'TIMEOUT', 'QUOTA_EXCEEDED') DEFAULT 'SUCCESS' COMMENT '调用状态',
    error_message TEXT NULL COMMENT '错误信息',
    error_code VARCHAR(50) NULL COMMENT '错误代码',
    
    -- 成本信息
    cost_estimate DECIMAL(10,6) NULL COMMENT '成本估算（美元）',
    token_usage JSON NULL COMMENT 'Token使用详情（API返回的完整统计）',
    
    -- 业务上下文
    user_id BIGINT NULL COMMENT '触发用户ID',
    
    -- 索引
    INDEX idx_trace_id (trace_id),
    INDEX idx_session_id (session_id),
    INDEX idx_agent_type (agent_type),
    INDEX idx_model_name (model_name),
    INDEX idx_timestamp (timestamp),
    INDEX idx_status (status),
    INDEX idx_user_id (user_id),
    INDEX idx_trace_sequence (trace_id, call_sequence)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
  COMMENT='LLM调用记录表'`,

  // 3. 会话追踪链路表
  `CREATE TABLE IF NOT EXISTS session_traces (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '链路ID',
    
    -- 基本标识
    trace_id VARCHAR(64) UNIQUE NOT NULL COMMENT 'TraceID，全局唯一',
    session_id VARCHAR(36) NOT NULL COMMENT '会话ID',
    
    -- 触发信息
    user_id BIGINT NOT NULL COMMENT '触发用户ID',
    group_id BIGINT NULL COMMENT '群ID（群聊时存在）',
    trigger_message_id BIGINT NULL COMMENT '触发消息的ID',
    trigger_event_type VARCHAR(50) NOT NULL COMMENT '触发事件类型',
    
    -- 关联日志ID（JSON数组）
    websocket_log_ids JSON NULL COMMENT '关联的WebSocket日志ID数组',
    llm_call_log_ids JSON NULL COMMENT '关联的LLM调用日志ID数组',
    
    -- 处理结果
    decision_result JSON NULL COMMENT '决策引擎结果',
    context_result JSON NULL COMMENT '上下文引擎结果',  
    persona_result JSON NULL COMMENT '风格处理结果 (legacy)',
    final_response TEXT NULL COMMENT '最终回复内容',
    
    -- 性能统计
    total_processing_time_ms INT NULL COMMENT '总处理时间（毫秒）',
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '开始处理时间',
    end_time TIMESTAMP NULL COMMENT '结束处理时间',
    
    -- 链路状态
    status ENUM('PROCESSING', 'COMPLETED', 'ERROR', 'TIMEOUT', 'CANCELLED') DEFAULT 'PROCESSING' COMMENT '处理状态',
    error_message TEXT NULL COMMENT '错误信息',
    
    -- 业务统计
    websocket_messages_count INT DEFAULT 0 COMMENT 'WebSocket消息数量',
    llm_calls_count INT DEFAULT 0 COMMENT 'LLM调用次数',
    total_tokens_used INT NULL COMMENT '总Token使用量',
    total_cost_estimate DECIMAL(10,6) NULL COMMENT '总成本估算',
    
    -- 更新时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    -- 索引
    INDEX idx_trace_id (trace_id),
    INDEX idx_session_id (session_id),
    INDEX idx_user_id (user_id),
    INDEX idx_group_id (group_id),
    INDEX idx_trigger_event (trigger_event_type),
    INDEX idx_start_time (start_time),
    INDEX idx_status (status),
    INDEX idx_processing_time (total_processing_time_ms)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
  COMMENT='会话追踪链路表'`,

  // 4. 日志统计汇总表
  `CREATE TABLE IF NOT EXISTS trace_statistics (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '统计ID',
    
    -- 统计维度
    date_key DATE NOT NULL COMMENT '统计日期',
    hour_key INT NOT NULL COMMENT '统计小时（0-23）',
    event_type VARCHAR(50) NOT NULL COMMENT '事件类型',
    
    -- 统计指标
    total_traces INT DEFAULT 0 COMMENT '总追踪数量',
    successful_traces INT DEFAULT 0 COMMENT '成功追踪数量',
    error_traces INT DEFAULT 0 COMMENT '错误追踪数量',
    avg_processing_time_ms DECIMAL(10,2) NULL COMMENT '平均处理时间',
    total_llm_calls INT DEFAULT 0 COMMENT '总LLM调用次数',
    total_tokens INT DEFAULT 0 COMMENT '总Token使用量',
    total_cost DECIMAL(10,6) DEFAULT 0.000000 COMMENT '总成本',
    
    -- 用户维度
    unique_users INT DEFAULT 0 COMMENT '唯一用户数',
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    -- 复合索引
    UNIQUE INDEX idx_date_hour_event (date_key, hour_key, event_type),
    INDEX idx_date_key (date_key),
    INDEX idx_event_type (event_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
  COMMENT='链路追踪统计汇总表'`
];

async function createTraceTables() {
  const database = new DatabaseManager(config.database);
  
  try {
    console.log('🔗 连接数据库...');
    
    console.log('📝 开始创建链路追踪表...');
    
    for (let i = 0; i < CREATE_TABLES_SQL.length; i++) {
      const sql = CREATE_TABLES_SQL[i];
      const tableName = ['websocket_logs', 'llm_call_logs', 'session_traces', 'trace_statistics'][i];
      
      try {
        console.log(`⚡ 创建表: ${tableName}...`);
        await database.executeQuery(sql);
        console.log(`✅ 表 ${tableName} 创建成功`);
      } catch (error: any) {
        if (error.code === 'ER_TABLE_EXISTS_ERROR') {
          console.log(`⚠️  表 ${tableName} 已存在，跳过`);
        } else {
          console.error(`❌ 表 ${tableName} 创建失败:`, error.message);
        }
      }
    }

    // 验证表创建结果
    console.log('\n🔍 验证表结构...');
    const tables = ['websocket_logs', 'llm_call_logs', 'session_traces', 'trace_statistics'];
    
    for (const tableName of tables) {
      try {
        const results = await database.executeQuery(`DESCRIBE ${tableName}`);
        console.log(`✅ 表 ${tableName} 验证成功，包含 ${results.length} 个字段`);
      } catch (error) {
        console.error(`❌ 表 ${tableName} 验证失败`);
      }
    }

    console.log('\n🎉 所有链路追踪表创建完成！');
    console.log('📊 可用表:');
    console.log('  - websocket_logs: WebSocket通信日志');
    console.log('  - llm_call_logs: LLM调用记录');
    console.log('  - session_traces: 会话链路追踪');
    console.log('  - trace_statistics: 统计汇总数据');

  } catch (error) {
    console.error('💥 创建表时发生错误:', error);
    process.exit(1);
  } finally {
    await database.close();
    console.log('🔌 数据库连接已关闭');
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  createTraceTables().catch(console.error);
}

export { createTraceTables };
