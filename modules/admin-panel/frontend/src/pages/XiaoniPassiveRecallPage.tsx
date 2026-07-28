import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BellOff,
  BrainCircuit,
  Database,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { PageHeader } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { SectionPanel } from '@/components/console/SectionPanel';
import { StatusPill } from '@/components/console/StatusPill';
import { EmptyState } from '@/components/console/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn, formatTimestamp } from '@/lib/utils';

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
  topK?: number;
  surfaced: RecallSurfaced[];
  droppedCounts: Record<string, number>;
};
type ReindexData = {
  scanned: number;
  changed: number;
  embedded: number;
  upserted: number;
  prunedPaths: number;
  counts: { total: number; byKind: Record<string, number> };
};

type CorpusStats = { total: number; byKind: Record<string, number> };

interface ShadowLogLead {
  // 语义召回腿:lead 是对象 {text,...} + cos + sourceRef + provenance
  lead?: string | { text?: string; kind?: string; pointer?: string | null };
  cos?: number;
  sourceRef?: string;
  provenance?: { source?: string; cueClass?: string; leadTemplate?: string; peer?: string | null };
  // 时间扫腿(open_loop / diary_event):lead 是整句字符串,附下列字段
  kind?: string;
  text?: string;
  title?: string;
  openedTag?: string | null;
  ageDays?: number | null;
  tier?: string;
  ref?: string;
  // 联想腿(第四腿)另附:落在哪个年龄桶、身份键、六因子等权总分与分项
  bucket?: string;
  identity?: string;
  lineKey?: string | null;
  memoryKind?: string;
  score?: number;
  factors?: Record<string, number>;
}

// entry.queryRef → 这条 shadow 是哪条腿。语义召回是「因落地而召回」,
// open_loop / diary / association 是「按时间/结构主动扫」,展示方式不同。
type LegKind = 'open_loop' | 'diary' | 'association' | 'recall';
function legKindFromRef(queryRef?: string | null): LegKind {
  if (queryRef === 'open_loop_scan') return 'open_loop';
  if (queryRef === 'diary_resurface') return 'diary';
  if (queryRef === 'association_scan') return 'association';
  return 'recall';
}

// 第四腿的四个年龄桶。近场那一格配额恒 0(她还记得,浮它等于把砖头当引子),
// 所以正常情况下这里永远看不到「近场」标 —— 看到了就是配额被人改了。
const ASSOCIATION_BUCKET_LABEL: Record<string, string> = {
  near: '近场 0-7 天（配额 0）',
  mid: '中场 8-30 天',
  far: '远场 30 天+',
  line: '线场（专题）',
};

function leadString(s: ShadowLogLead): string {
  if (typeof s.lead === 'string') return s.lead;
  return s.lead?.text || s.title || s.text || s.sourceRef || '';
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

// source_kind → 展示标签(真 corpus 分桶)。
const SOURCE_KIND_LABEL: Record<string, string> = {
  file_chunk: '文件记忆',
  action_stream: '动作流',
  inbound: '别人说过',
};

function legLabel(prov?: ShadowLogLead['provenance']): string {
  const t = prov?.leadTemplate || prov?.cueClass || prov?.source || '';
  if (prov?.source === 'qq_inbound' || t === 'peer_message') return '别人说过';
  if (t === 'db_file_provenance' || t === 'file_chunk') return '文件记忆';
  if (t === 'db_spoken_fragment') return '自己说过';
  return '动作流';
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

function SurfacedLead({ s }: { s: ShadowLogLead }) {
  const [open, setOpen] = React.useState(false);
  const [full, setFull] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const toggle = React.useCallback(async () => {
    if (!open && full === null && s.sourceRef) {
      setLoading(true);
      try {
        const resp = await fetch(`/api/xiaoni/passive-recall/cue?ref=${encodeURIComponent(s.sourceRef)}`);
        const json = (await resp.json()) as ApiResponse<{ embeddingText?: string } | null>;
        setFull(json?.data?.embeddingText || '（取不到全文，可能已被重建/删除）');
      } catch {
        setFull('（加载失败）');
      } finally {
        setLoading(false);
      }
    }
    setOpen((o) => !o);
  }, [open, full, s.sourceRef]);

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <StatusPill tone="info">{legLabel(s.provenance)}</StatusPill>
        <span className="text-xs text-muted-foreground">cos {typeof s.cos === 'number' ? s.cos.toFixed(3) : '-'}</span>
        {s.sourceRef ? (
          <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={() => void toggle()}>
            {open ? '收起' : loading ? '加载中…' : '展开全文'}
          </button>
        ) : null}
      </div>
      <div className="mt-1 break-words text-sm text-foreground">{leadString(s)}</div>
      {open && full !== null ? (
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 text-xs leading-5 text-foreground">{full}</pre>
      ) : null}
      {s.sourceRef ? <div className="mt-1 break-all text-[11px] text-muted-foreground">{s.sourceRef}</div> : null}
    </div>
  );
}

// 联想腿(第四腿)的一条:整句 lead + 桶标 + 六因子等权分项(观察期靠这个判因子有没有用)。
function AssociationLead({ s }: { s: ShadowLogLead }) {
  const factors = s.factors || {};
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={s.bucket === 'line' ? 'success' : s.bucket === 'far' ? 'neutral' : 'info'}>
          {ASSOCIATION_BUCKET_LABEL[s.bucket || ''] || s.bucket || '?'}
        </StatusPill>
        {typeof s.ageDays === 'number' ? <span className="text-xs text-muted-foreground">{Math.floor(s.ageDays)} 天</span> : null}
        {s.memoryKind ? <span className="text-xs text-muted-foreground">{s.memoryKind === 'promise' ? '承诺' : '往事'}</span> : null}
        {s.lineKey ? <span className="text-xs text-muted-foreground">线 {s.lineKey}</span> : null}
        {typeof s.score === 'number' ? <span className="ml-auto text-xs text-muted-foreground">分 {s.score.toFixed(2)}/6</span> : null}
      </div>
      <div className="mt-1 break-words text-sm text-foreground">{leadString(s)}</div>
      {Object.keys(factors).length ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {Object.entries(factors).map(([name, value]) => (
            <span key={name}>{name} {typeof value === 'number' ? value.toFixed(2) : '-'}</span>
          ))}
        </div>
      ) : null}
      {s.ref ? <div className="mt-1 break-all text-[11px] text-muted-foreground">{s.ref}</div> : null}
    </div>
  );
}

