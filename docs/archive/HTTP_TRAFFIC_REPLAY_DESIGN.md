# HTTP流量监控与可编辑重放系统 - 技术设计文档

**版本**: v1.0
**日期**: 2025-10-01
**项目**: QQ智能机器人 - HTTP流量监控模块
**状态**: 设计阶段

---

## 1. 项目概述

### 1.1 背景
在QQ智能机器人项目中，已实现透明代理方式捕获容器HTTP流量并记录到JSONL文件（Step 1完成）。现需实现管理面板的流量查看、筛选和**可编辑参数的流量重放**功能（Step 2）。

### 1.2 目标
- 将JSONL日志数据导入MySQL数据库，实现高效查询和管理
- 提供可视化管理界面，支持流量记录的查看、筛选和搜索
- 实现**完全可编辑参数**的流量重放功能，支持修改URL、Headers、Body等所有请求参数
- 提供原始请求与重放结果的可视化对比
- 支持批量重放和重放模板管理

### 1.3 技术栈
- **数据库**: MySQL 8.0
- **后端**: Node.js + TypeScript + Express
- **前端**: React 18 + TypeScript + TanStack Query + shadcn/ui
- **其他**: deep-diff (差异对比), node-fetch (HTTP客户端), chokidar (文件监听)

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    HTTP流量监控与重放系统                         │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   容器流量   │ ───▶ │   mitmproxy  │ ───▶ │ JSONL日志文件 │
│   (已完成)   │      │   透明代理   │      │   (实时写入)  │
└──────────────┘      └──────────────┘      └──────────────┘
                                                    │
                                                    │ 增量导入
                                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│                         MySQL数据库                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │http_traffic_logs │  │replay_history    │  │replay_templates│ │
│  │  (流量记录主表)  │  │ (重放历史记录)   │  │  (重放模板)   │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                           ▲                  ▲
                           │ 读写             │ 读写
                           │                  │
┌──────────────────────────┴──────────────────┴───────────────────┐
│                    Backend API服务层                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐│
│  │  流量查询API    │  │  重放执行API    │  │  模板管理API    ││
│  │ /traffic/logs   │  │ /traffic/replay │  │/replay/templates││
│  └─────────────────┘  └─────────────────┘  └─────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTP API调用
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│                    Frontend管理界面                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐│
│  │  流量列表页面   │  │  流量详情页面   │  │  重放编辑器组件 ││
│  │  (筛选/搜索)    │  │  (查看/重放)    │  │  (参数编辑)     ││
│  └─────────────────┘  └─────────────────┘  └─────────────────┘│
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │  结果对比组件   │  │  批量重放界面   │                      │
│  │  (Diff展示)     │  │  (多选/批处理)  │                      │
│  └─────────────────┘  └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流向

#### 2.2.1 流量捕获到存储流程
```
容器HTTP请求 → iptables → mitmproxy → JSONL文件 (实时追加)
                                          ↓
                                    log-importer服务 (每10秒扫描)
                                          ↓
                                    增量读取 + 批量插入
                                          ↓
                                    MySQL数据库
```

#### 2.2.2 流量重放流程
```
用户选择流量记录 → 打开参数编辑器 → 修改请求参数
                                          ↓
                                    点击"重放请求"
                                          ↓
                               后端重建HTTP请求 (应用修改)
                                          ↓
                                    发送到目标服务器
                                          ↓
                                    记录响应结果
                                          ↓
                          对比原始响应 vs 重放响应 (生成Diff)
                                          ↓
                          保存到 replay_history 表
                                          ↓
                          前端展示对比结果 (可视化Diff)
```

---

## 3. 数据库设计

### 3.1 表结构设计

#### 3.1.1 http_traffic_logs (流量记录主表)

**用途**: 存储所有捕获的HTTP流量记录

| 字段名 | 类型 | 索引 | 说明 |
|--------|------|------|------|
| id | BIGINT | PK | 主键，自增 |
| request_id | VARCHAR(36) | - | 请求唯一标识 (UUID) |
| trace_id | VARCHAR(36) | INDEX | 追踪ID，可关联对话记录 |
| container_name | VARCHAR(50) | - | 发起请求的容器名称 |
| service_name | VARCHAR(50) | - | 服务名称标识 |
| **method** | VARCHAR(10) | - | HTTP方法 (GET/POST/PUT...) |
| **url** | TEXT | FULLTEXT | 完整URL |
| **host** | VARCHAR(255) | INDEX | 目标主机 |
| **path** | TEXT | - | URL路径 |
| **query_params** | JSON | - | 查询参数 (JSON格式) |
| **request_headers** | JSON | - | 请求头 (JSON格式) |
| **request_body** | LONGTEXT | FULLTEXT | 请求体内容 |
| request_content_type | VARCHAR(100) | - | 请求Content-Type |
| request_size | INT | - | 请求大小 (字节) |
| **response_status** | INT | INDEX | HTTP响应状态码 |
| **response_headers** | JSON | - | 响应头 (JSON格式) |
| **response_body** | LONGTEXT | FULLTEXT | 响应体内容 |
| response_content_type | VARCHAR(100) | - | 响应Content-Type |
| response_size | INT | - | 响应大小 (字节) |
| **duration_ms** | INT | - | 请求总耗时 (毫秒) |
| dns_lookup_ms | INT | - | DNS查询耗时 |
| tcp_connect_ms | INT | - | TCP连接耗时 |
| tls_handshake_ms | INT | - | TLS握手耗时 |
| server_processing_ms | INT | - | 服务器处理耗时 |
| request_timestamp | DATETIME(3) | INDEX | 请求时间 (毫秒精度) |
| response_timestamp | DATETIME(3) | - | 响应时间 |
| **is_ai_request** | BOOLEAN | INDEX | 是否AI API请求 |
| **api_type** | VARCHAR(50) | INDEX | API类型 (gemini/openai/claude) |
| api_version | VARCHAR(20) | - | API版本 |
| client_ip | VARCHAR(45) | - | 客户端IP (支持IPv6) |
| user_agent | TEXT | - | User-Agent |
| referer | TEXT | - | Referer头 |
| error_message | TEXT | - | 错误信息 |
| error_code | VARCHAR(50) | - | 错误代码 |
| retry_count | INT | - | 重试次数 |
| is_cached_response | BOOLEAN | - | 是否缓存响应 |
| is_truncated | BOOLEAN | - | 内容是否被截断 |
| is_binary_data | BOOLEAN | - | 是否二进制数据 |
| conversation_id | VARCHAR(36) | INDEX | 关联对话ID |
| user_id | VARCHAR(50) | - | 关联用户ID |
| session_id | VARCHAR(36) | - | 会话ID |

