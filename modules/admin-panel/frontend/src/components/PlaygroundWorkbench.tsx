import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { PlaygroundPromptInput, PlaygroundPromptMode, PlaygroundRun } from '@/types/playground';
import { Beaker, Layers3, PanelLeftOpen, PanelRightOpen, Play, Plus, Trash2 } from 'lucide-react';

interface PlaygroundWorkbenchProps {
  caseName?: string;
  caseMode?: string;
  promptMode: PlaygroundPromptMode;
  promptInput: PlaygroundPromptInput;
  draftSystemInstruction: string;
  draftUserPromptTemplate: string;
  contextVariablesText: string;
  currentRun?: PlaygroundRun | null;
  isRunning?: boolean;
  onPromptInputChange: (next: PlaygroundPromptInput) => void;
  onDraftSystemInstructionChange: (value: string) => void;
  onDraftUserPromptTemplateChange: (value: string) => void;
  onContextVariablesTextChange: (value: string) => void;
  onRun: () => void;
  onOpenSamples: () => void;
  onOpenSettings: () => void;
}

export function PlaygroundWorkbench({
  caseName,
  caseMode,
  promptMode,
  promptInput,
  draftSystemInstruction,
  draftUserPromptTemplate,
  contextVariablesText,
  currentRun,
  isRunning,
  onPromptInputChange,
  onDraftSystemInstructionChange,
  onDraftUserPromptTemplateChange,
  onContextVariablesTextChange,
  onRun,
  onOpenSamples,
  onOpenSettings,
}: PlaygroundWorkbenchProps) {
  return (
    <Card className="border-border/70 bg-[linear-gradient(180deg,#ffffff_0%,#f6f8fb_100%)] shadow-[0_26px_60px_-40px_rgba(15,23,42,0.4)]">
      <CardHeader className="border-b border-border/70 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">AI Studio inspired</Badge>
              {caseMode ? <Badge variant="secondary">{caseMode}</Badge> : null}
            </div>
            <CardTitle className="text-[1.4rem]">{caseName || 'Playground Workbench'}</CardTitle>
            <div className="mt-1 text-sm text-muted-foreground">
              编辑 Prompt 和消息，再用右侧 provider 参数反复试跑。
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="lg:hidden" onClick={onOpenSamples}>
              <PanelLeftOpen className="mr-2 h-4 w-4" />
              Samples
            </Button>
            <Button variant="outline" size="sm" className="lg:hidden" onClick={onOpenSettings}>
              <PanelRightOpen className="mr-2 h-4 w-4" />
              Settings
            </Button>
            <Button onClick={onRun} disabled={isRunning}>
              <Play className="mr-2 h-4 w-4" />
              {isRunning ? 'Running...' : 'Run'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-5">
        <Alert>
          <Beaker className="h-4 w-4" />
          <AlertDescription>
            {promptMode === 'saved'
              ? '当前是 saved prompt 模式，系统会优先使用数据库里的 Prompt 模板，再叠加你的消息输入。'
              : '当前是 draft prompt 模式，系统只使用工作台里的草稿内容，不会回写正式 Prompt。'}
          </AlertDescription>
        </Alert>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-border/70 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Layers3 className="h-4 w-4 text-primary" />
                System Instruction
              </div>
              <Textarea
                value={promptMode === 'draft' ? draftSystemInstruction : promptInput.systemInstruction}
                onChange={(event) => {
                  if (promptMode === 'draft') {
                    onDraftSystemInstructionChange(event.target.value);
                  }
                  onPromptInputChange({
                    ...promptInput,
                    systemInstruction: event.target.value,
                  });
                }}
                className="min-h-[220px] resize-none rounded-2xl bg-slate-50 font-mono text-sm"
              />
            </div>

            <div className="rounded-3xl border border-border/70 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Messages</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onPromptInputChange({
                      ...promptInput,
                      messages: [...promptInput.messages, { role: 'user', content: '' }],
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Message
                </Button>
              </div>
              <div className="space-y-3">
                {promptInput.messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className="rounded-2xl border border-border/70 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant={message.role === 'assistant' ? 'secondary' : 'outline'}>
                        {message.role}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onPromptInputChange({
                            ...promptInput,
                            messages: promptInput.messages.filter((_, itemIndex) => itemIndex !== index),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={message.content}
                      onChange={(event) =>
                        onPromptInputChange({
                          ...promptInput,
                          messages: promptInput.messages.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, content: event.target.value } : item
                          ),
                        })
                      }
                      className="min-h-[120px] resize-none rounded-2xl bg-white text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-border/70 bg-white p-4">
              <div className="mb-3 text-sm font-semibold">Context Variables</div>
              <Textarea
                value={contextVariablesText}
                onChange={(event) => onContextVariablesTextChange(event.target.value)}
                className="min-h-[180px] rounded-2xl bg-slate-50 font-mono text-xs"
              />
            </div>

            {promptMode === 'draft' ? (
              <div className="rounded-3xl border border-border/70 bg-white p-4">
                <div className="mb-3 text-sm font-semibold">Draft User Prompt Template</div>
                <Textarea
                  value={draftUserPromptTemplate}
                  onChange={(event) => onDraftUserPromptTemplateChange(event.target.value)}
                  className="min-h-[180px] rounded-2xl bg-slate-50 font-mono text-xs"
                />
              </div>
            ) : null}

            <div className="rounded-3xl border border-border/70 bg-white p-4">
              <div className="mb-3 text-sm font-semibold">Quick Output</div>
              <div className="rounded-2xl border border-dashed border-border bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Latest</div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-7">
                  {currentRun?.outputSnapshot?.responseText || currentRun?.outputSnapshot?.error || 'Run 后这里会出现结果摘要。'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
