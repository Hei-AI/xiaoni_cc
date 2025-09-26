import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Switch } from '../components/ui/switch';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { 
  RefreshCw, 
  Trash2, 
  MessageSquare,
  Users,
  BarChart3,
  Send
} from 'lucide-react';

/**
 * 简单队列监控页面
 * 功能：
 * 1. 实时监控队列统计信息
 * 2. 查看活跃分区状态
 * 3. 队列管理操作（清空分区）
 * 4. 消息模拟测试
 */

interface QueueStats {
  totalPartitions: number;
  activePartitions: number;
  totalMessages: number;
  processingPartitions: number;
  config: {
    pollIntervalMs: number;
    batchSize: number;
    maxRetries: number;
    maxPartitions: number;
  };
}

interface PartitionInfo {
  partitionKey: string;
  info: {
    partitionKey: string;
    type: 'user' | 'group';
    messageCount: number;
    isProcessing: boolean;
    lastProcessedAt: string | null;
    messages: Array<{
      id: string;
      traceId: string;
      type: string;
      priority: string;
      timestamp: string;
    }>;
  };
}

const SimpleQueueMonitorPage: React.FC = () => {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [partitions, setPartitions] = useState<PartitionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);

  // 模拟消息表单状态
  const [simulationForm, setSimulationForm] = useState({
    type: 'private' as 'private' | 'group',
    user_id: '',
    group_id: '',
    message: '',
    priority: 'HIGH' as 'HIGH' | 'MEDIUM' | 'LOW',
    atBot: false
  });

  // 获取队列统计
  const fetchStats = async () => {
    try {
      // 获取统计数据和配置信息
      const [statsResponse, configResponse] = await Promise.all([
        fetch('/api/simple-queue/stats'),
        fetch('/api/simple-queue/config')
      ]);

      const statsResult = await statsResponse.json();
      const configResult = await configResponse.json();

      if (statsResult.success && configResult.success) {
        // 合并统计数据和配置信息
        const mergedStats = {
          totalPartitions: statsResult.data.partition_count || 0,
          activePartitions: statsResult.data.active_partitions || 0,
          totalMessages: statsResult.data.total_messages || 0,
          processingPartitions: statsResult.data.processing_messages || 0,
          config: {
            pollIntervalMs: configResult.config.performance?.pollIntervalMs || 100,
            batchSize: configResult.config.limits?.batchSize || 10,
            maxRetries: configResult.config.limits?.maxRetries || 3,
            maxPartitions: configResult.config.limits?.maxPartitions || 1000
          }
        };
        setStats(mergedStats);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  // 获取分区信息
  const fetchPartitions = async () => {
    try {
      const response = await fetch('/api/simple-queue/partitions');
      const result = await response.json();

      if (result.success) {
        // 映射API响应到组件期望的格式
        const mappedPartitions = result.data.map((partition: any) => ({
          partitionKey: partition.partition_key,
          info: {
            partitionKey: partition.partition_key,
            type: partition.type === 'private' ? 'user' : 'group',
            messageCount: partition.queue_size || 0,
            isProcessing: partition.processing > 0 || partition.status === 'active',
            lastProcessedAt: partition.last_activity,
            messages: [] // 暂时为空，可以后续扩展
          }
        }));
        setPartitions(mappedPartitions);
      }
    } catch (error) {
      console.error('Failed to fetch partitions:', error);
    } finally {
      setLoading(false);
    }
  };

  // 刷新数据
  const refreshData = async () => {
    await Promise.all([fetchStats(), fetchPartitions()]);
  };

  // 清空分区
  const clearPartition = async (partitionKey: string) => {
    try {
      const response = await fetch(`/api/simple-queue/partitions/${partitionKey}`, {
        method: 'DELETE'
      });
      
      const result = await response.json();
      if (result.success) {
        await refreshData();
      }
    } catch (error) {
      console.error('Failed to clear partition:', error);
    }
  };

  // 模拟消息
  const simulateMessage = async () => {
    try {
      const endpoint = simulationForm.type === 'private' 
        ? '/api/simple-queue/simulate/private'
        : '/api/simple-queue/simulate/group';
      
      const payload = simulationForm.type === 'private'
        ? {
            user_id: parseInt(simulationForm.user_id),
            message: simulationForm.message,
            priority: simulationForm.priority
          }
        : {
            user_id: parseInt(simulationForm.user_id),
            group_id: parseInt(simulationForm.group_id),
            message: simulationForm.message,
            atBot: simulationForm.atBot,
            priority: simulationForm.priority
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (result.success) {
        // 清空表单
        setSimulationForm({
          ...simulationForm,
          message: '',
          user_id: '',
          group_id: ''
        });
        
        // 刷新数据
        await refreshData();
      }
    } catch (error) {
      console.error('Failed to simulate message:', error);
    }
  };

  // 自动刷新
  useEffect(() => {
    refreshData();

    if (autoRefresh) {
      const interval = setInterval(refreshData, 5000); // 5秒刷新
      setRefreshInterval(interval);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

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
      {/* 页面标题 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">简单队列监控</h1>
          <p className="text-gray-600 mt-1">
            内存队列状态监控和消息模拟测试
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
            onClick={refreshData}
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
              <CardTitle className="text-sm font-medium">总分区数</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalPartitions}</div>
              <p className="text-xs text-muted-foreground">
                活跃: {stats.activePartitions}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">队列消息</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalMessages}</div>
              <p className="text-xs text-muted-foreground">
                处理中分区: {stats.processingPartitions}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">批处理大小</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.config.batchSize}</div>
              <p className="text-xs text-muted-foreground">
                轮询间隔: {stats.config.pollIntervalMs}ms
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">最大重试</CardTitle>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.config.maxRetries}</div>
              <p className="text-xs text-muted-foreground">
                最大分区: {stats.config.maxPartitions}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 活跃分区列表 */}
        <Card>
          <CardHeader>
            <CardTitle>活跃分区</CardTitle>
            <CardDescription>
              当前有消息的分区列表
            </CardDescription>
          </CardHeader>
          <CardContent>
            {partitions.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>分区</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>消息数</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partitions.map((partition) => (
                    <TableRow key={partition.partitionKey}>
                      <TableCell className="font-mono text-sm">
                        {partition.partitionKey}
                      </TableCell>
                      <TableCell>
                        <Badge variant={partition.info.type === 'user' ? 'default' : 'secondary'}>
                          {partition.info.type === 'user' ? '私聊' : '群聊'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {partition.info.messageCount}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={partition.info.isProcessing ? 'default' : 'secondary'}
                        >
                          {partition.info.isProcessing ? '处理中' : '空闲'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => clearPartition(partition.partitionKey)}
                          disabled={partition.info.messageCount === 0}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-2" />
                <p>暂无活跃分区</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 消息模拟器 */}
        <Card>
          <CardHeader>
            <CardTitle>消息模拟器</CardTitle>
            <CardDescription>
              模拟私聊或群聊消息进行测试
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 消息类型选择 */}
            <div className="flex space-x-4">
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  value="private"
                  checked={simulationForm.type === 'private'}
                  onChange={(e) => setSimulationForm({
                    ...simulationForm,
                    type: e.target.value as 'private'
                  })}
                />
                <span>私聊消息</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  value="group"
                  checked={simulationForm.type === 'group'}
                  onChange={(e) => setSimulationForm({
                    ...simulationForm,
                    type: e.target.value as 'group'
                  })}
                />
                <span>群聊消息</span>
              </label>
            </div>

            {/* 用户ID */}
            <div>
              <label className="block text-sm font-medium mb-1">用户ID</label>
              <Input
                type="number"
                placeholder="输入用户QQ号"
                value={simulationForm.user_id}
                onChange={(e) => setSimulationForm({
                  ...simulationForm,
                  user_id: e.target.value
                })}
              />
            </div>

            {/* 群组ID (仅群聊) */}
            {simulationForm.type === 'group' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">群组ID</label>
                  <Input
                    type="number"
                    placeholder="输入群聊号"
                    value={simulationForm.group_id}
                    onChange={(e) => setSimulationForm({
                      ...simulationForm,
                      group_id: e.target.value
                    })}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    checked={simulationForm.atBot}
                    onCheckedChange={(checked) => setSimulationForm({
                      ...simulationForm,
                      atBot: checked
                    })}
                  />
                  <span className="text-sm">@机器人</span>
                </div>
              </>
            )}

            {/* 消息内容 */}
            <div>
              <label className="block text-sm font-medium mb-1">消息内容</label>
              <Textarea
                placeholder="输入要模拟的消息内容"
                value={simulationForm.message}
                onChange={(e) => setSimulationForm({
                  ...simulationForm,
                  message: e.target.value
                })}
                rows={3}
              />
            </div>

            {/* 优先级 */}
            <div>
              <label className="block text-sm font-medium mb-1">优先级</label>
              <select
                className="w-full p-2 border rounded-md"
                value={simulationForm.priority}
                onChange={(e) => setSimulationForm({
                  ...simulationForm,
                  priority: e.target.value as 'HIGH' | 'MEDIUM' | 'LOW'
                })}
              >
                <option value="HIGH">高优先级</option>
                <option value="MEDIUM">中优先级</option>
                <option value="LOW">低优先级</option>
              </select>
            </div>

            {/* 提交按钮 */}
            <Button
              onClick={simulateMessage}
              disabled={!simulationForm.user_id || !simulationForm.message || 
                       (simulationForm.type === 'group' && !simulationForm.group_id)}
              className="w-full"
            >
              <Send className="w-4 h-4 mr-2" />
              发送模拟消息
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SimpleQueueMonitorPage;