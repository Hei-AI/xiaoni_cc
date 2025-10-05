import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { CheckCircle2, XCircle, Clock, User, FileText } from 'lucide-react';
import type { ReplayHistory } from '../types/traffic-replay';

interface ReplayHistoryListProps {
  history: ReplayHistory[];
  onViewDetails?: (historyId: number) => void;
}

export function ReplayHistoryList({
  history,
  onViewDetails
}: ReplayHistoryListProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>重放历史</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>暂无重放记录</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          重放历史
          <Badge variant="secondary">{history.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>重放时间</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>响应码</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>修改字段</TableHead>
                <TableHead>相似度</TableHead>
                <TableHead>操作者</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-sm">
                    {formatDate(item.replayed_at)}
                  </TableCell>
                  <TableCell>
                    {item.success ? (
                      <Badge variant="default" className="flex items-center gap-1 w-fit">
                        <CheckCircle2 className="h-3 w-3" />
                        成功
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                        <XCircle className="h-3 w-3" />
                        失败
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={item.status_code_match ? 'default' : 'secondary'}
                    >
                      {item.replay_response_status}
                      {item.status_code_match ? ' ✓' : ' ✗'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(item.replay_duration_ms)}
                    </div>
                    {item.duration_diff_ms !== 0 && (
                      <div className="text-xs text-muted-foreground">
                        {item.duration_diff_ms > 0 ? '+' : ''}
                        {formatDuration(item.duration_diff_ms)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.modification_summary ? (
                      <div className="space-y-1">
                        <Badge variant="secondary">
                          {item.modification_summary.modificationCount} 处修改
                        </Badge>
                        {item.modification_summary.fieldsModified.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {item.modification_summary.fieldsModified.slice(0, 2).join(', ')}
                            {item.modification_summary.fieldsModified.length > 2 && '...'}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">无修改</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.diff_summary ? (
                      <div className="space-y-1">
                        {item.response_body_match ? (
                          <Badge variant="default">100%</Badge>
                        ) : (
                          <Badge variant="secondary">
                            {item.diff_summary.bodyDiffCount} 处差异
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <User className="h-3 w-3" />
                      {item.replayed_by || '系统'}
                    </div>
                    {item.template_id && (
                      <Badge variant="outline" className="text-xs mt-1">
                        模板 #{item.template_id}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {onViewDetails && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onViewDetails(item.id)}
                      >
                        查看
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* 统计信息 */}
        <div className="mt-4 grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">总重放次数</div>
              <div className="text-2xl font-bold">{history.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">成功次数</div>
              <div className="text-2xl font-bold text-green-600">
                {history.filter(h => h.success).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">失败次数</div>
              <div className="text-2xl font-bold text-red-600">
                {history.filter(h => !h.success).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">状态码匹配率</div>
              <div className="text-2xl font-bold">
                {history.length > 0
                  ? `${((history.filter(h => h.status_code_match).length / history.length) * 100).toFixed(0)}%`
                  : '-'}
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}
