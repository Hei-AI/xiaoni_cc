import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import {
  ArrowLeft,
  Send,
  Bot,
  User,
  Brain,
  MessageSquare,
  RefreshCw,
  Eye,
  EyeOff,
  Settings,
  Trash2,
  Edit,
  Save,
  History,
  Clock
} from 'lucide-react';

interface DebugMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  thought?: string;
  thoughtExpanded?: boolean;
  isEditing?: boolean;
  metadata?: {
    model: string;
    tokensUsed?: number;
    processingTime?: number;
  };
}


interface AgentPrompt {
  id: string;
  agent_type: string;
  prompt_name: string;
  system_instructions: string | string[];
  user_prompt_template?: string | null;
  context_variables?: any;
  model_config?: any;
  advanced_config?: any;
  model_name?: string;
  allowed_token_ids?: number[] | null;
  is_active: number;
  version: number;
  created_by: string;
  description?: string | null;
}

interface DebugSession {
  id: number;
  prompt_id: string;
  session_name: string;
  messages: DebugMessage[];
  created_at: string;
  created_by: string;
  message_count?: number;
}

// 获取单个 Prompt
const fetchPrompt = async (promptId: string): Promise<{ success: boolean; data: AgentPrompt }> => {
  if (promptId === 'new') {
    throw new Error('Cannot fetch prompt with ID "new"');
  }

  const response = await fetch(`/api/prompts/${promptId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch prompt');
  }
  return response.json();
};

// 调试API调用
const debugPrompt = async (promptId: string, messages: DebugMessage[], userInput: string) => {
  const response = await fetch('/api/prompts/debug', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      promptId,
      messages,
      userInput
    }),
  });

  if (!response.ok) {
    throw new Error('Debug request failed');
  }

  return response.json();
};

// 获取调试历史
const fetchDebugSessions = async (promptId: string): Promise<{ success: boolean; data: DebugSession[] }> => {
  const response = await fetch(`/api/prompts/${promptId}/debug-sessions`);
  if (!response.ok) {
    throw new Error('Failed to fetch debug sessions');
  }
  return response.json();
};

// 获取特定调试会话
const fetchDebugSession = async (sessionId: number): Promise<{ success: boolean; data: DebugSession }> => {
  const response = await fetch(`/api/debug-sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch debug session');
  }
  return response.json();
};

