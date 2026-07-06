import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BellOff,
  BrainCircuit,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { PageHeader } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { SectionPanel } from '@/components/console/SectionPanel';
import { StatusPill } from '@/components/console/StatusPill';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn, formatTimestamp } from '@/lib/utils';

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | 'all';

type ApiResponse<T> = {
  success: boolean;
  data: T;
  error?: string;
};

type RecallLead = { kind: string; pointer: string | null; hint: string; privacyScope: string; text: string };
type RecallSurfaced = { lead: RecallLead; cos: number; sourceRef: string; provenance: Record<string, unknown> };
type RecallPreviewData = {
  deliveryMode: string;
  query: { ref: string | null; text: string; taskLocked: boolean };
  band: { floor: number | null; ceiling: number };
  silent: boolean;
  corpusCount: number;
  corpusTruncated?: boolean;
  surfaced: RecallSurfaced[];
  droppedCounts: Record<string, number>;
  droppedSample: Array<{ verdict: string; cos: number | null; sourceRef: string; cueClass: string | null; leadTemplate: string | null }>;
};
type ReindexData = {
  scanned: number;
  changed: number;
  embedded: number;
  upserted: number;
  prunedPaths: number;
  counts: { total: number; byKind: Record<string, number> };
};

type PassiveRecallCue = {
  cueClass: 'db_life_cue' | 'db_file_provenance' | 'db_spoken_fragment' | string;
  itemId: string | null;
  source: string | null;
  kind: string | null;
  timestamp: string | null;
  traceId: string | null;
  toolName: string | null;
  qqUsage: {
    mode: string;
    peerId: string | null;
  } | null;
  runtimePaths: Array<{
    path: string;
    relativePath: string;
    runtimeDir: string | null;
    basename: string | null;
    operation?: string | null;
  }>;
  features: string[];
  privacyScope: string;
  memoryCandidate: string | null;
  safeEmbeddingText: string | null;
};

type RuntimeFileCandidate = {
  source: 'runtime_file';
  cueClass: 'file_shadow_candidate';
  path: string;
  relativePath: string;
  runtimeDir: string | null;
  basename: string | null;
  extension: string | null;
  sizeBytes: number;
  mtime: string;
  safeEmbeddingText: string;
  preview: string | null;
};

type PassiveRecallShadowData = {
  identityKey: string;
  generatedAt: string;
  streamKind: string;
  deliveryMode: 'shadow_only' | string;
  filters: {
    range?: string;
    startTime?: string | null;
    endTime?: string | null;
    tags?: string[];
    includeFiles?: boolean;
    fileLimit?: number;
  };
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  counts: Record<string, number>;
  sources: {
    actionStream: {
      totalItems: number;
      cueCount: number;
    };
    runtimeFiles: {
      runtimeRoot: string;
      available: boolean;
      candidateCount: number;
      error: string | null;
    };
  };
  cues: PassiveRecallCue[];
  fileCandidates: RuntimeFileCandidate[];
};

const TIME_RANGE_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: '全部' },
];

const cueClassLabel: Record<string, string> = {
  db_life_cue: 'IM 读取',
  db_file_provenance: '文件痕迹',
  db_spoken_fragment: '已说片段',
  file_shadow_candidate: '运行文件',
};

const cueTone: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  db_life_cue: 'info',
  db_file_provenance: 'success',
  db_spoken_fragment: 'warning',
  file_shadow_candidate: 'neutral',
};

function buildQueryUrl(range: TimeRange, limit: number, fileLimit: number, includeFiles: boolean): string {
  const params = new URLSearchParams({
    range,
    limit: String(limit),
    file_limit: String(fileLimit),
    include_files: includeFiles ? '1' : '0',
  });
  return `/api/xiaoni/passive-recall/shadow-cues?${params.toString()}`;
}

async function fetchPassiveRecallShadow(url: string): Promise<PassiveRecallShadowData> {
  const response = await fetch(url);
  const payload = await response.json() as ApiResponse<PassiveRecallShadowData>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to load passive recall shadow cues');
  }
  return payload.data;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '-';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function cueTitle(cue: PassiveRecallCue): string {
  if (cue.qqUsage) {
    return `${cue.qqUsage.mode}${cue.qqUsage.peerId ? ` · ${cue.qqUsage.peerId}` : ''}`;
  }
  const firstPath = cue.runtimePaths[0]?.path;
  if (firstPath) {
    return firstPath;
  }
  return cue.itemId || `${cue.source || 'unknown'} / ${cue.kind || 'unknown'}`;
}