**索引策略**:
```sql
INDEX idx_trace_id (trace_id)
INDEX idx_timestamp (request_timestamp)
INDEX idx_ai_request (is_ai_request)
INDEX idx_api_type (api_type)
INDEX idx_host_path (host, path(100))
INDEX idx_status (response_status)
INDEX idx_conversation (conversation_id)
FULLTEXT idx_url_search (url)
FULLTEXT idx_body_search (request_body, response_body)
```

#### 3.1.2 traffic_replay_history (重放历史记录表)

**用途**: 记录每次流量重放的配置和结果

| 字段名 | 类型 | 索引 | 说明 |
|--------|------|------|------|
| id | BIGINT | PK | 主键，自增 |
| original_log_id | BIGINT | FK, INDEX | 原始流量记录ID |
| replayed_at | DATETIME(3) | INDEX | 重放时间 |
| replayed_by | VARCHAR(50) | - | 重放操作者 |
| **modified_method** | VARCHAR(10) | - | 修改后的HTTP方法 |
| **modified_url** | TEXT | - | 修改后的URL |
| **modified_headers** | JSON | - | 修改后的Headers |
| **modified_body** | LONGTEXT | - | 修改后的Body |
| **modification_summary** | JSON | - | 修改汇总 (哪些字段被修改) |
| replay_request_headers | JSON | - | 实际发送的请求头 |
| replay_request_body | LONGTEXT | - | 实际发送的请求体 |
| **replay_response_status** | INT | - | 重放响应状态码 |
| **replay_duration_ms** | INT | - | 重放耗时 |
| **replay_response_headers** | JSON | - | 重放响应头 |
| **replay_response_body** | LONGTEXT | - | 重放响应体 |
| replay_response_size | INT | - | 重放响应大小 |
| **diff_summary** | JSON | - | 差异汇总 (JSON Diff结果) |
| status_code_match | BOOLEAN | - | 状态码是否匹配 |
| response_body_match | BOOLEAN | - | 响应体是否匹配 |
| duration_diff_ms | INT | - | 耗时差异 |
| body_size_diff | INT | - | 响应体大小差异 |
| success | BOOLEAN | - | 重放是否成功 |
| error_message | TEXT | - | 错误信息 |
| timeout | INT | - | 超时设置 (毫秒) |
| template_id | INT | - | 使用的模板ID (可为空) |

**外键约束**:
```sql
FOREIGN KEY (original_log_id) REFERENCES http_traffic_logs(id) ON DELETE CASCADE
```

**索引策略**:
```sql
INDEX idx_original_log (original_log_id)
INDEX idx_replayed_at (replayed_at)
INDEX idx_replayed_by (replayed_by)
INDEX idx_success (success)
```

#### 3.1.3 traffic_replay_templates (重放模板表)

**用途**: 保存常用的参数修改模板，便于批量应用

| 字段名 | 类型 | 索引 | 说明 |
|--------|------|------|------|
| id | INT | PK | 主键，自增 |
| template_name | VARCHAR(100) | UNIQUE | 模板名称 |
| description | TEXT | - | 模板描述 |
| target_api_type | VARCHAR(50) | INDEX | 目标API类型 |
| target_host_pattern | VARCHAR(255) | - | 目标主机匹配模式 (支持通配符) |
| target_path_pattern | VARCHAR(255) | - | 目标路径匹配模式 |
| **header_modifications** | JSON | - | Header修改规则 |
| **body_modifications** | JSON | - | Body修改规则 (支持JSONPath) |
| **query_modifications** | JSON | - | Query参数修改规则 |
| url_replacement_pattern | VARCHAR(500) | - | URL替换模式 (正则表达式) |
| url_replacement_value | VARCHAR(500) | - | URL替换值 |
| is_active | BOOLEAN | - | 是否启用 |
| usage_count | INT | - | 使用次数 |
| created_by | VARCHAR(50) | - | 创建者 |
| created_at | DATETIME | - | 创建时间 |
| updated_at | DATETIME | - | 更新时间 |

**JSON字段结构示例**:
```json
// header_modifications
{
  "add": {
    "X-Custom-Header": "value",
    "Authorization": "Bearer new-token"
  },
  "remove": ["X-Old-Header"],
  "replace": {
    "Content-Type": "application/json"
  }
}

// body_modifications (支持JSONPath)
{
  "set": {
    "$.user.name": "new_name",
    "$.settings.enabled": true
  },
  "remove": ["$.sensitive_field"],
  "replace_entire": null  // 如果不为null，则替换整个body
}

// query_modifications
{
  "add": {"newParam": "value"},
  "remove": ["oldParam"],
  "replace": {"existingParam": "newValue"}
}
```

#### 3.1.4 log_import_state (导入状态表)

**用途**: 追踪JSONL文件的导入进度，实现增量导入

| 字段名 | 类型 | 索引 | 说明 |
|--------|------|------|------|
| id | INT | PK | 主键，自增 |
| file_path | VARCHAR(255) | UNIQUE | JSONL文件路径 |
| file_inode | BIGINT | - | 文件inode (防止文件重命名) |
| file_size | BIGINT | - | 文件大小 |
| last_position | BIGINT | - | 上次读取到的位置 (字节偏移) |
| last_import_time | DATETIME | - | 上次导入时间 |
| records_imported | INT | - | 已导入记录数 |
| records_failed | INT | - | 导入失败记录数 |
| status | ENUM | INDEX | 状态: active/completed/error/paused |
| error_message | TEXT | - | 错误信息 |
| import_started_at | DATETIME | - | 首次导入时间 |

---

## 4. 后端设计

### 4.1 模块职责划分

#### 4.1.1 后端负责内容总览

| 模块 | 位置 | 职责 |
|------|------|------|
| **JSONL增量导入服务** | `modules/http-traffic-monitor/services/log-importer.ts` | 监听JSONL文件，增量读取并批量导入MySQL |
| **流量查询服务** | `modules/admin-panel/backend/src/routes/traffic-monitor-routes.ts` | 提供流量记录的CRUD和筛选API |
| **流量重放服务** | `modules/admin-panel/backend/src/services/traffic-replay-service.ts` | 执行流量重放，应用参数修改，记录结果 |
| **结果对比服务** | `modules/admin-panel/backend/src/services/response-comparator.ts` | 对比原始响应和重放响应，生成差异报告 |
| **模板管理服务** | `modules/admin-panel/backend/src/routes/template-routes.ts` | 管理重放模板的CRUD |
| **数据库迁移** | `database/migrations/004_create_http_traffic_tables.sql` | 创建所有表结构和索引 |

### 4.2 JSONL增量导入服务

**文件**: `modules/http-traffic-monitor/services/log-importer.ts`

#### 4.2.1 核心功能
- 监听JSONL日志目录，自动发现新文件
- 增量读取文件内容（基于last_position）
- 批量插入MySQL（默认100条/批，或5秒超时）
- 错误重试和日志记录
- 防止重复导入（基于file_inode + last_position）

#### 4.2.2 关键接口

