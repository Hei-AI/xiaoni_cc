#!/usr/bin/env node

/**
 * 数据库Schema性能验证脚本
 * 专为Claude Bot Server Manager同事的Session管理需求创建
 * 基于Gemini API故障排查中发现的数据库性能问题经验
 */

const mysql = require('mysql2/promise');
const { performance } = require('perf_hooks');

// 配置
const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'qqbot_db'
};

class SchemaValidator {
  constructor() {
    this.connection = null;
    this.results = {
      tableChecks: [],
      indexChecks: [],
      performanceTests: [],
      recommendations: []
    };
  }

  async connect() {
    try {
      this.connection = await mysql.createConnection(config);
      console.log('✅ Database connection established');
      return true;
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      return false;
    }
  }

  async disconnect() {
    if (this.connection) {
      await this.connection.end();
      console.log('🔌 Database connection closed');
    }
  }

  async checkTableExists(tableName) {
    const [rows] = await this.connection.execute(
      'SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [config.database, tableName]
    );
    return rows[0].count > 0;
  }

  async checkIndexExists(tableName, indexName) {
    const [rows] = await this.connection.execute(
      'SELECT COUNT(*) as count FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
      [config.database, tableName, indexName]
    );
    return rows[0].count > 0;
  }

  async getTableRowCount(tableName) {
    try {
      const [rows] = await this.connection.execute(`SELECT COUNT(*) as count FROM ${tableName}`);
      return rows[0].count;
    } catch (error) {
      return 0;
    }
  }

  async measureQueryPerformance(sql, params = [], description = '') {
    const start = performance.now();
    try {
      const [rows] = await this.connection.execute(sql, params);
      const end = performance.now();
      const duration = end - start;
      
      return {
        success: true,
        duration: Math.round(duration),
        rowCount: Array.isArray(rows) ? rows.length : 1,
        description
      };
    } catch (error) {
      const end = performance.now();
      return {
        success: false,
        duration: Math.round(end - start),
        error: error.message,
        description
      };
    }
  }

  async validateSessionManagementSchema() {
    console.log('🔍 验证Session管理相关表结构...\n');

    // 1. 检查必需的表是否存在
    const requiredTables = [
      'conversations',
      'conversation_sessions', 
      'message_reply_chain',
      'requirements',
      'system_logs'
    ];

    for (const table of requiredTables) {
      const exists = await this.checkTableExists(table);
      this.results.tableChecks.push({
        table,
        exists,
        status: exists ? '✅' : '❌',
        message: exists ? 'Table exists' : 'Table missing'
      });
      
      if (exists) {
        const rowCount = await this.getTableRowCount(table);
        console.log(`${exists ? '✅' : '❌'} ${table}: ${exists ? 'exists' : 'missing'} (${rowCount} rows)`);
      } else {
        console.log(`❌ ${table}: missing`);
      }
    }
  }

  async validateIndexes() {
    console.log('\n🏗️  验证索引配置...\n');

    // 检查Session管理相关的关键索引
    const requiredIndexes = [
      // Conversations表索引
      { table: 'conversations', index: 'PRIMARY', critical: true },
      { table: 'conversations', index: 'idx_conversations_user_id', critical: true },
      { table: 'conversations', index: 'idx_conversations_session', critical: false },
      
      // Session表索引
      { table: 'conversation_sessions', index: 'PRIMARY', critical: true },
      { table: 'conversation_sessions', index: 'idx_session_user_id', critical: true },
      { table: 'conversation_sessions', index: 'idx_session_status', critical: false },
      
      // Message chain表索引
      { table: 'message_reply_chain', index: 'PRIMARY', critical: true },
      { table: 'message_reply_chain', index: 'idx_reply_chain_session', critical: true },
      { table: 'message_reply_chain', index: 'idx_reply_chain_user', critical: false }
    ];

    for (const { table, index, critical } of requiredIndexes) {
      const tableExists = await this.checkTableExists(table);
      if (!tableExists) {
        console.log(`⏭️  ${table}.${index}: skipped (table missing)`);
        continue;
      }

      const exists = await this.checkIndexExists(table, index);
      const status = exists ? '✅' : (critical ? '❌' : '⚠️');
      const message = exists ? 'exists' : (critical ? 'missing (critical)' : 'missing (recommended)');
      
      this.results.indexChecks.push({
        table,
        index,
        exists,
        critical,
        status,
        message
      });
      
      console.log(`${status} ${table}.${index}: ${message}`);
    }
  }

