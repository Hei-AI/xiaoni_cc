import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Play, RotateCcw, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { TrafficLog, ReplayModifications } from '../types/traffic-replay';

interface TrafficReplayEditorProps {
  originalLog: TrafficLog;
  onReplay: (modifications: ReplayModifications) => Promise<void>;
  isReplaying?: boolean;
  error?: string;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

export function TrafficReplayEditor({
  originalLog,
  onReplay,
  isReplaying = false,
  error
}: TrafficReplayEditorProps) {
  const [method, setMethod] = useState(originalLog.method);
  const [url, setUrl] = useState(originalLog.url);
  const [headers, setHeaders] = useState(
    JSON.stringify(originalLog.request_headers || {}, null, 2)
  );
  const [body, setBody] = useState(originalLog.request_body || '');
  const [modifications, setModifications] = useState<Set<string>>(new Set());
  const [validationError, setValidationError] = useState<string>('');

  // 更新字段并标记为已修改
  const handleFieldChange = (field: string, value: any, compareTo: any) => {
    if (value !== compareTo) {
      setModifications(prev => new Set(prev).add(field));
    } else {
      setModifications(prev => {
        const newSet = new Set(prev);
        newSet.delete(field);
        return newSet;
      });
    }
  };

  // JSON 验证
  const validateJson = (jsonString: string): boolean => {
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  };

  // JSON 格式化
  const formatJson = (jsonString: string): string => {
    try {
      return JSON.stringify(JSON.parse(jsonString), null, 2);
    } catch {
      return jsonString;
    }
  };

  // 重置到原始值
  const handleReset = () => {
    setMethod(originalLog.method);
    setUrl(originalLog.url);
    setHeaders(JSON.stringify(originalLog.request_headers || {}, null, 2));
    setBody(originalLog.request_body || '');
    setModifications(new Set());
    setValidationError('');
  };

  // 格式化 Headers
  const handleFormatHeaders = () => {
    const formatted = formatJson(headers);
    setHeaders(formatted);
  };

  // 格式化 Body
  const handleFormatBody = () => {
    if (body.trim()) {
      const formatted = formatJson(body);
      setBody(formatted);
    }
  };

  // 发起重放
  const handleReplay = async () => {
    setValidationError('');

    // 验证 Headers JSON
    if (headers.trim() && !validateJson(headers)) {
      setValidationError('请求头JSON格式错误，请检查语法');
      return;
    }

    // 验证 Body JSON (如果是JSON content-type)
    if (body.trim() && originalLog.request_content_type?.includes('json')) {
      if (!validateJson(body)) {
        setValidationError('请求体JSON格式错误，请检查语法');
        return;
      }
    }

    // 构建修改对象
    const mods: ReplayModifications = {};

    if (method !== originalLog.method) {
      mods.method = method;
    }

    if (url !== originalLog.url) {
      mods.url = url;
    }

    if (headers !== JSON.stringify(originalLog.request_headers || {}, null, 2)) {
      try {
        mods.headers = JSON.parse(headers);
      } catch {
        setValidationError('请求头JSON解析失败');
        return;
      }
    }

    if (body !== (originalLog.request_body || '')) {
      mods.body = body;
    }

    try {
      await onReplay(mods);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : '重放请求失败');
    }
  };

  // 计算修改摘要
  const modificationSummary = useMemo(() => {
    const modified: string[] = [];
    if (method !== originalLog.method) modified.push('HTTP方法');
    if (url !== originalLog.url) modified.push('URL');
    if (headers !== JSON.stringify(originalLog.request_headers || {}, null, 2)) {
      modified.push('请求头');
    }
    if (body !== (originalLog.request_body || '')) modified.push('请求体');
    return modified;
  }, [method, url, headers, body, originalLog]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>请求参数编辑器</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={modifications.size === 0 || isReplaying}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              重置
            </Button>
            <Button
              onClick={handleReplay}
              disabled={isReplaying}
              size="sm"
            >
              <Play className="h-4 w-4 mr-1" />
              {isReplaying ? '重放中...' : '重放请求'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">
              基本信息
              {(method !== originalLog.method || url !== originalLog.url) && (
                <Badge variant="secondary" className="ml-2">已修改</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="headers">
              请求头
              {headers !== JSON.stringify(originalLog.request_headers || {}, null, 2) && (
                <Badge variant="secondary" className="ml-2">已修改</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="body">
              请求体
              {body !== (originalLog.request_body || '') && (
                <Badge variant="secondary" className="ml-2">已修改</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="summary">
              摘要 ({modificationSummary.length})
            </TabsTrigger>
          </TabsList>

          {/* 基本信息 Tab */}
          <TabsContent value="basic" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="method">HTTP 方法</Label>
              <Select
                value={method}
                onValueChange={(value) => {
                  setMethod(value);
                  handleFieldChange('method', value, originalLog.method);
                }}
              >
                <SelectTrigger id="method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {method !== originalLog.method && (
                <p className="text-xs text-muted-foreground">
                  原始: {originalLog.method}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="url">请求 URL</Label>
              <Input
                id="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  handleFieldChange('url', e.target.value, originalLog.url);
                }}
                placeholder="https://api.example.com/v1/endpoint"
              />
              {url !== originalLog.url && (
                <p className="text-xs text-muted-foreground break-all">
                  原始: {originalLog.url}
                </p>
              )}
            </div>
          </TabsContent>

          {/* 请求头 Tab */}
          <TabsContent value="headers" className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="headers">请求头 (JSON 格式)</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFormatHeaders}
                >
                  格式化
                </Button>
              </div>
              <Textarea
                id="headers"
                value={headers}
                onChange={(e) => {
                  setHeaders(e.target.value);
                  handleFieldChange(
                    'headers',
                    e.target.value,
                    JSON.stringify(originalLog.request_headers || {}, null, 2)
                  );
                }}
                placeholder='{\n  "Content-Type": "application/json",\n  "Authorization": "Bearer token"\n}'
                className="font-mono text-sm min-h-[200px]"
              />
              {!validateJson(headers) && headers.trim() && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    JSON 格式错误，请检查语法
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </TabsContent>

          {/* 请求体 Tab */}
          <TabsContent value="body" className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="body">请求体</Label>
                <div className="flex gap-2">
                  {originalLog.request_content_type?.includes('json') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleFormatBody}
                    >
                      格式化
                    </Button>
                  )}
                </div>
              </div>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  handleFieldChange('body', e.target.value, originalLog.request_body || '');
                }}
                placeholder="请求体内容"
                className="font-mono text-sm min-h-[300px]"
              />
              {originalLog.request_content_type?.includes('json') &&
                body.trim() &&
                !validateJson(body) && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      JSON 格式错误，请检查语法
                    </AlertDescription>
                  </Alert>
                )}
            </div>
          </TabsContent>

          {/* 摘要 Tab */}
          <TabsContent value="summary" className="space-y-4">
            {modificationSummary.length > 0 ? (
              <div className="space-y-3">
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    已修改 {modificationSummary.length} 个字段
                  </AlertDescription>
                </Alert>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">修改的字段：</h4>
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    {modificationSummary.map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  未进行任何修改，将使用原始请求参数
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>

        {/* 错误提示 */}
        {(validationError || error) && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{validationError || error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