```typescript
interface LogImporterConfig {
  logDir: string;              // JSONL日志目录
  filePattern: string;         // 文件名模式 (如 traffic-*.jsonl)
  batchSize: number;           // 批量插入大小
  flushInterval: number;       // 刷新间隔 (毫秒)
  scanInterval: number;        // 扫描间隔 (毫秒)
}

class TrafficLogImporter {
  constructor(db: DatabaseManager, config: LogImporterConfig);

  // 启动增量导入服务
  async start(): Promise<void>;

  // 停止服务
  async stop(): Promise<void>;

  // 导入单个文件
  async importFile(filePath: string): Promise<ImportResult>;

  // 获取导入状态
  async getImportState(filePath: string): Promise<ImportState>;
}

interface ImportResult {
  success: boolean;
  recordsImported: number;
  recordsFailed: number;
  duration: number;
  errors: string[];
}
```

#### 4.2.3 实现逻辑

```typescript
async importFile(filePath: string): Promise<ImportResult> {
  // 1. 加载导入状态
  const state = await this.loadState(filePath);

  // 2. 打开文件流，从last_position开始读取
  const stream = fs.createReadStream(filePath, {
    start: state.lastPosition,
    encoding: 'utf8'
  });

  // 3. 按行读取并解析JSON
  const rl = readline.createInterface({ input: stream });
  let buffer = [];
  let currentPosition = state.lastPosition;

  for await (const line of rl) {
    // 跳过空行和文件头
    if (!line.trim() || line.includes('log_file_header')) continue;

    try {
      const record = JSON.parse(line);
      buffer.push(this.transformRecord(record));

      // 批量插入
      if (buffer.length >= this.batchSize) {
        await this.flushBuffer(buffer);
        buffer = [];
      }

      currentPosition += Buffer.byteLength(line, 'utf8') + 1;

    } catch (error) {
      console.error('Parse error:', error);
    }
  }

  // 4. 刷新剩余缓冲
  if (buffer.length > 0) {
    await this.flushBuffer(buffer);
  }

  // 5. 更新导入状态
  await this.updateState(filePath, currentPosition);

  return { success: true, recordsImported: count };
}
```

### 4.3 流量重放服务

**文件**: `modules/admin-panel/backend/src/services/traffic-replay-service.ts`

#### 4.3.1 核心功能
- 从数据库加载原始请求
- 应用用户修改（URL、Headers、Body等）
- 重建完整HTTP请求
- 发送请求到目标服务器
- 记录响应和性能指标
- 对比原始响应和重放响应
- 保存重放历史

#### 4.3.2 关键接口

```typescript
interface ReplayRequest {
  originalLogId: number;
  modifications?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
    queryParams?: Record<string, string>;
  };
  timeout?: number;
  followRedirects?: boolean;
  validateSSL?: boolean;
}

interface ReplayResult {
  success: boolean;
  replayHistoryId: number;
  originalLog: TrafficLog;
  modifiedRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  replayResponse: {
    status: number;
    headers: Record<string, string>;
    body: string;
    duration: number;
  };
  comparison: {
    statusMatch: boolean;
    bodyDiff: any[];            // deep-diff结果
    durationDiff: number;
    bodySizeDiff: number;
    headersDiff: any[];
  };
  error?: string;
}

class TrafficReplayService {
  constructor(db: DatabaseManager);

  // 重放单个请求
  async replayRequest(config: ReplayRequest): Promise<ReplayResult>;

  // 批量重放
  async batchReplay(
    logIds: number[],
    modifications?: any,
    concurrency?: number
  ): Promise<ReplayResult[]>;

  // 应用模板重放
  async replayWithTemplate(
    logId: number,
    templateId: number
  ): Promise<ReplayResult>;

  // 查询重放历史
  async getReplayHistory(originalLogId: number): Promise<ReplayHistory[]>;
}
```

#### 4.3.3 实现逻辑

```typescript
async replayRequest(config: ReplayRequest): Promise<ReplayResult> {
  // 1. 加载原始日志
  const originalLog = await this.db.query(
    'SELECT * FROM http_traffic_logs WHERE id = ?',
    [config.originalLogId]
  );

  // 2. 应用修改
  const modifiedRequest = {
    method: config.modifications?.method || originalLog.method,
    url: this.buildModifiedUrl(originalLog, config.modifications),
    headers: {
      ...JSON.parse(originalLog.request_headers),
      ...config.modifications?.headers
    },
    body: config.modifications?.body !== undefined
      ? config.modifications.body
      : originalLog.request_body
  };

  // 3. 发送HTTP请求
  const startTime = Date.now();
  let replayResponse;

  try {
    const response = await fetch(modifiedRequest.url, {
      method: modifiedRequest.method,
      headers: modifiedRequest.headers,
      body: modifiedRequest.body,
      timeout: config.timeout || 30000,
      redirect: config.followRedirects ? 'follow' : 'manual'
    });

    replayResponse = {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
      duration: Date.now() - startTime
    };

  } catch (error) {
    throw new Error(`Replay failed: ${error.message}`);
  }

  // 4. 对比结果
  const comparison = await this.compareResponses(
    originalLog,
    replayResponse
  );

  // 5. 保存重放历史
  const historyId = await this.saveReplayHistory({
    originalLogId: config.originalLogId,
    modifiedRequest,
    replayResponse,
    comparison,
    modificationSummary: this.generateModificationSummary(
      originalLog,
      config.modifications
    )
  });

  return {
    success: true,
    replayHistoryId: historyId,
    originalLog,
    modifiedRequest,
    replayResponse,
    comparison
  };
}
```

### 4.4 响应对比服务

**文件**: `modules/admin-panel/backend/src/services/response-comparator.ts`

#### 4.4.1 核心功能
- 对比HTTP状态码
- 对比响应体（支持JSON和文本）
- 对比响应头
- 对比性能指标（响应时间、大小）
- 生成结构化的差异报告

#### 4.4.2 关键接口

```typescript
interface ComparisonResult {
  statusMatch: boolean;
  statusOriginal: number;
  statusReplayed: number;

  bodyMatch: boolean;
  bodyDiff: DiffNode[];        // deep-diff结果
  bodyOriginal: any;
  bodyReplayed: any;
  bodySizeDiff: number;

  headersDiff: HeaderDiff[];

  durationOriginal: number;
  durationReplayed: number;
  durationDiff: number;
  durationDiffPercent: number;

  overallSimilarity: number;   // 0-100，相似度评分
}

interface DiffNode {
  kind: 'N' | 'D' | 'E' | 'A'; // New/Deleted/Edited/Array
  path: string[];
  lhs?: any;                   // 左侧值 (原始)
  rhs?: any;                   // 右侧值 (重放)
}

interface HeaderDiff {
  key: string;
  type: 'added' | 'removed' | 'changed';
  original?: string;
  replayed?: string;
}

class ResponseComparator {
  // 对比两个响应
  compare(
    original: TrafficLog,
    replayed: ReplayResponse
  ): ComparisonResult;

  // 计算相似度评分
  calculateSimilarity(comparison: ComparisonResult): number;

  // 格式化差异为人类可读文本
  formatDiffReport(comparison: ComparisonResult): string;
}
```