  async runPerformanceTests() {
    console.log('\n⚡ 执行性能测试...\n');

    // 测试查询集合
    const performanceTests = [
      {
        name: 'Basic conversation lookup',
        sql: 'SELECT * FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10',
        params: [85178516],
        expectedTime: 50 // ms
      },
      {
        name: 'Session by user lookup',
        sql: 'SELECT * FROM conversation_sessions WHERE user_id = ? AND status = ?',
        params: [85178516, 'active'],
        expectedTime: 30
      },
      {
        name: 'Message chain depth query',
        sql: 'SELECT * FROM message_reply_chain WHERE session_id = ? ORDER BY depth',
        params: ['test-session-id'],
        expectedTime: 40
      },
      {
        name: 'Session activity update',
        sql: 'UPDATE conversation_sessions SET last_activity = NOW() WHERE session_id = ?',
        params: ['test-session-id'],
        expectedTime: 20
      },
      {
        name: 'Complex session join query',
        sql: `SELECT s.*, COUNT(mrc.id) as reply_chain_length 
              FROM conversation_sessions s 
              LEFT JOIN message_reply_chain mrc ON s.session_id = mrc.session_id 
              WHERE s.user_id = ? 
              GROUP BY s.session_id 
              ORDER BY s.last_activity DESC 
              LIMIT 5`,
        params: [85178516],
        expectedTime: 100
      }
    ];

    for (const test of performanceTests) {
      const result = await this.measureQueryPerformance(test.sql, test.params, test.name);
      
      const isGood = result.success && result.duration <= test.expectedTime;
      const status = result.success ? (isGood ? '✅' : '⚠️') : '❌';
      
      this.results.performanceTests.push({
        ...result,
        ...test,
        isGood,
        status
      });

      if (result.success) {
        console.log(`${status} ${test.name}: ${result.duration}ms (expected ≤ ${test.expectedTime}ms)`);
      } else {
        console.log(`❌ ${test.name}: Failed - ${result.error}`);
      }
    }
  }

  async analyzeAndRecommend() {
    console.log('\n📊 性能分析和建议...\n');

    // 分析表大小和索引效率
    const tableAnalysis = [
      'conversations',
      'conversation_sessions', 
      'message_reply_chain'
    ];

    for (const table of tableAnalysis) {
      const exists = await this.checkTableExists(table);
      if (!exists) continue;

      try {
        // 获取表统计信息
        const [stats] = await this.connection.execute(`
          SELECT 
            table_rows,
            avg_row_length,
            data_length,
            index_length,
            (data_length + index_length) as total_size
          FROM information_schema.tables 
          WHERE table_schema = ? AND table_name = ?
        `, [config.database, table]);

        if (stats.length > 0) {
          const stat = stats[0];
          console.log(`📈 ${table}:`);
          console.log(`   Rows: ${stat.table_rows}`);
          console.log(`   Data size: ${Math.round(stat.data_length / 1024)}KB`);
          console.log(`   Index size: ${Math.round(stat.index_length / 1024)}KB`);
          
          // 生成建议
          if (stat.table_rows > 10000 && stat.index_length < stat.data_length * 0.1) {
            this.results.recommendations.push(`${table}: Consider adding more indexes for large table (${stat.table_rows} rows)`);
          }
          
          if (stat.avg_row_length > 1000) {
            this.results.recommendations.push(`${table}: Large average row size (${stat.avg_row_length} bytes), consider normalization`);
          }
        }
      } catch (error) {
        console.log(`⚠️  Could not analyze ${table}: ${error.message}`);
      }
    }

    // 基于性能测试结果的建议
    const slowQueries = this.results.performanceTests.filter(test => !test.isGood && test.success);
    if (slowQueries.length > 0) {
      console.log('\n⚠️  慢查询检测:');
      slowQueries.forEach(test => {
        console.log(`   ${test.name}: ${test.duration}ms (expected ≤ ${test.expectedTime}ms)`);
        
        if (test.name.includes('join')) {
          this.results.recommendations.push('Consider optimizing JOIN queries with better indexes');
        }
        
        if (test.duration > 200) {
          this.results.recommendations.push(`${test.name} is critically slow (${test.duration}ms), needs immediate optimization`);
        }
      });
    }

    // 输出建议
    if (this.results.recommendations.length > 0) {
      console.log('\n💡 优化建议:');
      this.results.recommendations.forEach((rec, i) => {
        console.log(`   ${i + 1}. ${rec}`);
      });
    } else {
      console.log('\n✅ 数据库性能良好，无需特别优化');
    }
  }

