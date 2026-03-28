import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { ResizableSplit } from '../components/ui/resizable-split';
import { FloatingWorkspacePanel, type FloatingWorkspacePanelState, type FloatingWorkspaceResizeMode } from '../components/ui/floating-workspace-panel';
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
import {
  fetchDebugSessions,
  fetchDebugSession,
  saveDebugSession,
  deleteDebugSession
} from '../lib/promptDebugApi';
import { formatConfiguredValue } from '@/lib/contract-display';

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
    totalTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    processingTime?: number;
    contextPolicy?: {
      source?: string;
      contextWindowTokens?: number;
      softTriggerTokens?: number;
      hardCeilingTokens?: number;
      replyBudgetTokens?: number;
    };
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
  is_active: number;
  version: number;
  created_by: string;
  description?: string | null;
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

// 调试API调用 - 使用debug-v2端点调用Bot Core
const debugPrompt = async (promptId: string, messages: DebugMessage[], userInput: string) => {
  // 🔥 修复: 传递完整的对话历史和prompt ID，而不是单独的userInput
  // 将前端的DebugMessage格式转换为LLM API需要的格式
  const conversationHistory = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : msg.role, // 转换为Gemini API格式
    content: msg.content
  }));

  // 添加当前用户输入
  conversationHistory.push({
    role: 'user',
    content: userInput
  });

  const response = await fetch('/api/debug/prompt-v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt_id: promptId,                    // 🔥 传递prompt ID而不是手动获取配置
      messages: conversationHistory,          // 🔥 传递完整对话历史
      conversation_id: promptId
    }),
  });

  if (!response.ok) {
    throw new Error('Debug request failed');
  }

  return response.json();
};

const toNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const normalizeDebugMetadata = (response: any) => {
  const totalTokens =
    toNumber(response?.usage?.total_tokens) ??
    toNumber(response?.usage?.totalTokenCount) ??
    toNumber(response?.usageMetadata?.totalTokenCount);
  const cachedInputTokens =
    toNumber(response?.usage_details?.cached_input_tokens) ??
    toNumber(response?.usage?.cached_input_tokens);
  const reasoningTokens =
    toNumber(response?.usage_details?.reasoning_tokens) ??
    toNumber(response?.usage?.reasoning_tokens);
  const processingTime =
    toNumber(response?.performance?.duration_ms) ??
    toNumber(response?.performance?.processing_time_ms) ??
    toNumber(response?.processingTime);
  const contextPolicy = response?.context_policy
    ? {
        source: typeof response.context_policy.source === 'string' ? response.context_policy.source : undefined,
        contextWindowTokens: toNumber(response.context_policy.context_window_tokens),
        softTriggerTokens: toNumber(response.context_policy.soft_trigger_tokens),
        hardCeilingTokens: toNumber(response.context_policy.hard_ceiling_tokens),
        replyBudgetTokens: toNumber(response.context_policy.reply_budget_tokens)
      }
    : undefined;

  return {
    totalTokens,
    cachedInputTokens,
    reasoningTokens,
    processingTime,
    contextPolicy
  };
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
  const [showConfigPanel, setShowConfigPanel] = useState(true);
  const [isDesktopDebugLayout, setIsDesktopDebugLayout] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.innerWidth >= 1024;
  });
  const [historyPanel, setHistoryPanel] = useState<FloatingWorkspacePanelState>({
    collapsed: true,
    x: 980,
    y: 24,
    width: 360,
    height: 520,
  });
  const [configPanel, setConfigPanel] = useState<FloatingWorkspacePanelState>({
    collapsed: false,
    x: 980,
    y: 110,
    width: 340,
    height: 380,
  });
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: 'history' | 'config';
    mode: FloatingWorkspaceResizeMode;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const applyMatch = (matches: boolean) => setIsDesktopDebugLayout(matches);
    applyMatch(mediaQuery.matches);
    const listener = (event: MediaQueryListEvent) => applyMatch(event.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  const clampFloatingPanel = (panel: FloatingWorkspacePanelState): FloatingWorkspacePanelState => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    const boundsWidth = rect?.width ?? (typeof window === 'undefined' ? 1600 : window.innerWidth);
    const boundsHeight = rect?.height ?? (typeof window === 'undefined' ? 1000 : window.innerHeight);
    const width = Math.min(Math.max(panel.width, 320), Math.max(320, boundsWidth - 32));
    const height = Math.min(Math.max(panel.height, 280), Math.max(280, boundsHeight - 32));
    const x = Math.min(Math.max(panel.x, 16), Math.max(16, boundsWidth - width - 16));
    const y = Math.min(Math.max(panel.y, 16), Math.max(16, boundsHeight - height - 16));
    return { ...panel, width, height, x, y };
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragRef.current;
      if (!dragState) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      const updatePanel = dragState.id === 'history' ? setHistoryPanel : setConfigPanel;

      updatePanel((current) => {
        let next = current;
        if (dragState.mode === 'move') {
          next = { ...current, x: dragState.originX + deltaX, y: dragState.originY + deltaY };
        } else if (dragState.mode === 'right') {
          next = { ...current, width: dragState.originWidth + deltaX };
        } else if (dragState.mode === 'bottom') {
          next = { ...current, height: dragState.originHeight + deltaY };
        } else {
          next = { ...current, width: dragState.originWidth + deltaX, height: dragState.originHeight + deltaY };
        }
        return clampFloatingPanel(next);
      });
    };

    const handlePointerUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    if (!isDesktopDebugLayout) {
      return;
    }
    setHistoryPanel((current) => clampFloatingPanel(current));
    setConfigPanel((current) => clampFloatingPanel(current));
  }, [isDesktopDebugLayout]);

  const handleFloatingPointerDown = (id: 'history' | 'config', mode: FloatingWorkspaceResizeMode) =>
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const panel = id === 'history' ? historyPanel : configPanel;
      dragRef.current = {
        id,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        originX: panel.x,
        originY: panel.y,
        originWidth: panel.width,
        originHeight: panel.height,
      };
    };

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

      // 处理新的API响应格式
      let thought = '';
      let actualContent = '';

      if (response.success) {
        // 新的API格式: { success: true, response: "...", thinking: "...", model: "..." }
        actualContent = response.response || '';
        thought = response.thinking || '';
      } else if (response.candidates && response.candidates[0]) {
        // 兼容旧的Gemini API格式
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
          model: formatConfiguredValue(response.model),
          ...normalizeDebugMetadata(response)
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

  const handleLoadSession = (sessionId: string) => {
    loadSessionMutation.mutate(sessionId);
    setShowHistoryPanel(false);
  };

  const handleDeleteSession = (sessionId: string) => {
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
      <div className="py-12 text-center text-destructive">
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
            onClick={() => {
              const nextOpen = !showHistoryPanel;
              setShowHistoryPanel(nextOpen);
              setHistoryPanel((current) => ({ ...current, collapsed: !nextOpen }));
            }}
            disabled={isLoadingSessions}
          >
            <History className="h-4 w-4 mr-2" />
            {showHistoryPanel ? '隐藏历史' : '调试历史'}
            {debugSessionsData?.data?.sessions && debugSessionsData.data.sessions.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {debugSessionsData.data.sessions.length}
              </Badge>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const nextOpen = !showConfigPanel;
              setShowConfigPanel(nextOpen);
              setConfigPanel((current) => ({ ...current, collapsed: !nextOpen }));
            }}
          >
            <Settings className="h-4 w-4 mr-2" />
            {showConfigPanel ? '隐藏配置' : 'Prompt配置'}
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

      {isDesktopDebugLayout ? (
        <div ref={workspaceRef} className="relative">
          <Card className="flex h-[clamp(640px,72vh,920px)] min-h-0 flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                对话调试
                <Badge variant="outline">{messages.length} 条消息</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden">
              <ResizableSplit
                direction="vertical"
                disabled={!isDesktopDebugLayout}
                defaultSize={78}
                minFirstSize={300}
                minSecondSize={140}
                className="h-full"
                firstClassName="h-full"
                secondClassName="h-full"
                handleLabel="调整消息列表与输入区高度"
                first={(
                  <div className="h-full min-h-0 space-y-4 overflow-y-auto pr-1">
                    {messages.length === 0 ? (
                      <div className="py-8 text-center text-muted-foreground">
                        <Bot className="mx-auto mb-4 h-12 w-12 opacity-50" />
                        <p>开始与AI对话，测试您的Prompt配置</p>
                      </div>
                    ) : (
                      messages.map((message) => (
                        <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] ${message.role === 'user' ? 'order-2' : 'order-1'}`}>
                            {message.role === 'assistant' && message.thought && (
                              <>
                                <div className="mb-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => toggleThought(message.id)}
                                    className="h-auto p-1 text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/10 hover:text-[hsl(var(--warning))]"
                                  >
                                    <Brain className="mr-1 h-3 w-3" />
                                    <span className="text-xs">
                                      {message.thoughtExpanded ? '收起思考过程' : '展开思考过程'}
                                    </span>
                                    {message.thoughtExpanded ? (
                                      <EyeOff className="ml-1 h-3 w-3" />
                                    ) : (
                                      <Eye className="ml-1 h-3 w-3" />
                                    )}
                                  </Button>
                                </div>
                                {message.thoughtExpanded && (
                                  <div className="mb-2 rounded-lg border border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/10 p-3">
                                    <div className="mb-2 flex items-center gap-2">
                                      <Brain className="h-4 w-4 text-[hsl(var(--warning))]" />
                                      <span className="text-sm font-medium text-[hsl(var(--warning))]">思考过程</span>
                                    </div>
                                    <div className="whitespace-pre-wrap font-mono text-sm text-[hsl(var(--warning))]">
                                      {message.thought}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}

                            <div className="mb-1 flex items-center gap-1 opacity-60 transition-opacity hover:opacity-100">
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
                                className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>

                            <div className={`rounded-lg p-3 ${
                              message.role === 'user'
                                ? 'border border-primary/15 bg-primary/10 text-foreground'
                                : 'border border-border bg-muted/45 text-foreground'
                            }`}>
                              {editingMessageId === message.id ? (
                                <div className="space-y-2">
                                  <Textarea
                                    value={editingContent}
                                    onChange={(e) => setEditingContent(e.target.value)}
                                    className="min-h-[60px] text-sm text-foreground"
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => saveEditMessage(message.id)} className="h-6 px-2 text-xs">
                                      保存
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={cancelEditMessage} className="h-6 px-2 text-xs">
                                      取消
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="whitespace-pre-wrap">{message.content}</div>
                              )}

                              {message.metadata && !editingMessageId && (
                                <div className="mt-2 border-t border-border pt-2">
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-75">
                                    {message.metadata.model && <span>模型: {message.metadata.model}</span>}
                                    {typeof message.metadata.totalTokens !== 'undefined' && <span>Total: {message.metadata.totalTokens}</span>}
                                    {typeof message.metadata.cachedInputTokens !== 'undefined' && <span>Cached: {message.metadata.cachedInputTokens}</span>}
                                    {typeof message.metadata.reasoningTokens !== 'undefined' && <span>Reasoning: {message.metadata.reasoningTokens}</span>}
                                    {typeof message.metadata.processingTime !== 'undefined' && <span>耗时: {message.metadata.processingTime}ms</span>}
                                    {typeof message.metadata.contextPolicy?.contextWindowTokens !== 'undefined' && (
                                      <span>窗口: {message.metadata.contextPolicy.contextWindowTokens}</span>
                                    )}
                                    {typeof message.metadata.contextPolicy?.softTriggerTokens !== 'undefined' && (
                                      <span>Soft: {message.metadata.contextPolicy.softTriggerTokens}</span>
                                    )}
                                    {typeof message.metadata.contextPolicy?.hardCeilingTokens !== 'undefined' && (
                                      <span>Hard: {message.metadata.contextPolicy.hardCeilingTokens}</span>
                                    )}
                                    {typeof message.metadata.contextPolicy?.replyBudgetTokens !== 'undefined' && (
                                      <span>Reply: {message.metadata.contextPolicy.replyBudgetTokens}</span>
                                    )}
                                    {message.metadata.contextPolicy?.source && <span>策略: {message.metadata.contextPolicy.source}</span>}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="mt-1 text-xs text-muted-foreground">
                              {message.timestamp.toLocaleTimeString()}
                            </div>
                          </div>

                          <div className={`flex-shrink-0 ${message.role === 'user' ? 'order-1' : 'order-2'}`}>
                            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                              message.role === 'user' ? 'bg-primary/10' : 'bg-muted'
                            }`}>
                              {message.role === 'user' ? (
                                <User className="h-4 w-4 text-primary" />
                              ) : (
                                <Bot className="h-4 w-4 text-foreground" />
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
                second={(
                  <div className="h-full min-h-0 overflow-auto border-t pt-4">
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
                        rows={3}
                        className="min-h-[110px] flex-1"
                      />
                      <Button onClick={handleSendMessage} disabled={!userInput.trim() || isLoading} className="px-4">
                        {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      按 Enter 发送，Shift + Enter 换行
                    </p>
                  </div>
                )}
              />
            </CardContent>
          </Card>

          {showConfigPanel ? (
            <FloatingWorkspacePanel
              title="Prompt配置"
              x={configPanel.x}
              y={configPanel.y}
              width={configPanel.width}
              height={configPanel.height}
              onClose={() => {
                setShowConfigPanel(false);
                setConfigPanel((current) => ({ ...current, collapsed: true }));
              }}
              onDragPointerDown={handleFloatingPointerDown('config', 'move')}
              onResizePointerDown={(mode) => handleFloatingPointerDown('config', mode)}
              bodyClassName="overflow-auto"
            >
              <div className="space-y-4">
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
                  <p className="text-sm text-muted-foreground">{formatConfiguredValue(prompt.model_name)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">状态</Label>
                  <Badge variant={prompt.is_active ? 'default' : 'secondary'}>
                    {prompt.is_active ? '激活' : '禁用'}
                  </Badge>
                </div>
                {prompt.description && (
                  <div>
                    <Label className="text-sm font-medium">描述</Label>
                    <p className="text-sm text-muted-foreground">{prompt.description}</p>
                  </div>
                )}
              </div>
            </FloatingWorkspacePanel>
          ) : null}

          {showHistoryPanel ? (
            <FloatingWorkspacePanel
              title="调试历史"
              x={historyPanel.x}
              y={historyPanel.y}
              width={historyPanel.width}
              height={historyPanel.height}
              onClose={() => {
                setShowHistoryPanel(false);
                setHistoryPanel((current) => ({ ...current, collapsed: true }));
              }}
              onDragPointerDown={handleFloatingPointerDown('history', 'move')}
              onResizePointerDown={(mode) => handleFloatingPointerDown('history', mode)}
              bodyClassName="overflow-auto"
            >
              <div className="space-y-2">
                {isLoadingSessions ? (
                  <div className="py-4 text-center">
                    <RefreshCw className="mx-auto mb-2 h-4 w-4 animate-spin" />
                    <p className="text-sm text-muted-foreground">加载中...</p>
                  </div>
                ) : !debugSessionsData?.data?.sessions || debugSessionsData.data.sessions.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <History className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    <p className="text-sm">暂无调试历史</p>
                  </div>
                ) : (
                  debugSessionsData.data.sessions.map((session) => (
                    <div
                      key={session.id}
                      className="group cursor-pointer rounded-lg border p-3 hover:bg-muted/50"
                      onClick={() => handleLoadSession(session.id)}
                    >
                      <div className="mb-2 flex items-start justify-between">
                        <h4 className="flex-1 truncate text-sm font-medium">
                          {session.session_name}
                        </h4>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(session.id);
                          }}
                          className="h-6 w-6 p-0 text-destructive opacity-0 group-hover:opacity-100 hover:text-destructive"
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
              </div>
            </FloatingWorkspacePanel>
          ) : null}
        </div>
      ) : (
        <div className={`grid gap-6 ${showHistoryPanel ? 'grid-cols-1 xl:grid-cols-5' : 'grid-cols-1 lg:grid-cols-4'}`}>
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
                    <div className="py-4 text-center">
                      <RefreshCw className="mx-auto mb-2 h-4 w-4 animate-spin" />
                      <p className="text-sm text-muted-foreground">加载中...</p>
                    </div>
                  ) : !debugSessionsData?.data?.sessions || debugSessionsData.data.sessions.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      <History className="mx-auto mb-2 h-8 w-8 opacity-50" />
                      <p className="text-sm">暂无调试历史</p>
                    </div>
                  ) : (
                    debugSessionsData.data.sessions.map((session) => (
                      <div
                        key={session.id}
                        className="group cursor-pointer rounded-lg border p-3 hover:bg-muted/50"
                        onClick={() => handleLoadSession(session.id)}
                      >
                        <div className="mb-2 flex items-start justify-between">
                          <h4 className="flex-1 truncate text-sm font-medium">
                            {session.session_name}
                          </h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(session.id);
                            }}
                            className="h-6 w-6 p-0 text-destructive opacity-0 group-hover:opacity-100 hover:text-destructive"
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

          <div className={showHistoryPanel ? 'xl:col-span-1' : 'lg:col-span-1'}>
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
                  <p className="text-sm text-muted-foreground">{formatConfiguredValue(prompt.model_name)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">状态</Label>
                  <Badge variant={prompt.is_active ? 'default' : 'secondary'}>
                    {prompt.is_active ? '激活' : '禁用'}
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

          <div className={showHistoryPanel ? 'xl:col-span-3' : 'lg:col-span-3'}>
            <Card className="flex h-[600px] flex-col">
              <CardHeader className="flex-shrink-0">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  对话调试
                  <Badge variant="outline">{messages.length} 条消息</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col overflow-hidden">
                <div className="mb-4 flex-1 space-y-4 overflow-y-auto">
                  {messages.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      <Bot className="mx-auto mb-4 h-12 w-12 opacity-50" />
                      <p>开始与AI对话，测试您的Prompt配置</p>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] ${message.role === 'user' ? 'order-2' : 'order-1'}`}>
                          <div className={`rounded-lg p-3 ${
                            message.role === 'user'
                              ? 'border border-primary/15 bg-primary/10 text-foreground'
                              : 'border border-border bg-muted/45 text-foreground'
                          }`}>
                            <div className="whitespace-pre-wrap">{message.content}</div>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {message.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                        <div className={`flex-shrink-0 ${message.role === 'user' ? 'order-1' : 'order-2'}`}>
                          <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                            message.role === 'user' ? 'bg-primary/10' : 'bg-muted'
                          }`}>
                            {message.role === 'user' ? (
                              <User className="h-4 w-4 text-primary" />
                            ) : (
                              <Bot className="h-4 w-4 text-foreground" />
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    按 Enter 发送，Shift + Enter 换行
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* 保存会话对话框 */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/18 backdrop-blur-[1px]">
          <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-popover p-6 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.35)]">
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
