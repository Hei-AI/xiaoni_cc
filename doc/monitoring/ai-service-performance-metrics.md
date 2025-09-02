# AI服务性能监控指标定义

**创建者**: Claude AI Service Tech Lead  
**创建时间**: 2025-09-01  
**版本**: v1.0  
**适用范围**: QQ智能机器人AI服务模块

## 📊 概述

基于Gemini API集成经验和SE主督导规划要求，定义AI服务模块的关键性能指标(KPI)和监控标准，确保服务稳定性和用户体验质量。

## 🎯 核心性能指标 (Core KPIs)

### 1. API调用性能指标

#### 🔄 API调用成功率
```typescript
interface APISuccessMetrics {
  name: 'ai_service_success_rate';
  description: 'API调用成功率百分比';
  target: '>= 99%';
  warning_threshold: '< 98%';
  critical_threshold: '< 95%';
  measurement_window: '5m'; // 5分钟滑动窗口
  
  // 计算逻辑
  calculation: {
    successful_requests: number;
    total_requests: number;
    success_rate: number; // (successful_requests / total_requests) * 100
  };
}

// Prometheus指标收集
const aiServiceSuccessRate = new prometheus.Counter({
  name: 'ai_service_requests_total',
  help: 'Total number of AI service requests',
  labelNames: ['status', 'service_type', 'model_name']
});
```

#### ⏱️ API响应时间
```typescript
interface ResponseTimeMetrics {
  name: 'ai_service_response_time';
  description: 'AI服务API响应时间分布';
  
  targets: {
    p50: '< 800ms';   // 中位数响应时间
    p95: '< 2000ms';  // 95分位响应时间  
    p99: '< 5000ms';  // 99分位响应时间
  };
  
  warning_thresholds: {
    p50: '> 1000ms';
    p95: '> 3000ms';
    p99: '> 8000ms';
  };
  
  measurement_buckets: [50, 100, 200, 500, 800, 1000, 2000, 5000, 10000]; // ms
}

// Prometheus histogram
const responseTimeHistogram = new prometheus.Histogram({
  name: 'ai_service_response_duration_seconds',
  help: 'AI service response time distribution',
  labelNames: ['operation', 'model', 'intent_type'],
  buckets: [0.05, 0.1, 0.2, 0.5, 0.8, 1.0, 2.0, 5.0, 10.0]
});
```

### 2. Token管理指标

#### 🔑 Token轮换性能
```typescript
interface TokenRotationMetrics {
  name: 'token_rotation_performance';
  description: 'Token轮换延迟和成功率';
  
  rotation_latency: {
    target: '< 100ms';
    warning: '> 200ms';
    critical: '> 500ms';
  };
  
  rotation_success_rate: {
    target: '>= 99.5%';
    warning: '< 99%';
    critical: '< 95%';
  };
  
  active_token_count: {
    target: '>= 2'; // 至少保持2个活跃Token
    warning: '== 1'; // 单Token风险状态
    critical: '== 0'; // 无可用Token
  };
}
```

#### 💰 Token配额使用监控
```typescript
interface TokenQuotaMetrics {
  name: 'token_quota_usage';
  description: 'Token配额使用率和预警';
  
  daily_quota_usage: {
    target: '< 80%';   // 日配额使用率目标
    warning: '> 85%';  // 预警阈值
    critical: '> 95%'; // 紧急阈值
  };
  
  hourly_rate_limit: {
    target: '< 70%';   // 小时限制使用率
    warning: '> 80%';
    critical: '> 90%';
  };
  
  cost_tracking: {
    daily_cost_limit: 50.0; // USD
    monthly_budget: 1200.0; // USD
    cost_per_request: number; // 实时计算
  };
}
```

### 3. 缓存性能指标

#### 🗄️ 缓存命中率和性能
```typescript
interface CachePerformanceMetrics {
  name: 'ai_service_cache_performance';
  description: '缓存系统性能指标';
  
  hit_rate: {
    target: '> 70%';    // 缓存命中率目标
    warning: '< 60%';   // 命中率过低预警
    critical: '< 40%';  // 严重性能问题
  };
  
  cache_response_time: {
    target: '< 5ms';    // 缓存响应时间
    warning: '> 10ms';
    critical: '> 50ms';
  };
  
  cache_size_metrics: {
    memory_usage: {
      target: '< 100MB';
      warning: '> 150MB';
      critical: '> 200MB';
    };
    entry_count: {
      max_entries: 1000;
      warning_threshold: 800;
      cleanup_threshold: 900;
    };
  };
}
```

## 🏗️ 系统健康指标

### 4. 服务可用性指标

