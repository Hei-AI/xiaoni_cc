import { type ChangeEvent, type FormEvent, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  History,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  RefreshCw,
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
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { SectionPanel } from '@/components/console/SectionPanel';
import { cn } from '@/lib/utils';
import {
  editImageLab,
  generateImageLab,
  type ImageLabFormat,
  type ImageLabImageResult,
  type ImageLabMode,
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      const nextEntries = response.images.map((image) => ({
        id: createId('image'),
        createdAt,
        prompt: prompt.trim(),
        mode,
        size: activeSize,
        quality,
        format,
        compression,
        image,
      }));
      const nextIds = nextEntries.map((entry) => entry.id);
      setHistory((previous) => [...nextEntries, ...previous].slice(0, 48));
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
  const canSubmit = prompt.trim().length > 0 && !isPending && (mode === 'generate' || activeReferences.length > 0);

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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <form id="image-lab-form" className="space-y-4" onSubmit={handleSubmit}>
          <SectionPanel
            title="Prompt"
            description="生成和编辑共用同一条描述；切到 edit 时会随请求带上当前参考图。"
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
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
              <div className="space-y-4">
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
                    <Label htmlFor="image-lab-count">n</Label>
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

                <div className="space-y-2">
                  <Button type="submit" disabled={!canSubmit} className="w-full">
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                    {mode === 'edit' ? 'Edit image' : 'Generate image'}
                  </Button>
                  {!prompt.trim() && (
                    <p className="text-xs text-muted-foreground">Enter a prompt to enable generation.</p>
                  )}
                  {mode === 'edit' && activeReferences.length === 0 && prompt.trim() && (
                    <p className="text-xs text-muted-foreground">Add a reference image to run edit mode.</p>
                  )}
                </div>
              </div>
            </div>
          </SectionPanel>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionPanel title="Output" icon={<ImageIcon className="h-4 w-4 text-primary" />}>
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
                    disabled={format === 'png'}
                    onChange={(event) => setCompression(Number(event.target.value))}
                  />
                </div>
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
                  className="flex min-h-[116px] w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/70"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload or reuse history
                </button>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
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
          </div>

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
          >
            {previewEntry ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-border bg-muted/60 p-3">
                  <img src={previewEntry.image.dataUrl} alt={previewEntry.prompt} className="max-h-[68vh] max-w-full rounded-md object-contain shadow-sm" />
                </div>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Prompt</div>
                    <p className="mt-1 leading-6 text-foreground">{previewEntry.prompt}</p>
                  </div>
                  {previewEntry.image.revisedPrompt && (
                    <div>
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Revised</div>
                      <p className="mt-1 leading-6 text-muted-foreground">{previewEntry.image.revisedPrompt}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Badge variant="outline">{previewEntry.size}</Badge>
                    <Badge variant="outline">{previewEntry.quality}</Badge>
                    <Badge variant="outline">{previewEntry.format}</Badge>
                    <Badge variant="outline">{previewEntry.mode}</Badge>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-center">
                {isPending ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
                <div className="mt-3 text-sm font-medium text-foreground">{isPending ? 'Rendering image...' : 'No image yet'}</div>
                <div className="mt-1 text-xs text-muted-foreground">{activeSize} · {quality} · {format}</div>
              </div>
            )}
          </SectionPanel>
        </form>

        <aside className="space-y-4">
          <SectionPanel
            title="History"
            description="结果可直接复用为 edit 参考图。"
            icon={<History className="h-4 w-4 text-primary" />}
            action={
              history.length > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setHistory([])}>
                  Reset
                </Button>
              ) : null
            }
            contentClassName="pt-3"
          >
            {history.length === 0 ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 text-center">
                <RefreshCw className="h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No history in this session</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
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
          </SectionPanel>
        </aside>
      </div>
    </PageShell>
  );
}
