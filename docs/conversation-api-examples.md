# 对话历史API使用示例

## API端点

`GET /api/conversations`

## 向后兼容性

现有的API调用方式保持完全兼容，无需修改现有代码：

```bash
# 原有调用方式（继续有效）
curl "http://localhost:8080/api/conversations?user_id=85178516&limit=50"
```

## 新增功能

### 1. 基础分页查询

```bash
# 获取第1页，每页50条记录
curl "http://localhost:8080/api/conversations?page=1&limit=50"

# 获取第2页，每页20条记录
curl "http://localhost:8080/api/conversations?page=2&limit=20"
```

响应示例：
```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "conv_20250902_001",
        "user_id": 85178516,
        "user_message": "你好，请帮我分析需求",
        "ai_response": "好的，请详细描述您的需求",
        "timestamp": "2025-09-02T10:30:00.000Z",
        "response_time": 1.234,
        "model_name": "gemini-2.5-flash"
      }
    ],
    "pagination": {
      "current_page": 1,
      "total_pages": 5,
      "per_page": 50,
      "total_count": 234,
      "has_next": true,
      "has_previous": false
    }
  }
}
```

### 2. 用户筛选 + 分页

```bash
# 获取特定用户的对话历史
curl "http://localhost:8080/api/conversations?user_id=85178516&page=1&limit=30"
```

### 3. 时间范围筛选

```bash
# 获取指定日期范围的对话
curl "http://localhost:8080/api/conversations?start_date=2025-08-01&end_date=2025-09-02&page=1&limit=50"

# 只指定开始日期
curl "http://localhost:8080/api/conversations?start_date=2025-09-01&page=1&limit=50"

# 只指定结束日期
curl "http://localhost:8080/api/conversations?end_date=2025-09-02&page=1&limit=50"
```

### 4. 关键词搜索

```bash
# 搜索包含"需求"关键词的对话
curl "http://localhost:8080/api/conversations?search=需求&page=1&limit=50"

# 搜索包含"API"的对话
curl "http://localhost:8080/api/conversations?search=API&page=1&limit=50"
```

### 5. 模型筛选

```bash
# 筛选特定模型的对话
curl "http://localhost:8080/api/conversations?model_name=gemini-2.5-flash&page=1&limit=50"
```

### 6. 排序控制

```bash
# 按时间倒序（默认，最新在前）
curl "http://localhost:8080/api/conversations?page=1&limit=50&sort_order=desc"

# 按时间正序（最早在前）
curl "http://localhost:8080/api/conversations?page=1&limit=50&sort_order=asc"
```

### 7. 包含原始数据

```bash
# 包含原始请求/响应数据（用于调试）
curl "http://localhost:8080/api/conversations?page=1&limit=50&include_raw=true"
```

### 8. 组合查询示例

```bash
# 复杂查询：特定用户 + 时间范围 + 搜索关键词
curl "http://localhost:8080/api/conversations?user_id=85178516&start_date=2025-08-01&end_date=2025-09-02&search=系统设计&page=1&limit=20&sort_order=desc"
```

响应示例（带筛选信息）：
```json
{
  "success": true,
  "data": {
    "conversations": [...],
    "pagination": {
      "current_page": 1,
      "total_pages": 3,
      "per_page": 20,
      "total_count": 45,
      "has_next": true,
      "has_previous": false
    },
    "filters": {
      "user_id": 85178516,
      "date_range": {
        "start_date": "2025-08-01",
        "end_date": "2025-09-02"
      },
      "search": "系统设计",
      "sort_order": "desc"
    }
  }
}
```

## 错误处理

### 参数验证错误

```json
{
  "success": false,
  "error": "Invalid page parameter",
  "message": "Page number must be greater than 0"
}
```

### 日期格式错误

```json
{
  "success": false,
  "error": "Invalid start_date format",
  "message": "Date format should be YYYY-MM-DD"
}
```

### 服务器错误

```json
{
  "success": false,
  "error": "Failed to get conversations",
  "message": "Database connection failed"
}
```

## JavaScript 客户端示例

### 使用 fetch API

```javascript
class ConversationAPI {
  constructor(baseUrl = 'http://localhost:8080') {
    this.baseUrl = baseUrl;
  }

  async getConversations(params = {}) {
    const queryString = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryString.append(key, value.toString());
      }
    });

    const response = await fetch(`${this.baseUrl}/api/conversations?${queryString}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  }

  // 获取特定用户的对话历史
  async getUserConversations(userId, page = 1, limit = 50) {
    return this.getConversations({ user_id: userId, page, limit });
  }

  // 搜索对话
  async searchConversations(query, page = 1, limit = 50) {
    return this.getConversations({ search: query, page, limit });
  }

  // 获取日期范围内的对话
  async getConversationsByDateRange(startDate, endDate, page = 1, limit = 50) {
    return this.getConversations({ 
      start_date: startDate, 
      end_date: endDate, 
      page, 
      limit 
    });
  }
}

// 使用示例
const api = new ConversationAPI();

// 获取第一页对话
const conversations = await api.getConversations({ page: 1, limit: 50 });
console.log(conversations);

// 搜索包含"API"的对话
const searchResults = await api.searchConversations('API');
console.log(searchResults);

// 获取特定用户的对话
const userConversations = await api.getUserConversations(85178516, 1, 30);
console.log(userConversations);
```

### React Hook 示例

```jsx
import { useState, useEffect } from 'react';

function useConversations(params = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchConversations = async () => {
      setLoading(true);
      setError(null);

      try {
        const api = new ConversationAPI();
        const result = await api.getConversations(params);
        setData(result.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchConversations();
  }, [JSON.stringify(params)]);

  return { data, loading, error };
}

// 组件中使用
function ConversationList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  
  const { data, loading, error } = useConversations({ 
    page, 
    limit: 20, 
    search: search || undefined 
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <input 
        type="text" 
        value={search} 
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索对话..."
      />
      
      <div>
        {data?.conversations?.map(conv => (
          <div key={conv.id}>
            <h4>用户 {conv.user_id}</h4>
            <p>{conv.user_message}</p>
            <p>{conv.ai_response}</p>
            <small>{new Date(conv.timestamp).toLocaleString()}</small>
          </div>
        ))}
      </div>

      <div>
        <button 
          disabled={!data?.pagination?.has_previous}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </button>
        
        <span>
          第 {data?.pagination?.current_page} / {data?.pagination?.total_pages} 页
        </span>
        
        <button 
          disabled={!data?.pagination?.has_next}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
```

## 性能建议

1. **合理设置limit**: 建议每页20-100条记录，避免单次查询过多数据
2. **使用时间范围筛选**: 对于大量历史数据，建议加上时间范围限制
3. **避免深度分页**: 页数过大时性能会下降，建议使用时间范围代替深度分页
4. **搜索优化**: 搜索关键词建议3个字符以上，提高查询效率
5. **缓存策略**: 前端可以缓存已获取的页面数据，减少重复请求

## 监控和调试

### 启用详细日志

API调用会在服务器日志中记录查询信息：

```
INFO [http-server] Conversations query executed {
  user_id: 85178516,
  page: 1,
  limit: 50,
  total_results: 234,
  has_search: true,
  has_date_filter: false
}
```

### 性能监控

可以通过以下查询监控API性能：

```sql
-- 查看最近的对话查询日志
SELECT * FROM system_logs 
WHERE module_name = 'http-server' 
  AND message LIKE '%Conversations query executed%'
ORDER BY timestamp DESC 
LIMIT 10;
```