// 时间扫腿(open_loop 承诺 / diary 旧事)的一条:整句 lead + 档位/年龄标。
function TimeScanLead({ s, leg }: { s: ShadowLogLead; leg: LegKind }) {
  const badge = leg === 'open_loop'
    ? (s.tier === 'overdue' ? '放很久' : s.tier === 'undated' ? '没写日期' : '开着')
    : '旧事';
  const tone: React.ComponentProps<typeof StatusPill>['tone'] = s.tier === 'undated'
    ? 'warning'
    : s.tier === 'overdue'
      ? 'neutral'
      : 'info';
  const age = typeof s.ageDays === 'number'
    ? `${Math.floor(s.ageDays)} 天`
    : (s.ageDays === null && leg === 'open_loop' ? '不确定多久' : '');
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <StatusPill tone={tone}>{badge}</StatusPill>
        {age ? <span className="text-xs text-muted-foreground">{age}</span> : null}
        {s.openedTag ? <span className="text-xs text-muted-foreground">记于 {s.openedTag}</span> : null}
      </div>
      <div className="mt-1 break-words text-sm text-foreground">{leadString(s)}</div>
    </div>
  );
}

const LEG_HEADER: Record<LegKind, string> = {
  recall: '当下落地（query）',
  open_loop: '开放承诺 · 按时间扫（非语义召回）',
  diary: '翻旧事 · 按时间扫（非语义召回）',
  association: '联想 · 六因子等权 + 四桶配额（当下落地当引子）',
};

function ShadowLogRow({ entry }: { entry: ShadowLogEntry }) {
  const dc = entry.droppedCounts || {};
  const leg = legKindFromRef(entry.queryRef);
  const isTimeScan = leg !== 'recall';
  const scanDesc = leg === 'open_loop'
    ? `扫了 ${entry.corpusCount ?? 0} 条开放承诺`
    : leg === 'diary'
      ? `扫了 ${entry.corpusCount ?? 0} 件日记往事`
      // 联想腿的「因」是当下落地那段文本(queryText),顺带报一下过完滤后的候选池大小
      : leg === 'association'
        ? `${entry.queryText || '（这一轮取不到落地文本）'}\n过滤后候选 ${entry.corpusCount ?? 0} 条`
        : (entry.queryText || entry.queryRef || '—');
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {entry.silent
            ? <StatusPill tone="neutral">静默</StatusPill>
            : <StatusPill tone="success">浮现</StatusPill>}
          {isTimeScan ? (
            <StatusPill tone="info">
              {leg === 'open_loop' ? '待办承诺腿' : leg === 'association' ? '联想腿' : '旧事腿'}
            </StatusPill>
          ) : null}
          {entry.taskLocked ? <StatusPill tone="warning">task-locked</StatusPill> : null}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{formatTimestamp(entry.occurredAt, { fallback: '-' })}</span>
      </div>
      {/* 触发这次扫描的因:语义腿是当下落地 query;时间腿是「扫了多少条」 */}
      <div className="mt-2 rounded-md bg-muted/40 px-2.5 py-1.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{LEG_HEADER[leg]}</div>
        <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground">{scanDesc}</div>
      </div>
      {entry.surfaced?.length ? (
        <div className="mt-2 space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {isTimeScan ? '→ 这次拎出来的（shadow，不投递）' : '→ 勾起的记忆（果）'}
          </div>
          {entry.surfaced.map((s, index) => (
            leg === 'association'
              ? <AssociationLead key={s.ref || index} s={s} />
              : isTimeScan
                ? <TimeScanLead key={s.ref || index} s={s} leg={leg} />
                : <SurfacedLead key={s.sourceRef || index} s={s} />
          ))}
        </div>
      ) : null}
      {/* 联想腿:四个桶各有多少候选(空桶就少浮,不跨桶借 —— 少浮几条从这里读) */}
      {leg === 'association' ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>近场 {dc.bucket_near ?? 0}（配额 0）</span>
          <span>中场 {dc.bucket_mid ?? 0}</span>
          <span>远场 {dc.bucket_far ?? 0}</span>
          <span>线场 {dc.bucket_line ?? 0}</span>
          <span>冷却剔 {dc.cooled_down ?? 0}</span>
          <span>结构头剔 {dc.structural_title ?? 0}</span>
          <span>裸时刻标题剔 {dc.bare_timestamp_title ?? 0}</span>
          <span>无桶剔 {dc.no_bucket ?? 0}</span>
        </div>
      ) : null}
      {isTimeScan ? null : (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>近邻 {entry.topK ?? 0}</span>
          <span>带 [{typeof entry.bandFloor === 'number' ? entry.bandFloor.toFixed(2) : '-'}, {typeof entry.bandCeiling === 'number' ? entry.bandCeiling.toFixed(2) : '-'}]</span>
          <span>太像 {dc.drop_too_similar ?? 0}</span>
          <span>在场 {dc.drop_in_context ?? 0}</span>
          <span>太远 {dc.drop_too_far ?? 0}</span>
        </div>
      )}
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

