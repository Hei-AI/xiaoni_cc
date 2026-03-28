import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Loader2, Send, AlertCircle, CheckCircle, Copy, Brain, MessageSquare } from 'lucide-react';

interface DebugPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId?: string;
  initialData?: {
    systemPrompt?: string;
    userInput?: string;
    prompt?: string; // 向后兼容
    parameters: string;
    model?: string | null;
  };
}

interface DebugRequest {
  systemPrompt: string;
  userInput: string;
  parameters: string;
  model: string;
}

interface DebugResponse {
  success: boolean;
  response?: string;
  tokenUsed?: {
    id: number;
    project_name: string;
  };
  model?: string;
  error?: string;
  execution_time?: number;
  usage?: {
    total_tokens?: number;
  } | null;
  usage_details?: {
    cached_input_tokens?: number;
    reasoning_tokens?: number;
  } | null;
  context_policy?: {
    source?: string;
    context_window_tokens?: number;
    soft_trigger_tokens?: number;
    hard_ceiling_tokens?: number;
    reply_budget_tokens?: number;
  } | null;
}

const toNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export const DebugPromptModal: React.FC<DebugPromptModalProps> = ({
  isOpen,
  onClose,
  conversationId,
  initialData
}) => {
  const [request, setRequest] = useState<DebugRequest>({
    systemPrompt: '',
    userInput: '',
    parameters: '{}',
    model: ''
  });
  const [response, setResponse] = useState<DebugResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 🔥 预填充初始数据
  useEffect(() => {
    if (initialData && isOpen) {
      setRequest({
        systemPrompt: initialData.systemPrompt || '',
        userInput: initialData.userInput || initialData.prompt || '', // 兼容旧版本
        parameters: initialData.parameters,
        model: initialData.model || ''
      });
      setResponse(null); // 清除之前的响应
    }
  }, [initialData, isOpen]);

  const handleSubmit = async () => {
    if (!request.systemPrompt.trim() && !request.userInput.trim()) {
      return;
    }

    if (!request.model.trim()) {
      return;
    }

    setIsLoading(true);
    setResponse(null);

    try {
      // Validate JSON parameters
      let parsedParams = {};
      try {
        parsedParams = JSON.parse(request.parameters);
      } catch (e) {
        throw new Error('参数必须是有效的JSON格式');
      }

      const startTime = Date.now();
      const response = await fetch('/api/debug/prompt-v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemPrompt: request.systemPrompt,
          userInput: request.userInput,
          parameters: parsedParams,
          model: request.model.trim(),
          conversation_id: conversationId
        }),
      });

      const data = await response.json();
      const executionTime = Date.now() - startTime;

      if (response.ok) {
        setResponse({
          success: true,
          response: data.response,
          tokenUsed: data.token_used,
          model: data.model,
          execution_time: executionTime,
          usage: data.usage || null,
          usage_details: data.usage_details || null,
          context_policy: data.context_policy || null
        });
      } else {
        setResponse({
          success: false,
          error: data.error || '请求失败',
          execution_time: executionTime
        });
      }
    } catch (error) {
      setResponse({
        success: false,
        error: error instanceof Error ? error.message : '网络错误',
        execution_time: Date.now() - Date.now()
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setRequest({
      systemPrompt: '',
      userInput: '',
      parameters: '{}',
      model: ''
    });
    setResponse(null);
  };

  const copyResponse = () => {
    if (response?.response) {
      navigator.clipboard.writeText(response.response);
    }
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(request.parameters);
      setRequest(prev => ({
        ...prev,
        parameters: JSON.stringify(parsed, null, 2)
      }));
    } catch (e) {
      // Invalid JSON, leave as is
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Prompt 调试工具
          </DialogTitle>
          <DialogDescription>
            直接调用LLM API进行prompt测试，系统会自动选择可用的token
            {conversationId && (
              <span className="block mt-1 text-xs text-muted-foreground">
                关联对话ID: {conversationId}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Input Section */}
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="model">模型 ID</Label>
              <Input
                id="model"
                value={request.model}
                onChange={(e) => setRequest(prev => ({ ...prev, model: e.target.value }))}
                placeholder="必须显式填写，例如 gpt-5.4-mini"
              />
              <p className="text-xs text-muted-foreground">
                调试不会再自动补默认模型。
              </p>
            </div>

            {/* 🔥 System Prompt 输入区域 */}
            <div className="space-y-2">
              <Label htmlFor="systemPrompt" className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-600" />
                System Prompt （系统提示词）
              </Label>
              <Textarea
                id="systemPrompt"
                value={request.systemPrompt}
                onChange={(e) => setRequest(prev => ({ ...prev, systemPrompt: e.target.value }))}
                placeholder="输入系统提示词，定义AI的角色和行为..."
                className="min-h-[100px] font-mono text-sm bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800"
              />
            </div>

            {/* 🔥 User Input 输入区域 */}
            <div className="space-y-2">
              <Label htmlFor="userInput" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-blue-600" />
                User Input （用户输入和上下文）
              </Label>
              <Textarea
                id="userInput"
                value={request.userInput}
                onChange={(e) => setRequest(prev => ({ ...prev, userInput: e.target.value }))}
                placeholder="输入用户消息和相关上下文..."
                className="min-h-[120px] font-mono text-sm bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="parameters">参数 (JSON)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={formatJson}
                  className="h-6 px-2 text-xs"
                >
                  格式化
                </Button>
              </div>
              <Textarea
                id="parameters"
                value={request.parameters}
                onChange={(e) => setRequest(prev => ({ ...prev, parameters: e.target.value }))}
                placeholder='{"temperature": 0.7, "max_output_tokens": 1000}'
                className="min-h-[80px] font-mono text-sm"
              />
            </div>
          </div>

          {/* Response Section */}
          {response && (
            <Card className={response.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <div className="flex items-center gap-2">
                    {response.success ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-600" />
                    )}
                    {response.success ? '调用成功' : '调用失败'}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {response.execution_time && (
                      <Badge variant="secondary">
                        {response.execution_time}ms
                      </Badge>
                    )}
                    {response.success && response.response && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={copyResponse}
                        className="h-6 px-2"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {response.success && response.tokenUsed && (
                  <div className="text-xs text-muted-foreground">
                    使用Token: {response.tokenUsed.project_name} (ID: {response.tokenUsed.id})
                    {response.model && ` | 模型: ${response.model}`}
                  </div>
                )}

                {response.success && (
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    {typeof toNumber(response.usage?.total_tokens) !== 'undefined' && (
                      <div className="rounded border bg-white p-2">Total Tokens: {response.usage?.total_tokens}</div>
                    )}
                    {typeof toNumber(response.usage_details?.cached_input_tokens) !== 'undefined' && (
                      <div className="rounded border bg-white p-2">Cached Input: {response.usage_details?.cached_input_tokens}</div>
                    )}
                    {typeof toNumber(response.usage_details?.reasoning_tokens) !== 'undefined' && (
                      <div className="rounded border bg-white p-2">Reasoning: {response.usage_details?.reasoning_tokens}</div>
                    )}
                    {typeof toNumber(response.context_policy?.context_window_tokens) !== 'undefined' && (
                      <div className="rounded border bg-white p-2">Context Window: {response.context_policy?.context_window_tokens}</div>
                    )}
                    {typeof toNumber(response.context_policy?.soft_trigger_tokens) !== 'undefined' && (
                      <div className="rounded border bg-white p-2">Soft Trigger: {response.context_policy?.soft_trigger_tokens}</div>
                    )}
                    {typeof toNumber(response.context_policy?.hard_ceiling_tokens) !== 'undefined' && (
                      <div className="rounded border bg-white p-2">Hard Ceiling: {response.context_policy?.hard_ceiling_tokens}</div>
                    )}
                    {typeof toNumber(response.context_policy?.reply_budget_tokens) !== 'undefined' && (
                      <div className="rounded border bg-white p-2">Reply Budget: {response.context_policy?.reply_budget_tokens}</div>
                    )}
                    {response.context_policy?.source && (
                      <div className="rounded border bg-white p-2">Policy Source: {response.context_policy.source}</div>
                    )}
                  </div>
                )}
                
                {response.success && response.response && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">响应内容:</Label>
                    <div className="bg-white border rounded p-3 max-h-[300px] overflow-y-auto">
                      <pre className="text-sm whitespace-pre-wrap font-mono">
                        {response.response}
                      </pre>
                    </div>
                  </div>
                )}

                {!response.success && response.error && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-red-600">错误信息:</Label>
                    <div className="bg-white border border-red-200 rounded p-3">
                      <pre className="text-sm text-red-600 whitespace-pre-wrap">
                        {response.error}
                      </pre>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={isLoading}
          >
            重置
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              关闭
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isLoading || (!request.systemPrompt.trim() && !request.userInput.trim()) || !request.model.trim()}
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              发送调试
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
