# QQ机器人数据库性能优化指南

## 📊 文档信息

- **版本**: v1.0
- **作者**: System Architect Designer  
- **日期**: 2025-09-04
- **适用范围**: MySQL 8.0 + Redis 7.0 + 智能化升级架构
- **更新周期**: 季度评估和优化

## 🎯 优化目标

### 核心性能指标

| 指标 | 当前值 | 目标值 | 优化策略 |
|------|--------|--------|----------|
| **平均查询响应时间** | 200ms | <100ms | 索引优化 + 查询重写 |
| **95分位响应时间** | 800ms | <500ms | 缓存策略 + 分区优化 |
| **数据库并发连接数** | 200 | 500+ | 连接池优化 + 读写分离 |
| **缓存命中率** | 75% | >90% | 缓存策略优化 + 预热机制 |
| **磁盘I/O使用率** | 60% | <40% | 存储优化 + SSD升级 |

---

## 🔧 MySQL性能优化

### 1. 服务器配置优化

#### 核心配置参数
```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf

[mysqld]
# ================================
# 内存配置优化
# ================================
# InnoDB缓冲池 - 系统内存的70-80%
innodb_buffer_pool_size = 16G
innodb_buffer_pool_instances = 8

# 查询缓存 - 避免重复查询解析
query_cache_size = 256M
query_cache_type = ON
query_cache_limit = 2M

# 排序和连接缓冲区
sort_buffer_size = 2M
join_buffer_size = 2M
read_buffer_size = 1M
read_rnd_buffer_size = 1M

# ================================
# 连接和并发优化
# ================================
max_connections = 2000
max_connect_errors = 100000
back_log = 512
thread_cache_size = 64
thread_pool_size = 16

# 连接超时配置
wait_timeout = 28800
interactive_timeout = 28800
connect_timeout = 10

# ================================
# InnoDB存储引擎优化
# ================================
# 事务日志
innodb_log_file_size = 2G
innodb_log_buffer_size = 64M
innodb_log_files_in_group = 2

# 刷盘策略 - 性能与安全平衡
innodb_flush_log_at_trx_commit = 1
innodb_flush_method = O_DIRECT
innodb_file_per_table = ON

# I/O优化
innodb_io_capacity = 2000
innodb_io_capacity_max = 4000
innodb_read_io_threads = 8
innodb_write_io_threads = 8

# 锁优化
innodb_lock_wait_timeout = 50
innodb_deadlock_detect = ON
innodb_print_all_deadlocks = ON

# ================================
# 查询优化
# ================================
# 慢查询日志
slow_query_log = ON
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1.0
log_queries_not_using_indexes = ON

# 二进制日志
log_bin = mysql-bin
binlog_format = ROW
sync_binlog = 1
binlog_cache_size = 32M

# ================================
# 表和索引优化
# ================================
table_open_cache = 4000
table_definition_cache = 2000
open_files_limit = 65535

# 临时表
tmp_table_size = 256M
max_heap_table_size = 256M

# MyISAM优化（如有使用）
key_buffer_size = 256M
myisam_sort_buffer_size = 128M
```

### 2. 索引优化策略

#### 索引设计原则
```sql
-- =====================================
-- 1. 基于查询模式的索引设计
-- =====================================

-- 对话追踪查询优化
-- 查询模式: 按用户ID和时间范围查询
CREATE INDEX idx_traces_user_time_optimized 
ON conversation_traces (user_id, start_time DESC, status) 
USING BTREE;

-- 查询模式: 按追踪类型和状态查询  
CREATE INDEX idx_traces_type_status_time 
ON conversation_traces (trace_type, status, start_time DESC)
USING BTREE;

-- 查询模式: 按会话ID查询
CREATE INDEX idx_traces_session_time 
ON conversation_traces (session_id, start_time DESC)
WHERE session_id IS NOT NULL;

-- =====================================
-- 2. 覆盖索引优化查询性能
-- =====================================

-- Prompt使用历史覆盖索引
CREATE INDEX idx_prompt_usage_covering
ON prompt_usage_history (
    template_id, 
    started_at DESC, 
    execution_status,
    response_quality_score,
    execution_time_ms
);

-- 分析指标覆盖索引
CREATE INDEX idx_analytics_covering
ON analytics_metrics (
    metric_id,
    time_bucket,
    bucket_start_time DESC,
    metric_value,
    sample_count
);

-- =====================================
-- 3. 条件索引减少存储开销
-- =====================================

-- 仅为活跃模板创建索引
CREATE INDEX idx_prompts_active_usage
ON dynamic_prompt_templates (usage_count DESC, last_used_at DESC)
WHERE status = 'active';

-- 仅为未解决错误创建索引
CREATE INDEX idx_errors_unresolved
ON error_traces (error_type, user_impact, first_occurrence DESC)
WHERE resolution_status IN ('open', 'investigating');

-- =====================================
-- 4. 函数索引优化复杂查询
-- =====================================

-- 按持续时间分类的函数索引
CREATE INDEX idx_traces_duration_category
ON conversation_traces (
    (CASE 
        WHEN duration_ms < 1000 THEN 'fast'
        WHEN duration_ms < 5000 THEN 'normal' 
        ELSE 'slow' 
    END),
    start_time DESC
);

-- 按日期分组的函数索引  
CREATE INDEX idx_metrics_date_category
ON analytics_metrics (
    DATE(bucket_start_time),
    metric_category,
    metric_value
);
```