async function fetchCorpusStats(): Promise<CorpusStats> {
  const response = await fetch('/api/xiaoni/passive-recall/corpus-stats');
  const json = (await response.json()) as ApiResponse<CorpusStats>;
  if (!json.success) {
    throw new Error(json.error || '加载语料构成失败');
  }
  return json.data;
}

export const XiaoniPassiveRecallPage: React.FC = () => {
  const [recallText, setRecallText] = React.useState('');
  const [recallTaskLocked, setRecallTaskLocked] = React.useState(false);
  const [recallBusy, setRecallBusy] = React.useState(false);
  const [recallError, setRecallError] = React.useState<string | null>(null);
  const [recallResult, setRecallResult] = React.useState<RecallPreviewData | null>(null);
  const [reindexBusy, setReindexBusy] = React.useState(false);
  const [reindexInfo, setReindexInfo] = React.useState<string | null>(null);
  const [onlySurfaced, setOnlySurfaced] = React.useState(true);

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

  const shadowLogQuery = useQuery({
    queryKey: ['xiaoni-passive-recall-shadow-log', onlySurfaced],
    queryFn: () => fetchShadowLog(onlySurfaced),
    refetchInterval: 15000,
  });
  const shadowLogEntries = shadowLogQuery.data || [];

  const corpusQuery = useQuery({
    queryKey: ['xiaoni-passive-recall-corpus-stats'],
    queryFn: fetchCorpusStats,
    refetchInterval: 30000,
  });
  const corpus = corpusQuery.data;
  const byKind = corpus?.byKind || {};

  return (
    <PageShell className="max-w-7xl">
      <PageHeader
        eyebrow="Passive Recall"
        title="小腻被动浮现 Shadow"
        description="每次内容落地自动跑召回，结果只记录、绝不投递给小腻。"
        icon={<BrainCircuit className="h-5 w-5" />}
        badge={<StatusPill tone="info">shadow_only</StatusPill>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void shadowLogQuery.refetch(); void corpusQuery.refetch(); }}
              disabled={shadowLogQuery.isFetching}
            >
              {shadowLogQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              刷新
            </Button>
          </div>
        }
      />

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
            description="每次内容落地都会在这里留痕（多数静默）；关掉「只看浮现」可看全部。"
          />
        )}
      </SectionPanel>

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
                <span>近邻 {recallResult.topK ?? recallResult.surfaced.length}</span>
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
        title="语料构成"
        description="被动浮现的召回底：文件记忆 + 动作流 + 别人说过（入站）。ingest 钩子实时补，重建语料对账。"
        icon={<Database className="h-4 w-4 text-primary" />}
        action={corpusQuery.isFetching ? <StatusPill tone="warning">loading</StatusPill> : <StatusPill tone="success">live</StatusPill>}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CountTile label="总计" value={corpus?.total || 0} tone="info" />
          <CountTile label={SOURCE_KIND_LABEL.file_chunk} value={byKind.file_chunk || 0} tone="success" />
          <CountTile label={SOURCE_KIND_LABEL.action_stream} value={byKind.action_stream || 0} tone="neutral" />
          <CountTile label={SOURCE_KIND_LABEL.inbound} value={byKind.inbound || 0} tone="warning" />
        </div>
      </SectionPanel>

      <div className={cn('rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground')}>
        只读 shadow 页 · 浮现结果绝不投递给小腻，不代表记忆已经进入她的上下文。
      </div>
    </PageShell>
  );
};
