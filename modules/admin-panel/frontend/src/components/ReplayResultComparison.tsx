import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Alert, AlertDescription } from './ui/alert';
import { Progress } from './ui/progress';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  HardDrive,
  Download,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import ReactDiffViewer from 'react-diff-viewer-continued';
import type { ComparisonResult, ReplayResponse } from '../types/traffic-replay';

interface ReplayResultComparisonProps {
  original: {
    status: number;
    headers: Record<string, string>;
    body: string;
    duration: number;
    size: number;
  };
  replayed: ReplayResponse;
  comparison: ComparisonResult;
  onExport?: () => void;
}

export function ReplayResultComparison({
  original,
  replayed,
  comparison,
  onExport
}: ReplayResultComparisonProps) {
  // 格式化JSON
  const formatBody = (body: string) => {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return body;
    }
  };

  // 格式化大小
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // 格式化时间
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // 计算差异百分比
  const durationDiffPercent = useMemo(() => {
    if (original.duration === 0) return 0;
    return ((comparison.durationDiff / original.duration) * 100).toFixed(1);
  }, [original.duration, comparison.durationDiff]);

  // 状态匹配图标
  const StatusIcon = comparison.statusMatch ? CheckCircle2 : XCircle;
  const statusVariant = comparison.statusMatch ? 'default' : 'destructive';

  // 相似度颜色
  const similarityColor = useMemo(() => {
    if (comparison.overallSimilarity >= 95) return 'text-green-600';
    if (comparison.overallSimilarity >= 80) return 'text-yellow-600';
    return 'text-red-600';
  }, [comparison.overallSimilarity]);

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>响应对比结果</CardTitle>
          {onExport && (
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="h-4 w-4 mr-2" />
              导出报告
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* 概览统计 */}
        <div className="space-y-4 mb-6">
          <Alert>
            <StatusIcon className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">状态码:</span>
                  <Badge variant={statusVariant}>
                    {original.status} → {replayed.status}
                  </Badge>
                  {comparison.statusMatch ? (
                    <span className="text-sm text-green-600">(匹配)</span>
                  ) : (
                    <span className="text-sm text-red-600">(不匹配)</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span className="font-medium">响应时间:</span>
                  <span className="text-sm">
                    {formatDuration(original.duration)} → {formatDuration(replayed.duration)}
                  </span>
                  {comparison.durationDiff > 0 ? (
                    <Badge variant="destructive" className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      +{formatDuration(comparison.durationDiff)} (+{durationDiffPercent}%)
                    </Badge>
                  ) : comparison.durationDiff < 0 ? (
                    <Badge variant="default" className="flex items-center gap-1">
                      <TrendingDown className="h-3 w-3" />
                      {formatDuration(comparison.durationDiff)} ({durationDiffPercent}%)
                    </Badge>
                  ) : (
                    <span className="text-sm text-green-600">(相同)</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  <span className="font-medium">响应大小:</span>
                  <span className="text-sm">
                    {formatSize(original.size)} → {formatSize(replayed.size || 0)}
                  </span>
                  {comparison.bodySizeDiff !== 0 && (
                    <Badge variant="secondary">
                      {comparison.bodySizeDiff > 0 ? '+' : ''}
                      {formatSize(Math.abs(comparison.bodySizeDiff))}
                    </Badge>
                  )}
                </div>

                {comparison.bodyDiff.length > 0 && (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm text-yellow-600">
                      发现 {comparison.bodyDiff.length} 处内容差异
                    </span>
                  </div>
                )}

                <div className="space-y-2 mt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">整体相似度:</span>
                    <span className={`text-lg font-bold ${similarityColor}`}>
                      {comparison.overallSimilarity}%
                    </span>
                  </div>
                  <Progress value={comparison.overallSimilarity} className="h-2" />
                </div>
              </div>
            </AlertDescription>
          </Alert>
        </div>

        {/* 详细对比 Tabs */}
        <Tabs defaultValue="body" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="body">
              响应体对比
              {comparison.bodyDiff.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {comparison.bodyDiff.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="headers">
              响应头对比
              {comparison.headersDiff.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {comparison.headersDiff.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="diff-details">差异详情</TabsTrigger>
          </TabsList>

          {/* 响应体对比 */}
          <TabsContent value="body" className="space-y-4">
            <div className="border rounded-lg overflow-hidden">
              <ReactDiffViewer
                oldValue={formatBody(original.body)}
                newValue={formatBody(replayed.body)}
                splitView={true}
                leftTitle="原始响应"
                rightTitle="重放响应"
                showDiffOnly={false}
                useDarkTheme={false}
                styles={{
                  variables: {
                    light: {
                      diffViewerBackground: '#ffffff',
                      diffViewerColor: '#212529',
                      addedBackground: '#e6ffed',
                      addedColor: '#24292e',
                      removedBackground: '#ffeef0',
                      removedColor: '#24292e',
                      wordAddedBackground: '#acf2bd',
                      wordRemovedBackground: '#fdb8c0',
                      addedGutterBackground: '#cdffd8',
                      removedGutterBackground: '#ffdce0',
                      gutterBackground: '#f6f8fa',
                      gutterBackgroundDark: '#f3f4f6',
                      highlightBackground: '#fffbdd',
                      highlightGutterBackground: '#fff5b1',
                    },
                  },
                }}
              />
            </div>
          </TabsContent>

          {/* 响应头对比 */}
          <TabsContent value="headers" className="space-y-4">
            {comparison.headersDiff.length > 0 ? (
              <div className="space-y-2">
                {comparison.headersDiff.map((diff, index) => (
                  <Alert key={index}>
                    <AlertDescription>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{diff.key}:</span>
                          {diff.type === 'added' && (
                            <Badge variant="default">新增</Badge>
                          )}
                          {diff.type === 'removed' && (
                            <Badge variant="destructive">删除</Badge>
                          )}
                          {diff.type === 'changed' && (
                            <Badge variant="secondary">修改</Badge>
                          )}
                        </div>
                        {diff.type === 'changed' && (
                          <div className="text-sm space-y-1">
                            <div className="text-red-600">
                              - {diff.original}
                            </div>
                            <div className="text-green-600">
                              + {diff.replayed}
                            </div>
                          </div>
                        )}
                        {diff.type === 'added' && (
                          <div className="text-sm text-green-600">
                            + {diff.replayed}
                          </div>
                        )}
                        {diff.type === 'removed' && (
                          <div className="text-sm text-red-600">
                            - {diff.original}
                          </div>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            ) : (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>响应头完全一致</AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* 差异详情 */}
          <TabsContent value="diff-details" className="space-y-4">
            {comparison.bodyDiff.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">响应体差异详情:</h4>
                {comparison.bodyDiff.map((diff, index) => (
                  <Alert key={index}>
                    <AlertDescription>
                      <div className="space-y-1">
                        <div className="font-medium text-sm">
                          路径: {diff.path.length > 0 ? `$.${diff.path.join('.')}` : '$'}
                        </div>
                        <div className="text-xs space-y-1">
                          {diff.kind === 'E' && (
                            <>
                              <div>类型: 值变更</div>
                              <div className="text-red-600">原始值: {JSON.stringify(diff.lhs)}</div>
                              <div className="text-green-600">重放值: {JSON.stringify(diff.rhs)}</div>
                            </>
                          )}
                          {diff.kind === 'N' && (
                            <>
                              <div>类型: 新增字段</div>
                              <div className="text-green-600">新增值: {JSON.stringify(diff.rhs)}</div>
                            </>
                          )}
                          {diff.kind === 'D' && (
                            <>
                              <div>类型: 删除字段</div>
                              <div className="text-red-600">删除值: {JSON.stringify(diff.lhs)}</div>
                            </>
                          )}
                          {diff.kind === 'A' && (
                            <>
                              <div>类型: 数组变更</div>
                              <div>变更详情: {JSON.stringify(diff)}</div>
                            </>
                          )}
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            ) : (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>响应体内容完全一致</AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