---

## 5. 前端设计

### 5.1 模块职责划分

#### 5.1.1 前端负责内容总览

| 组件/页面 | 位置 | 职责 |
|-----------|------|------|
| **流量监控列表页** | `pages/HttpTrafficMonitorPage.tsx` | 展示流量列表，筛选，搜索，导出，批量重放入口 |
| **流量详情页** | `pages/HttpTrafficDetailPage.tsx` | 展示单条记录完整信息，重放入口 |
| **重放参数编辑器** | `components/TrafficReplayEditor.tsx` | 可编辑的请求参数表单（核心组件） |
| **重放结果对比器** | `components/ReplayResultComparison.tsx` | 可视化对比原始vs重放结果 |
| **批量重放界面** | `components/BatchReplayDialog.tsx` | 批量选择和重放配置 |
| **重放历史列表** | `components/ReplayHistoryList.tsx` | 展示某条记录的所有重放历史 |
| **模板管理页** | `pages/ReplayTemplatesPage.tsx` | 管理重放模板，创建/编辑/删除 |
| **模板选择器** | `components/TemplateSelector.tsx` | 快速应用已保存的模板 |

### 5.2 核心组件设计

#### 5.2.1 TrafficReplayEditor (重放参数编辑器)

**文件**: `modules/admin-panel/frontend/src/components/TrafficReplayEditor.tsx`

**功能**:
- 展示原始请求参数（只读背景色）
- 提供可编辑表单修改所有参数
- 实时标记已修改字段
- 支持重置到原始值
- 支持保存为模板
- JSON格式验证和美化

**Props接口**:
```typescript
interface TrafficReplayEditorProps {
  originalLog: TrafficLog;      // 原始流量记录
  onReplay: (modifications: ReplayModifications) => Promise<void>;
  onSaveTemplate?: (template: TemplateConfig) => Promise<void>;
  isReplaying?: boolean;
  error?: string;
}

interface ReplayModifications {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  queryParams?: Record<string, string>;
}
```

**UI结构**:
```
┌─────────────────────────────────────────────────────────┐
│ 请求编辑器                              [重置] [重放]    │
├─────────────────────────────────────────────────────────┤
│ [基本信息] [请求头] [请求体] [查询参数]                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  HTTP方法: [GET ▼]                                       │
│                                                          │
│  请求URL:                                                │
│  ┌────────────────────────────────────────────────────┐ │
│  │ https://api.example.com/v1/users?page=1            │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  请求头 (JSON格式):  [格式化]                            │
│  ┌────────────────────────────────────────────────────┐ │
│  │ {                                                  │ │
│  │   "Content-Type": "application/json",             │ │
│  │   "Authorization": "Bearer token123"  ← 已修改    │ │
│  │ }                                                  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  请求体:  [格式化] [从模板加载]                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │ {                                                  │ │
│  │   "username": "testuser",                         │ │
│  │   "email": "test@example.com"                     │ │
│  │ }                                                  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ✓ 已修改字段: Authorization (header), username (body)  │
│                                                          │
│  [保存为模板]  [从模板加载]                              │
└─────────────────────────────────────────────────────────┘
```

**关键功能实现**:
```typescript
// 修改追踪
const [modifications, setModifications] = useState<Set<string>>(new Set());

const handleFieldChange = (field: string, value: any) => {
  setModifications(prev => new Set(prev).add(field));
  // 更新表单值...
};

// 重置功能
const handleReset = () => {
  setMethod(originalLog.method);
  setUrl(originalLog.url);
  setHeaders(JSON.stringify(originalLog.request_headers, null, 2));
  setBody(originalLog.request_body);
  setModifications(new Set());
};

// JSON验证
const validateJson = (jsonString: string): boolean => {
  try {
    JSON.parse(jsonString);
    return true;
  } catch {
    return false;
  }
};

// 发起重放
const handleReplay = async () => {
  // 验证JSON格式
  if (!validateJson(headers)) {
    setError('请求头JSON格式错误');
    return;
  }

  const mods: ReplayModifications = {};
  if (method !== originalLog.method) mods.method = method;
  if (url !== originalLog.url) mods.url = url;
  if (headers !== JSON.stringify(originalLog.request_headers, null, 2)) {
    mods.headers = JSON.parse(headers);
  }
  if (body !== originalLog.request_body) mods.body = body;

  await onReplay(mods);
};
```

#### 5.2.2 ReplayResultComparison (结果对比组件)

**文件**: `modules/admin-panel/frontend/src/components/ReplayResultComparison.tsx`

**功能**:
- 并排展示原始响应和重放响应
- 高亮差异部分
- JSON Diff可视化
- 性能指标对比图表
- 状态码匹配提示

**Props接口**:
```typescript
interface ReplayResultComparisonProps {
  original: {
    status: number;
    headers: Record<string, string>;
    body: string;
    duration: number;
    size: number;
  };
  replayed: {
    status: number;
    headers: Record<string, string>;
    body: string;
    duration: number;
    size: number;
  };
  comparison: ComparisonResult;
  onExport?: () => void;
}
```

**UI结构**:
```
┌─────────────────────────────────────────────────────────┐
│ 响应对比结果                                   [导出报告]│
├─────────────────────────────────────────────────────────┤
│ 概览统计:                                                │
│  ✓ 状态码: 200 → 200 (匹配)                             │
│  ⚠ 响应时间: 245ms → 312ms (+67ms, +27%)               │
│  ✓ 响应大小: 1.2KB → 1.2KB (相同)                      │
│  ⚠ 发现 3 处内容差异                                    │
│  整体相似度: 94%  ███████████░                          │
├─────────────────────────────────────────────────────────┤
│ [概览] [响应体对比] [响应头对比] [性能指标]             │
├─────────────────────────────────────────────────────────┤
│ 响应体差异 (JSON Diff):                                 │
│                                                          │
│ ┌─────原始响应─────┐  ┌─────重放响应─────┐             │
│ │ {               │  │ {               │             │
│ │   "status":"ok",│  │   "status":"ok",│             │
│ │   "timestamp":  │  │   "timestamp":  │             │
│ │     1234567890  │  │     1234567999 ←差异          │
│ │   "data": {     │  │   "data": {     │             │
│ │     "id": 123   │  │     "id": 123   │             │
│ │   }             │  │   }             │             │
│ │ }               │  │ }               │             │
│ └─────────────────┘  └─────────────────┘             │
│                                                          │
│ 差异详情:                                                │
│  • $.timestamp: 1234567890 → 1234567999 (+109)         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**使用外部库**:
```typescript
import ReactDiffViewer from 'react-diff-viewer';

