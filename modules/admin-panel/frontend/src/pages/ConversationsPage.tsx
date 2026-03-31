import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bot, Clock3, MessageCircleMore, RefreshCw, Search, Sparkles, Workflow } from 'lucide-react';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { SectionPanel } from '@/components/console/SectionPanel';
import { ErrorState } from '@/components/console/ErrorState';
import { EmptyState } from '@/components/console/EmptyState';
import { StatusPill } from '@/components/console/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatTimestamp } from '@/lib/utils';
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

export const ConversationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [selectedSessionKey, setSelectedSessionKey] = React.useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const sessionsQuery = useRunSessions(debouncedSearch);
  const sessions = sessionsQuery.data?.data || [];
  const sessionRunsQuery = useSessionRuns(selectedSessionKey);
  const runs = sessionRunsQuery.data || [];
  const runDetailQuery = useRunDetail(selectedRunId);
  const selectedRun = runDetailQuery.data;

  React.useEffect(() => {
    if (!sessions.length) {
      setSelectedSessionKey(null);
      return;
    }
    if (!selectedSessionKey || !sessions.some((session) => session.session_key === selectedSessionKey)) {
      setSelectedSessionKey(sessions[0].session_key);
    }
  }, [selectedSessionKey, sessions]);

  React.useEffect(() => {
    if (!runs.length) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  const sessionsLoading = sessionsQuery.isLoading || sessionsQuery.isFetching;
  const runsLoading = sessionsLoading || sessionRunsQuery.isLoading || (Boolean(selectedSessionKey) && sessionRunsQuery.isFetching);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Agent Runs"
        title="对话流"
        description="按会话中的 agent run 阅读这批消息是怎么被消费的，以及为什么回或为什么没回。"
        icon={<Workflow className="h-5 w-5" />}
        actions={(
          <Button variant="outline" size="sm" onClick={() => { void sessionsQuery.refetch(); void sessionRunsQuery.refetch(); }}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        )}
      />

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="搜索 session、对象名、消息预览"
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <SectionPanel
            title="会话"
            description="先选会话，再选本次处理 run。"
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
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedSessionKey === session.session_key ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-foreground">{session.peer_name || session.session_key}</div>
                      <StatusPill tone={toneForRun(session.latest_status, session.last_no_reply)}>{session.latest_status}</StatusPill>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{session.session_key}</div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{session.total_runs} runs</span>
                      <span>{session.latest_input_message_count} 条输入</span>
                      <span>{session.no_reply_runs} 次没回</span>
                    </div>
                    <div className="mt-3 text-sm text-foreground/80">{session.latest_message_preview || '暂无预览'}</div>
                  </button>
                ))
              )}
            </div>
          </SectionPanel>
        </div>

        <SectionPanel
          title="Runs"
          description="二级选择区；先选 run，再决定要不要跳 Trace。"
          contentClassName="pt-3"
        >
          <div className="space-y-3">
            {sessionRunsQuery.error ? (
              <ErrorState description={sessionRunsQuery.error.message} onRetry={() => sessionRunsQuery.refetch()} />
            ) : runsLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-40 animate-pulse rounded-2xl border border-border bg-muted/40" />
              ))
            ) : !selectedSessionKey ? (
              <EmptyState icon={<Bot className="h-10 w-10" />} title="选择会话" description="先在左侧选择一个会话，再查看对应 runs。" />
            ) : runs.length === 0 ? (
              <EmptyState icon={<Bot className="h-10 w-10" />} title="暂无 runs" description="选择一个有数据的会话。" />
            ) : (
              runs.map((run) => (
                <div
                  key={run.id}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedRunId === run.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{formatTimestamp(run.started_at || run.created_at)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{run.id}</div>
                    </div>
                    <StatusPill tone={toneForRun(run.status, run.no_reply)}>{run.no_reply ? 'no_reply' : run.status}</StatusPill>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">{run.input_message_count} 条输入</Badge>
                    <Badge variant="outline">{run.total_turns} turns</Badge>
                    <Badge variant="outline">In {formatTokenCount(run.input_tokens_total)}</Badge>
                    <Badge variant="outline">Out {formatTokenCount(run.output_tokens_total)}</Badge>
                    <Badge variant="outline">Cache {formatTokenCount(run.cached_input_tokens_total)}</Badge>
                    {run.termination_reason ? <Badge variant="outline">{run.termination_reason}</Badge> : null}
                  </div>
                  <div className="mt-3 text-sm text-foreground/85 line-clamp-3">{run.final_response || run.finish_outcome || run.error_message || '未产生最终回复'}</div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <Button variant={selectedRunId === run.id ? 'default' : 'outline'} size="sm" onClick={() => setSelectedRunId(run.id)}>
                      {selectedRunId === run.id ? '当前 Run' : '查看详情'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/runs/${run.id}/trace`)}>
                      Trace
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionPanel>

        <SectionPanel
          title="Run Detail"
          description="在列表页直接看这次 run 为什么回、为什么没回，以及 participation decision 的关键分数。"
          contentClassName="pt-3"
        >
          {runDetailQuery.error ? (
            <ErrorState description={runDetailQuery.error.message} onRetry={() => runDetailQuery.refetch()} />
          ) : runDetailQuery.isLoading || runDetailQuery.isFetching ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40" />
              ))}
            </div>
          ) : !selectedRunId || !selectedRun ? (
            <EmptyState icon={<Bot className="h-10 w-10" />} title="选择一个 run" description="右侧会显示 participation decision、输入批次和当前结果。" />
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{selectedRun.session.peer_name || selectedRun.session.session_key}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{selectedRun.run.id}</div>
                  </div>
                  <StatusPill tone={toneForRun(selectedRun.run.status, selectedRun.run.no_reply)}>
                    {selectedRun.run.no_reply ? 'no_reply' : selectedRun.run.status}
                  </StatusPill>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">{selectedRun.input_batch.message_count} 条输入</Badge>
                  <Badge variant="outline">{selectedRun.decision.llm_calls_count} 次 LLM</Badge>
                  <Badge variant="outline">{selectedRun.decision.tool_calls_count} 次工具</Badge>
                  <Badge variant="outline">{selectedRun.decision.sent_messages_count} 条发出</Badge>
                  {selectedRun.run.termination_reason ? <Badge variant="outline">{selectedRun.run.termination_reason}</Badge> : null}
                </div>
                <div className="mt-4 text-sm text-foreground/85">
                  {selectedRun.result.final_response || selectedRun.run.final_response || selectedRun.run.finish_outcome || selectedRun.run.error_message || '未产生最终回复'}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,#fffdf7_0%,#fffaf0_100%)] p-4">
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
                      <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                        <div className="text-xs text-muted-foreground">最近一次判定</div>
                        <div className="mt-1 text-sm font-medium text-foreground">{formatTimestamp(selectedRun.decision.participation.latest.event_time, { fallback: 'n/a' })}</div>
                        <div className="mt-2 text-xs text-muted-foreground">路径: {selectedRun.decision.participation.latest.path || 'n/a'}</div>
                        {selectedRun.decision.participation.latest.used_llm_judge ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            judge: {selectedRun.decision.participation.latest.llm_judge_model || 'unknown'} / {selectedRun.decision.participation.latest.llm_judge_decision || 'n/a'} / {selectedRun.decision.participation.latest.llm_judge_confidence || 'n/a'}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 p-3">
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
                      <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                        <div className="text-xs text-muted-foreground">Final Score</div>
                        <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.scores?.final)}</div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                        <div className="text-xs text-muted-foreground">Continuity Similarity</div>
                        <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.continuity_similarity)}</div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                        <div className="text-xs text-muted-foreground">Interest Similarity</div>
                        <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.interest_similarity)}</div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                        <div className="text-xs text-muted-foreground">Addressedness</div>
                        <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.scores?.addressedness)}</div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                        <div className="text-xs text-muted-foreground">Social Position</div>
                        <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.scores?.social_position)}</div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 p-3">
                        <div className="text-xs text-muted-foreground">Timing</div>
                        <div className="mt-1 text-lg font-semibold text-foreground">{formatPercent(selectedRun.decision.participation.latest.scores?.timing)}</div>
                      </div>
                    </div>

                    {selectedRun.decision.participation.latest.embedding_error ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        embedding error: {selectedRun.decision.participation.latest.embedding_error}
                      </div>
                    ) : null}
                    {selectedRun.decision.participation.latest.llm_judge_error ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        llm judge error: {selectedRun.decision.participation.latest.llm_judge_error}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                    这个 run 还没有 participation decision 数据。通常说明它来自旧数据，或者这次不是通过新的 Stage 2 path 进入的。
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Clock3 className="h-4 w-4 text-muted-foreground" />
                  Input Batch
                </div>
                <div className="mt-3 space-y-3">
                  {selectedRun.input_batch.messages.map((message) => (
                    <div key={`${message.queue_message_id}-${message.position}`} className="rounded-xl border border-border/70 bg-background/80 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-foreground">
                          #{message.position} {message.sender_name || message.sender_id}
                        </div>
                        <Badge variant="outline">{message.message_sid || `queue:${message.queue_message_id}`}</Badge>
                      </div>
                      <div className="mt-2 text-sm text-foreground/85">{message.body_for_agent}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SectionPanel>
      </div>
    </PageShell>
  );
};
