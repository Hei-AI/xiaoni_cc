import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  History,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { SectionPanel } from '@/components/console/SectionPanel';
import { cn } from '@/lib/utils';
import {
  assistImageLabPrompt,
  editImageLab,
  fetchImageLabHistory,
  generateImageLab,
  imageLabHistoryRunToImages,
  type ImageLabFormat,
  type ImageLabHistoryRun,
  type ImageLabImageResult,
  type ImageLabMode,
  type ImageLabPromptAssistantResponse,
  type ImageLabQuality,
  type ImageLabReferenceImage,
  type ImageLabRequest,
} from '@/lib/imageLabApi';

type SizePreset = '1024x1024' | '1536x1024' | '1024x1536' | '1792x1024' | '1024x1792' | 'custom';

interface UploadedReference {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
}

interface HistoryEntry {
  id: string;
  createdAt: string;
  prompt: string;
  mode: ImageLabMode;
  size: string;
  quality: ImageLabQuality;
  format: ImageLabFormat;
  compression: number;
  image: ImageLabImageResult;
  runId?: string;
  source: 'session' | 'persisted';
}

const SIZE_PRESETS: Array<{ value: SizePreset; label: string }> = [
  { value: '1024x1024', label: 'Square 1024' },
  { value: '1536x1024', label: 'Landscape 1536x1024' },
  { value: '1024x1536', label: 'Portrait 1024x1536' },
  { value: '1792x1024', label: 'Wide 1792x1024' },
  { value: '1024x1792', label: 'Tall 1024x1792' },
  { value: 'custom', label: 'Custom' },
];