#### 索引监控和维护
```sql
-- =====================================
-- 索引使用情况分析
-- =====================================

-- 查看索引使用统计
SELECT 
    TABLE_SCHEMA,
    TABLE_NAME,
    INDEX_NAME,
    SEQ_IN_INDEX,
    COLUMN_NAME,
    CARDINALITY,
    NULLABLE
FROM information_schema.STATISTICS 
WHERE TABLE_SCHEMA = 'qqbot_db'
    AND TABLE_NAME IN (
        'conversation_traces',
        'dynamic_prompt_templates', 
        'analytics_metrics'
    )
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

-- 检查未使用的索引
SELECT 
    object_schema,
    object_name,
    index_name,
    count_read,
    count_write,
    (count_write / (count_read + count_write)) * 100 as write_ratio
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE object_schema = 'qqbot_db'
    AND count_read = 0
    AND index_name IS NOT NULL
    AND index_name != 'PRIMARY'
ORDER BY count_write DESC;

-- 查找重复索引
SELECT 
    a.TABLE_SCHEMA,
    a.TABLE_NAME,
    a.INDEX_NAME as index1,
    b.INDEX_NAME as index2,
    a.COLUMN_NAME
FROM information_schema.STATISTICS a
JOIN information_schema.STATISTICS b ON (
    a.TABLE_SCHEMA = b.TABLE_SCHEMA
    AND a.TABLE_NAME = b.TABLE_NAME
    AND a.COLUMN_NAME = b.COLUMN_NAME
    AND a.INDEX_NAME != b.INDEX_NAME
)
WHERE a.TABLE_SCHEMA = 'qqbot_db'
ORDER BY a.TABLE_NAME, a.COLUMN_NAME;
```

### 3. 查询优化技巧

#### 查询重写示例
```sql
-- =====================================
-- 1. 避免全表扫描的查询优化
-- =====================================

-- ❌ 低效查询 - 全表扫描
SELECT * FROM conversation_traces 
WHERE DATE(start_time) = '2025-09-04';

-- ✅ 优化查询 - 使用索引范围查询
SELECT * FROM conversation_traces 
WHERE start_time >= '2025-09-04 00:00:00' 
    AND start_time < '2025-09-05 00:00:00';

-- =====================================
-- 2. 子查询优化为JOIN
-- =====================================

-- ❌ 低效子查询
SELECT * FROM dynamic_prompt_templates 
WHERE template_id IN (
    SELECT template_id FROM prompt_usage_history 
    WHERE started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
);

-- ✅ 优化为EXISTS查询
SELECT dpt.* FROM dynamic_prompt_templates dpt
WHERE EXISTS (
    SELECT 1 FROM prompt_usage_history puh 
    WHERE puh.template_id = dpt.template_id 
        AND puh.started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
);

-- =====================================
-- 3. 聚合查询优化
-- =====================================

-- ❌ 低效聚合查询
SELECT 
    user_id,
    COUNT(*) as trace_count,
    AVG(duration_ms) as avg_duration
FROM conversation_traces
GROUP BY user_id
HAVING COUNT(*) > 100;

-- ✅ 使用索引优化聚合
SELECT 
    user_id,
    COUNT(*) as trace_count,
    AVG(duration_ms) as avg_duration
FROM conversation_traces
WHERE start_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY user_id
HAVING COUNT(*) > 100;

-- =====================================
-- 4. 批量操作优化
-- =====================================

-- ❌ 逐行插入
INSERT INTO analytics_metrics (metric_id, metric_value, recorded_at) VALUES ('metric1', 100, NOW());
INSERT INTO analytics_metrics (metric_id, metric_value, recorded_at) VALUES ('metric2', 200, NOW());

-- ✅ 批量插入
INSERT INTO analytics_metrics (metric_id, metric_value, recorded_at) VALUES 
    ('metric1', 100, NOW()),
    ('metric2', 200, NOW()),
    ('metric3', 300, NOW());

-- ✅ 使用ON DUPLICATE KEY UPDATE优化UPSERT
INSERT INTO dynamic_prompt_templates (
    template_id, template_name, usage_count
) VALUES (
    'template1', 'Chat Template', 1
) ON DUPLICATE KEY UPDATE 
    usage_count = usage_count + VALUES(usage_count),
    last_used_at = NOW();
```

### 4. 分区表优化

#### 时间分区策略
```sql
-- =====================================
-- 对话追踪表按月分区
-- =====================================
ALTER TABLE conversation_traces 
PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
    PARTITION p202509 VALUES LESS THAN (202510),
    PARTITION p202510 VALUES LESS THAN (202511),
    PARTITION p202511 VALUES LESS THAN (202512),
    PARTITION p202512 VALUES LESS THAN (202601),
    PARTITION p202601 VALUES LESS THAN (202602),
    PARTITION p202602 VALUES LESS THAN (202603),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- =====================================
-- 分析指标表按时间和类型分区
-- =====================================
ALTER TABLE analytics_metrics 
PARTITION BY RANGE (YEAR(bucket_start_time) * 100 + MONTH(bucket_start_time))
SUBPARTITION BY HASH(metric_category) SUBPARTITIONS 4 (
    PARTITION p202509 VALUES LESS THAN (202510),
    PARTITION p202510 VALUES LESS THAN (202511),
    PARTITION p202511 VALUES LESS THAN (202512),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- =====================================
-- 分区维护脚本
-- =====================================
DELIMITER //

CREATE PROCEDURE MaintainPartitions()
BEGIN
    DECLARE current_month INT;
    DECLARE next_month INT;
    DECLARE partition_name VARCHAR(20);
    DECLARE partition_value INT;
    
    SET current_month = YEAR(NOW()) * 100 + MONTH(NOW());
    SET next_month = current_month + 1;
    
    -- 添加下个月的分区
    SET partition_name = CONCAT('p', next_month);
    SET partition_value = next_month + 1;
    
    SET @sql = CONCAT(
        'ALTER TABLE conversation_traces ADD PARTITION (',
        'PARTITION ', partition_name, ' VALUES LESS THAN (', partition_value, '))'
    );
    
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    
    -- 删除6个月前的分区
    SET @old_month = current_month - 6;
    SET @old_partition = CONCAT('p', @old_month);
    
    SET @sql = CONCAT('ALTER TABLE conversation_traces DROP PARTITION ', @old_partition);
    
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
END //

DELIMITER ;

-- 创建定时任务（每月执行）
-- 需要配合系统cron作业：0 0 1 * * mysql -u root -p qqbot_db -e "CALL MaintainPartitions();"
```