// JSON Diff展示
<ReactDiffViewer
  oldValue={JSON.stringify(original.body, null, 2)}
  newValue={JSON.stringify(replayed.body, null, 2)}
  splitView={true}
  leftTitle="原始响应"
  rightTitle="重放响应"
  showDiffOnly={false}
  useDarkTheme={false}
/>
```

#### 5.2.3 BatchReplayDialog (批量重放对话框)

**文件**: `modules/admin-panel/frontend/src/components/BatchReplayDialog.tsx`

**功能**:
- 展示选中的流量记录列表
- 统一配置修改参数
- 批量执行重放
- 实时显示进度
- 聚合统计结果

**Props接口**:
```typescript
interface BatchReplayDialogProps {
  selectedLogs: TrafficLog[];
  open: boolean;
  onClose: () => void;
  onComplete: (results: BatchReplayResult) => void;
}

interface BatchReplayResult {
  total: number;
  successful: number;
  failed: number;
  results: ReplayResult[];
  aggregateStats: {
    avgDurationDiff: number;
    statusMatchRate: number;
    bodyMatchRate: number;
  };
}
```

**UI结构**:
```
┌─────────────────────────────────────────────────────────┐
│ 批量重放请求                          [X]                │
├─────────────────────────────────────────────────────────┤
│ 已选择 15 条流量记录                                     │
│                                                          │
│ 统一修改配置 (可选):                                     │
│ ┌────────────────────────────────────────────────────┐ │
│ │ □ 修改HTTP方法: [POST ▼]                           │ │
│ │ □ 替换URL中的参数: key=[__________]                │ │
│ │ ☑ 添加/修改Headers:                                 │ │
│ │   Authorization: Bearer new-token-123              │ │
│ │ □ 修改请求体: [从模板加载 ▼]                       │ │
│ └────────────────────────────────────────────────────┘ │
│                                                          │
│ 高级选项:                                                │
│  并发数: [5 ▼]  超时: [30]秒  □ 失败自动重试            │
│                                                          │
│ 进度: ███████░░░░░░ 7/15 (47%)                         │
│                                                          │
│ 结果预览:                                                │
│  ✓ 成功: 6   ✗ 失败: 1   ⏳ 进行中: 1   ⏸ 待执行: 7  │
│                                                          │
│              [取消]  [开始重放]                          │
└─────────────────────────────────────────────────────────┘
```

### 5.3 页面设计

#### 5.3.1 HttpTrafficMonitorPage (流量监控列表页)

**已有功能** (保持不变):
- ✅ 流量记录列表展示
- ✅ 实时刷新 (30秒)
- ✅ 统计卡片 (总请求数、AI请求数、平均响应时间、错误率)
- ✅ 筛选器 (method, status, AI类型, 时间范围)
- ✅ 搜索 (全文搜索)
- ✅ 分页
- ✅ 导出 CSV/JSON

**新增功能**:
- **批量选择**: 添加checkbox列，支持全选/单选
- **批量重放按钮**: 选中记录后，显示"批量重放"按钮
- **快速重放**: 每行添加快速重放按钮（使用默认参数）
- **重放状态指示器**: 显示哪些记录有重放历史（徽章提示）

**修改点**:
```typescript
// 添加选择状态
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

// 批量重放处理
const handleBatchReplay = () => {
  setShowBatchReplayDialog(true);
};

// 快速重放处理
const handleQuickReplay = async (logId: number) => {
  const result = await fetch(`${API_BASE_URL}/traffic/replay/${logId}`, {
    method: 'POST',
    body: JSON.stringify({ modifications: {} }) // 无修改
  });
  // 显示结果通知...
};

// 表格新增列
<TableHead>
  <input type="checkbox" onChange={handleSelectAll} />
</TableHead>

// 每行新增
<TableCell>
  <input
    type="checkbox"
    checked={selectedIds.has(log.id)}
    onChange={() => toggleSelect(log.id)}
  />
</TableCell>

// 操作列新增快速重放
<Button variant="ghost" size="sm" onClick={() => handleQuickReplay(log.id)}>
  <Play className="h-4 w-4" />
</Button>
```

#### 5.3.2 HttpTrafficDetailPage (流量详情页)

**已有功能** (保持不变):
- ✅ 完整请求/响应详情
- ✅ Headers展示
- ✅ JSON美化显示
- ✅ 性能指标展示
- ✅ Trace ID追踪
- ✅ 下载原始数据

**新增功能**:
- **重放编辑器**: 嵌入 `TrafficReplayEditor` 组件
- **重放历史标签页**: 展示该记录的所有重放历史
- **结果对比**: 重放后展示 `ReplayResultComparison` 组件
- **模板应用**: 快速应用已保存的模板

**修改点**:
```typescript
const [showReplayEditor, setShowReplayEditor] = useState(false);
const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
const [replayHistory, setReplayHistory] = useState<ReplayHistory[]>([]);

// 加载重放历史
useEffect(() => {
  if (id) {
    fetch(`${API_BASE_URL}/traffic/replay/history/${id}`)
      .then(res => res.json())
      .then(data => setReplayHistory(data.data));
  }
}, [id]);

