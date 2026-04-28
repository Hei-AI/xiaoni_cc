import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bot, Clock3, MessageCircleMore, PanelRightOpen, RefreshCw, Search, Sparkles, Workflow } from 'lucide-react';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { SectionPanel } from '@/components/console/SectionPanel';
import { ErrorState } from '@/components/console/ErrorState';
import { EmptyState } from '@/components/console/EmptyState';
import { StatusPill } from '@/components/console/StatusPill';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn, formatTimestamp } from '@/lib/utils';
import { useRunDetail, useRunSessions, useSessionRuns } from '@/hooks/useAgentRuns';

function toneForRun(status: string, noReply?: boolean): 'danger' | 'warning' | 'success' | 'info' {
  if (status === 'failed') return 'danger';
  if (noReply) return 'warning';
  if (status === 'completed') return 'success';
  return 'info';
}

function formatTokenCount(value: number | null | undefined): string {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }
  return `${Math.round(value * 100)}%`;
}

function formatDurationMs(value: number | null | undefined): string {
  const numeric = Number(value || 0);
  if (!numeric) {
    return '0 ms';
  }
  if (numeric < 1000) {
    return `${numeric} ms`;
  }
  return `${(numeric / 1000).toFixed(1)} s`;
}

function formatStatusLabel(status: string, noReply?: boolean): string {
  if (noReply) return 'no_reply';
  return status;
}

function formatNoReplyRate(noReplyRuns: number, totalRuns: number): string {
  if (!totalRuns) {
    return '0%';
  }
  return `${Math.round((noReplyRuns / totalRuns) * 100)}%`;
}

function summarizeRunDecision(status: string, noReply?: boolean, reason?: string | null): string {
  if (noReply) {
    return reason ? `这次没有回，停在 ${reason}。` : '这次没有回。';
  }
  if (status === 'failed') {
    return reason ? `这次失败，终止原因是 ${reason}。` : '这次失败了。';
  }
  if (status === 'completed') {
    return reason ? `这次完成，收束在 ${reason}。` : '这次完成并给出了结果。';
  }
  return reason ? `当前状态 ${status}，原因 ${reason}。` : `当前状态 ${status}。`;
}