const QUALITY_OPTIONS: ImageLabQuality[] = ['auto', 'low', 'medium', 'high'];
const FORMAT_OPTIONS: ImageLabFormat[] = ['png', 'jpeg', 'webp'];
const PROMPT_SECTION_LABELS: Array<[keyof ImageLabPromptAssistantResponse['sections'], string]> = [
  ['subject', 'Subject'],
  ['scene', 'Scene'],
  ['style', 'Style'],
  ['composition', 'Composition'],
  ['camera', 'Camera'],
  ['lighting', 'Lighting'],
  ['details', 'Details'],
  ['constraints', 'Constraints'],
];

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseSize(value: string): { width?: number; height?: number } {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) {
    return {};
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function readFileAsDataUrl(file: File): Promise<UploadedReference> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Cannot read ${file.name}`));
        return;
      }
      resolve({
        id: createId('upload'),
        name: file.name,
        dataUrl: reader.result,
        mimeType: file.type || 'image/png',
      });
    };
    reader.onerror = () => reject(new Error(`Cannot read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function isQuality(value: string | undefined): value is ImageLabQuality {
  return value === 'auto' || value === 'low' || value === 'medium' || value === 'high';
}

function isFormat(value: string | undefined): value is ImageLabFormat {
  return value === 'png' || value === 'jpeg' || value === 'webp';
}

function isSizePreset(value: string | undefined): value is SizePreset {
  return value === '1024x1024'
    || value === '1536x1024'
    || value === '1024x1536'
    || value === '1792x1024'
    || value === '1024x1792';
}

function normalizeHistoryMode(operation: string): ImageLabMode {
  return operation === 'edit' ? 'edit' : 'generate';
}

function normalizeHistoryQuality(value: string | null | undefined): ImageLabQuality {
  return isQuality(value || undefined) ? value as ImageLabQuality : 'auto';
}

function normalizeHistoryFormat(value: string | null | undefined): ImageLabFormat {
  return isFormat(value || undefined) ? value as ImageLabFormat : 'png';
}

function entriesFromHistoryRuns(runs: ImageLabHistoryRun[]): HistoryEntry[] {
  return runs.flatMap((run) => {
    if (run.operation !== 'generate' && run.operation !== 'edit') {
      return [];
    }
    const images = imageLabHistoryRunToImages(run);
    return images.map((image, index) => ({
      id: image.artifactId || `${run.id}-${index}`,
      runId: run.id,
      createdAt: run.completed_at || run.created_at,
      prompt: run.prompt,
      mode: normalizeHistoryMode(run.operation),
      size: run.size || 'auto',
      quality: normalizeHistoryQuality(run.quality),
      format: normalizeHistoryFormat(run.format),
      compression: 90,
      image,
      source: 'persisted' as const,
    }));
  });
}

function mergeHistoryEntries(nextEntries: HistoryEntry[], previousEntries: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>();
  return [...nextEntries, ...previousEntries]
    .filter((entry) => {
      const key = entry.image.artifactId || entry.id;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 80);
}

function getActiveRuns(runs: ImageLabHistoryRun[] | undefined): ImageLabHistoryRun[] {
  return (runs ?? [])
    .filter((run) => run.status === 'pending')
    .sort((a, b) => Date.parse(b.started_at || b.created_at) - Date.parse(a.started_at || a.created_at));
}

function getFailedRuns(runs: ImageLabHistoryRun[] | undefined): ImageLabHistoryRun[] {
  return (runs ?? [])
    .filter((run) => run.status === 'failed')
    .sort((a, b) => Date.parse(b.completed_at || b.updated_at || b.created_at) - Date.parse(a.completed_at || a.updated_at || a.created_at));
}

function formatOperation(value: string): string {
  if (value === 'prompt_assistant') {
    return 'prompt assist';
  }
  return value;
}

function runParameters(run: ImageLabHistoryRun): string[] {
  return [run.size, run.quality, run.format].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function ActiveJobItem({ run }: { run: ImageLabHistoryRun }) {
  const startedAt = run.started_at || run.created_at;
  const parameters = runParameters(run);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <span className="truncate text-xs font-medium text-foreground">{formatTime(startedAt)}</span>
        </div>
        <Badge variant="secondary" className="shrink-0 px-2 py-0.5">
          {formatOperation(run.operation)}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{run.prompt || 'No prompt recorded'}</p>
      {parameters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parameters.map((parameter) => (
            <Badge key={parameter} variant="outline" className="px-2 py-0 text-[10px]">
              {parameter}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function FailedJobItem({ run, onLoadDraft }: { run: ImageLabHistoryRun; onLoadDraft: () => void }) {
  const finishedAt = run.completed_at || run.updated_at || run.created_at;
  const parameters = runParameters(run);
  const errorText = run.error_message || 'No error message recorded';

  return (
    <div className="rounded-lg border border-destructive/25 bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="truncate text-xs font-medium text-foreground">{formatTime(finishedAt)}</span>
        </div>
        <Badge variant="destructive" className="shrink-0 px-2 py-0.5">
          {formatOperation(run.operation)}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{run.prompt || 'No prompt recorded'}</p>
      <details className="mt-2 rounded-md border border-destructive/20 bg-destructive/5 text-xs leading-5 text-destructive">
        <summary className="cursor-pointer list-none px-2 py-1.5 font-medium">
          <span className="line-clamp-1">{errorText}</span>
        </summary>
        <p className="border-t border-destructive/15 px-2 py-2">{errorText}</p>
      </details>
      {parameters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parameters.map((parameter) => (
            <Badge key={parameter} variant="outline" className="px-2 py-0 text-[10px]">
              {parameter}
            </Badge>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={onLoadDraft}>
        <RotateCcw className="mr-2 h-3.5 w-3.5" />
        Load draft
      </Button>
    </div>
  );
}

function HistoryThumbnail({
  entry,
  selected,
  current,
  onToggleReference,
  onPreview,
}: {
  entry: HistoryEntry;
  selected: boolean;
  current: boolean;
  onToggleReference: () => void;
  onPreview: () => void;
}) {
  return (
    <div className={cn('rounded-lg border bg-card p-2 transition-colors', current ? 'border-primary/50' : 'border-border')}>
      <button
        type="button"
        className="block aspect-square w-full overflow-hidden rounded-md border border-border bg-muted"
        onClick={onPreview}
        title="预览结果"
      >
        <img src={entry.image.dataUrl} alt={entry.prompt} className="h-full w-full object-cover" />
      </button>
      <div className="mt-2 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-foreground">{formatTime(entry.createdAt)}</span>
          <Badge variant={entry.mode === 'edit' ? 'secondary' : 'outline'} className="shrink-0 px-2 py-0.5">
            {entry.mode}
          </Badge>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{entry.prompt}</p>
      </div>
      <Button
        type="button"
        variant={selected ? 'default' : 'outline'}
        size="sm"
        className="mt-2 w-full"
        onClick={onToggleReference}
      >
        {selected ? 'Using as ref' : 'Use as ref'}
      </Button>
    </div>
  );
}

export function ImageLabPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<ImageLabMode>('generate');
  const [sizePreset, setSizePreset] = useState<SizePreset>('1024x1024');
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);
  const [quality, setQuality] = useState<ImageLabQuality>('high');
  const [format, setFormat] = useState<ImageLabFormat>('png');
  const [compression, setCompression] = useState(90);
  const [n, setN] = useState(1);
  const [uploadedReferences, setUploadedReferences] = useState<UploadedReference[]>([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentResultIds, setCurrentResultIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [assistantResult, setAssistantResult] = useState<ImageLabPromptAssistantResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activityTab, setActivityTab] = useState<'running' | 'failed' | 'history'>('failed');

  const historyQuery = useQuery({
    queryKey: ['image-lab-history'],
    queryFn: () => fetchImageLabHistory(80),
    staleTime: 30_000,
    refetchInterval: 5000,
  });

  const activeSize = sizePreset === 'custom' ? `${customWidth}x${customHeight}` : sizePreset;
  const selectedHistoryReferences = useMemo(
    () => history.filter((entry) => selectedHistoryIds.includes(entry.id)),
    [history, selectedHistoryIds]
  );
  const activeReferences = useMemo<ImageLabReferenceImage[]>(
    () => [
      ...uploadedReferences.map((reference) => ({
        id: reference.id,
        name: reference.name,
        dataUrl: reference.dataUrl,
        mimeType: reference.mimeType,
      })),
      ...selectedHistoryReferences.map((entry) => ({
        id: entry.id,
        name: `history-${formatTime(entry.createdAt)}`,
        dataUrl: entry.image.dataUrl,
        mimeType: entry.image.mimeType,
      })),
    ],
    [selectedHistoryReferences, uploadedReferences]
  );
  const currentResults = useMemo(
    () => history.filter((entry) => currentResultIds.includes(entry.id)),
    [currentResultIds, history]
  );
  const previewEntry = useMemo(
    () => history.find((entry) => entry.id === previewId) ?? currentResults[0] ?? history[0] ?? null,
    [currentResults, history, previewId]
  );
  const activeRuns = useMemo(() => getActiveRuns(historyQuery.data), [historyQuery.data]);
  const failedRuns = useMemo(() => getFailedRuns(historyQuery.data), [historyQuery.data]);

  useEffect(() => {
    if (!historyQuery.data) {
      return;
    }
    const persistedEntries = entriesFromHistoryRuns(historyQuery.data);
    setHistory((previous) => mergeHistoryEntries(persistedEntries, previous));
  }, [historyQuery.data]);

  const imageMutation = useMutation({
    mutationFn: async () => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
        throw new Error('Prompt is required');
      }
      if (mode === 'edit' && activeReferences.length === 0) {
        throw new Error('Edit mode needs at least one reference image');
      }

      const sizeParts = parseSize(activeSize);
      const payload: ImageLabRequest = {
        prompt: trimmedPrompt,
        size: activeSize,
        width: sizeParts.width,
        height: sizeParts.height,
        quality,
        format,
        compression,
        n,
        referenceImages: activeReferences,
      };

      return mode === 'edit' ? editImageLab(payload) : generateImageLab(payload);
    },
    onSuccess: (response) => {
      const createdAt = new Date().toISOString();
      const nextEntries = response.images.map((image, index) => ({
        id: image.artifactId || response.historyRun?.artifacts?.[index]?.id || createId('image'),
        runId: response.historyRun?.id,
        createdAt,
        prompt: prompt.trim(),
        mode,
        size: activeSize,
        quality,
        format,
        compression,
        image,
        source: 'session' as const,
      }));
      const nextIds = nextEntries.map((entry) => entry.id);
      setHistory((previous) => mergeHistoryEntries(nextEntries, previous));
      setCurrentResultIds(nextIds);
      setPreviewId(nextIds[0] ?? null);
      setStatusMessage(`${nextEntries.length} image${nextEntries.length > 1 ? 's' : ''} ready`);
      setErrorMessage(null);
    },
    onError: (error) => {
      setStatusMessage(null);
      setErrorMessage(error instanceof Error ? error.message : 'Image Lab request failed');
    },
  });

  const assistantMutation = useMutation({
    mutationFn: async () => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
        throw new Error('Enter a rough idea before using Prompt Assist');
      }
      return assistImageLabPrompt({
        prompt: trimmedPrompt,
        mode,
        size: activeSize,
        quality,
        format,
        referenceImages: activeReferences,
      });
    },
    onSuccess: (response) => {
      setAssistantResult(response);
      setStatusMessage('Prompt Assistant prepared a draft');
      setErrorMessage(null);
    },
    onError: (error) => {
      setStatusMessage(null);
      setErrorMessage(error instanceof Error ? error.message : 'Prompt Assistant failed');
    },
  });

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }
    try {
      const references = await Promise.all(files.map(readFileAsDataUrl));
      setUploadedReferences((previous) => [...references, ...previous].slice(0, 12));
      setMode('edit');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to read image');
    } finally {
      event.target.value = '';
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    imageMutation.mutate();
  };

  const handlePromptAssist = () => {
    setStatusMessage(null);
    setErrorMessage(null);
    assistantMutation.mutate();
  };

  const applyAssistantPrompt = () => {
    if (!assistantResult) {
      return;
    }
    setPrompt(assistantResult.finalPrompt);
    setStatusMessage('Prompt applied. Review it, then generate.');
    setErrorMessage(null);
  };

  const applyAssistantSuggestions = () => {
    const suggested = assistantResult?.suggested;
    if (!suggested) {
      return;
    }
    if (isSizePreset(suggested.size)) {
      setSizePreset(suggested.size);
    } else if (suggested.size && /^(\d+)x(\d+)$/.test(suggested.size)) {
      const parsed = parseSize(suggested.size);
      setSizePreset('custom');
      setCustomWidth(parsed.width || customWidth);
      setCustomHeight(parsed.height || customHeight);
    }
    if (isQuality(suggested.quality)) {
      setQuality(suggested.quality);
    }
    if (isFormat(suggested.format)) {
      setFormat(suggested.format);
    }
    setStatusMessage('Prompt Assistant suggestions applied');
  };

  const loadRunDraft = (run: ImageLabHistoryRun) => {
    const nextSize = typeof run.size === 'string' && run.size.trim() ? run.size.trim() : '1024x1024';
    const inputJson = run.input_json && typeof run.input_json === 'object' ? run.input_json : {};
    const requestedCount = Number(inputJson.n);
    const requestedCompression = Number(inputJson.output_compression ?? inputJson.compression);

    setPrompt(run.prompt || '');
    setMode(run.operation === 'edit' ? 'edit' : 'generate');
    if (isSizePreset(nextSize)) {
      setSizePreset(nextSize);
    } else if (/^(\d+)x(\d+)$/.test(nextSize)) {
      const parsed = parseSize(nextSize);
      setSizePreset('custom');
      setCustomWidth(parsed.width || customWidth);
      setCustomHeight(parsed.height || customHeight);
    }
    setQuality(normalizeHistoryQuality(run.quality));
    setFormat(normalizeHistoryFormat(run.format));
    if (Number.isFinite(requestedCount)) {
      setN(Math.max(1, Math.min(8, requestedCount)));
    }
    if (Number.isFinite(requestedCompression)) {
      setCompression(Math.max(0, Math.min(100, requestedCompression)));
    }
    setAssistantResult(null);
    setStatusMessage(run.operation === 'edit'
      ? 'Failed edit loaded as draft. Reselect references, adjust it, then rerun.'
      : 'Failed job loaded as draft. Adjust it, then rerun.');
    setErrorMessage(null);
  };

  const toggleHistoryReference = (id: string) => {
    setSelectedHistoryIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [id, ...previous].slice(0, 8)
    );
    setMode('edit');
  };

  const clearReferences = () => {
    setUploadedReferences([]);
    setSelectedHistoryIds([]);
  };

  const isPending = imageMutation.isPending;
  const isAssistantPending = assistantMutation.isPending;
  const canSubmit = prompt.trim().length > 0 && !isPending && !isAssistantPending && (mode === 'generate' || activeReferences.length > 0);
  const canAssist = prompt.trim().length > 0 && !isAssistantPending && !isPending;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Image Lab"
        title="gpt-image-2"
        description="面向人工使用的多轮生图工作台，支持生成、编辑、参考图复用与结果留痕。"
        icon={<ImagePlus className="h-4 w-4" />}
        badge={<PageHeaderBadge>{quality === 'high' ? 'High quality' : quality}</PageHeaderBadge>}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Upload ref
            </Button>
            <Button type="submit" form="image-lab-form" disabled={!canSubmit} size="sm">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {mode === 'edit' ? 'Run edit' : 'Run'}
            </Button>
          </div>
        }
      />

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />

      <div className="space-y-4">
        <form id="image-lab-form" className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
            <div className="space-y-4">
              <SectionPanel
                title="Prompt"
                description="描述、模式和输出设置集中在这里；右侧实时保留结果预览。"
                icon={<Sparkles className="h-4 w-4 text-primary" />}
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="image-lab-prompt">Prompt</Label>
                    <Textarea
                      id="image-lab-prompt"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Describe the image, style, composition, and edits..."
                      className="min-h-[190px] resize-y"
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Mode</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['generate', 'edit'] as ImageLabMode[]).map((option) => (
                          <Button
                            key={option}
                            type="button"
                            variant={mode === option ? 'default' : 'outline'}
                            onClick={() => setMode(option)}
                          >
                            {option === 'generate' ? 'New image' : 'Edit refs'}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="image-lab-size">Size</Label>
                        <Select value={sizePreset} onValueChange={(value) => setSizePreset(value as SizePreset)}>
                          <SelectTrigger id="image-lab-size">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SIZE_PRESETS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="image-lab-count">Images</Label>
                        <Input
                          id="image-lab-count"
                          type="number"
                          min={1}
                          max={8}
                          value={n}
                          onChange={(event) => setN(Math.max(1, Math.min(8, Number(event.target.value) || 1)))}
                        />
                      </div>
                    </div>
                  </div>

                  {sizePreset === 'custom' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="image-lab-width">Width</Label>
                        <Input
                          id="image-lab-width"
                          type="number"
                          min={256}
                          max={4096}
                          step={64}
                          value={customWidth}
                          onChange={(event) => setCustomWidth(Math.max(256, Number(event.target.value) || 1024))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="image-lab-height">Height</Label>
                        <Input
                          id="image-lab-height"
                          type="number"
                          min={256}
                          max={4096}
                          step={64}
                          value={customHeight}
                          onChange={(event) => setCustomHeight(Math.max(256, Number(event.target.value) || 1024))}
                        />
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-border bg-muted/35 p-3">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                      <ImageIcon className="h-4 w-4 text-primary" />
                      Advanced output
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="image-lab-quality">Quality</Label>
                        <Select value={quality} onValueChange={(value) => setQuality(value as ImageLabQuality)}>
                          <SelectTrigger id="image-lab-quality">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {QUALITY_OPTIONS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="image-lab-format">Format</Label>
                        <Select value={format} onValueChange={(value) => setFormat(value as ImageLabFormat)}>
                          <SelectTrigger id="image-lab-format">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FORMAT_OPTIONS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {format !== 'png' && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="image-lab-compression">Compression</Label>
                            <span className="font-mono text-xs text-muted-foreground">{compression}</span>
                          </div>
                          <Input
                            id="image-lab-compression"
                            type="range"
                            min={0}
                            max={100}
                            value={compression}
                            onChange={(event) => setCompression(Number(event.target.value))}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="submit" disabled={!canSubmit}>
                      {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                      {mode === 'edit' ? 'Edit image' : 'Generate image'}
                    </Button>
                    <Button type="button" variant="outline" disabled={!canAssist} onClick={handlePromptAssist}>
                      {isAssistantPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      Prompt Assist
                    </Button>
                  </div>

                  {!prompt.trim() && (
                    <p className="text-xs text-muted-foreground">Enter a rough idea to enable generation and assist.</p>
                  )}
                  {mode === 'edit' && activeReferences.length === 0 && prompt.trim() && (
                    <p className="text-xs text-muted-foreground">Add a reference image to run edit mode.</p>
                  )}

                  {assistantResult && (
                    <div className="space-y-4 border-t border-border pt-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{assistantResult.detectedUseCase}</Badge>
                            {assistantResult.modelName && <Badge variant="outline">{assistantResult.modelName}</Badge>}
                          </div>
                          {assistantResult.summary && (
                            <p className="mt-2 text-sm text-muted-foreground">{assistantResult.summary}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={applyAssistantSuggestions}>
                            Apply settings
                          </Button>
                          <Button type="button" size="sm" onClick={applyAssistantPrompt}>
                            Apply prompt
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-lg border border-border bg-muted/40 p-3">
                        <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Assistant draft</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{assistantResult.finalPrompt}</p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        {PROMPT_SECTION_LABELS.map(([key, label]) => (
                          assistantResult.sections[key] ? (
                            <div key={key} className="rounded-lg border border-border bg-background p-3">
                              <div className="text-xs font-medium text-muted-foreground">{label}</div>
                              <p className="mt-1 text-sm leading-5 text-foreground">{assistantResult.sections[key]}</p>
                            </div>
                          ) : null
                        ))}
                      </div>

                      {(assistantResult.warnings.length > 0 || assistantResult.sourcePatterns.length > 0) && (
                        <div className="grid gap-3 md:grid-cols-2">
                          {assistantResult.warnings.length > 0 && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                              <div className="text-xs font-medium text-amber-700 dark:text-amber-300">Warnings</div>
                              <ul className="mt-2 space-y-1 text-sm text-foreground">
                                {assistantResult.warnings.map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {assistantResult.sourcePatterns.length > 0 && (
                            <div className="rounded-lg border border-border bg-background p-3">
                              <div className="text-xs font-medium text-muted-foreground">Pattern references</div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {assistantResult.sourcePatterns.map((pattern) => (
                                  <Badge key={pattern.id} variant="outline">{pattern.label}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </SectionPanel>

              <SectionPanel
                title="References"
                icon={<Upload className="h-4 w-4 text-primary" />}
                action={
                  activeReferences.length > 0 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={clearReferences}>
                      Clear
                    </Button>
                  ) : null
                }
              >
                {activeReferences.length === 0 ? (
                  <button
                    type="button"
                    className="flex min-h-[104px] w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/70"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload or reuse history
                  </button>
                ) : (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-4">
                    {uploadedReferences.map((reference) => (
                      <div key={reference.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                        <img src={reference.dataUrl} alt={reference.name} className="h-full w-full object-cover" />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute right-1 top-1 h-7 w-7 opacity-0 group-hover:opacity-100"
                          title="移除参考图"
                          onClick={() => setUploadedReferences((previous) => previous.filter((item) => item.id !== reference.id))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    {selectedHistoryReferences.map((entry) => (
                      <div key={entry.id} className="group relative aspect-square overflow-hidden rounded-lg border border-primary/30 bg-muted">
                        <img src={entry.image.dataUrl} alt={entry.prompt} className="h-full w-full object-cover" />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute right-1 top-1 h-7 w-7 opacity-0 group-hover:opacity-100"
                          title="移除历史参考"
                          onClick={() => setSelectedHistoryIds((previous) => previous.filter((id) => id !== entry.id))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </SectionPanel>

              {errorMessage && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              {statusMessage && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                  <AlertDescription>{statusMessage}</AlertDescription>
                </Alert>
              )}
            </div>

            <SectionPanel
              title="Result"
              icon={isPending ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <ImageIcon className="h-4 w-4 text-primary" />}
              action={
                previewEntry ? (
                  <a href={previewEntry.image.dataUrl} download={`image-lab-${previewEntry.id}.${format}`}>
                    <Button type="button" variant="outline" size="sm">
                      <Download className="mr-2 h-4 w-4" />
                      Save
                    </Button>
                  </a>
                ) : null
              }
              className="self-start xl:sticky xl:top-4"
            >
              {previewEntry ? (
                <div className="space-y-4">
                  <div className="flex min-h-[540px] items-center justify-center rounded-lg border border-border bg-muted/60 p-3">
                    <img src={previewEntry.image.dataUrl} alt={previewEntry.prompt} className="max-h-[72vh] max-w-full rounded-md object-contain shadow-sm" />
                  </div>
                  <div className="grid gap-4 text-sm lg:grid-cols-[minmax(0,1fr)_220px]">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Prompt</div>
                      <p className="mt-1 line-clamp-3 leading-6 text-foreground">{previewEntry.prompt}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <Badge variant="outline">{previewEntry.size}</Badge>
                      <Badge variant="outline">{previewEntry.quality}</Badge>
                      <Badge variant="outline">{previewEntry.format}</Badge>
                      <Badge variant="outline">{previewEntry.mode}</Badge>
                    </div>
                  </div>
                  {previewEntry.image.revisedPrompt && (
                    <div className="rounded-lg border border-border bg-muted/35 p-3 text-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Revised</div>
                      <p className="mt-1 line-clamp-3 leading-6 text-muted-foreground">{previewEntry.image.revisedPrompt}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex min-h-[620px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-center">
                  {isPending ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
                  <div className="mt-3 text-sm font-medium text-foreground">{isPending ? 'Rendering image...' : 'No image yet'}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{activeSize} · {quality} · {format}</div>
                </div>
              )}
            </SectionPanel>
          </div>
        </form>

        <SectionPanel
          title="Activity"
          description="Running, failed, and history share one workspace so tasks stay recoverable without stealing the canvas."
          icon={<History className="h-4 w-4 text-primary" />}
          action={
            <Button type="button" variant="ghost" size="sm" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}>
              <RefreshCw className={cn('mr-2 h-3.5 w-3.5', historyQuery.isFetching && 'animate-spin')} />
              Refresh
            </Button>
          }
          contentClassName="pt-3"
        >
          <Tabs value={activityTab} onValueChange={(value) => setActivityTab(value as 'running' | 'failed' | 'history')}>
            <TabsList className="flex h-auto flex-wrap items-center gap-2 border-b-0">
              <TabsTrigger
                value="running"
                className="h-9 rounded-md border border-border px-3 pb-0 data-[state=active]:border-primary data-[state=active]:bg-primary/10"
              >
                Running {activeRuns.length}
              </TabsTrigger>
              <TabsTrigger
                value="failed"
                className="h-9 rounded-md border border-border px-3 pb-0 data-[state=active]:border-primary data-[state=active]:bg-primary/10"
              >
                Failed {failedRuns.length}
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="h-9 rounded-md border border-border px-3 pb-0 data-[state=active]:border-primary data-[state=active]:bg-primary/10"
              >
                History {history.length}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="running" className="mt-4">
              {activeRuns.length === 0 ? (
                <div className="flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-center">
                  <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {historyQuery.isLoading ? 'Loading jobs...' : 'No active jobs'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {activeRuns.map((run) => (
                    <ActiveJobItem key={run.id} run={run} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="failed" className="mt-4">
              {failedRuns.length === 0 ? (
                <div className="flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-center">
                  <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {historyQuery.isLoading ? 'Loading failures...' : 'No failed jobs'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {failedRuns.map((run) => (
                    <FailedJobItem key={run.id} run={run} onLoadDraft={() => loadRunDraft(run)} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              {history.length === 0 ? (
                <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-center">
                  <RefreshCw className="h-6 w-6 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {historyQuery.isLoading ? 'Loading history...' : 'No image history yet'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                  {history.map((entry) => (
                    <HistoryThumbnail
                      key={entry.id}
                      entry={entry}
                      selected={selectedHistoryIds.includes(entry.id)}
                      current={currentResultIds.includes(entry.id)}
                      onToggleReference={() => toggleHistoryReference(entry.id)}
                      onPreview={() => setPreviewId(entry.id)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </SectionPanel>
      </div>
    </PageShell>
  );
}