#### ❤️ 健康检查状态
```typescript
interface ServiceHealthMetrics {
  name: 'ai_service_health_status';
  description: 'AI服务整体健康状态';
  
  overall_health: {
    states: ['healthy', 'degraded', 'unhealthy'];
    healthy_criteria: [
      'api_success_rate > 99%',
      'response_time_p95 < 2000ms',
      'active_tokens >= 2',
      'cache_hit_rate > 60%'
    ];
  };
  
  component_health: {
    gemini_api_connectivity: boolean;
    token_manager_status: boolean;
    cache_system_status: boolean;
    database_connectivity: boolean;
  };
  
  health_check_interval: '30s'; // 健康检查频率
  failure_threshold: 3; // 连续失败次数阈值
}
```

### 5. 意图识别准确性指标

#### 🧠 AI意图分析质量
```typescript
interface IntentAnalysisMetrics {
  name: 'intent_analysis_accuracy';
  description: '意图识别准确性和质量指标';
  
  accuracy_metrics: {
    requirement_detection_accuracy: {
      target: '> 85%';     // 需求识别准确率
      warning: '< 80%';
      critical: '< 70%';
      measurement_method: 'human_feedback_sampling';
    };
    
    confidence_distribution: {
      high_confidence: '> 80%';     // 高置信度比例
      medium_confidence: '60-80%';  // 中等置信度比例  
      low_confidence: '< 60%';      // 低置信度比例
      target_high_ratio: '> 60%';   // 高置信度目标比例
    };
  };
  
  false_positive_rate: {
    target: '< 5%';    // 误判率目标
    warning: '> 10%';
    critical: '> 20%';
  };
}
```

## 📈 监控实现架构

### Prometheus指标收集实现
```typescript
// src/monitoring/ai-service-metrics.ts
import * as prometheus from 'prom-client';

export class AIServiceMetricsCollector {
  // 请求计数器
  private readonly requestCounter = new prometheus.Counter({
    name: 'ai_service_requests_total',
    help: 'Total AI service requests',
    labelNames: ['status', 'operation', 'model', 'user_type']
  });

  // 响应时间直方图
  private readonly responseTimeHistogram = new prometheus.Histogram({
    name: 'ai_service_response_duration_seconds',
    help: 'AI service response time distribution',
    labelNames: ['operation', 'model', 'intent_type'],
    buckets: [0.05, 0.1, 0.2, 0.5, 0.8, 1.0, 2.0, 5.0, 10.0]
  });

  // Token使用量表
  private readonly tokenUsageGauge = new prometheus.Gauge({
    name: 'ai_service_token_quota_usage_ratio',
    help: 'Token quota usage ratio',
    labelNames: ['token_key', 'time_window']
  });

  // 缓存指标
  private readonly cacheHitRatio = new prometheus.Gauge({
    name: 'ai_service_cache_hit_ratio',
    help: 'Cache hit ratio',
    labelNames: ['cache_type']
  });

  // 记录API调用
  recordAPICall(status: string, operation: string, model: string, duration: number): void {
    this.requestCounter.inc({
      status,
      operation,
      model,
      user_type: operation.includes('requirement') ? 'authorized' : 'general'
    });

    this.responseTimeHistogram
      .labels({ operation, model, intent_type: this.extractIntentType(operation) })
      .observe(duration / 1000);
  }

  // 更新Token使用率
  updateTokenUsage(tokenKey: string, usageRatio: number, timeWindow: string): void {
    this.tokenUsageGauge
      .labels({ token_key: tokenKey, time_window: timeWindow })
      .set(usageRatio);
  }

  // 更新缓存命中率
  updateCacheMetrics(cacheType: string, hitRatio: number): void {
    this.cacheHitRatio
      .labels({ cache_type: cacheType })
      .set(hitRatio);
  }

  private extractIntentType(operation: string): string {
    if (operation.includes('requirement')) return 'requirement_analysis';
    if (operation.includes('chat')) return 'general_chat';
    return 'unknown';
  }
}
```

### Grafana Dashboard配置
```yaml
# grafana/dashboards/ai-service-dashboard.json
{
  "dashboard": {
    "title": "AI Service Performance Dashboard",
    "panels": [
      {
        "title": "API Success Rate",
        "type": "stat",
        "targets": [{
          "expr": "rate(ai_service_requests_total{status=\"success\"}[5m]) / rate(ai_service_requests_total[5m]) * 100",
          "legendFormat": "Success Rate %"
        }],
        "thresholds": {
          "steps": [
            {"color": "red", "value": 0},
            {"color": "yellow", "value": 98},
            {"color": "green", "value": 99}
          ]
        }
      },
      {
        "title": "Response Time Distribution",
        "type": "heatmap",
        "targets": [{
          "expr": "increase(ai_service_response_duration_seconds_bucket[5m])",
          "legendFormat": "{{le}}"
        }]
      },
      {
        "title": "Token Usage Trend",
        "type": "timeseries",
        "targets": [{
          "expr": "ai_service_token_quota_usage_ratio",
          "legendFormat": "{{token_key}} - {{time_window}}"
        }]
      }
    ]
  }
}
```