export const ConversationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [selectedSessionKey, setSelectedSessionKey] = React.useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const sessionsQuery = useRunSessions(debouncedSearch);
  const sessions = sessionsQuery.data?.data || [];
  const sessionRunsQuery = useSessionRuns(selectedSessionKey);
  const runs = sessionRunsQuery.data || [];
  const runDetailQuery = useRunDetail(selectedRunId, detailOpen);
  const selectedRun = runDetailQuery.data;
  const selectedSession = React.useMemo(
    () => sessions.find((session) => session.session_key === selectedSessionKey) ?? null,
    [selectedSessionKey, sessions]
  );
  const selectedRunListItem = React.useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  React.useEffect(() => {
    if (!sessions.length) {
      setSelectedSessionKey(null);
      setDetailOpen(false);
      return;
    }
    if (!selectedSessionKey || !sessions.some((session) => session.session_key === selectedSessionKey)) {
      setSelectedSessionKey(sessions[0].session_key);
    }
  }, [selectedSessionKey, sessions]);

  React.useEffect(() => {
    if (!runs.length) {
      setSelectedRunId(null);
      setDetailOpen(false);
      return;
    }
    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  const sessionsLoading = sessionsQuery.isLoading || sessionsQuery.isFetching;
  const runsLoading = sessionsLoading || sessionRunsQuery.isLoading || (Boolean(selectedSessionKey) && sessionRunsQuery.isFetching);

  const openRunDetail = React.useCallback((runId: string) => {
    setSelectedRunId(runId);
    setDetailOpen(true);
  }, []);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Conversation Workspace"
        title="对话工作台"
        description="先按会话扫清楚发生了什么，再挑一条 run 深看。Trace 留给真正需要追链路的时候。"
        icon={<Workflow className="h-5 w-5" />}
        actions={(
          <Button variant="outline" size="sm" onClick={() => { void sessionsQuery.refetch(); void sessionRunsQuery.refetch(); }}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        )}
      />

      <div className="mb-4">
        <div className="flex flex-col gap-3 rounded-3xl border border-border bg-[linear-gradient(135deg,rgba(247,244,236,0.92),rgba(255,255,255,0.96))] p-4 sm:p-5">
          <div className="max-w-xl">
            <div className="text-sm font-semibold text-foreground">先找到对象，再看最近一次决策。</div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              这个页面现在只做三件事：定位会话、扫描 run 结果、在必要时跳 Trace。`Run Detail` 不再常驻占位。
            </div>
          </div>
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="搜索 session、对象名、消息预览"
              className="h-11 rounded-2xl border-border/80 bg-background pl-9"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <SectionPanel
            title="会话"
            description="一眼看对象、最近状态和最近消息。"
            contentClassName="pt-3"
          >
            <div className="space-y-3">
              {sessionsQuery.error ? (
                <ErrorState description={sessionsQuery.error.message} onRetry={() => sessionsQuery.refetch()} />
              ) : sessionsLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-32 animate-pulse rounded-2xl border border-border bg-muted/40" />
                ))
              ) : sessions.length === 0 ? (
                <EmptyState icon={<MessageCircleMore className="h-10 w-10" />} title="暂无会话" description="还没有 agent run 数据。" />
              ) : (
                sessions.map((session) => (
                  <button
                    type="button"
                    key={session.session_key}
                    onClick={() => setSelectedSessionKey(session.session_key)}
                    className={`w-full rounded-3xl border p-4 text-left transition ${
                      selectedSessionKey === session.session_key
                        ? 'border-primary/60 bg-[linear-gradient(180deg,rgba(244,240,227,0.78),rgba(255,255,255,0.98))] shadow-sm'
                        : 'border-border bg-card hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-foreground">{session.peer_name || session.session_key}</div>
                      <StatusPill tone={toneForRun(session.latest_status, session.last_no_reply)}>
                        {formatStatusLabel(session.latest_status, session.last_no_reply)}
                      </StatusPill>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{session.session_key}</div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{session.total_runs} runs</span>
                      <span>{session.latest_input_message_count} 条输入</span>
                      <span>{session.no_reply_runs} 次没回</span>
                    </div>
                    <div className="mt-3 text-sm leading-6 text-foreground/80">{session.latest_message_preview || '暂无预览'}</div>
                  </button>
                ))
              )}
            </div>
          </SectionPanel>
        </div>

        <div className="space-y-4">
          <SectionPanel
            title="当前会话"
            description="先用这一屏判断有没有必要继续深挖。"
            contentClassName="pt-3"
          >
            {!selectedSession ? (
              <EmptyState icon={<Bot className="h-10 w-10" />} title="选择会话" description="先在左侧选择一个会话，再查看对应 runs。" />
            ) : (
              <div className="space-y-4">
                <div className="rounded-3xl border border-border bg-[linear-gradient(180deg,rgba(252,249,242,0.9),rgba(255,255,255,0.98))] p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold text-foreground">{selectedSession.peer_name || selectedSession.session_key}</div>
                        <StatusPill tone={toneForRun(selectedSession.latest_status, selectedSession.last_no_reply)}>
                          {formatStatusLabel(selectedSession.latest_status, selectedSession.last_no_reply)}
                        </StatusPill>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">{selectedSession.session_key}</div>
                      <div className="mt-4 max-w-3xl text-sm leading-6 text-foreground/80">
                        {selectedRunListItem
                          ? summarizeRunDecision(
                            selectedRunListItem.status,
                            selectedRunListItem.no_reply,
                            selectedRunListItem.termination_reason || selectedRunListItem.finish_outcome || selectedRunListItem.finish_reason
                          )
                          : '这个会话还没有可读的 run。'}
                      </div>
                    </div>
                    {selectedRunListItem ? (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => openRunDetail(selectedRunListItem.id)}>
                          <PanelRightOpen className="mr-2 h-4 w-4" />
                          打开详情抽屉
                        </Button>
                        <Button variant="default" size="sm" onClick={() => navigate(`/runs/${selectedRunListItem.id}/trace`)}>
                          Trace
                          <ArrowRight className="ml-1 h-4 w-4" />
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-border/70 bg-background/90 p-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Recent Activity</div>
                      <div className="mt-2 text-sm font-semibold text-foreground">
                        {formatTimestamp(selectedSession.latest_completed_at || selectedSession.latest_started_at, { fallback: 'n/a' })}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/90 p-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Runs</div>
                      <div className="mt-2 text-2xl font-semibold text-foreground">{selectedSession.total_runs}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/90 p-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">No Reply Rate</div>
                      <div className="mt-2 text-2xl font-semibold text-foreground">
                        {formatNoReplyRate(selectedSession.no_reply_runs, selectedSession.total_runs)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/90 p-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Latest Input</div>
                      <div className="mt-2 text-2xl font-semibold text-foreground">{selectedSession.latest_input_message_count}</div>
                    </div>
                  </div>
                </div>

                {selectedRunListItem ? (
                  <div className="rounded-3xl border border-primary/20 bg-primary/5 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          当前选中 run · {formatTimestamp(selectedRunListItem.started_at || selectedRunListItem.created_at)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{selectedRunListItem.id}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="outline">{selectedRunListItem.input_message_count} 条输入</Badge>
                          <Badge variant="outline">{selectedRunListItem.total_turns} turns</Badge>
                          <Badge variant="outline">{selectedRunListItem.llm_calls_count} 次 LLM</Badge>
                          <Badge variant="outline">In {formatTokenCount(selectedRunListItem.input_tokens_total)}</Badge>
                          <Badge variant="outline">Out {formatTokenCount(selectedRunListItem.output_tokens_total)}</Badge>
                        </div>
                      </div>
                      <StatusPill tone={toneForRun(selectedRunListItem.status, selectedRunListItem.no_reply)}>
                        {formatStatusLabel(selectedRunListItem.status, selectedRunListItem.no_reply)}
                      </StatusPill>
                    </div>
                    <div className="mt-4 text-sm leading-6 text-foreground/85">
                      {selectedRunListItem.final_response || selectedRunListItem.finish_outcome || selectedRunListItem.error_message || '未产生最终回复'}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </SectionPanel>

          <SectionPanel
            title="Runs"
            description="按时间扫每次处理结果。需要细节时再打开抽屉或 Trace。"
            contentClassName="pt-3"
          >
            <div className="space-y-3">
              {sessionRunsQuery.error ? (
                <ErrorState description={sessionRunsQuery.error.message} onRetry={() => sessionRunsQuery.refetch()} />
              ) : runsLoading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-40 animate-pulse rounded-3xl border border-border bg-muted/40" />
                ))
              ) : !selectedSessionKey ? (
                <EmptyState icon={<Bot className="h-10 w-10" />} title="选择会话" description="先在左侧选择一个会话，再查看对应 runs。" />
              ) : runs.length === 0 ? (
                <EmptyState icon={<Bot className="h-10 w-10" />} title="暂无 runs" description="这个会话还没有 agent run。" />
              ) : (
                runs.map((run) => {
                  const isSelected = selectedRunId === run.id;
                  return (
                    <div
                      key={run.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedRunId(run.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedRunId(run.id);
                        }
                      }}
                      className={cn(
                        'rounded-3xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-primary/30',
                        isSelected
                          ? 'border-primary/60 bg-[linear-gradient(180deg,rgba(244,240,227,0.78),rgba(255,255,255,0.98))] shadow-sm'
                          : 'border-border bg-card hover:bg-muted/30'
                      )}
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-foreground">{formatTimestamp(run.started_at || run.created_at)}</div>
                            <StatusPill tone={toneForRun(run.status, run.no_reply)}>
                              {formatStatusLabel(run.status, run.no_reply)}
                            </StatusPill>
                            {run.termination_reason ? <Badge variant="outline">{run.termination_reason}</Badge> : null}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{run.id}</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge variant="outline">{run.input_message_count} 条输入</Badge>
                            <Badge variant="outline">{run.total_turns} turns</Badge>
                            <Badge variant="outline">{run.llm_calls_count} 次 LLM</Badge>
                            <Badge variant="outline">In {formatTokenCount(run.input_tokens_total)}</Badge>
                            <Badge variant="outline">Out {formatTokenCount(run.output_tokens_total)}</Badge>
                            <Badge variant="outline">Cache {formatTokenCount(run.cached_input_tokens_total)}</Badge>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 xl:justify-end">
                          <Button variant={isSelected ? 'default' : 'outline'} size="sm" onClick={(event) => { event.stopPropagation(); setSelectedRunId(run.id); }}>
                            {isSelected ? '当前 Run' : '设为当前'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); openRunDetail(run.id); }}>
                            <PanelRightOpen className="mr-2 h-4 w-4" />
                            详情抽屉
                          </Button>
                          <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); navigate(`/runs/${run.id}/trace`); }}>
                            Trace
                            <ArrowRight className="ml-1 h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 text-sm leading-6 text-foreground/85">
                        {run.final_response || run.finish_outcome || run.error_message || '未产生最终回复'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </SectionPanel>
        </div>
      </div>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="w-full max-w-3xl border-l border-border bg-background px-0">
          <SheetHeader className="border-b border-border px-6 py-5 pr-12">
            <SheetTitle>Run 详情抽屉</SheetTitle>
            <SheetDescription>
              这里只放需要深看时才值得占注意力的内容，常规浏览回到主列表。
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="space-y-4 px-6 py-6">
              {runDetailQuery.error ? (
                <ErrorState description={runDetailQuery.error.message} onRetry={() => runDetailQuery.refetch()} />
              ) : runDetailQuery.isLoading || runDetailQuery.isFetching ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40" />
                ))
              ) : !selectedRunId || !selectedRun ? (
                <EmptyState icon={<Bot className="h-10 w-10" />} title="选择一个 run" description="打开任一 run 的详情抽屉后，这里会显示关键上下文。" />
              ) : (
                <>
                  <div className="rounded-3xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{selectedRun.session.peer_name || selectedRun.session.session_key}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{selectedRun.run.id}</div>
                      </div>
                      <StatusPill tone={toneForRun(selectedRun.run.status, selectedRun.run.no_reply)}>
                        {formatStatusLabel(selectedRun.run.status, selectedRun.run.no_reply)}
                      </StatusPill>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">{selectedRun.input_batch.message_count} 条输入</Badge>
                      <Badge variant="outline">{selectedRun.decision.llm_calls_count} 次 LLM</Badge>
                      <Badge variant="outline">{selectedRun.decision.tool_calls_count} 次工具</Badge>
                      <Badge variant="outline">{selectedRun.decision.sent_messages_count} 条发出</Badge>
                      {selectedRun.run.termination_reason ? <Badge variant="outline">{selectedRun.run.termination_reason}</Badge> : null}
                    </div>
                    <div className="mt-4 text-sm leading-6 text-foreground/85">
                      {selectedRun.result.final_response || selectedRun.run.final_response || selectedRun.run.finish_outcome || selectedRun.run.error_message || '未产生最终回复'}
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => navigate(`/runs/${selectedRun.run.id}/trace`)}>
                        Trace
                        <ArrowRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-border bg-[linear-gradient(180deg,#fffdf7_0%,#fffaf0_100%)] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Sparkles className="h-4 w-4 text-amber-600" />
                      Participation Decision
                    </div>
                    {selectedRun.decision.participation?.latest ? (
                      <div className="mt-4 space-y-4">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">{selectedRun.decision.participation.latest.decision || 'unknown'}</Badge>
                          <Badge variant="outline">{selectedRun.decision.participation.latest.reason || 'unknown_reason'}</Badge>
                          <Badge variant="outline">{selectedRun.decision.participation.latest.confidence || 'unknown_confidence'}</Badge>
                          <Badge variant="outline">{selectedRun.decision.participation.latest.used_embeddings ? 'embedding on' : 'embedding off'}</Badge>
                          <Badge variant="outline">{selectedRun.decision.participation.latest.used_llm_judge ? 'llm judge on' : 'llm judge off'}</Badge>
                          {selectedRun.decision.participation.latest.conservative_fallback ? <Badge variant="outline">conservative fallback</Badge> : null}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                            <div className="text-xs text-muted-foreground">最近一次判定</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{formatTimestamp(selectedRun.decision.participation.latest.event_time, { fallback: 'n/a' })}</div>
                            <div className="mt-2 text-xs text-muted-foreground">路径: {selectedRun.decision.participation.latest.path || 'n/a'}</div>
                            {selectedRun.decision.participation.latest.used_llm_judge ? (
                              <div className="mt-2 text-xs text-muted-foreground">
                                judge: {selectedRun.decision.participation.latest.llm_judge_model || 'unknown'} / {selectedRun.decision.participation.latest.llm_judge_decision || 'n/a'} / {selectedRun.decision.participation.latest.llm_judge_confidence || 'n/a'}
                              </div>
                            ) : null}
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                            <div className="text-xs text-muted-foreground">冷却 / 最近活跃</div>
                            <div className="mt-1 text-sm font-medium text-foreground">
                              {formatDurationMs(selectedRun.decision.participation.latest.cooldown_remaining_ms)} remaining
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              recent inbound {selectedRun.decision.participation.latest.recent_inbound_count || 0}, recent replies {selectedRun.decision.participation.latest.recent_reply_count || 0}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                            <div className="text-xs text-muted-foreground">Final Score</div>
                            <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.scores?.final)}</div>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                            <div className="text-xs text-muted-foreground">Continuity Similarity</div>
                            <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.continuity_similarity)}</div>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                            <div className="text-xs text-muted-foreground">Interest Similarity</div>
                            <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.interest_similarity)}</div>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                            <div className="text-xs text-muted-foreground">Addressedness</div>
                            <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.scores?.addressedness)}</div>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                            <div className="text-xs text-muted-foreground">Social Position</div>
                            <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.scores?.social_position)}</div>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                            <div className="text-xs text-muted-foreground">Timing</div>
                            <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.scores?.timing)}</div>
                          </div>
                        </div>

                        {selectedRun.decision.participation.latest.embedding_error ? (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                            embedding error: {selectedRun.decision.participation.latest.embedding_error}
                          </div>
                        ) : null}
                        {selectedRun.decision.participation.latest.llm_judge_error ? (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                            llm judge error: {selectedRun.decision.participation.latest.llm_judge_error}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                        这个 run 还没有 participation decision 数据。通常说明它来自旧数据，或者这次不是通过新的 Stage 2 path 进入的。
                      </div>
                    )}
                  </div>

                  <div className="rounded-3xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Clock3 className="h-4 w-4 text-muted-foreground" />
                      Input Batch
                    </div>
                    <div className="mt-3 space-y-3">
                      {selectedRun.input_batch.messages.map((message) => (
                        <div key={`${message.queue_message_id}-${message.position}`} className="rounded-2xl border border-border/70 bg-background/80 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-foreground">
                              #{message.position} {message.sender_name || message.sender_id}
                            </div>
                            <Badge variant="outline">{message.message_sid || `queue:${message.queue_message_id}`}</Badge>
                          </div>
                          <div className="mt-2 text-sm leading-6 text-foreground/85">{message.body_for_agent}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                    当前版本已屏蔽 relationship memory / topic 等后台观察面，这里只保留 run、输入批次和最终回复。
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
};
