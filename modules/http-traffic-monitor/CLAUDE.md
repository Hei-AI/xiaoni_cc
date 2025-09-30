# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the HTTP Traffic Monitor module.

# HTTP流量监控模块 - 技术文档

## 模块概述

HTTP Traffic Monitor是QQ智能机器人项目的独立监控模块，专门用于捕获、记录和分析容器内所有HTTP出站流量。通过mitmproxy代理技术，实现对SDK调用（特别是Gemini AI API）的透明化监控。

## 🏗️ 架构设计

### 核心组件
```
http-traffic-monitor/
├── Node.js服务层      # 服务管理和API接口
├── mitmproxy代理层    # HTTP流量拦截和解密
├── 数据存储层         # MySQL流量日志存储
└── Web界面层         # Admin Panel集成展示
```

### 技术栈
- **Node.js + TypeScript** - 服务层开发
- **mitmproxy + Python** - 流量代理和拦截
- **MySQL** - 数据持久化存储
- **React** - Web界面展示（集成到Admin Panel）

## 🔧 技术原理

### 1. 流量拦截机制

**代理劫持原理：**
```bash
# 目标容器环境变量配置
HTTP_PROXY=http://http-traffic-monitor:8888
HTTPS_PROXY=http://http-traffic-monitor:8888
NODE_TLS_REJECT_UNAUTHORIZED=0
```

**流量路径：**
```
Gemini SDK → Node.js HTTP模块 → 环境变量代理 → mitmproxy:8888 → 目标API服务器
                                                   ↓
                                              流量记录服务
                                                   ↓
                                              MySQL数据库
```

### 2. HTTPS解密机制

**mitmproxy中间人攻击原理：**
1. mitmproxy生成自签名CA证书
2. 容器内安装此CA证书到信任存储
3. mitmproxy为每个域名动态生成服务器证书
4. 建立两条独立的TLS连接：
   - 客户端 ↔ mitmproxy (TLS₁)
   - mitmproxy ↔ 服务器 (TLS₂)
5. mitmproxy在中间解密、记录、转发

### 3. 数据记录策略

**异步记录设计：**
- 主流程不阻塞，确保API调用性能
- 后台异步写入数据库
- 支持批量写入优化
- 错误重试机制

## 📊 数据库设计

### http_traffic_logs表结构

```sql
CREATE TABLE http_traffic_logs (
  -- 主键和关联
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  trace_id VARCHAR(36) COMMENT '追踪ID，关联现有系统',
  container_name VARCHAR(50) DEFAULT 'qqbot-core',
  service_name VARCHAR(50) COMMENT '服务名称标识',

  -- 请求信息
  method VARCHAR(10) NOT NULL COMMENT 'HTTP方法',
  url TEXT NOT NULL COMMENT '完整URL',
  host VARCHAR(255) COMMENT '目标主机',
  path TEXT COMMENT 'URL路径',
  query_params JSON COMMENT '查询参数',
  request_headers JSON COMMENT '请求头',
  request_body LONGTEXT COMMENT '请求体',
  request_size INT COMMENT '请求大小(字节)',

  -- 响应信息
  response_status INT COMMENT 'HTTP状态码',
  response_headers JSON COMMENT '响应头',
  response_body LONGTEXT COMMENT '响应体',
  response_size INT COMMENT '响应大小(字节)',

  -- 性能指标
  duration_ms INT COMMENT '请求耗时(毫秒)',
  timestamp DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),

  -- 分类标记
  is_ai_request BOOLEAN DEFAULT FALSE COMMENT '是否AI API请求',
  api_type VARCHAR(50) COMMENT 'API类型: gemini, openai等',

  -- 安全和调试
  client_ip VARCHAR(45) COMMENT '客户端IP',
  user_agent TEXT COMMENT 'User-Agent',
  error_message TEXT COMMENT '错误信息',

  -- 索引优化
  INDEX idx_trace_id (trace_id),
  INDEX idx_timestamp (timestamp),
  INDEX idx_ai_request (is_ai_request),
  INDEX idx_api_type (api_type),
  INDEX idx_host_path (host, path(100)),
  INDEX idx_status (response_status),

  -- 全文搜索索引
  FULLTEXT idx_url_search (url),
  FULLTEXT idx_body_search (request_body, response_body)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 数据生命周期管理

**数据清理策略：**
- 保留最近30天的详细记录
- 压缩存储超过7天的响应体
- 定期清理超过90天的历史数据
- 保留AI请求的长期统计信息

## 🐍 mitmproxy插件设计

### addon.py核心功能

```python
class HTTPTrafficLogger:
    def __init__(self):
        self.db_pool = self._create_connection_pool()

    def request(self, flow: http.HTTPFlow) -> None:
        """请求拦截 - 记录开始时间和生成trace_id"""
        flow.metadata['start_time'] = datetime.now()
        flow.metadata['trace_id'] = str(uuid.uuid4())

    def response(self, flow: http.HTTPFlow) -> None:
        """响应拦截 - 记录完整HTTP交互"""
        # 计算响应时间
        # 判断API类型
        # 构造日志数据
        # 异步保存到数据库

    def _is_ai_request(self, host: str) -> bool:
        """智能识别AI API请求"""
        ai_patterns = [
            'generativelanguage.googleapis.com',  # Gemini
            'api.openai.com',                     # OpenAI
            'api.anthropic.com',                  # Claude
            'api.cohere.ai'                       # Cohere
        ]
        return any(pattern in host for pattern in ai_patterns)