// 执行重放
const handleReplay = async (modifications: any) => {
  const response = await fetch(`${API_BASE_URL}/traffic/replay/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modifications })
  });

  const result = await response.json();
  setReplayResult(result.data);

  // 刷新重放历史
  refetchHistory();
};

// 标签页新增
<TabsList>
  <TabsTrigger value="overview">概览</TabsTrigger>
  <TabsTrigger value="request">请求</TabsTrigger>
  <TabsTrigger value="response">响应</TabsTrigger>
  <TabsTrigger value="replay">重放 {replayHistory.length > 0 && `(${replayHistory.length})`}</TabsTrigger>
</TabsList>

<TabsContent value="replay">
  {!showReplayEditor ? (
    <div>
      <Button onClick={() => setShowReplayEditor(true)}>
        <Play className="mr-2" />
        开始重放
      </Button>

      <ReplayHistoryList history={replayHistory} />
    </div>
  ) : (
    <>
      <TrafficReplayEditor
        originalLog={log}
        onReplay={handleReplay}
      />

      {replayResult && (
        <ReplayResultComparison
          original={log}
          replayed={replayResult.replayResponse}
          comparison={replayResult.comparison}
        />
      )}
    </>
  )}
</TabsContent>
```

#### 5.3.3 ReplayTemplatesPage (模板管理页)

**新建页面**: `modules/admin-panel/frontend/src/pages/ReplayTemplatesPage.tsx`

**功能**:
- 展示所有重放模板列表
- 创建新模板
- 编辑/删除模板
- 测试模板应用效果
- 模板使用统计

**UI结构**:
```
┌─────────────────────────────────────────────────────────┐
│ 重放模板管理                              [+ 新建模板]   │
├─────────────────────────────────────────────────────────┤
│ 搜索: [________________]  筛选: [全部API类型 ▼]         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 模板名称: Gemini Token刷新                         │ │
│ │ 描述: 替换Authorization为新token                   │ │
│ │ 适用: Gemini API  |  使用次数: 156                 │ │
│ │                                                    │ │
│ │ 修改规则:                                          │ │
│ │  • Headers: 替换 Authorization                    │ │
│ │  • Body: 无修改                                   │ │
│ │                                                    │ │
│ │ [编辑] [删除] [应用到选中记录]                    │ │
│ └────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 模板名称: 测试环境URL替换                         │ │
│ │ 描述: 将生产环境URL替换为测试环境                 │ │
│ │ 适用: 所有API  |  使用次数: 89                    │ │
│ │                                                    │ │
│ │ 修改规则:                                          │ │
│ │  • URL: api.example.com → test-api.example.com   │ │
│ │  • Headers: 添加 X-Test-Mode: true               │ │
│ │                                                    │ │
│ │ [编辑] [删除] [应用到选中记录]                    │ │
│ └────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 6. API接口文档

### 6.1 流量查询API

#### 6.1.1 获取流量记录列表

**已实现** ✅

```
GET /api/traffic/logs
```

**请求参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认1 |
| limit | number | 否 | 每页记录数，默认50，最大200 |
| method | string | 否 | HTTP方法筛选 (GET/POST/PUT...) |
| host | string | 否 | 主机名筛选 (模糊匹配) |
| status | number | 否 | 状态码筛选 |
| is_ai_request | boolean | 否 | 是否AI请求 |
| api_type | string | 否 | API类型 (gemini/openai/claude) |
| trace_id | string | 否 | 追踪ID精确匹配 |
| start_time | string | 否 | 开始时间 (ISO 8601) |
| end_time | string | 否 | 结束时间 (ISO 8601) |
| search | string | 否 | 全文搜索 (URL/body) |

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "id": 12345,
      "request_id": "550e8400-e29b-41d4-a716-446655440000",
      "trace_id": "trace-abc123",
      "container_name": "qqbot-core",
      "method": "POST",
      "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
      "host": "generativelanguage.googleapis.com",
      "path": "/v1beta/models/gemini-pro:generateContent",
      "response_status": 200,
      "duration_ms": 1245,
      "request_timestamp": "2025-10-01T12:34:56.789Z",
      "is_ai_request": true,
      "api_type": "gemini",
      "api_version": "v1beta",
      "request_size": 2048,
      "response_size": 4096,
      "error_message": null,
      "retry_count": 0,
      "is_cached_response": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1523,
    "pages": 31
  },
  "timestamp": "2025-10-01T12:35:00.000Z"
}
```

#### 6.1.2 获取单条流量记录详情

**已实现** ✅

```
GET /api/traffic/logs/:id
```

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | number | 流量记录ID |

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": 12345,
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "trace_id": "trace-abc123",
    "container_name": "qqbot-core",
    "method": "POST",
    "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
    "host": "generativelanguage.googleapis.com",
    "path": "/v1beta/models/gemini-pro:generateContent",
    "query_params": {
      "key": "AIza***"
    },
    "request_headers": {
      "Content-Type": "application/json",
      "User-Agent": "google-api-nodejs-client/7.2.0"
    },
    "request_body": "{\"contents\":[{\"parts\":[{\"text\":\"Hello\"}]}],\"generationConfig\":{\"temperature\":0.9}}",
    "request_content_type": "application/json",
    "request_size": 2048,
    "response_status": 200,
    "response_headers": {
      "Content-Type": "application/json",
      "X-Response-Time": "1245ms"
    },
    "response_body": "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hi there!\"}]}}]}",
    "response_content_type": "application/json",
    "response_size": 4096,
    "duration_ms": 1245,
    "dns_lookup_ms": 5,
    "tcp_connect_ms": 12,
    "tls_handshake_ms": 45,
    "server_processing_ms": 1183,
    "request_timestamp": "2025-10-01T12:34:56.789Z",
    "response_timestamp": "2025-10-01T12:34:58.034Z",
    "is_ai_request": true,
    "api_type": "gemini",
    "api_version": "v1beta",
    "client_ip": "172.20.0.5",
    "user_agent": "google-api-nodejs-client/7.2.0",
    "error_message": null,
    "conversation_id": "conv-xyz789"
  },
  "timestamp": "2025-10-01T12:35:00.000Z"
}
```

#### 6.1.3 获取流量统计数据

**已实现** ✅

```
GET /api/traffic/stats
```

**请求参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| range | string | 否 | 时间范围: 1h/24h/7d/30d，默认24h |

**响应示例**:
```json
{
  "success": true,
  "data": {
    "overview": {
      "total_requests": 15234,
      "ai_requests": 3456,
      "successful_requests": 14890,
      "failed_requests": 344,
      "avg_response_time": 856,
      "min_response_time": 23,
      "max_response_time": 8945,
      "total_request_bytes": 31457280,
      "total_response_bytes": 62914560
    },
    "api_types": [
      {
        "api_type": "gemini",
        "request_count": 2345,
        "avg_duration": 1245,
        "error_count": 23
      },
      {
        "api_type": "openai",
        "request_count": 1111,
        "avg_duration": 2156,
        "error_count": 45
      }
    ],
    "hosts": [
      {
        "host": "generativelanguage.googleapis.com",
        "request_count": 2345,
        "avg_duration": 1245,
        "error_count": 23
      }
    ],
    "hourly_distribution": [
      {
        "hour": "2025-10-01 12:00:00",
        "request_count": 523,
        "ai_request_count": 145,
        "avg_duration": 834
      }
    ],
    "status_codes": [
      { "status_group": "2xx", "count": 14890 },
      { "status_group": "4xx", "count": 289 },
      { "status_group": "5xx", "count": 55 }
    ],
    "time_range": "24h"
  },
  "timestamp": "2025-10-01T12:35:00.000Z"
}
```

### 6.2 流量重放API

#### 6.2.1 重放单个请求

**待实现** ⚠️

```
POST /api/traffic/replay/:id
```

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | number | 原始流量记录ID |

**请求Body**:
```json
{
  "modifications": {
    "method": "POST",
    "url": "https://test-api.example.com/v1/users",
    "headers": {
      "Authorization": "Bearer new-token-123",
      "X-Test-Mode": "true"
    },
    "body": "{\"username\":\"testuser\",\"email\":\"test@example.com\"}",
    "queryParams": {
      "debug": "true"
    }
  },
  "timeout": 30000,
  "followRedirects": true,
  "validateSSL": true
}
```

**请求Body字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| modifications | object | 否 | 参数修改配置，不提供则使用原始参数 |
| modifications.method | string | 否 | HTTP方法 |
| modifications.url | string | 否 | 完整URL |
| modifications.headers | object | 否 | 请求头，会与原始headers合并 |
| modifications.body | string | 否 | 请求体 |
| modifications.queryParams | object | 否 | 查询参数，会与原始参数合并 |
| timeout | number | 否 | 超时时间(毫秒)，默认30000 |
| followRedirects | boolean | 否 | 是否跟随重定向，默认true |
| validateSSL | boolean | 否 | 是否验证SSL证书，默认true |

**响应示例**:
```json
{
  "success": true,
  "data": {
    "replayHistoryId": 789,
    "originalLog": {
      "id": 12345,
      "method": "GET",
      "url": "https://api.example.com/v1/users",
      "response_status": 200,
      "response_body": "{\"id\":1,\"name\":\"user1\"}",
      "duration_ms": 245
    },
    "modifiedRequest": {
      "method": "POST",
      "url": "https://test-api.example.com/v1/users",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer new-token-123",
        "X-Test-Mode": "true"
      },
      "body": "{\"username\":\"testuser\",\"email\":\"test@example.com\"}"
    },
    "replayResponse": {
      "status": 201,
      "headers": {
        "Content-Type": "application/json",
        "X-Request-Id": "req-xyz123"
      },
      "body": "{\"id\":2,\"name\":\"testuser\"}",
      "duration": 312
    },
    "comparison": {
      "statusMatch": false,
      "bodyDiff": [
        {
          "kind": "E",
          "path": ["id"],
          "lhs": 1,
          "rhs": 2
        },
        {
          "kind": "E",
          "path": ["name"],
          "lhs": "user1",
          "rhs": "testuser"
        }
      ],
      "durationDiff": 67,
      "bodySizeDiff": 3,
      "headersDiff": [
        {
          "key": "X-Request-Id",
          "type": "added",
          "replayed": "req-xyz123"
        }
      ],
      "overallSimilarity": 75
    }
  },
  "timestamp": "2025-10-01T12:35:00.000Z"
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "Replay failed: Connection timeout",
  "details": {
    "originalLogId": 12345,
    "errorCode": "ETIMEDOUT",
    "timestamp": "2025-10-01T12:35:00.000Z"
  }
}
```

#### 6.2.2 批量重放请求

**待实现** ⚠️

```
POST /api/traffic/replay/batch
```

**请求Body**:
```json
{
  "logIds": [12345, 12346, 12347],
  "modifications": {
    "headers": {
      "Authorization": "Bearer new-token-123"
    }
  },
  "concurrency": 5,
  "timeout": 30000
}
```

**请求Body字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| logIds | number[] | 是 | 流量记录ID数组 |
| modifications | object | 否 | 统一的参数修改配置 |
| concurrency | number | 否 | 并发数，默认5，最大10 |
| timeout | number | 否 | 单个请求超时(毫秒)，默认30000 |

**响应示例**:
```json
{
  "success": true,
  "data": {
    "total": 3,
    "successful": 2,
    "failed": 1,
    "results": [
      {
        "logId": 12345,
        "success": true,
        "replayHistoryId": 789,
        "comparison": { "statusMatch": true, "overallSimilarity": 98 }
      },
      {
        "logId": 12346,
        "success": true,
        "replayHistoryId": 790,
        "comparison": { "statusMatch": true, "overallSimilarity": 95 }
      },
      {
        "logId": 12347,
        "success": false,
        "error": "Connection timeout"
      }
    ],
    "aggregateStats": {
      "avgDurationDiff": 45,
      "statusMatchRate": 0.67,
      "bodyMatchRate": 0.67,
      "avgSimilarity": 96.5
    }
  },
  "timestamp": "2025-10-01T12:35:00.000Z"
}
```

#### 6.2.3 使用模板重放

**待实现** ⚠️

```
POST /api/traffic/replay/:id/with-template
```

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | number | 原始流量记录ID |

**请求Body**:
```json
{
  "templateId": 5
}
```

**响应**: 与单个重放响应相同

#### 6.2.4 获取重放历史

**待实现** ⚠️

```
GET /api/traffic/replay/history/:originalId
```

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| originalId | number | 原始流量记录ID |

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "id": 789,
      "original_log_id": 12345,
      "replayed_at": "2025-10-01T12:30:00.000Z",
      "replayed_by": "admin",
      "modified_method": "POST",
      "modified_url": "https://test-api.example.com/v1/users",
      "modification_summary": {
        "fieldsModified": ["method", "url", "headers.Authorization"],
        "modificationCount": 3
      },
      "replay_response_status": 201,
      "replay_duration_ms": 312,
      "diff_summary": {
        "statusMatch": false,
        "bodyDiffCount": 2
      },
      "status_code_match": false,
      "response_body_match": false,
      "duration_diff_ms": 67,
      "success": true,
      "template_id": null
    }
  ],
  "timestamp": "2025-10-01T12:35:00.000Z"
}
```