---

## 🚀 Redis性能优化

### 1. 内存配置优化

#### 核心配置参数
```conf
# redis.conf 性能优化配置

# ================================
# 内存管理
# ================================
maxmemory 16gb
maxmemory-policy allkeys-lru  # LRU淘汰策略
maxmemory-samples 10          # LRU采样精度

# 内存分配优化
hash-max-ziplist-entries 512
hash-max-ziplist-value 64
list-max-ziplist-size -2
set-max-intset-entries 512
zset-max-ziplist-entries 128
zset-max-ziplist-value 64

# ================================
# 持久化优化
# ================================
# RDB配置
save 900 1
save 300 10  
save 60 10000
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb

# AOF配置  
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# ================================
# 网络和I/O优化
# ================================
tcp-backlog 511
timeout 300
tcp-keepalive 300
maxclients 10000

# I/O线程配置（Redis 6.0+）
io-threads 4
io-threads-do-reads yes

# ================================
# 慢日志配置
# ================================
slowlog-log-slower-than 10000  # 10ms
slowlog-max-len 128

# ================================
# 客户端输出缓冲区
# ================================
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60
```

### 2. 缓存策略优化

#### 智能缓存管理
```typescript
class OptimizedCacheManager {
  private redis: Redis;
  private localCache: LRU<string, any>;
  private compressionThreshold = 1024; // 1KB以上数据压缩

  constructor() {
    this.redis = new Redis({
      host: 'redis-cluster',
      port: 6379,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true,
      // 连接池优化
      family: 4,
      keepAlive: true,
      // 命令优化
      commandTimeout: 5000,
      lazyConnect: true
    });

    this.localCache = new LRU({
      max: 10000,
      maxAge: 5 * 60 * 1000, // 5分钟
      updateAgeOnGet: true
    });
  }

  // =====================================
  // 多级缓存策略
  // =====================================
  async get<T>(key: string): Promise<T | null> {
    // L1: 本地缓存
    let data = this.localCache.get(key);
    if (data) {
      this.metrics.recordCacheHit('local', key);
      return data;
    }

    // L2: Redis缓存
    const cached = await this.redis.get(key);
    if (cached) {
      data = await this.deserializeData(cached);
      this.localCache.set(key, data);
      this.metrics.recordCacheHit('redis', key);
      return data;
    }

    this.metrics.recordCacheMiss(key);
    return null;
  }

  async set<T>(key: string, value: T, ttl: number = 3600): Promise<void> {
    // 数据压缩
    const serialized = await this.serializeData(value);
    
    // 写入多级缓存
    this.localCache.set(key, value);
    await this.redis.setex(key, ttl, serialized);
    
    this.metrics.recordCacheSet(key, serialized.length);
  }

  // =====================================
  // 批量操作优化
  // =====================================
  async mget<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const missedKeys: string[] = [];

    // 先检查本地缓存
    for (const key of keys) {
      const cached = this.localCache.get(key);
      if (cached) {
        result.set(key, cached);
      } else {
        missedKeys.push(key);
      }
    }

    if (missedKeys.length === 0) return result;

    // 批量从Redis获取
    const pipeline = this.redis.pipeline();
    missedKeys.forEach(key => pipeline.get(key));
    
    const redisResults = await pipeline.exec();
    
    for (let i = 0; i < missedKeys.length; i++) {
      const [err, value] = redisResults[i];
      if (!err && value) {
        const data = await this.deserializeData(value);
        result.set(missedKeys[i], data);
        this.localCache.set(missedKeys[i], data);
      }
    }

    return result;
  }

  async mset<T>(entries: Map<string, T>, ttl: number = 3600): Promise<void> {
    const pipeline = this.redis.pipeline();
    
    for (const [key, value] of entries) {
      const serialized = await this.serializeData(value);
      pipeline.setex(key, ttl, serialized);
      this.localCache.set(key, value);
    }
    
    await pipeline.exec();
  }

  // =====================================
  // 数据序列化优化
  // =====================================
  private async serializeData(data: any): Promise<string> {
    const jsonString = JSON.stringify(data);
    
    if (jsonString.length > this.compressionThreshold) {
      // 使用gzip压缩大数据
      const compressed = await this.compress(jsonString);
      return `compressed:${compressed}`;
    }
    
    return jsonString;
  }

  private async deserializeData(data: string): Promise<any> {
    if (data.startsWith('compressed:')) {
      const compressed = data.substring(11);
      const decompressed = await this.decompress(compressed);
      return JSON.parse(decompressed);
    }
    
    return JSON.parse(data);
  }

  // =====================================
  // 缓存预热策略
  // =====================================
  async warmupCache(): Promise<void> {
    console.log('开始缓存预热...');
    
    // 预热活跃Prompt模板
    await this.warmupPromptTemplates();
    
    // 预热用户会话数据
    await this.warmupUserSessions();
    
    // 预热分析指标
    await this.warmupAnalyticsMetrics();
    
    console.log('缓存预热完成');
  }

  private async warmupPromptTemplates(): Promise<void> {
    const activeTemplates = await this.db.query(`
      SELECT template_id, template_content, template_variables 
      FROM dynamic_prompt_templates 
      WHERE status = 'active' 
      ORDER BY usage_count DESC 
      LIMIT 100
    `);

    const batchSize = 10;
    for (let i = 0; i < activeTemplates.length; i += batchSize) {
      const batch = activeTemplates.slice(i, i + batchSize);
      const pipeline = this.redis.pipeline();
      
      for (const template of batch) {
        const key = `prompt:template:${template.template_id}`;
        pipeline.setex(key, 7200, JSON.stringify(template)); // 2小时TTL
      }
      
      await pipeline.exec();
    }
  }
}
```