## 🚨 告警规则配置

### Prometheus Alert Rules
```yaml
# monitoring/alert-rules.yml
groups:
  - name: ai_service_alerts
    rules:
      # API成功率告警
      - alert: AIServiceHighFailureRate
        expr: rate(ai_service_requests_total{status="error"}[5m]) / rate(ai_service_requests_total[5m]) > 0.02
        for: 2m
        labels:
          severity: warning
          component: ai_service
        annotations:
          summary: "AI Service failure rate is above 2%"
          description: "AI Service error rate is {{ $value | humanizePercentage }} for the last 5 minutes"

      # 响应时间告警
      - alert: AIServiceHighLatency
        expr: histogram_quantile(0.95, rate(ai_service_response_duration_seconds_bucket[5m])) > 2
        for: 3m
        labels:
          severity: warning
          component: ai_service
        annotations:
          summary: "AI Service P95 latency is above 2 seconds"
          description: "AI Service P95 response time is {{ $value }}s"

      # Token配额告警
      - alert: AIServiceTokenQuotaHigh
        expr: ai_service_token_quota_usage_ratio > 0.85
        for: 1m
        labels:
          severity: warning
          component: token_manager
        annotations:
          summary: "AI Service token quota usage is high"
          description: "Token {{ $labels.token_key }} usage is {{ $value | humanizePercentage }}"

      # 缓存命中率告警
      - alert: AIServiceLowCacheHitRate
        expr: ai_service_cache_hit_ratio < 0.6
        for: 5m
        labels:
          severity: warning
          component: cache_system
        annotations:
          summary: "AI Service cache hit rate is low"
          description: "Cache {{ $labels.cache_type }} hit rate is {{ $value | humanizePercentage }}"
```

## 📊 SLA标准定义

### 服务等级协议 (Service Level Agreement)
```typescript
interface AIServiceSLA {
  availability: {
    target: '99.9%';           // 月度可用性目标
    measurement_window: 'monthly';
    downtime_budget: '43.2m';  // 月度停机时间预算(分钟)
  };
  
  performance: {
    response_time_p95: '2000ms';    // 95%请求响应时间
    response_time_p99: '5000ms';    // 99%请求响应时间
    api_success_rate: '99%';        // API调用成功率
  };
  
  capacity: {
    max_concurrent_requests: 100;    // 最大并发请求数
    daily_request_limit: 10000;      // 日请求量限制
    burst_capacity: 150;             // 突发处理能力
  };
  
  recovery: {
    recovery_time_objective: '5m';   // 恢复时间目标
    recovery_point_objective: '1m';  // 恢复点目标
    failover_time: '30s';            // 故障切换时间
  };
}
```

## 🔧 实施指导

### 1. 监控部署步骤
```bash
# 1. 部署Prometheus
docker run -d -p 9090:9090 \
  -v ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus

# 2. 部署Grafana
docker run -d -p 3000:3000 \
  -v ./monitoring/grafana:/var/lib/grafana \
  grafana/grafana

# 3. 配置告警规则
curl -X POST http://localhost:9090/api/v1/rules \
  -H "Content-Type: application/yaml" \
  --data-binary @monitoring/alert-rules.yml

# 4. 启动AI服务监控
npm run start:with-monitoring
```

### 2. 指标收集集成
```typescript
// 在现有AI服务中集成监控
import { AIServiceMetricsCollector } from './monitoring/ai-service-metrics';

class AIService {
  private metrics = new AIServiceMetricsCollector();
  
  async generateResponse(message: string, userId: number): Promise<string> {
    const startTime = Date.now();
    
    try {
      const response = await this.callGeminiAPI(message);
      const duration = Date.now() - startTime;
      
      // 记录成功指标
      this.metrics.recordAPICall('success', 'generate_response', 'gemini-2.5-flash', duration);
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // 记录失败指标
      this.metrics.recordAPICall('error', 'generate_response', 'gemini-2.5-flash', duration);
      
      throw error;
    }
  }
}
```

---

**创建基础**: Gemini API故障排查实战经验  
**技术标准**: 企业级监控最佳实践  
**维护职责**: Claude AI Service Tech Lead  
**更新频率**: 按业务需求和技术演进调整