### 6.3 模板管理API

#### 6.3.1 获取模板列表

**待实现** ⚠️

```
GET /api/traffic/replay/templates
```

**请求参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| api_type | string | 否 | 筛选API类型 |
| search | string | 否 | 搜索模板名称 |
| is_active | boolean | 否 | 是否启用 |

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "id": 5,
      "template_name": "Gemini Token刷新",
      "description": "替换Gemini API的Authorization token",
      "target_api_type": "gemini",
      "target_host_pattern": "*googleapis.com",
      "header_modifications": {
        "replace": {
          "Authorization": "Bearer {{NEW_TOKEN}}"
        }
      },
      "body_modifications": null,
      "query_modifications": null,
      "is_active": true,
      "usage_count": 156,
      "created_by": "admin",
      "created_at": "2025-09-15T10:00:00.000Z",
      "updated_at": "2025-10-01T08:00:00.000Z"
    }
  ],
  "timestamp": "2025-10-01T12:35:00.000Z"
}
```

#### 6.3.2 创建模板

**待实现** ⚠️

```
POST /api/traffic/replay/templates
```

**请求Body**:
```json
{
  "template_name": "测试环境URL替换",
  "description": "将生产环境URL替换为测试环境",
  "target_api_type": "all",
  "target_host_pattern": "api.example.com",
  "header_modifications": {
    "add": {
      "X-Test-Mode": "true"
    }
  },
  "body_modifications": null,
  "query_modifications": null,
  "url_replacement_pattern": "api\\.example\\.com",
  "url_replacement_value": "test-api.example.com"
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": 6,
    "template_name": "测试环境URL替换",
    "created_at": "2025-10-01T12:35:00.000Z"
  },
  "timestamp": "2025-10-01T12:35:00.000Z"
}
```

#### 6.3.3 更新模板

**待实现** ⚠️

```
PUT /api/traffic/replay/templates/:id
```

**请求Body**: 与创建模板相同

#### 6.3.4 删除模板

**待实现** ⚠️

```
DELETE /api/traffic/replay/templates/:id
```

**响应示例**:
```json
{
  "success": true,
  "message": "Template deleted successfully",
  "timestamp": "2025-10-01T12:35:00.000Z"
}
```

---

## 7. 实施计划

### 7.1 任务分解

| 任务ID | 任务名称 | 负责方 | 预计时间 | 依赖 |
|--------|----------|--------|----------|------|
| **DB-1** | 创建数据库表结构 | 后端 | 20分钟 | - |
| **BE-1** | 实现JSONL增量导入服务 | 后端 | 30分钟 | DB-1 |
| **BE-2** | 实现流量重放服务 | 后端 | 40分钟 | DB-1 |
| **BE-3** | 实现响应对比服务 | 后端 | 20分钟 | BE-2 |
| **BE-4** | 添加重放API路由 | 后端 | 30分钟 | BE-2, BE-3 |
| **BE-5** | 实现模板管理API | 后端 | 30分钟 | DB-1 |
| **FE-1** | 开发重放参数编辑器组件 | 前端 | 40分钟 | - |
| **FE-2** | 开发结果对比组件 | 前端 | 30分钟 | - |
| **FE-3** | 开发批量重放对话框 | 前端 | 30分钟 | FE-1 |
| **FE-4** | 修改流量详情页集成重放 | 前端 | 30分钟 | FE-1, FE-2, BE-4 |
| **FE-5** | 修改流量列表页添加批量重放 | 前端 | 20分钟 | FE-3, BE-4 |
| **FE-6** | 开发模板管理页面 | 前端 | 40分钟 | BE-5 |
| **TEST-1** | 集成测试和验证 | 前后端 | 30分钟 | 全部 |

### 7.2 时间估算

- **后端总计**: 2小时30分钟
- **前端总计**: 3小时10分钟
- **测试总计**: 30分钟
- **总预计时间**: 约6小时（考虑并行开发，实际约3.5-4小时）

### 7.3 里程碑

| 里程碑 | 完成标准 | 预计完成时间 |
|--------|----------|--------------|
| M1: 数据库和导入服务就绪 | 数据能从JSONL导入MySQL | 实施后50分钟 |
| M2: 重放核心功能完成 | 能重放请求并记录结果 | 实施后2小时 |
| M3: 前端编辑器完成 | 能可视化编辑和重放 | 实施后3.5小时 |
| M4: 完整功能交付 | 包括批量重放和模板管理 | 实施后6小时 |

---

## 8. 测试验证

### 8.1 功能测试清单

#### 8.1.1 数据导入测试
- [ ] JSONL文件能被正确解析
- [ ] 增量导入不会重复导入相同记录
- [ ] 支持多日志文件并发导入
- [ ] 导入失败能正确重试和日志记录

#### 8.1.2 流量重放测试
- [ ] 能重放GET请求
- [ ] 能重放POST/PUT/DELETE等方法
- [ ] 修改URL后能正确发送到新地址
- [ ] 修改Headers后能正确应用
- [ ] 修改Body后能正确发送
- [ ] 修改Query参数后能正确拼接
- [ ] 重放结果能正确保存到数据库
- [ ] 重放失败能捕获和记录错误

#### 8.1.3 结果对比测试
- [ ] 能正确对比JSON响应差异
- [ ] 能正确对比文本响应差异
- [ ] 能正确计算相似度评分
- [ ] 能展示响应时间差异
- [ ] 能展示响应大小差异

#### 8.1.4 批量重放测试
- [ ] 能批量选择多条记录
- [ ] 能配置统一的修改参数
- [ ] 能控制并发数
- [ ] 能展示实时进度
- [ ] 能聚合统计结果

#### 8.1.5 模板管理测试
- [ ] 能创建新模板
- [ ] 能编辑已有模板
- [ ] 能删除模板
- [ ] 能应用模板到重放
- [ ] 模板匹配规则正确工作

### 8.2 性能测试

- **导入性能**: 应能支持每秒导入100+条记录
- **重放性能**: 单个重放应在配置的超时时间内完成
- **批量重放**: 应能并发处理5-10个请求
- **查询性能**: 流量列表查询应在1秒内返回（带索引优化）

### 8.3 用户体验测试

- [ ] 编辑器界面友好，易于理解
- [ ] 修改追踪清晰，用户知道改了什么
- [ ] 重放结果展示直观，差异一目了然
- [ ] 错误提示明确，帮助用户排查问题
- [ ] 响应式设计，适配不同屏幕

---

## 9. 风险和注意事项

### 9.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 大文件导入性能问题 | 导入速度慢，占用资源 | 使用流式读取，批量插入，限制单次导入大小 |
| 重放目标服务限流 | 批量重放失败 | 添加限流和重试机制，支持配置延迟 |
| JSON Diff计算消耗大 | 大响应体对比慢 | 限制对比的body大小，超过阈值仅对比摘要 |
| 数据库存储空间 | 流量数据快速增长 | 实施数据清理策略，压缩历史数据 |

### 9.2 安全注意事项

- **敏感信息脱敏**: 在前端展示时，对Authorization等敏感header进行部分遮蔽
- **请求验证**: 重放前验证目标URL是否在白名单内，防止SSRF攻击
- **权限控制**: 重放功能应限制特定角色访问
- **日志审计**: 记录所有重放操作的执行者和时间

### 9.3 兼容性注意

- **Node.js版本**: 确保node-fetch等依赖与Node.js版本兼容
- **MySQL版本**: 全文索引需要MySQL 5.6+
- **浏览器兼容**: JSON编辑器和Diff组件需要现代浏览器支持

---

## 10. 扩展功能（后续迭代）

以下功能可在基础版本稳定后考虑：

1. **智能参数推断**: 基于历史重放，自动推荐参数修改
2. **A/B测试支持**: 对比不同参数配置的效果
3. **性能回归检测**: 监控API响应时间变化趋势
4. **Mock服务器**: 直接在管理界面启动Mock服务
5. **流量录制增强**: 支持Websocket流量捕获
6. **CI/CD集成**: 提供命令行工具，支持自动化测试
7. **流量回放压测**: 基于历史流量生成压测场景

---

## 11. 附录

### 11.1 技术依赖

**后端**:
```json
{
  "node-fetch": "^3.3.2",
  "deep-diff": "^1.0.2",
  "chokidar": "^3.5.3",
  "readline": "^1.3.0"
}
```

**前端**:
```json
{
  "react-diff-viewer": "^3.1.1",
  "@tanstack/react-query": "^5.0.0",
  "lucide-react": "^0.292.0"
}
```

### 11.2 数据库迁移命令

```bash
# 执行迁移
mysql -u qqbot_user -p qqbot_db < database/migrations/004_create_http_traffic_tables.sql

# 验证表创建
mysql -u qqbot_user -p qqbot_db -e "SHOW TABLES LIKE 'http_%';"
```

### 11.3 服务启动命令

```bash
# 启动JSONL导入服务
npm run start:log-importer

# 或使用守护进程脚本
bash modules/http-traffic-monitor/scripts/start-log-importer.sh &

# 停止服务
pkill -f log-importer
```

---

**文档结束**