  async generateSQLRecommendations() {
    console.log('\n📝 推荐的SQL优化脚本:\n');

    const missingIndexes = this.results.indexChecks.filter(check => !check.exists);
    if (missingIndexes.length > 0) {
      console.log('-- 缺失索引创建脚本:');
      missingIndexes.forEach(({ table, index }) => {
        switch (index) {
          case 'idx_conversations_session':
            console.log(`CREATE INDEX ${index} ON ${table}(session_id) WHERE session_id IS NOT NULL;`);
            break;
          case 'idx_session_user_id':
            console.log(`CREATE INDEX ${index} ON ${table}(user_id);`);
            break;
          case 'idx_session_status':
            console.log(`CREATE INDEX ${index} ON ${table}(status);`);
            break;
          case 'idx_reply_chain_session':
            console.log(`CREATE INDEX ${index} ON ${table}(session_id, depth);`);
            break;
          case 'idx_reply_chain_user':
            console.log(`CREATE INDEX ${index} ON ${table}(user_id, reply_to_message_id);`);
            break;
          default:
            console.log(`-- Review index: ${table}.${index}`);
        }
      });
      console.log('');
    }

    // 性能优化建议
    console.log('-- 性能优化建议:');
    console.log('-- 1. 定期清理过期Session');
    console.log('DELETE FROM conversation_sessions WHERE status = "expired" AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);');
    console.log('-- 2. 优化消息链查询');
    console.log('-- 考虑添加复合索引: (session_id, depth, created_at)');
    console.log('-- 3. 监控慢查询日志');
    console.log('-- SET GLOBAL slow_query_log = 1;');
    console.log('-- SET GLOBAL long_query_time = 0.1;');
  }

  async run() {
    console.log('🚀 开始数据库Schema验证...\n');
    console.log(`📊 数据库: ${config.database}@${config.host}:${config.port}\n`);

    const connected = await this.connect();
    if (!connected) return;

    try {
      await this.validateSessionManagementSchema();
      await this.validateIndexes();
      await this.runPerformanceTests();
      await this.analyzeAndRecommend();
      await this.generateSQLRecommendations();

      // 输出总结
      console.log('\n📋 验证总结:');
      const tableOK = this.results.tableChecks.filter(t => t.exists).length;
      const indexOK = this.results.indexChecks.filter(i => i.exists).length;
      const perfOK = this.results.performanceTests.filter(p => p.isGood).length;
      
      console.log(`   表结构: ${tableOK}/${this.results.tableChecks.length} ✓`);
      console.log(`   索引: ${indexOK}/${this.results.indexChecks.length} ✓`);
      console.log(`   性能测试: ${perfOK}/${this.results.performanceTests.length} ✓`);
      
      const overallScore = Math.round(
        (tableOK / this.results.tableChecks.length + 
         indexOK / this.results.indexChecks.length + 
         perfOK / this.results.performanceTests.length) / 3 * 100
      );
      
      console.log(`   整体评分: ${overallScore}% ${overallScore >= 90 ? '🎉' : overallScore >= 70 ? '👍' : '⚠️'}`);

    } catch (error) {
      console.error('❌ 验证过程中发生错误:', error.message);
    } finally {
      await this.disconnect();
    }
  }
}

// 主执行
if (require.main === module) {
  const validator = new SchemaValidator();
  validator.run().then(() => {
    console.log('\n✨ 验证完成!');
    process.exit(0);
  }).catch(error => {
    console.error('💥 验证失败:', error.message);
    process.exit(1);
  });
}

module.exports = SchemaValidator;