### 3. Redis集群优化

#### 集群配置
```conf
# redis-cluster.conf
port 7000
cluster-enabled yes
cluster-config-file nodes.conf
cluster-node-timeout 5000
cluster-announce-ip 192.168.1.100
cluster-announce-port 7000
cluster-announce-bus-port 17000

# 集群优化配置
cluster-migration-barrier 1
cluster-require-full-coverage no
cluster-slave-validity-factor 0

# 内存和性能优化
maxmemory 8gb
maxmemory-policy allkeys-lru
```

#### 集群监控脚本
```bash
#!/bin/bash
# redis-cluster-monitor.sh

REDIS_CLI="/usr/local/bin/redis-cli"
CLUSTER_NODES="192.168.1.100:7000 192.168.1.101:7000 192.168.1.102:7000"
ALERT_THRESHOLD=90  # 内存使用率阈值

for node in $CLUSTER_NODES; do
    echo "=== 检查节点: $node ==="
    
    # 检查节点状态
    status=$($REDIS_CLI -h ${node%:*} -p ${node#*:} ping)
    if [ "$status" != "PONG" ]; then
        echo "❌ 节点 $node 无法连接"
        # 发送告警
        curl -X POST "https://alerts.qqbot.ai/webhook" \
             -H "Content-Type: application/json" \
             -d "{\"message\": \"Redis节点 $node 离线\", \"severity\": \"critical\"}"
        continue
    fi
    
    # 检查内存使用率
    memory_info=$($REDIS_CLI -h ${node%:*} -p ${node#*:} info memory)
    used_memory=$(echo "$memory_info" | grep used_memory_human | cut -d: -f2 | tr -d '\r')
    max_memory=$(echo "$memory_info" | grep maxmemory_human | cut -d: -f2 | tr -d '\r')
    
    echo "内存使用: $used_memory / $max_memory"
    
    # 检查慢查询
    slow_queries=$($REDIS_CLI -h ${node%:*} -p ${node#*:} slowlog len)
    if [ "$slow_queries" -gt 10 ]; then
        echo "⚠️  慢查询数量: $slow_queries"
        # 获取最近的慢查询
        $REDIS_CLI -h ${node%:*} -p ${node#*:} slowlog get 5
    fi
    
    # 检查客户端连接数
    connected_clients=$($REDIS_CLI -h ${node%:*} -p ${node#*:} info clients | grep connected_clients | cut -d: -f2 | tr -d '\r')
    echo "客户端连接数: $connected_clients"
    
    echo ""
done

# 检查集群整体状态
echo "=== 集群整体状态 ==="
$REDIS_CLI --cluster check ${CLUSTER_NODES%% *}
```

---

## 📈 应用层性能优化

### 1. 连接池优化

#### 数据库连接池配置
```typescript
class OptimizedDatabaseManager {
  private pool: mysql.Pool;
  private readPool: mysql.Pool;
  private writePool: mysql.Pool;

  constructor(config: DatabaseConfig) {
    // 写库连接池
    this.writePool = mysql.createPool({
      host: config.write.host,
      port: config.write.port,
      user: config.user,
      password: config.password,
      database: config.database,
      
      // 连接池优化配置
      connectionLimit: 50,        // 写操作连接数限制
      acquireTimeout: 60000,      // 获取连接超时
      timeout: 60000,             // 查询超时
      reconnect: true,            // 自动重连
      
      // 性能优化
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: false,
      
      // 连接选项
      ssl: false,
      multipleStatements: false,  // 安全考虑
      
      // 连接保持
      acquireTimeout: 60000,
      timeout: 60000,
      reconnect: true,
      
      // 预连接
      preConnectionHook: (connection, done) => {
        // 设置连接字符集
        connection.query('SET NAMES utf8mb4', done);
      }
    });

    // 读库连接池（读写分离）
    this.readPool = mysql.createPool({
      host: config.read.host,
      port: config.read.port,
      user: config.user,
      password: config.password,
      database: config.database,
      
      connectionLimit: 100,       // 读操作连接数更多
      // ... 其他配置同写库
    });

    this.setupConnectionMonitoring();
  }

  // =====================================
  // 连接池监控
  // =====================================
  private setupConnectionMonitoring(): void {
    setInterval(() => {
      const writeStats = this.writePool.config;
      const readStats = this.readPool.config;
      
      console.log('连接池状态:', {
        write: {
          active: writeStats.connectionLimit - writeStats.acquireTimeout,
          idle: writeStats.acquireTimeout,
          limit: writeStats.connectionLimit
        },
        read: {
          active: readStats.connectionLimit - readStats.acquireTimeout,
          idle: readStats.acquireTimeout,
          limit: readStats.connectionLimit
        }
      });
      
      // 连接数告警
      if (writeStats.connectionLimit * 0.8 < (writeStats.connectionLimit - writeStats.acquireTimeout)) {
        this.alertService.sendAlert({
          type: 'database_connection_high',
          message: '写库连接数过高',
          severity: 'warning'
        });
      }
    }, 30000);
  }

  // =====================================
  // 智能查询路由
  // =====================================
  async executeQuery<T>(query: string, params: any[] = [], forceWrite: boolean = false): Promise<T[]> {
    const pool = this.shouldUseWritePool(query, forceWrite) ? this.writePool : this.readPool;
    
    const startTime = Date.now();
    
    try {
      const connection = await this.getConnection(pool);
      const [rows] = await connection.execute(query, params);
      connection.release();
      
      const duration = Date.now() - startTime;
      this.metrics.recordQuery(query, duration, rows.length);
      
      return rows as T[];
    } catch (error) {
      this.metrics.recordQueryError(query, error);
      throw error;
    }
  }

  private shouldUseWritePool(query: string, forceWrite: boolean): boolean {
    if (forceWrite) return true;
    
    const writeKeywords = ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP'];
    const upperQuery = query.toUpperCase().trim();
    
    return writeKeywords.some(keyword => upperQuery.startsWith(keyword));
  }

  // =====================================
  // 批量操作优化
  // =====================================
  async executeBatch<T>(operations: Array<{query: string, params: any[]}>): Promise<T[]> {
    const connection = await this.getConnection(this.writePool);
    
    try {
      await connection.beginTransaction();
      
      const results: T[] = [];
      const batchSize = 100; // 批量大小
      
      for (let i = 0; i < operations.length; i += batchSize) {
        const batch = operations.slice(i, i + batchSize);
        
        const batchPromises = batch.map(op => 
          connection.execute(op.query, op.params)
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.map(r => r[0] as T));
      }
      
      await connection.commit();
      connection.release();
      
      return results;
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  }
}
```

