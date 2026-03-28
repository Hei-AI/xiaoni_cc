import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { PlaygroundPromptMode, PlaygroundProviderConfig } from '@/types/playground';
import {
  getPlaygroundProviderId,
  getPlaygroundProviderSpecific,
  withPlaygroundProviderId,
} from '@/lib/provider-config';
import { ChevronDown, Gauge, Settings2, SlidersHorizontal, WandSparkles } from 'lucide-react';

interface PromptSummary {
  id: string;
  prompt_name: string;
  model_name?: string | null;
}

interface ProviderSettingsPanelProps {
  promptMode: PlaygroundPromptMode;
  promptId?: string | null;
  prompts: PromptSummary[];
  providerConfig: PlaygroundProviderConfig;
  providerSpecificText: string;
  safetyText: string;
  toolsText: string;
  onPromptModeChange: (value: PlaygroundPromptMode) => void;
  onPromptIdChange: (value: string | null) => void;
  onProviderConfigChange: (next: PlaygroundProviderConfig) => void;
  onProviderSpecificTextChange: (value: string) => void;
  onSafetyTextChange: (value: string) => void;
  onToolsTextChange: (value: string) => void;
}

const PROVIDER_OPTIONS = [
  { value: 'google-gemini-cli', label: 'Google Gemini CLI' },
  { value: 'google-legacy', label: 'Google Legacy API' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'codex', label: 'Codex' },
] as const;

export function ProviderSettingsPanel({
  promptMode,
  promptId,
  prompts,
  providerConfig,
  providerSpecificText,
  safetyText,
  toolsText,
  onPromptModeChange,
  onPromptIdChange,
  onProviderConfigChange,
  onProviderSpecificTextChange,
  onSafetyTextChange,
  onToolsTextChange,
}: ProviderSettingsPanelProps) {
  const generation = providerConfig.generation || {};
  const thinking = providerConfig.thinking || {};
  const context = providerConfig.context || {};
  const providerId = getPlaygroundProviderId(providerConfig);
  const providerSpecific = getPlaygroundProviderSpecific(providerConfig);

  return (
    <Card className="border-border/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-[0_20px_45px_-36px_rgba(15,23,42,0.35)]">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-primary" />
            Run Settings
          </CardTitle>
          <Badge variant="outline">{providerId}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-2xl border border-border/70 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <WandSparkles className="h-4 w-4 text-primary" />
            Prompt Mode
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={promptMode === 'saved' ? 'default' : 'outline'}
              onClick={() => onPromptModeChange('saved')}
            >
              Saved Prompt
            </Button>
            <Button
              type="button"
              variant={promptMode === 'draft' ? 'default' : 'outline'}
              onClick={() => onPromptModeChange('draft')}
            >
              Draft Prompt
            </Button>
          </div>
          <div className="mt-3">
            <Select value={promptId || 'none'} onValueChange={(value) => onPromptIdChange(value === 'none' ? null : value)}>
              <SelectTrigger>
                <SelectValue placeholder="选择 Prompt" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不绑定 Prompt</SelectItem>
                {prompts.map((prompt) => (
                  <SelectItem key={prompt.id} value={prompt.id}>
                    {prompt.prompt_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Provider
          </div>
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={providerId}
                onValueChange={(value) =>
                  onProviderConfigChange(withPlaygroundProviderId(providerConfig, value as PlaygroundProviderConfig['model']['provider']))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Temperature</Label>
                <Input
                  value={String(generation.temperature ?? 0.7)}
                  onChange={(event) =>
                    onProviderConfigChange({
                      ...providerConfig,
                      generation: { ...generation, temperature: Number(event.target.value || 0) },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Top P</Label>
                <Input
                  value={String(generation.topP ?? 0.95)}
                  onChange={(event) =>
                    onProviderConfigChange({
                      ...providerConfig,
                      generation: { ...generation, topP: Number(event.target.value || 0) },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Top K</Label>
                <Input
                  value={String(generation.topK ?? 40)}
                  onChange={(event) =>
                    onProviderConfigChange({
                      ...providerConfig,
                      generation: { ...generation, topK: Number(event.target.value || 0) },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Max Output Tokens</Label>
                <Input
                  value={String(generation.maxOutputTokens ?? 2048)}
                  onChange={(event) =>
                    onProviderConfigChange({
                      ...providerConfig,
                      generation: { ...generation, maxOutputTokens: Number(event.target.value || 0) },
                    })
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="h-4 w-4 text-primary" />
            Thinking
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-border/70 px-3 py-2">
            <div>
              <div className="text-sm font-medium">Include thoughts</div>
              <div className="text-xs text-muted-foreground">是否要求 provider 暴露推理输出</div>
            </div>
            <Switch
              checked={Boolean(thinking.includeThoughts)}
              onCheckedChange={(checked) =>
                onProviderConfigChange({
                  ...providerConfig,
                  thinking: { ...thinking, includeThoughts: checked },
                })
              }
            />
          </div>
          <div className="mt-3 space-y-2">
            <Label>Thinking Budget</Label>
            <Input
              value={String(thinking.thinkingBudget ?? -1)}
              onChange={(event) =>
                onProviderConfigChange({
                  ...providerConfig,
                  thinking: { ...thinking, thinkingBudget: Number(event.target.value || 0) },
                })
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-white p-4">
          <div className="text-sm font-semibold">Execution Context</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className="rounded-xl border border-border/70 px-3 py-2">Model {String(providerConfig.model?.name || 'auto')}</div>
            <div className="rounded-xl border border-border/70 px-3 py-2">Prompt {String(context.promptName || 'draft')}</div>
          </div>
        </div>

        <Collapsible className="rounded-2xl border border-border/70 bg-white p-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold">
            <span>Advanced JSON</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label>providerSpecific</Label>
              <Textarea value={providerSpecificText || JSON.stringify(providerSpecific, null, 2)} onChange={(event) => onProviderSpecificTextChange(event.target.value)} className="min-h-[120px] font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>safety</Label>
              <Textarea value={safetyText} onChange={(event) => onSafetyTextChange(event.target.value)} className="min-h-[120px] font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>tools</Label>
              <Textarea value={toolsText} onChange={(event) => onToolsTextChange(event.target.value)} className="min-h-[120px] font-mono text-xs" />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
