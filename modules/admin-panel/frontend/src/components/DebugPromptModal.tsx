import React, { useState } from 'react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Loader2, Send, AlertCircle, CheckCircle, Copy } from 'lucide-react';

interface DebugPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId?: string;
}

interface DebugRequest {
  prompt: string;
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
}

const AVAILABLE_MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
];

export const DebugPromptModal: React.FC<DebugPromptModalProps> = ({
  isOpen,
  onClose,
  conversationId
}) => {
  const [request, setRequest] = useState<DebugRequest>({
    prompt: '',
    parameters: '{}',
    model: 'gemini-2.5-flash'
  });
  const [response, setResponse] = useState<DebugResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (!request.prompt.trim()) {
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
      const response = await fetch('/api/debug/prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: request.prompt,
          parameters: parsedParams,
          model: request.model,
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
          execution_time: executionTime
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
      prompt: '',
      parameters: '{}',
      model: 'gemini-2.5-flash'
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
              <Label htmlFor="model">选择模型</Label>
              <Select
                value={request.model}
                onValueChange={(value) => setRequest(prev => ({ ...prev, model: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择LLM模型" />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt 内容</Label>
              <Textarea
                id="prompt"
                value={request.prompt}
                onChange={(e) => setRequest(prev => ({ ...prev, prompt: e.target.value }))}
                placeholder="输入你要测试的prompt..."
                className="min-h-[120px] font-mono text-sm"
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
              disabled={isLoading || !request.prompt.trim()}
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