### 2. 异步处理优化

#### 队列处理优化
```typescript
class HighPerformanceQueueProcessor {
  private processingQueue: Queue;
  private deadLetterQueue: Queue;
  private metrics: MetricsCollector;
  
  constructor() {
    this.processingQueue = new Bull('high-perf-queue', {
      redis: {
        host: 'redis-cluster',
        port: 6379,
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        lazyConnect: true
      },
      
      defaultJobOptions: {
        removeOnComplete: 100,    // 保留最近100个完成的任务
        removeOnFail: 50,         // 保留最近50个失败的任务
        attempts: 3,              // 重试3次
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        delay: 100,               // 100ms延迟批处理
      },

      settings: {
        stalledInterval: 30000,   // 30秒检查卡住的任务
        maxStalledCount: 3,       // 最多3次卡住重试
      }
    });

    this.setupProcessors();
    this.setupMonitoring();
  }

  // =====================================
  // 多并发处理器
  // =====================================
  private setupProcessors(): void {
    // 对话追踪处理器 - 高并发
    this.processingQueue.process('trace-processing', 10, async (job) => {
      return this.processTrace(job.data);
    });

    // Prompt渲染处理器 - 中等并发
    this.processingQueue.process('prompt-rendering', 5, async (job) => {
      return this.renderPrompt(job.data);
    });

    // 分析指标处理器 - 批量处理
    this.processingQueue.process('analytics-batch', 3, async (job) => {
      return this.processBatchAnalytics(job.data);
    });
  }

  // =====================================
  // 智能批处理
  // =====================================
  private batchProcessor = new Map<string, any[]>();
  private batchTimers = new Map<string, NodeJS.Timeout>();

  async addToBatch(type: string, data: any): Promise<void> {
    if (!this.batchProcessor.has(type)) {
      this.batchProcessor.set(type, []);
    }

    this.batchProcessor.get(type)!.push(data);

    // 清除现有定时器
    if (this.batchTimers.has(type)) {
      clearTimeout(this.batchTimers.get(type)!);
    }

    // 设置批处理定时器
    const timer = setTimeout(() => {
      this.processBatch(type);
    }, 1000); // 1秒内的数据批量处理

    this.batchTimers.set(type, timer);

    // 达到批大小立即处理
    const batch = this.batchProcessor.get(type)!;
    if (batch.length >= this.getBatchSize(type)) {
      clearTimeout(timer);
      await this.processBatch(type);
    }
  }

  private async processBatch(type: string): Promise<void> {
    const batch = this.batchProcessor.get(type);
    if (!batch || batch.length === 0) return;

    // 清空批次
    this.batchProcessor.set(type, []);
    this.batchTimers.delete(type);

    try {
      switch (type) {
        case 'analytics':
          await this.processBatchAnalytics({ metrics: batch });
          break;
        case 'traces':
          await this.processBatchTraces({ traces: batch });
          break;
        default:
          console.warn(`未知批处理类型: ${type}`);
      }
    } catch (error) {
      console.error(`批处理失败 ${type}:`, error);
      // 重新加入队列进行重试
      await this.processingQueue.add('retry-batch', { type, data: batch }, {
        attempts: 2,
        delay: 5000
      });
    }
  }

  // =====================================
  // 性能监控
  // =====================================
  private setupMonitoring(): void {
    this.processingQueue.on('completed', (job, result) => {
      this.metrics.recordJobCompletion(job.name, job.processedOn - job.timestamp);
    });

    this.processingQueue.on('failed', (job, err) => {
      this.metrics.recordJobFailure(job.name, err.message);
    });

    this.processingQueue.on('stalled', (job) => {
      this.metrics.recordJobStall(job.name);
    });

    // 队列统计信息
    setInterval(async () => {
      const stats = await this.processingQueue.getJobCounts();
      this.metrics.recordQueueStats(stats);
    }, 30000);
  }
}
```

### 3. 内存管理优化