```

### 证书管理

**自动证书安装：**
```bash
# scripts/install-certs.sh
#!/bin/bash
# 生成mitmproxy CA证书
mitmproxy --set confdir=/app/mitmproxy &
sleep 5
pkill mitmproxy

# 安装到系统信任存储
cp /app/mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/mitmproxy.crt
update-ca-certificates
```

## 🌐 Web界面设计

### Admin Panel集成

**新增页面：**
- `/http-traffic` - 流量监控主页面
- `/http-traffic/:id` - 单条记录详情页面
- `/http-traffic/stats` - 流量统计面板

**核心功能：**
1. **实时流量列表** - 显示最新的HTTP请求
2. **智能筛选** - 按API类型、状态码、时间范围筛选
3. **搜索功能** - 全文搜索URL和请求内容
4. **JSON美化** - 格式化显示请求响应体
5. **统计面板** - API调用频率、错误率分析
6. **导出功能** - 支持CSV/JSON格式导出

### API接口设计

```typescript
// GET /api/http-traffic
interface TrafficListParams {
  page?: number;
  limit?: number;
  method?: string;
  host?: string;
  status?: number;
  is_ai_request?: boolean;
  start_time?: string;
  end_time?: string;
  search?: string;
}

// GET /api/http-traffic/:id
interface TrafficDetail {
  id: number;
  trace_id: string;
  request_info: RequestInfo;
  response_info: ResponseInfo;
  metadata: TrafficMetadata;
}

// GET /api/http-traffic/stats
interface TrafficStats {
  total_requests: number;
  ai_requests: number;
  error_rate: number;
  avg_response_time: number;
  top_apis: ApiStatistic[];
  hourly_distribution: HourlyData[];
}
```

## 🚀 部署配置

### Docker集成

**独立容器部署：**
```yaml
# docker-compose.yml扩展
services:
  http-traffic-monitor:
    build: ./modules/http-traffic-monitor
    container_name: qqbot-traffic-monitor
    ports:
      - "8888:8888"  # mitmproxy端口
      - "9090:9090"  # 管理API端口
    environment:
      - DB_HOST=localhost
      - DB_USER=qqbot_user
      - DB_PASSWORD=qqbot_password
      - DB_NAME=qqbot_db
      - PROXY_PORT=8888
      - API_PORT=9090
    networks:
      - qqbot-network
    depends_on:
      - mysql

  qqbot-core:
    environment:
      - HTTP_PROXY=http://qqbot-traffic-monitor:8888
      - HTTPS_PROXY=http://qqbot-traffic-monitor:8888
      - NODE_TLS_REJECT_UNAUTHORIZED=0
    depends_on:
      - http-traffic-monitor
```

### 环境变量配置

```bash
# 代理配置
PROXY_PORT=8888
API_PORT=9090

# 数据库配置
DB_HOST=localhost
DB_USER=qqbot_user
DB_PASSWORD=qqbot_password
DB_NAME=qqbot_db

# 功能开关
ENABLE_TRAFFIC_LOGGING=true
ENABLE_RESPONSE_BODY_LOGGING=true
ENABLE_BINARY_DATA_LOGGING=false
MAX_BODY_SIZE=1048576  # 1MB

# 性能配置
LOG_BATCH_SIZE=100
LOG_FLUSH_INTERVAL=5000  # 5秒
CONNECTION_POOL_SIZE=10
```

## 🔧 开发工作流

### 本地开发

```bash
# 启动开发环境
cd modules/http-traffic-monitor
npm install
npm run dev