// 保存调试会话
const saveDebugSession = async (promptId: string, sessionName: string, messages: DebugMessage[]) => {
  const response = await fetch(`/api/prompts/${promptId}/debug-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionName,
      messages
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to save debug session');
  }

  return response.json();
};

// 删除调试会话
const deleteDebugSession = async (sessionId: number) => {
  const response = await fetch(`/api/debug-sessions/${sessionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete debug session');
  }

  return response.json();
};

export const PromptDebugPage: React.FC = () => {
  const { promptId } = useParams<{ promptId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<DebugMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  // Debug session state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveSessionName, setSaveSessionName] = useState('');
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  // 查询Prompt数据
  const {
    data: promptData,
    isLoading: isLoadingPrompt,
    error: promptError
  } = useQuery({
    queryKey: ['prompt', promptId],
    queryFn: () => fetchPrompt(promptId!),
    enabled: !!promptId && promptId !== 'new',
  });

  // 查询调试历史
  const {
    data: debugSessionsData,
    isLoading: isLoadingSessions
  } = useQuery({
    queryKey: ['debugSessions', promptId],
    queryFn: () => fetchDebugSessions(promptId!),
    enabled: !!promptId && promptId !== 'new',
  });

  // 保存调试会话的 mutation
  const saveSessionMutation = useMutation({
    mutationFn: ({ sessionName, messages: messagesToSave }: { sessionName: string; messages: DebugMessage[] }) =>
      saveDebugSession(promptId!, sessionName, messagesToSave),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debugSessions', promptId] });
      setShowSaveDialog(false);
      setSaveSessionName('');
    },
  });

  // 加载调试会话的 mutation
  const loadSessionMutation = useMutation({
    mutationFn: fetchDebugSession,
    onSuccess: (data) => {
      if (data.success) {
        // 将存储的 'model' 角色转换回前端使用的 'assistant'
        const convertedMessages = data.data.messages.map((msg: any) => ({
          ...msg,
          role: msg.role === 'model' ? 'assistant' : msg.role,
          timestamp: new Date(msg.timestamp)
        }));
        setMessages(convertedMessages);
      }
    },
  });

  // 删除调试会话的 mutation
  const deleteSessionMutation = useMutation({
    mutationFn: deleteDebugSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debugSessions', promptId] });
    },
  });

  const handleSendMessage = async () => {
    if (!userInput.trim() || isLoading || !promptId) return;

    const newUserMessage: DebugMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userInput.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newUserMessage]);
    setUserInput('');
    setIsLoading(true);

    try {
      const response = await debugPrompt(promptId, messages, newUserMessage.content);

      // 解析响应中的思考过程
      let thought = '';
      let actualContent = '';

      if (response.candidates && response.candidates[0]) {
        const parts = response.candidates[0].content?.parts || [];

        // 查找思考过程和实际回复
        for (const part of parts) {
          if (part.thought) {
            thought = part.text || '';
          } else {
            actualContent += part.text || '';
          }
        }
      }

      const assistantMessage: DebugMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: actualContent.trim(),
        thought: thought.trim() || undefined,
        timestamp: new Date(),
        metadata: {
          model: response.modelVersion || 'unknown',
          tokensUsed: response.usageMetadata?.totalTokenCount,
          processingTime: response.processingTime
        }
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Debug error:', error);
      const errorMessage: DebugMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const toggleThought = (messageId: string) => {
    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? { ...msg, thoughtExpanded: !msg.thoughtExpanded }
        : msg
    ));
  };

  const startEditMessage = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingContent(content);
  };

  const saveEditMessage = (messageId: string) => {
    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? { ...msg, content: editingContent }
        : msg
    ));
    setEditingMessageId(null);
    setEditingContent('');
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingContent('');
  };

  const deleteMessage = (messageId: string) => {
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
  };

  // Debug session handlers
  const handleSaveSession = () => {
    if (!saveSessionName.trim() || messages.length === 0) return;
    saveSessionMutation.mutate({ sessionName: saveSessionName, messages });
  };

  const handleLoadSession = (sessionId: number) => {
    loadSessionMutation.mutate(sessionId);
    setShowHistoryPanel(false);
  };

  const handleDeleteSession = (sessionId: number) => {
    if (confirm('确定要删除这个调试会话吗？')) {
      deleteSessionMutation.mutate(sessionId);
    }
  };

  // Auto-generate session name based on first user message
  const generateSessionName = () => {
    const firstUserMessage = messages.find(msg => msg.role === 'user');
    if (firstUserMessage) {
      const content = firstUserMessage.content.trim();
      return content.length > 20 ? content.substring(0, 20) + '...' : content;
    }
    return `调试会话 ${new Date().toLocaleDateString()}`;
  };

  if (isLoadingPrompt) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">加载中...</span>
      </div>
    );
  }

  if (promptError || !promptData?.success) {
    return (
      <div className="text-center py-12 text-red-600">
        加载失败: {promptError instanceof Error ? promptError.message : '未知错误'}
      </div>
    );
  }

  const prompt = promptData.data;

  return (
    <div className="space-y-6">
      {/* 页面头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate('/prompts')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Bot className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">调试 Prompt: {prompt.prompt_name}</h1>
            <p className="text-muted-foreground">
              多轮对话调试，支持思考过程查看
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowHistoryPanel(!showHistoryPanel)}
            disabled={isLoadingSessions}
          >
            <History className="h-4 w-4 mr-2" />
            调试历史
            {debugSessionsData?.data && debugSessionsData.data.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {debugSessionsData.data.length}
              </Badge>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setSaveSessionName(generateSessionName());
              setShowSaveDialog(true);
            }}
            disabled={messages.length === 0}
          >
            <Save className="h-4 w-4 mr-2" />
            保存会话
          </Button>
          <Button
            variant="outline"
            onClick={clearMessages}
            disabled={messages.length === 0}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            清空对话
          </Button>
        </div>
      </div>

      <div className={`grid gap-6 ${showHistoryPanel ? 'grid-cols-1 xl:grid-cols-5' : 'grid-cols-1 lg:grid-cols-4'}`}>
        {/* 历史面板 (可选显示) */}
        {showHistoryPanel && (
          <div className="xl:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  调试历史
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
                {isLoadingSessions ? (
                  <div className="text-center py-4">
                    <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">加载中...</p>
                  </div>
                ) : !debugSessionsData?.data || debugSessionsData.data.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">暂无调试历史</p>
                  </div>
                ) : (
                  debugSessionsData?.data.map((session) => (
                    <div
                      key={session.id}
                      className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer group"
                      onClick={() => handleLoadSession(session.id)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-medium text-sm truncate flex-1">
                          {session.session_name}
                        </h4>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(session.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0 text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(session.created_at).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>{session.message_count || 0} 条消息</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* 左侧：Prompt信息 */}
        <div className={showHistoryPanel ? "xl:col-span-1" : "lg:col-span-1"}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Prompt配置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm font-medium">名称</Label>
                <p className="text-sm text-muted-foreground">{prompt.prompt_name}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">类型</Label>
                <Badge variant="secondary">{prompt.agent_type}</Badge>
              </div>
              <div>
                <Label className="text-sm font-medium">模型</Label>
                <p className="text-sm text-muted-foreground">{prompt.model_name || 'gemini-2.5-flash'}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">状态</Label>
                <Badge variant={prompt.is_active ? "default" : "secondary"}>
                  {prompt.is_active ? "激活" : "禁用"}
                </Badge>
              </div>
              {prompt.description && (
                <div>
                  <Label className="text-sm font-medium">描述</Label>
                  <p className="text-sm text-muted-foreground">{prompt.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧：对话调试区域 */}
        <div className={showHistoryPanel ? "xl:col-span-3" : "lg:col-span-3"}>
          <Card className="h-[600px] flex flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                对话调试
                <Badge variant="outline">{messages.length} 条消息</Badge>
              </CardTitle>
            </CardHeader>

            {/* 消息列表 */}
            <CardContent className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                {messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>开始与AI对话，测试您的Prompt配置</p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] ${message.role === 'user' ? 'order-2' : 'order-1'}`}>
                        {/* 思考过程 (仅AI消息，可点击展开) */}
                        {message.role === 'assistant' && message.thought && (
                          <>
                            <div className="mb-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleThought(message.id)}
                                className="text-yellow-700 hover:text-yellow-800 hover:bg-yellow-50 p-1 h-auto"
                              >
                                <Brain className="h-3 w-3 mr-1" />
                                <span className="text-xs">
                                  {message.thoughtExpanded ? '收起思考过程' : '展开思考过程'}
                                </span>
                                {message.thoughtExpanded ? (
                                  <EyeOff className="h-3 w-3 ml-1" />
                                ) : (
                                  <Eye className="h-3 w-3 ml-1" />
                                )}
                              </Button>
                            </div>
                            {message.thoughtExpanded && (
                              <div className="mb-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                                <div className="flex items-center gap-2 mb-2">
                                  <Brain className="h-4 w-4 text-yellow-600" />
                                  <span className="text-sm font-medium text-yellow-800">思考过程</span>
                                </div>
                                <div className="text-sm text-yellow-700 whitespace-pre-wrap font-mono">
                                  {message.thought}
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* 消息操作按钮 */}
                        <div className="flex items-center gap-1 mb-1 opacity-60 hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEditMessage(message.id, message.content)}
                            className="h-6 px-2 text-xs"
                            disabled={editingMessageId === message.id}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteMessage(message.id)}
                            className="h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>

                        {/* 消息内容 */}
                        <div className={`p-3 rounded-lg ${
                          message.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}>
                          {editingMessageId === message.id ? (
                            <div className="space-y-2">
                              <Textarea
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                className="min-h-[60px] text-sm"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => saveEditMessage(message.id)}
                                  className="h-6 px-2 text-xs"
                                >
                                  保存
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={cancelEditMessage}
                                  className="h-6 px-2 text-xs"
                                >
                                  取消
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap">{message.content}</div>
                          )}

                          {/* 元数据 */}
                          {message.metadata && !editingMessageId && (
                            <div className="mt-2 pt-2 border-t border-opacity-20 border-gray-300">
                              <div className="text-xs opacity-75 space-x-4">
                                {message.metadata.model && (
                                  <span>模型: {message.metadata.model}</span>
                                )}
                                {message.metadata.tokensUsed && (
                                  <span>Tokens: {message.metadata.tokensUsed}</span>
                                )}
                                {message.metadata.processingTime && (
                                  <span>耗时: {message.metadata.processingTime}ms</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="text-xs text-muted-foreground mt-1">
                          {message.timestamp.toLocaleTimeString()}
                        </div>
                      </div>

                      <div className={`flex-shrink-0 ${message.role === 'user' ? 'order-1' : 'order-2'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          message.role === 'user' ? 'bg-blue-600' : 'bg-gray-600'
                        }`}>
                          {message.role === 'user' ? (
                            <User className="h-4 w-4 text-white" />
                          ) : (
                            <Bot className="h-4 w-4 text-white" />
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* 输入区域 */}
              <div className="flex-shrink-0 border-t pt-4">
                <div className="flex gap-2">
                  <Textarea
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="输入消息开始调试..."
                    disabled={isLoading}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    rows={2}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!userInput.trim() || isLoading}
                    className="px-4"
                  >
                    {isLoading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  按 Enter 发送，Shift + Enter 换行
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 保存会话对话框 */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">保存调试会话</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="sessionName">会话名称</Label>
                <Input
                  id="sessionName"
                  value={saveSessionName}
                  onChange={(e) => setSaveSessionName(e.target.value)}
                  placeholder="请输入会话名称"
                  className="mt-1"
                />
              </div>
              <div className="text-sm text-muted-foreground">
                将保存当前 {messages.length} 条消息记录
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => setShowSaveDialog(false)}
              >
                取消
              </Button>
              <Button
                onClick={handleSaveSession}
                disabled={!saveSessionName.trim() || saveSessionMutation.isPending}
              >
                {saveSessionMutation.isPending && (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                )}
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};