#### 内存泄漏防护
```typescript
class MemoryManager {
  private memoryUsage = new Map<string, number>();
  private gcStats = { forced: 0, automatic: 0 };
  
  constructor() {
    this.startMemoryMonitoring();
    this.setupGarbageCollection();
  }

  // =====================================
  // 内存监控
  // =====================================
  private startMemoryMonitoring(): void {
    setInterval(() => {
      const usage = process.memoryUsage();
      const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
      const totalMB = Math.round(usage.heapTotal / 1024 / 1024);
      
      this.memoryUsage.set('heap_used', usedMB);
      this.memoryUsage.set('heap_total', totalMB);
      
      console.log(`内存使用: ${usedMB}MB / ${totalMB}MB (${Math.round(usedMB/totalMB*100)}%)`);
      
      // 内存使用率过高时触发GC
      if (usedMB / totalMB > 0.85) {
        this.forceGarbageCollection();
      }
      
      // 内存告警
      if (usedMB > 1024) { // 超过1GB
        console.warn('⚠️ 内存使用过高:', usedMB, 'MB');
      }
    }, 10000); // 10秒检查一次
  }

  // =====================================
  // 垃圾回收优化
  // =====================================
  private setupGarbageCollection(): void {
    // 监听GC事件
    const v8 = require('v8');
    const perfHooks = require('perf_hooks');
    
    const obs = new perfHooks.PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        if (entry.name === 'gc') {
          this.gcStats.automatic++;
          console.log(`GC执行: ${entry.duration.toFixed(2)}ms`);
        }
      });
    });
    
    obs.observe({ entryTypes: ['gc'] });
  }

  private forceGarbageCollection(): void {
    if (global.gc) {
      const before = process.memoryUsage().heapUsed;
      global.gc();
      const after = process.memoryUsage().heapUsed;
      
      this.gcStats.forced++;
      console.log(`强制GC: 释放 ${Math.round((before - after) / 1024 / 1024)}MB`);
    }
  }

  // =====================================
  // 大对象处理优化
  // =====================================
  async processLargeData<T>(data: T[], processor: (item: T) => Promise<void>): Promise<void> {
    const chunkSize = 1000; // 每次处理1000条
    
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      
      // 并行处理chunk
      await Promise.all(chunk.map(processor));
      
      // 处理完一个chunk后，给GC机会运行
      if (i % (chunkSize * 10) === 0) {
        await this.sleep(1);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =====================================
  // 缓存清理策略
  // =====================================
  private cleanupCaches(): void {
    // 清理过期的本地缓存
    if (this.localCache) {
      const before = this.localCache.length;
      this.localCache.prune(); // 清理过期条目
      const after = this.localCache.length;
      console.log(`本地缓存清理: ${before} -> ${after}`);
    }

    // 清理临时文件
    this.cleanupTempFiles();
  }
}
```

---

## 📊 监控和性能分析

### 1. 性能指标收集

#### 综合监控系统
```typescript
class PerformanceMonitor {
  private metrics = new Map<string, MetricData>();
  private alertThresholds = new Map<string, number>();
  
  constructor() {
    this.setupMetricsCollection();
    this.setupAlertThresholds();
  }

  // =====================================
  // 数据库性能监控
  // =====================================
  async collectDatabaseMetrics(): Promise<DatabaseMetrics> {
    const connection = await this.db.getConnection();
    
    // 查询性能统计
    const [queryStats] = await connection.execute(`
      SELECT 
        event_name,
        count_star,
        sum_timer_wait/1000000000 as total_time_seconds,
        avg_timer_wait/1000000000 as avg_time_seconds,
        max_timer_wait/1000000000 as max_time_seconds
      FROM performance_schema.events_statements_summary_by_digest
      WHERE schema_name = 'qqbot_db'
      ORDER BY sum_timer_wait DESC
      LIMIT 10
    `);

    // 连接统计
    const [connectionStats] = await connection.execute(`
      SELECT 
        variable_name,
        variable_value
      FROM performance_schema.global_status 
      WHERE variable_name IN (
        'Threads_connected',
        'Threads_running', 
        'Max_used_connections',
        'Connection_errors_max_connections',
        'Aborted_connects'
      )
    `);

    // InnoDB统计
    const [innodbStats] = await connection.execute(`
      SELECT 
        variable_name,
        variable_value
      FROM performance_schema.global_status
      WHERE variable_name LIKE 'Innodb_%'
        AND variable_name IN (
          'Innodb_buffer_pool_hit_rate',
          'Innodb_buffer_pool_pages_dirty',
          'Innodb_buffer_pool_pages_free',
          'Innodb_rows_read',
          'Innodb_rows_inserted',
          'Innodb_rows_updated',
          'Innodb_rows_deleted'
        )
    `);

    connection.release();

    return {
      queryPerformance: queryStats,
      connections: connectionStats,
      innodb: innodbStats,
      timestamp: new Date()
    };
  }

  // =====================================
  // Redis性能监控
  // =====================================
  async collectRedisMetrics(): Promise<RedisMetrics> {
    const info = await this.redis.info();
    const slowlog = await this.redis.slowlog('get', 10);
    
    const stats = this.parseRedisInfo(info);
    
    return {
      memory: {
        used: parseInt(stats.used_memory),
        max: parseInt(stats.maxmemory),
        usage_percent: (parseInt(stats.used_memory) / parseInt(stats.maxmemory)) * 100
      },
      connections: {
        connected: parseInt(stats.connected_clients),
        blocked: parseInt(stats.blocked_clients),
        rejected: parseInt(stats.rejected_connections)
      },
      operations: {
        ops_per_sec: parseInt(stats.instantaneous_ops_per_sec),
        hits: parseInt(stats.keyspace_hits),
        misses: parseInt(stats.keyspace_misses),
        hit_rate: (parseInt(stats.keyspace_hits) / 
                  (parseInt(stats.keyspace_hits) + parseInt(stats.keyspace_misses))) * 100
      },
      slowQueries: slowlog.length,
      timestamp: new Date()
    };
  }

  // =====================================
  // 应用性能监控
  // =====================================
  collectApplicationMetrics(): ApplicationMetrics {
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    
    return {
      cpu: {
        user: cpuUsage.user / 1000000, // 转换为秒
        system: cpuUsage.system / 1000000
      },
      memory: {
        rss: memUsage.rss / 1024 / 1024, // MB
        heapUsed: memUsage.heapUsed / 1024 / 1024,
        heapTotal: memUsage.heapTotal / 1024 / 1024,
        external: memUsage.external / 1024 / 1024
      },
      eventLoop: {
        lag: this.measureEventLoopLag()
      },
      uptime: process.uptime(),
      timestamp: new Date()
    };
  }

  // =====================================
  // 自动告警系统
  // =====================================
  private setupAlertThresholds(): void {
    this.alertThresholds.set('db_query_time', 1000);        // 查询时间 > 1秒
    this.alertThresholds.set('db_connection_usage', 80);     // 连接使用率 > 80%
    this.alertThresholds.set('redis_memory_usage', 85);      // Redis内存 > 85%
    this.alertThresholds.set('redis_hit_rate', 80);          // 缓存命中率 < 80%
    this.alertThresholds.set('app_memory_usage', 1024);      // 应用内存 > 1GB
    this.alertThresholds.set('event_loop_lag', 100);         // 事件循环延迟 > 100ms
  }

  async checkAlerts(): Promise<void> {
    const [dbMetrics, redisMetrics, appMetrics] = await Promise.all([
      this.collectDatabaseMetrics(),
      this.collectRedisMetrics(), 
      this.collectApplicationMetrics()
    ]);

    // 数据库告警检查
    if (dbMetrics.connections.some(c => 
        c.variable_name === 'Threads_connected' && 
        parseInt(c.variable_value) > this.alertThresholds.get('db_connection_usage')!)) {
      await this.sendAlert('database', '数据库连接数过高', 'warning');
    }

    // Redis告警检查
    if (redisMetrics.memory.usage_percent > this.alertThresholds.get('redis_memory_usage')!) {
      await this.sendAlert('redis', `Redis内存使用率: ${redisMetrics.memory.usage_percent.toFixed(1)}%`, 'warning');
    }

    if (redisMetrics.operations.hit_rate < this.alertThresholds.get('redis_hit_rate')!) {
      await this.sendAlert('redis', `缓存命中率过低: ${redisMetrics.operations.hit_rate.toFixed(1)}%`, 'warning');
    }

    // 应用告警检查
    if (appMetrics.memory.heapUsed > this.alertThresholds.get('app_memory_usage')!) {
      await this.sendAlert('application', `应用内存使用过高: ${appMetrics.memory.heapUsed.toFixed(1)}MB`, 'warning');
    }
  }
}
```