# 启动mitmproxy
./scripts/start-proxy.sh

# 测试流量捕获
npm run test-traffic
```

### 调试方法

**mitmproxy调试：**
```bash
# 启动mitmproxy web界面
mitmproxy -s mitmproxy/addon.py --web-host 0.0.0.0 --web-port 8081

# 访问: http://localhost:8081 查看实时流量
```

**数据库调试：**
```sql
-- 查看最新流量记录
SELECT * FROM http_traffic_logs
ORDER BY timestamp DESC
LIMIT 10;

-- 查看AI请求统计
SELECT api_type, COUNT(*) as count, AVG(duration_ms) as avg_time
FROM http_traffic_logs
WHERE is_ai_request = TRUE
GROUP BY api_type;
```

## 📈 性能优化

### 数据库优化

1. **索引策略** - 针对常用查询字段建立复合索引
2. **分区表** - 按时间分区提高查询性能
3. **数据压缩** - 使用JSON压缩减少存储空间
4. **读写分离** - 考虑使用读副本提高查询性能

### 代理性能

1. **异步处理** - 所有数据库操作异步执行
2. **批量写入** - 合并多条记录减少IO操作
3. **内存缓存** - 缓存频繁查询的数据
4. **连接池** - 复用数据库连接

## 🔒 安全考虑

### 数据安全

1. **敏感信息脱敏** - 自动检测并脱敏API密钥
2. **访问控制** - 基于角色的数据访问权限
3. **数据加密** - 敏感响应体加密存储
4. **审计日志** - 记录数据访问操作

### 网络安全

1. **证书管理** - 安全的CA证书生成和分发
2. **网络隔离** - 容器间网络隔离
3. **流量过滤** - 可配置的敏感域名过滤
4. **监控告警** - 异常流量模式检测

## 🧪 测试策略

### 单元测试

```bash
# 运行单元测试
npm test

# 测试覆盖率
npm run test:coverage
```

### 集成测试

```bash
# 测试mitmproxy插件
python -m pytest mitmproxy/tests/

# 测试数据库集成
npm run test:database

# 测试API接口
npm run test:api
```

### 端到端测试

```bash
# 启动完整环境
docker-compose up -d

# 运行E2E测试
npm run test:e2e
```

## 📚 故障排除

### 常见问题

1. **代理连接失败**
   - 检查容器网络配置
   - 验证环境变量设置
   - 查看mitmproxy启动日志

2. **HTTPS解密失败**
   - 确认CA证书安装
   - 检查NODE_TLS_REJECT_UNAUTHORIZED设置
   - 验证证书信任链

3. **数据库连接错误**
   - 检查数据库连接参数
   - 验证表结构是否正确
   - 查看连接池状态

### 日志分析

```bash
# 查看服务日志
docker logs qqbot-traffic-monitor

# 查看mitmproxy日志
tail -f logs/mitmproxy.log

# 查看数据库慢查询
SHOW PROCESSLIST;
```

## 🔄 版本升级

### 数据迁移

```sql
-- 版本升级SQL脚本示例
ALTER TABLE http_traffic_logs
ADD COLUMN request_id VARCHAR(36) AFTER trace_id;

-- 数据迁移脚本
UPDATE http_traffic_logs
SET request_id = UUID()
WHERE request_id IS NULL;
```

### 配置更新

```bash
# 备份现有配置
cp config/production.json config/production.json.bak

# 应用新配置
npm run migrate:config
```

## 💡 最佳实践

### 开发建议

1. **渐进式部署** - 先在测试环境验证，再部署到生产
2. **监控指标** - 设置关键指标的监控和告警
3. **性能测试** - 定期进行压力测试验证性能
4. **文档维护** - 及时更新API文档和配置说明

### 运维建议

1. **定期备份** - 数据库定期备份和恢复测试
2. **日志轮转** - 配置日志轮转防止磁盘空间不足
3. **资源监控** - 监控CPU、内存、磁盘使用情况
4. **安全更新** - 及时更新依赖包和基础镜像

---

## 📞 支持和维护

如需技术支持或发现问题，请：
1. 查阅本文档的故障排除章节
2. 检查GitHub Issues中的已知问题
3. 提交详细的Bug报告或功能请求

本模块采用现代化的微服务架构，提供企业级的HTTP流量监控能力，特别适合AI API集成的调试和性能优化场景。