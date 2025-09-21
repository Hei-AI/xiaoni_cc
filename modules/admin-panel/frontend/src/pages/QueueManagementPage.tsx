import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Progress } from '../components/ui/progress';
import { Switch } from '../components/ui/switch';
import { ScrollArea } from '../components/ui/scroll-area';
import { 
  Play, 
  Pause, 
  Trash2, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle,
  Clock,
  Users,
  MessageSquare,
  BarChart3,
  Activity
} from 'lucide-react';

/**
 * 队列管理页面
 * 功能：
 * 1. 实时监控所有消息队列状态
 * 2. 查看未消费消息详情
 * 3. 队列管理操作（暂停/恢复/清空）
 * 4. 性能统计和可视化
 */

interface QueueInfo {
  name: string;
  type: 'private' | 'group';
  userId?: number;
  groupId?: number;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  lastJobAt?: string;
  stats?: {
    avgProcessingTime: number;
    throughput: number;
    errorRate: number;
  };
}

interface UnconsumedMessage {
  id: string;
  traceId: string;
  type: string;
  data: any;
  timestamp: string;
  priority: number;
  attempts: number;
  delay: number;
  queueName: string;
  state: 'waiting' | 'active' | 'delayed';
}

interface QueueStats {
  totalQueues: number;
  totalMessages: number;
  totalUnconsumed: number;
  lastUpdated: string;
}