### 2. 性能测试方案

#### 压力测试脚本
```typescript
class PerformanceTestSuite {
  private testResults = new Map<string, TestResult>();

  // =====================================
  // 数据库压力测试
  // =====================================
  async runDatabaseStressTest(): Promise<TestResult> {
    console.log('开始数据库压力测试...');
    
    const testConfig = {
      concurrentUsers: [10, 50, 100, 200, 500],
      testDuration: 300, // 5分钟
      queries: [
        'SELECT * FROM conversation_traces WHERE user_id = ? ORDER BY start_time DESC LIMIT 20',
        'SELECT template_id, COUNT(*) FROM prompt_usage_history WHERE started_at >= ? GROUP BY template_id',
        'INSERT INTO analytics_metrics (metric_id, metric_value, recorded_at) VALUES (?, ?, NOW())'
      ]
    };

    const results: TestResult[] = [];

    for (const concurrency of testConfig.concurrentUsers) {
      console.log(`测试并发数: ${concurrency}`);
      
      const testResult = await this.runConcurrencyTest(concurrency, testConfig);
      results.push(testResult);
      
      // 恢复间隔
      await this.sleep(30000);
    }

    const summary = this.analyzeTestResults(results);
    return summary;
  }

  private async runConcurrencyTest(concurrency: number, config: any): Promise<TestResult> {
    const startTime = Date.now();
    const endTime = startTime + (config.testDuration * 1000);
    
    const workers: Promise<WorkerResult>[] = [];
    
    // 创建并发worker
    for (let i = 0; i < concurrency; i++) {
      workers.push(this.createTestWorker(endTime, config.queries));
    }

    const workerResults = await Promise.all(workers);
    
    // 统计结果
    const totalQueries = workerResults.reduce((sum, r) => sum + r.queryCount, 0);
    const totalErrors = workerResults.reduce((sum, r) => sum + r.errorCount, 0);
    const avgResponseTime = workerResults.reduce((sum, r) => sum + r.avgResponseTime, 0) / workerResults.length;
    const maxResponseTime = Math.max(...workerResults.map(r => r.maxResponseTime));
    
    return {
      concurrency,
      duration: config.testDuration,
      totalQueries,
      queriesPerSecond: totalQueries / config.testDuration,
      errorRate: (totalErrors / totalQueries) * 100,
      avgResponseTime,
      maxResponseTime,
      timestamp: new Date()
    };
  }

  // =====================================
  // 缓存性能测试
  // =====================================
  async runCachePerformanceTest(): Promise<TestResult> {
    console.log('开始缓存性能测试...');
    
    const testConfig = {
      operations: ['GET', 'SET', 'DEL', 'MGET', 'MSET'],
      dataSizes: [1024, 10240, 102400], // 1KB, 10KB, 100KB
      iterations: 10000
    };

    const results = new Map<string, any>();

    for (const operation of testConfig.operations) {
      for (const size of testConfig.dataSizes) {
        const testKey = `${operation}_${size}B`;
        console.log(`测试: ${testKey}`);
        
        const result = await this.runCacheTest(operation, size, testConfig.iterations);
        results.set(testKey, result);
      }
    }

    return {
      testType: 'cache_performance',
      results: Object.fromEntries(results),
      timestamp: new Date()
    };
  }

  private async runCacheTest(operation: string, dataSize: number, iterations: number): Promise<any> {
    const testData = 'x'.repeat(dataSize);
    const startTime = Date.now();
    
    let successCount = 0;
    let errorCount = 0;
    const responseTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const key = `test:${operation}:${i}`;
      const operationStart = Date.now();
      
      try {
        switch (operation) {
          case 'GET':
            await this.redis.get(key);
            break;
          case 'SET':
            await this.redis.set(key, testData, 'EX', 300);
            break;
          case 'DEL':
            await this.redis.del(key);
            break;
          case 'MGET':
            const keys = Array.from({ length: 10 }, (_, j) => `test:mget:${i}:${j}`);
            await this.redis.mget(...keys);
            break;
          case 'MSET':
            const pairs = Array.from({ length: 10 }, (_, j) => [`test:mset:${i}:${j}`, testData]).flat();
            await this.redis.mset(...pairs);
            break;
        }
        
        successCount++;
        responseTimes.push(Date.now() - operationStart);
      } catch (error) {
        errorCount++;
      }
    }

    const totalTime = Date.now() - startTime;
    const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    
    return {
      operation,
      dataSize,
      iterations,
      successCount,
      errorCount,
      totalTimeMs: totalTime,
      avgResponseTimeMs: avgResponseTime,
      opsPerSecond: (successCount / totalTime) * 1000,
      p95ResponseTime: this.calculatePercentile(responseTimes, 0.95),
      p99ResponseTime: this.calculatePercentile(responseTimes, 0.99)
    };
  }

  // =====================================
  // 结果分析和报告
  // =====================================
  private analyzeTestResults(results: TestResult[]): TestResult {
    const analysis = {
      testType: 'database_stress_test',
      maxThroughput: Math.max(...results.map(r => r.queriesPerSecond)),
      optimalConcurrency: results.reduce((best, current) => 
        current.errorRate < 5 && current.queriesPerSecond > best.queriesPerSecond ? current : best
      ),
      performanceDegradation: this.calculatePerformanceDegradation(results),
      recommendations: this.generateRecommendations(results),
      timestamp: new Date()
    };

    return analysis;
  }

  private generateRecommendations(results: TestResult[]): string[] {
    const recommendations: string[] = [];
    
    const highErrorRateResults = results.filter(r => r.errorRate > 5);
    if (highErrorRateResults.length > 0) {
      recommendations.push(`在${highErrorRateResults[0].concurrency}并发时错误率过高，建议优化数据库连接池`);
    }

    const slowResponseResults = results.filter(r => r.avgResponseTime > 1000);
    if (slowResponseResults.length > 0) {
      recommendations.push(`响应时间在高并发下超过1秒，建议添加缓存或优化查询`);
    }

    const optimalResult = results.reduce((best, current) => 
      current.errorRate < 2 && current.queriesPerSecond > best.queriesPerSecond ? current : best
    );
    
    recommendations.push(`建议最大并发设置为${optimalResult.concurrency}，可获得${optimalResult.queriesPerSecond.toFixed(0)} QPS`);

    return recommendations;
  }
}
```