function CountTile({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="text-xl font-semibold text-foreground">{value}</div>
        <StatusPill tone={tone}>{value > 0 ? 'active' : 'empty'}</StatusPill>
      </div>
    </div>
  );
}

function FeaturePills({ features }: { features: string[] }) {
  if (!features.length) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {features.slice(0, 10).map((feature) => (
        <span key={feature} className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {feature}
        </span>
      ))}
      {features.length > 10 ? (
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          +{features.length - 10}
        </span>
      ) : null}
    </div>
  );
}

function CueRow({ cue }: { cue: PassiveRecallCue }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={cueTone[cue.cueClass] || 'neutral'}>
              {cueClassLabel[cue.cueClass] || cue.cueClass}
            </StatusPill>
            <span className="truncate text-sm font-medium text-foreground">{cueTitle(cue)}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[cue.source, cue.kind, cue.toolName, cue.privacyScope].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="shrink-0 text-xs text-muted-foreground">
          {formatTimestamp(cue.timestamp, { fallback: '-' })}
        </div>
      </div>

      {cue.runtimePaths.length ? (
        <div className="mt-3 space-y-1">
          {cue.runtimePaths.map((entry) => (
            <div key={`${entry.path}:${entry.operation || ''}`} className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-foreground">
              <span className="font-medium">{entry.operation || 'ref'}</span>
              <span className="ml-2 break-all text-muted-foreground">{entry.path}</span>
            </div>
          ))}
        </div>
      ) : null}

      {cue.safeEmbeddingText ? (
        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2.5 text-xs leading-5 text-foreground">
          {cue.safeEmbeddingText}
        </pre>
      ) : null}
      <FeaturePills features={cue.features} />
    </div>
  );
}

function FileCandidateRow({ candidate }: { candidate: RuntimeFileCandidate }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="neutral">运行文件</StatusPill>
            <span className="truncate text-sm font-medium text-foreground">{candidate.basename || candidate.path}</span>
          </div>
          <div className="mt-1 break-all text-xs text-muted-foreground">{candidate.path}</div>
        </div>
        <div className="shrink-0 text-xs text-muted-foreground">
          {formatBytes(candidate.sizeBytes)}
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {candidate.runtimeDir || 'unknown'} · {formatTimestamp(candidate.mtime, { fallback: candidate.mtime })}
      </div>
      {candidate.preview ? (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2.5 text-xs leading-5 text-foreground">
          {candidate.preview}
        </pre>
      ) : null}
    </div>
  );
}

interface ShadowLogLead {
  lead?: { text?: string; kind?: string; pointer?: string | null };
  cos?: number;
  sourceRef?: string;
  provenance?: { source?: string; cueClass?: string; leadTemplate?: string; peer?: string | null };
}

interface ShadowLogEntry {
  id: string;
  occurredAt: string;
  queryText?: string;
  queryRef?: string | null;
  taskLocked?: boolean;
  silent?: boolean;
  bandFloor?: number | null;
  bandCeiling?: number | null;
  corpusCount?: number;
  topK?: number;
  surfaced: ShadowLogLead[];
  droppedCounts?: Record<string, number>;
}

function legLabel(prov?: ShadowLogLead['provenance']): string {
  const t = prov?.leadTemplate || prov?.cueClass || prov?.source || '';
  if (prov?.source === 'qq_inbound' || t === 'peer_message') return '别人说过';
  if (t === 'db_file_provenance' || t === 'file_chunk') return '文件记忆';
  if (t === 'db_spoken_fragment') return '自己说过';
  return '动作流';
}

