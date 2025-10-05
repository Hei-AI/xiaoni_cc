import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Progress } from './ui/progress';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { ScrollArea } from './ui/scroll-area';
import { CheckCircle2, XCircle, Loader2, Play, AlertCircle } from 'lucide-react';
import type { TrafficLog, BatchReplayResult } from '../types/traffic-replay';

interface BatchReplayDialogProps {
  selectedLogs: TrafficLog[];
  open: boolean;
  onClose: () => void;
  onComplete: (results: BatchReplayResult) => void;
}

interface BatchReplayProgress {
  total: number;
  completed: number;
  successful: number;
  failed: number;
  inProgress: number;
  pending: number;
  results: Array<{
    logId: number;
    status: 'pending' | 'in-progress' | 'success' | 'failed';
    error?: string;
  }>;
}

export function BatchReplayDialog({
  selectedLogs,
  open,
  onClose,
  onComplete
}: BatchReplayDialogProps) {
  const [enableMethodChange, setEnableMethodChange] = useState(false);
  const [method, setMethod] = useState('POST');
  const [enableHeaderChange, setEnableHeaderChange] = useState(false);
  const [headers, setHeaders] = useState('');
  const [enableBodyChange, setEnableBodyChange] = useState(false);
  const [body, setBody] = useState('');
  const [concurrency, setConcurrency] = useState('5');
  const [timeout, setTimeout] = useState('30');
  const [autoRetry, setAutoRetry] = useState(false);

  const [isReplaying, setIsReplaying] = useState(false);
  const [progress, setProgress] = useState<BatchReplayProgress>({
    total: selectedLogs.length,
    completed: 0,
    successful: 0,
    failed: 0,
    inProgress: 0,
    pending: selectedLogs.length,
    results: selectedLogs.map(log => ({
      logId: log.id,
      status: 'pending'
    }))
  });
  const [error, setError] = useState('');

  const handleStartReplay = async () => {
    setError('');
    setIsReplaying(true);

    try {
      // 构建修改配置
      const modifications: any = {};

      if (enableMethodChange) {
        modifications.method = method;
      }

      if (enableHeaderChange && headers.trim()) {
        try {
          modifications.headers = JSON.parse(headers);
        } catch {
          setError('请求头JSON格式错误');
          setIsReplaying(false);
          return;
        }
      }

      if (enableBodyChange && body.trim()) {
        modifications.body = body;
      }

      // 调用批量重放API
      const response = await fetch(`/api/traffic/replay/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          logIds: selectedLogs.map(log => log.id),
          modifications: Object.keys(modifications).length > 0 ? modifications : undefined,
          concurrency: parseInt(concurrency),
          timeout: parseInt(timeout) * 1000,
        }),
      });

      if (!response.ok) {
        throw new Error('批量重放请求失败');
      }

      const result = await response.json();

      if (result.success) {
        // 更新进度
        setProgress({
          total: result.data.total,
          completed: result.data.total,
          successful: result.data.successful,
          failed: result.data.failed,
          inProgress: 0,
          pending: 0,
          results: result.data.results.map((r: any) => ({
            logId: r.logId,
            status: r.success ? 'success' : 'failed',
            error: r.error
          }))
        });

        // 完成回调
        onComplete(result.data);
      } else {
        throw new Error(result.error || '批量重放失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量重放失败');
    } finally {
      setIsReplaying(false);
    }
  };

  const progressPercent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(open) => !isReplaying && !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>批量重放请求</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* 选中记录数 */}
            <Alert>
              <AlertDescription>
                已选择 <strong>{selectedLogs.length}</strong> 条流量记录
              </AlertDescription>
            </Alert>

            {/* 统一修改配置 */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">统一修改配置 (可选)</h3>

              {/* HTTP方法 */}
              <div className="flex items-center space-x-4">
                <Checkbox
                  checked={enableMethodChange}
                  onCheckedChange={(checked) => setEnableMethodChange(!!checked)}
                  disabled={isReplaying}
                />
                <Label className="flex-1">修改HTTP方法:</Label>
                <Select
                  value={method}
                  onValueChange={setMethod}
                  disabled={!enableMethodChange || isReplaying}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Headers */}
              <div className="space-y-2">
                <div className="flex items-center space-x-4">
                  <Checkbox
                    checked={enableHeaderChange}
                    onCheckedChange={(checked) => setEnableHeaderChange(!!checked)}
                    disabled={isReplaying}
                  />
                  <Label>添加/修改Headers (JSON格式):</Label>
                </div>
                {enableHeaderChange && (
                  <Textarea
                    value={headers}
                    onChange={(e) => setHeaders(e.target.value)}
                    placeholder='{\n  "Authorization": "Bearer token"\n}'
                    className="font-mono text-sm min-h-[100px]"
                    disabled={isReplaying}
                  />
                )}
              </div>

              {/* Body */}
              <div className="space-y-2">
                <div className="flex items-center space-x-4">
                  <Checkbox
                    checked={enableBodyChange}
                    onCheckedChange={(checked) => setEnableBodyChange(!!checked)}
                    disabled={isReplaying}
                  />
                  <Label>修改请求体:</Label>
                </div>
                {enableBodyChange && (
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="请求体内容"
                    className="font-mono text-sm min-h-[100px]"
                    disabled={isReplaying}
                  />
                )}
              </div>
            </div>

            {/* 高级选项 */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium">高级选项</h3>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="concurrency">并发数:</Label>
                  <Select
                    value={concurrency}
                    onValueChange={setConcurrency}
                    disabled={isReplaying}
                  >
                    <SelectTrigger id="concurrency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['1', '3', '5', '10'].map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timeout">超时 (秒):</Label>
                  <Input
                    id="timeout"
                    type="number"
                    value={timeout}
                    onChange={(e) => setTimeout(e.target.value)}
                    disabled={isReplaying}
                    min="5"
                    max="300"
                  />
                </div>

                <div className="flex items-end">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="autoRetry"
                      checked={autoRetry}
                      onCheckedChange={(checked) => setAutoRetry(!!checked)}
                      disabled={isReplaying}
                    />
                    <Label htmlFor="autoRetry">失败自动重试</Label>
                  </div>
                </div>
              </div>
            </div>

            {/* 进度显示 */}
            {isReplaying && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>进度:</span>
                    <span className="font-medium">
                      {progress.completed}/{progress.total} ({progressPercent}%)
                    </span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                </div>

                <div className="grid grid-cols-4 gap-2 text-sm">
                  <Badge variant="default" className="justify-center">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    成功: {progress.successful}
                  </Badge>
                  <Badge variant="destructive" className="justify-center">
                    <XCircle className="h-3 w-3 mr-1" />
                    失败: {progress.failed}
                  </Badge>
                  <Badge variant="secondary" className="justify-center">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    进行中: {progress.inProgress}
                  </Badge>
                  <Badge variant="outline" className="justify-center">
                    待执行: {progress.pending}
                  </Badge>
                </div>
              </div>
            )}

            {/* 结果预览 */}
            {progress.completed > 0 && !isReplaying && (
              <Alert>
                <AlertDescription>
                  <div className="space-y-2">
                    <div className="font-medium">批量重放完成</div>
                    <div className="text-sm space-y-1">
                      <div>✓ 成功: {progress.successful} 条</div>
                      <div>✗ 失败: {progress.failed} 条</div>
                      {progress.failed > 0 && (
                        <div className="text-xs text-muted-foreground mt-2">
                          失败原因详见各条记录的重放历史
                        </div>
                      )}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* 错误提示 */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isReplaying}
          >
            取消
          </Button>
          <Button
            onClick={handleStartReplay}
            disabled={isReplaying || (progress.completed > 0 && !isReplaying)}
          >
            {isReplaying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                重放中...
              </>
            ) : progress.completed > 0 ? (
              '已完成'
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                开始重放
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