---

## 📝 性能优化清单

### 即时优化项目（1周内完成）

- [ ] **配置MySQL服务器参数**
  - [ ] 调整innodb_buffer_pool_size至系统内存70%
  - [ ] 配置查询缓存和连接池参数
  - [ ] 启用慢查询日志并分析

- [ ] **优化核心索引**
  - [ ] 创建conversation_traces表复合索引
  - [ ] 添加prompt_usage_history覆盖索引
  - [ ] 删除未使用的冗余索引

- [ ] **配置Redis缓存**
  - [ ] 设置合适的内存限制和淘汰策略
  - [ ] 启用AOF持久化和压缩
  - [ ] 配置集群模式（如需要）

### 短期优化项目（1个月内完成）

- [ ] **实施数据库分区**
  - [ ] 为大表实施时间分区策略
  - [ ] 创建分区维护自动化脚本
  - [ ] 测试分区查询性能

- [ ] **应用层优化**
  - [ ] 实现多级缓存策略
  - [ ] 优化数据库连接池配置
  - [ ] 实施异步处理和批量操作

- [ ] **监控和告警**
  - [ ] 部署性能监控系统
  - [ ] 配置关键指标告警
  - [ ] 建立性能基线和SLA

### 长期优化项目（3个月内完成）

- [ ] **架构升级**
  - [ ] 实施读写分离架构
  - [ ] 评估和实施分库分表
  - [ ] 引入消息队列优化异步处理

- [ ] **高可用部署**
  - [ ] 配置数据库主从复制
  - [ ] 实施Redis哨兵或集群
  - [ ] 建立完整的容灾备份方案

- [ ] **性能测试和优化**
  - [ ] 建立持续性能测试流程
  - [ ] 定期性能基准测试
  - [ ] 根据业务增长调整架构

---

## 🎯 预期效果

### 性能提升预期

| 优化项目 | 当前状态 | 优化目标 | 预期提升 |
|---------|---------|----------|----------|
| **平均响应时间** | 200ms | <100ms | 50%↑ |
| **95分位响应时间** | 800ms | <500ms | 37%↑ |
| **数据库并发** | 200 | 500+ | 150%↑ |
| **缓存命中率** | 75% | >90% | 20%↑ |
| **系统吞吐量** | 1000 QPS | 5000 QPS | 400%↑ |

### ROI分析

- **开发投入**: 约40人日
- **硬件成本**: 增加30%（SSD升级、内存扩容）
- **运维效益**: 减少60%的性能故障
- **用户体验**: 响应时间减半，满意度提升25%
- **业务价值**: 支持5倍业务增长，单用户处理成本降低50%

---

## 📞 支持联系

如需专业的性能优化咨询和实施支持，请联系系统架构团队：

- **邮箱**: architecture@qqbot.ai
- **文档更新**: 每季度根据实际性能数据更新优化建议
- **技术支持**: 7x24小时性能监控和故障响应

---

**本文档将随着系统规模扩展和技术演进持续更新，确保性能优化策略与业务发展保持同步。**