function ShadowLogRow({ entry }: { entry: ShadowLogEntry }) {
  const dc = entry.droppedCounts || {};
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {entry.silent
            ? <StatusPill tone="neutral">静默</StatusPill>
            : <StatusPill tone="success">浮现</StatusPill>}
          {entry.taskLocked ? <StatusPill tone="warning">task-locked</StatusPill> : null}
          <span className="truncate text-sm text-foreground">「{entry.queryText || entry.queryRef || '—'}」</span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{formatTimestamp(entry.occurredAt, { fallback: '-' })}</span>
      </div>
      {entry.surfaced?.length ? (
        <div className="mt-2 space-y-1.5">
          {entry.surfaced.map((s, index) => (
            <div key={s.sourceRef || index} className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <StatusPill tone="info">{legLabel(s.provenance)}</StatusPill>
                <span className="text-xs text-muted-foreground">cos {typeof s.cos === 'number' ? s.cos.toFixed(3) : '-'}</span>
              </div>
              <div className="mt-1 break-words text-sm text-foreground">{s.lead?.text || s.sourceRef}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>近邻 {entry.topK ?? 0}</span>
        <span>带 [{typeof entry.bandFloor === 'number' ? entry.bandFloor.toFixed(2) : '-'}, {typeof entry.bandCeiling === 'number' ? entry.bandCeiling.toFixed(2) : '-'}]</span>
        <span>太像 {dc.drop_too_similar ?? 0}</span>
        <span>在场 {dc.drop_in_context ?? 0}</span>
        <span>太远 {dc.drop_too_far ?? 0}</span>
      </div>
    </div>
  );
}

async function fetchShadowLog(onlySurfaced: boolean): Promise<ShadowLogEntry[]> {
  const params = new URLSearchParams({ limit: '80', only_surfaced: String(onlySurfaced) });
  const response = await fetch(`/api/xiaoni/passive-recall/shadow-log?${params.toString()}`);
  const json = (await response.json()) as ApiResponse<{ entries: ShadowLogEntry[] }>;
  if (!json.success) {
    throw new Error(json.error || '加载浮现流水失败');
  }
  return json.data.entries || [];
}

export const XiaoniPassiveRecallPage: React.FC = () => {
  const [range, setRange] = React.useState<TimeRange>('24h');
  const [limitInput, setLimitInput] = React.useState('80');
  const [fileLimitInput, setFileLimitInput] = React.useState('20');
  const [includeFiles, setIncludeFiles] = React.useState(true);
  const [recallText, setRecallText] = React.useState('');
  const [recallTaskLocked, setRecallTaskLocked] = React.useState(false);
  const [recallBusy, setRecallBusy] = React.useState(false);
  const [recallError, setRecallError] = React.useState<string | null>(null);
  const [recallResult, setRecallResult] = React.useState<RecallPreviewData | null>(null);
  const [reindexBusy, setReindexBusy] = React.useState(false);
  const [reindexInfo, setReindexInfo] = React.useState<string | null>(null);

  const runRecall = React.useCallback(async () => {
    if (!recallText.trim()) {
      setRecallError('输入一段「当下内容」当 query');
      return;
    }
    setRecallBusy(true);
    setRecallError(null);
    try {
      const params = new URLSearchParams({ query_text: recallText.trim(), task_locked: String(recallTaskLocked), limit: '3' });
      const response = await fetch(`/api/xiaoni/passive-recall/recall?${params.toString()}`);
      const json = (await response.json()) as ApiResponse<RecallPreviewData>;
      if (!json.success) {
        throw new Error(json.error || '召回失败');
      }
      setRecallResult(json.data);
    } catch (error) {
      setRecallError(error instanceof Error ? error.message : '召回失败');
      setRecallResult(null);
    } finally {
      setRecallBusy(false);
    }
  }, [recallText, recallTaskLocked]);

  const runReindex = React.useCallback(async () => {
    setReindexBusy(true);
    setReindexInfo(null);
    try {
      const response = await fetch('/api/xiaoni/passive-recall/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await response.json()) as ApiResponse<ReindexData>;
      if (!json.success) {
        throw new Error(json.error || '重建失败');
      }
      const d = json.data;
      setReindexInfo(`语料 ${d.counts.total} 条(扫 ${d.scanned}、嵌 ${d.embedded}、写 ${d.upserted}、清 ${d.prunedPaths} 文件)`);
    } catch (error) {
      setReindexInfo(error instanceof Error ? `失败：${error.message}` : '重建失败');
    } finally {
      setReindexBusy(false);
    }
  }, []);

  const limit = Math.max(1, Math.min(200, Number.parseInt(limitInput, 10) || 80));
  const fileLimit = Math.max(0, Math.min(100, Number.parseInt(fileLimitInput, 10) || 20));
  const queryUrl = React.useMemo(
    () => buildQueryUrl(range, limit, fileLimit, includeFiles),
    [fileLimit, includeFiles, limit, range]
  );
  const query = useQuery({
    queryKey: ['xiaoni-passive-recall-shadow', queryUrl],
    queryFn: () => fetchPassiveRecallShadow(queryUrl),
    refetchInterval: 15000,
  });
  const data = query.data;
  const counts = data?.counts || {};
  const cues = data?.cues || [];
  const fileCandidates = data?.fileCandidates || [];

  const [onlySurfaced, setOnlySurfaced] = React.useState(true);
  const shadowLogQuery = useQuery({
    queryKey: ['xiaoni-passive-recall-shadow-log', onlySurfaced],
    queryFn: () => fetchShadowLog(onlySurfaced),
    refetchInterval: 15000,
  });
  const shadowLogEntries = shadowLogQuery.data || [];

  return (
    <PageShell className="max-w-7xl">
      <PageHeader
        eyebrow="Passive Recall"
        title="小腻被动浮现 Shadow"
        description="只读观察 extractor 输出；不写 Notify Bucket，不投递给小腻。"
        icon={<BrainCircuit className="h-5 w-5" />}
        badge={<StatusPill tone="info">{data?.deliveryMode || 'shadow_only'}</StatusPill>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              刷新
            </Button>
          </div>
        }
      />

      {query.error ? (
        <ErrorState
          description={query.error instanceof Error ? query.error.message : '加载被动召回 shadow 输出失败'}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <SectionPanel
        title="召回预览"
        description="给一段「当下内容」当 query，看 band-pass 会浮出什么 lead、剔掉什么。只展示，不投递。"
        icon={<Search className="h-4 w-4 text-primary" />}
        action={
          <Button variant="outline" size="sm" onClick={() => void runReindex()} disabled={reindexBusy}>
            {reindexBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
            重建语料
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[280px] flex-1 space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">当下内容（query）</span>
              <Input
                value={recallText}
                onChange={(event) => setRecallText(event.target.value)}
                placeholder="例如她刚 cat 的一段笔记 / 刚收到的一句话"
              />
            </label>
            <label className="flex items-center gap-2 pb-2">
              <Switch checked={recallTaskLocked} onCheckedChange={setRecallTaskLocked} />
              <span className="text-xs text-muted-foreground">task-locked（抬高 floor）</span>
            </label>
            <Button size="sm" onClick={() => void runRecall()} disabled={recallBusy}>
              {recallBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              跑召回
            </Button>
          </div>
          {reindexInfo ? <p className="text-xs text-muted-foreground">{reindexInfo}</p> : null}
          {recallError ? <p className="text-xs text-destructive">{recallError}</p> : null}
          {recallResult ? (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusPill tone={recallResult.silent ? 'warning' : 'success'}>
                  {recallResult.silent ? '静默（什么都不冒）' : `${recallResult.surfaced.length} 条浮现`}
                </StatusPill>
                <span>语料 {recallResult.corpusCount}</span>
                {recallResult.corpusTruncated ? <StatusPill tone="warning">语料截断</StatusPill> : null}
                <span>band [{recallResult.band.floor ?? '—'}, {recallResult.band.ceiling}]</span>
                <span>
                  剔：似 {recallResult.droppedCounts.drop_too_similar || 0} / 在场 {recallResult.droppedCounts.drop_in_context || 0} / 远 {recallResult.droppedCounts.drop_too_far || 0}
                </span>
              </div>
              {recallResult.surfaced.map((entry) => (
                <div key={entry.sourceRef} className="rounded-md bg-muted/40 p-2 text-sm">
                  <div className="font-medium">{entry.lead.text}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    cos {entry.cos.toFixed(3)} · {entry.lead.kind} · {entry.lead.privacyScope} · {entry.sourceRef}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </SectionPanel>

      <SectionPanel
        title="过滤"
        description="这里控制 action-stream 窗口和 runtime 文件候选数量。"
        icon={<Search className="h-4 w-4 text-primary" />}
        action={query.isFetching ? <StatusPill tone="warning">loading</StatusPill> : <StatusPill tone="success">live</StatusPill>}
      >
        <div className="grid gap-3 md:grid-cols-[160px_160px_160px_1fr] md:items-end">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">时间范围</span>
            <Select value={range} onValueChange={(value) => setRange(value as TimeRange)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">事件窗口</span>
            <Input value={limitInput} onChange={(event) => setLimitInput(event.target.value)} inputMode="numeric" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">文件候选</span>
            <Input value={fileLimitInput} onChange={(event) => setFileLimitInput(event.target.value)} inputMode="numeric" disabled={!includeFiles} />
          </label>
          <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
            <div>
              <div className="text-sm font-medium text-foreground">扫描 runtime 文件</div>
              <div className="text-xs text-muted-foreground">只读 `.md/.txt` 候选</div>
            </div>
            <Switch checked={includeFiles} onCheckedChange={setIncludeFiles} aria-label="扫描 runtime 文件" />
          </div>
        </div>
      </SectionPanel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CountTile label="IM 读取" value={counts.db_life_cue || 0} tone="info" />
        <CountTile label="文件痕迹" value={counts.db_file_provenance || 0} tone="success" />
        <CountTile label="已说片段" value={counts.db_spoken_fragment || 0} tone="warning" />
        <CountTile label="运行文件" value={counts.file_shadow_candidate || 0} tone="neutral" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <SectionPanel
          title="DB 事件触发点"
          description={`action-stream ${data?.sources.actionStream.totalItems ?? 0} 条中提取 ${data?.sources.actionStream.cueCount ?? 0} 条`}
          icon={<Database className="h-4 w-4 text-primary" />}
          contentClassName="space-y-3"
        >
          {query.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading shadow cues...
            </div>
          ) : cues.length ? (
            cues.map((cue) => <CueRow key={cue.itemId || `${cue.cueClass}:${cue.timestamp}`} cue={cue} />)
          ) : (
            <EmptyState
              icon={<BellOff className="h-10 w-10" />}
              title="没有 DB cue"
              description="当前 action-stream 窗口里没有可作为被动召回原始点的事件。"
            />
          )}
        </SectionPanel>

        <SectionPanel
          title="Runtime 文件候选"
          description={data?.sources.runtimeFiles.available
            ? `${data.sources.runtimeFiles.runtimeRoot} · ${data.sources.runtimeFiles.candidateCount} 条`
            : data?.sources.runtimeFiles.error || 'runtime 文件扫描未启用'}
          icon={<FileText className="h-4 w-4 text-primary" />}
          contentClassName="space-y-3"
        >
          {query.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading runtime files...
            </div>
          ) : fileCandidates.length ? (
            fileCandidates.map((candidate) => <FileCandidateRow key={candidate.path} candidate={candidate} />)
          ) : (
            <EmptyState
              icon={<FileText className="h-10 w-10" />}
              title="没有文件候选"
              description={includeFiles ? '当前 runtime 扫描没有返回候选。' : 'runtime 文件扫描已关闭。'}
            />
          )}
        </SectionPanel>
      </div>

      <SectionPanel
        title="浮现流水（触发2 shadow）"
        description="每次内容落地自动跑召回 → 只记录不投递。绝大多数落地应静默；浮现的按腿分组（别人说过 / 文件记忆 / 自己说过 / 动作流）。"
        icon={<BrainCircuit className="h-4 w-4 text-primary" />}
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">只看浮现</span>
            <Switch checked={onlySurfaced} onCheckedChange={setOnlySurfaced} aria-label="只看浮现" />
          </div>
        }
        contentClassName="space-y-2"
      >
        {shadowLogQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading 浮现流水...
          </div>
        ) : shadowLogEntries.length ? (
          shadowLogEntries.map((entry) => <ShadowLogRow key={entry.id} entry={entry} />)
        ) : (
          <EmptyState
            icon={<BellOff className="h-10 w-10" />}
            title={onlySurfaced ? '还没有浮现记录' : '还没有浮现流水'}
            description="钩子部署后，每次内容落地都会在这里留痕（多数静默）。"
          />
        )}
      </SectionPanel>

      <div className={cn('rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground')}>
        生成时间：{formatTimestamp(data?.generatedAt, { fallback: '-' })} · 当前页面只展示 shadow 数据，不代表记忆已经浮现或被小腻看到。
      </div>
    </PageShell>
  );
};