const QueueManagementPage: React.FC = () => {
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [unconsumedMessages, setUnconsumedMessages] = useState<UnconsumedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);

  // 获取队列列表
  const fetchQueues = async () => {
    try {
      const response = await fetch('/api/queue-monitor/queues');
      const result = await response.json();
      
      if (result.success) {
        setQueues(result.data);
        setStats(result.stats);
      }
    } catch (error) {
      console.error('Failed to fetch queues:', error);
    } finally {
      setLoading(false);
    }
  };

  // 获取未消费消息
  const fetchUnconsumedMessages = async (queueName: string) => {
    try {
      const response = await fetch(`/api/queue-monitor/queues/${queueName}/unconsumed?limit=100`);
      const result = await response.json();
      
      if (result.success) {
        setUnconsumedMessages(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch unconsumed messages:', error);
    }
  };

  // 队列操作
  const handleQueueAction = async (queueName: string, action: 'pause' | 'resume' | 'clear') => {
    try {
      let url = `/api/queue-monitor/queues/${queueName}`;
      let method = 'PATCH';
      let body = null;

      if (action === 'clear') {
        method = 'DELETE';
      } else {
        url += '/pause';
        body = JSON.stringify({ paused: action === 'pause' });
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body
      });

      const result = await response.json();
      if (result.success) {
        await fetchQueues(); // 刷新队列列表
        if (selectedQueue === queueName) {
          await fetchUnconsumedMessages(queueName); // 刷新消息列表
        }
      }
    } catch (error) {
      console.error(`Failed to ${action} queue:`, error);
    }
  };

  // 自动刷新
  useEffect(() => {
    fetchQueues();

    if (autoRefresh) {
      const interval = setInterval(fetchQueues, 10000); // 10秒刷新
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // 队列选择变化
  useEffect(() => {
    if (selectedQueue) {
      fetchUnconsumedMessages(selectedQueue);
    }
  }, [selectedQueue]);

  // 获取队列状态颜色
  const getQueueStatusColor = (queue: QueueInfo): string => {
    if (queue.paused) return 'bg-gray-500';
    if (queue.failed > 0) return 'bg-red-500';
    if (queue.active > 0) return 'bg-green-500';
    if (queue.waiting > 0) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  // 获取队列状态文本
  const getQueueStatusText = (queue: QueueInfo): string => {
    if (queue.paused) return '暂停';
    if (queue.failed > 0) return '有失败';
    if (queue.active > 0) return '处理中';
    if (queue.waiting > 0) return '等待中';
    return '空闲';
  };

  // 格式化时间
  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  // 格式化处理时间
  const formatProcessingTime = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin" />
        <span className="ml-2">加载队列信息...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题和控制 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">队列管理</h1>
          <p className="text-gray-600 mt-1">
            实时监控消息队列状态和未消费消息
          </p>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
            />
            <span className="text-sm">自动刷新</span>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={fetchQueues}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            手动刷新
          </Button>
        </div>
      </div>

      {/* 统计概览 */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">总队列数</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalQueues}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">总消息数</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalMessages}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">未消费消息</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.totalUnconsumed}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">最后更新</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-sm">{formatTime(stats.lastUpdated)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 主要内容区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 队列列表 */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <BarChart3 className="w-5 h-5 mr-2" />
                队列列表
              </CardTitle>
              <CardDescription>
                点击队列查看详细信息和未消费消息
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96">
                <div className="space-y-2">
                  {queues.map((queue) => (
                    <Card
                      key={queue.name}
                      className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                        selectedQueue === queue.name ? 'ring-2 ring-blue-500' : ''
                      }`}
                      onClick={() => setSelectedQueue(queue.name)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center">
                            <div
                              className={`w-3 h-3 rounded-full mr-2 ${getQueueStatusColor(queue)}`}
                            />
                            <span className="font-medium">
                              {queue.type === 'private' ? `用户 ${queue.userId}` : `群组 ${queue.groupId}`}
                            </span>
                          </div>
                          <Badge variant="outline">
                            {getQueueStatusText(queue)}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                          <div>等待: {queue.waiting}</div>
                          <div>处理中: {queue.active}</div>
                          <div>完成: {queue.completed}</div>
                          <div>失败: {queue.failed}</div>
                        </div>

                        {queue.waiting > 0 && (
                          <Progress 
                            value={(queue.completed / (queue.completed + queue.waiting)) * 100}
                            className="mt-2 h-1"
                          />
                        )}

                        {queue.stats && (
                          <div className="mt-2 text-xs text-gray-500">
                            处理时间: {formatProcessingTime(queue.stats.avgProcessingTime)} |
                            吞吐量: {queue.stats.throughput}/h |
                            错误率: {(queue.stats.errorRate * 100).toFixed(1)}%
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* 队列详情和未消费消息 */}
        <div className="lg:col-span-2">
          {selectedQueue ? (
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>队列详情: {selectedQueue}</CardTitle>
                    <CardDescription>
                      查看和管理未消费的消息
                    </CardDescription>
                  </div>
                  
                  <div className="flex space-x-2">
                    {(() => {
                      const queue = queues.find(q => q.name === selectedQueue);
                      if (!queue) return null;
                      
                      return (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleQueueAction(selectedQueue, queue.paused ? 'resume' : 'pause')}
                          >
                            {queue.paused ? (
                              <>
                                <Play className="w-4 h-4 mr-1" />
                                恢复
                              </>
                            ) : (
                              <>
                                <Pause className="w-4 h-4 mr-1" />
                                暂停
                              </>
                            )}
                          </Button>
                          
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleQueueAction(selectedQueue, 'clear')}
                            disabled={queue.waiting === 0 && queue.active === 0}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            清空
                          </Button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="messages" className="w-full">
                  <TabsList>
                    <TabsTrigger value="messages">未消费消息</TabsTrigger>
                    <TabsTrigger value="stats">性能统计</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="messages" className="space-y-4">
                    {unconsumedMessages.length > 0 ? (
                      <ScrollArea className="h-96">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>消息ID</TableHead>
                              <TableHead>状态</TableHead>
                              <TableHead>类型</TableHead>
                              <TableHead>优先级</TableHead>
                              <TableHead>重试次数</TableHead>
                              <TableHead>时间</TableHead>
                              <TableHead>TraceID</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unconsumedMessages.map((message) => (
                              <TableRow key={message.id}>
                                <TableCell className="font-mono text-sm">
                                  {message.id}
                                </TableCell>
                                <TableCell>
                                  <Badge 
                                    variant={
                                      message.state === 'active' ? 'default' :
                                      message.state === 'delayed' ? 'secondary' : 'outline'
                                    }
                                  >
                                    {message.state === 'active' ? '处理中' :
                                     message.state === 'delayed' ? '延迟' : '等待'}
                                  </Badge>
                                </TableCell>
                                <TableCell>{message.type}</TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {message.priority}
                                  </Badge>
                                </TableCell>
                                <TableCell>{message.attempts}</TableCell>
                                <TableCell className="text-sm">
                                  {formatTime(message.timestamp)}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {message.traceId}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <CheckCircle className="w-12 h-12 mx-auto mb-2" />
                        <p>没有未消费的消息</p>
                      </div>
                    )}
                  </TabsContent>
                  
                  <TabsContent value="stats">
                    {(() => {
                      const queue = queues.find(q => q.name === selectedQueue);
                      if (!queue?.stats) {
                        return (
                          <div className="text-center py-8 text-gray-500">
                            <AlertCircle className="w-12 h-12 mx-auto mb-2" />
                            <p>暂无统计数据</p>
                          </div>
                        );
                      }

                      return (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm">平均处理时间</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-2xl font-bold">
                                {formatProcessingTime(queue.stats.avgProcessingTime)}
                              </div>
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm">小时吞吐量</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-2xl font-bold">
                                {queue.stats.throughput}
                              </div>
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm">错误率</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className={`text-2xl font-bold ${
                                queue.stats.errorRate > 0.1 ? 'text-red-600' : 'text-green-600'
                              }`}>
                                {(queue.stats.errorRate * 100).toFixed(1)}%
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      );
                    })()}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-96">
                <div className="text-center text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-2" />
                  <p>选择一个队列查看详细信息</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default QueueManagementPage;