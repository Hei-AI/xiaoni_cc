import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bot, Clock3, MessageCircleMore, RefreshCw, Search, Sparkles, Workflow, X } from 'lucide-react';
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
import { useRunDetail, useRunSessions, useSessionConversationItems, useSessionParticipationEvents, useSessionRelationshipMemory, useSessionRuns } from '@/hooks/useAgentRuns';
import type { RelationshipMemoryCardRecord, SessionConversationItemRecord } from '@/types';

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

function scrollToEvidenceMessage(messageId: number) {
  if (!Number.isFinite(messageId)) {
    return;
  }
  const element = document.getElementById(`relationship-evidence-message-${messageId}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

const RelationshipEvidenceBlock: React.FC<{ card: RelationshipMemoryCardRecord }> = ({ card }) => {
  const hasEvidence = card.evidence_events.length > 0 || card.evidence_messages.length > 0;
  if (!hasEvidence) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        暂无可展开证据
      </div>
    );
  }

  return (
    <details className="mt-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-foreground">
        展开来源证据
      </summary>
      {card.evidence_events.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ledger Events</div>
          {card.evidence_events.map((event) => (
            <div key={event.id} className="rounded-xl border border-border/60 bg-background/80 p-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{event.event_type || 'event'}</Badge>
                <span>#{event.id}</span>
                {event.confidence ? <span>{event.confidence}</span> : null}
                {event.created_at ? <span>{formatTimestamp(event.created_at)}</span> : null}
              </div>
              {event.source_excerpt ? (
                <div className="mt-2 text-sm text-foreground/85">{event.source_excerpt}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {card.evidence_messages.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Chat Excerpts</div>
          {card.evidence_messages.map((message) => (
            <div key={message.id} className="rounded-xl border border-border/60 bg-background/80 p-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{message.role || 'message'}</Badge>
                <span>#{message.id}</span>
                {message.phase ? <span>{message.phase}</span> : null}
                {message.created_at ? <span>{formatTimestamp(message.created_at)}</span> : null}
              </div>
              <div className="mt-2 text-sm text-foreground/85">{message.content || '无内容摘录'}</div>
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
};

export const ConversationsPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const participationEventsQuery = useSessionParticipationEvents(selectedSessionKey);
  const relationshipMemoryQuery = useSessionRelationshipMemory(selectedSessionKey);
  const conversationItemsQuery = useSessionConversationItems(selectedSessionKey);
  const runs = sessionRunsQuery.data || [];
  const participationEvents = participationEventsQuery.data || [];
  const relationshipMemory = relationshipMemoryQuery.data;
  const sessionConversationItems = conversationItemsQuery.data || [];
  const evidenceMessageIds = React.useMemo(
    () => new Set([
      ...((relationshipMemory?.group_cards || []).flatMap((card) => card.source_message_ids || [])),
      ...((relationshipMemory?.person_cards || []).flatMap((card) => card.source_message_ids || []))
    ]),
    [relationshipMemory]
  );
  const runDetailQuery = useRunDetail(selectedRunId);
  const selectedRun = runDetailQuery.data;

  const overrideMutation = useMutation({
    mutationFn: async (payload: { cardId: number; actionType: 'pin' | 'downrank' | 'archive' }) => {
      const response = await fetch(`/api/runs/relationship-memory/cards/${payload.cardId}/overrides`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action_type: payload.actionType,
          created_by: 'admin-panel'
        })
      });
      if (!response.ok) {
        throw new Error('Failed to update relationship memory override');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session-relationship-memory', selectedSessionKey] });
    }
  });
  const removeOverrideMutation = useMutation({
    mutationFn: async (overrideId: number) => {
      const response = await fetch(`/api/runs/relationship-memory/overrides/${overrideId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to delete relationship memory override');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session-relationship-memory', selectedSessionKey] });
    }
  });

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
  const participationLoading = sessionsLoading || participationEventsQuery.isLoading || (Boolean(selectedSessionKey) && participationEventsQuery.isFetching);
  const relationshipLoading = sessionsLoading || relationshipMemoryQuery.isLoading || (Boolean(selectedSessionKey) && relationshipMemoryQuery.isFetching);
  const conversationItemsLoading = sessionsLoading || conversationItemsQuery.isLoading || (Boolean(selectedSessionKey) && conversationItemsQuery.isFetching);

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
            ) : (
              <>
                {relationshipMemoryQuery.error ? (
                  <ErrorState description={relationshipMemoryQuery.error.message} onRetry={() => relationshipMemoryQuery.refetch()} />
                ) : relationshipLoading ? (
                  <div className="h-32 animate-pulse rounded-2xl border border-border bg-muted/40" />
                ) : relationshipMemory ? (
                  <div className="rounded-2xl border border-dashed border-sky-300 bg-sky-50/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">Relationship Memory</div>
                        <div className="mt-1 text-xs text-muted-foreground">看这段会话当前沉淀下来的关系卡和最近结算 job。</div>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="secondary">{relationshipMemory.group_cards.length} 群卡</Badge>
                        <Badge variant="secondary">{relationshipMemory.person_cards.length} 人际卡</Badge>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {(relationshipMemory.jobs || []).slice(0, 3).map((job) => (
                        <div key={job.id} className="rounded-2xl border border-sky-200 bg-white/80 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-foreground">Job #{job.id}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(job.updated_at || job.created_at || '')}</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {job.status ? <Badge variant="outline">{job.status}</Badge> : null}
                              {job.output_card_version ? <Badge variant="outline">v{job.output_card_version}</Badge> : null}
                              <Badge variant="outline">{job.ledger_event_count} events</Badge>
                            </div>
                          </div>
                          {job.error_message ? (
                            <div className="mt-2 text-xs text-red-600">{job.error_message}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {participationLoading ? (
                  <div className="h-32 animate-pulse rounded-2xl border border-border bg-muted/40" />
                ) : participationEvents.length > 0 ? (
                  <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">Pre-Run Decisions</div>
                        <div className="mt-1 text-xs text-muted-foreground">这些消息在进入主循环前就被 Stage 2 挡掉了。</div>
                      </div>
                      <Badge variant="secondary">{participationEvents.length} 条</Badge>
                    </div>
                    <div className="mt-4 space-y-3">
                      {participationEvents.map((event) => (
                        <div key={event.event_id} className="rounded-2xl border border-amber-200 bg-white/80 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-foreground">{formatTimestamp(event.event_time || '')}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{event.inbound?.sender_name || event.inbound?.sender_id || 'unknown sender'}</div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              <Badge variant="secondary">{event.decision || 'unknown'}</Badge>
                              {event.reason ? <Badge variant="outline">{event.reason}</Badge> : null}
                              {event.confidence ? <Badge variant="outline">{event.confidence}</Badge> : null}
                            </div>
                          </div>
                          <div className="mt-3 text-sm text-foreground/85">{event.inbound?.raw_body || event.inbound?.body_for_agent || '无消息预览'}</div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>Final {formatPercent(event.scores?.final)}</span>
                            <span>Continuity {formatPercent(event.continuity_similarity)}</span>
                            <span>Interest {formatPercent(event.interest_similarity)}</span>
                            <span>{event.used_embeddings ? 'embedding on' : 'embedding off'}</span>
                            <span>{event.used_llm_judge ? 'llm judge on' : 'llm judge off'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {runs.length === 0 ? (
                  <EmptyState icon={<Bot className="h-10 w-10" />} title="暂无 runs" description="这个会话最近只有 pre-run decision，或还没有 agent run。" />
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
              </>
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

              {relationshipMemory && selectedSessionKey ? (
                <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,#f7fcff_0%,#f2f8ff_100%)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-foreground">Relationship Memory Cards</div>
                    <Button variant="outline" size="sm" onClick={() => relationshipMemoryQuery.refetch()} disabled={relationshipMemoryQuery.isFetching}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      刷新记忆
                    </Button>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    session: {relationshipMemory.normalized_session_key}
                  </div>
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">群公共卡片</div>
                      {relationshipMemory.group_cards.length === 0 ? (
                        <EmptyState icon={<Sparkles className="h-8 w-8" />} title="暂无群卡片" description="这段会话还没沉淀出 group memory。" />
                      ) : relationshipMemory.group_cards.map((card) => (
                        <div key={card.id} className="rounded-2xl border border-border/70 bg-background/80 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm font-semibold text-foreground">{card.summary_text}</div>
                            <Badge variant="outline">{formatPercent(card.decayed_score)}</Badge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {card.context_before ? `前因: ${card.context_before}` : '无前因摘要'}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-1">
                              <span>msg</span>
                              {card.source_message_ids.length > 0 ? card.source_message_ids.map((messageId) => (
                                <Button
                                  key={messageId}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => scrollToEvidenceMessage(messageId)}
                                >
                                  #{messageId}
                                </Button>
                              )) : <span>n/a</span>}
                            </div>
                            <span>event {card.source_event_ids.join(', ') || 'n/a'}</span>
                            <span>v{card.version}</span>
                          </div>
                          <RelationshipEvidenceBlock card={card} />
                          {card.overrides.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {card.overrides.map((override) => (
                                <div key={override.id} className="inline-flex items-center gap-1">
                                  <Badge variant="secondary">{override.action_type || 'override'}</Badge>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2"
                                    disabled={removeOverrideMutation.isPending}
                                    onClick={() => removeOverrideMutation.mutate(override.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <RelationshipOverrideActions
                            card={card}
                            busy={overrideMutation.isPending}
                            onAction={(actionType) => overrideMutation.mutate({ cardId: card.id, actionType })}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">人际卡片</div>
                      {relationshipMemory.person_cards.length === 0 ? (
                        <EmptyState icon={<Sparkles className="h-8 w-8" />} title="暂无人际卡片" description="这段会话还没沉淀出 person memory。" />
                      ) : relationshipMemory.person_cards.map((card) => (
                        <div key={card.id} className="rounded-2xl border border-border/70 bg-background/80 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-foreground">{card.summary_text}</div>
                              <div className="mt-1 text-xs text-muted-foreground">target {card.target_user_id || 'n/a'}</div>
                            </div>
                            <Badge variant="outline">{formatPercent(card.decayed_score)}</Badge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {card.trigger ? `触发: ${card.trigger}` : '无触发摘要'}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-1">
                              <span>msg</span>
                              {card.source_message_ids.length > 0 ? card.source_message_ids.map((messageId) => (
                                <Button
                                  key={messageId}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => scrollToEvidenceMessage(messageId)}
                                >
                                  #{messageId}
                                </Button>
                              )) : <span>n/a</span>}
                            </div>
                            <span>event {card.source_event_ids.join(', ') || 'n/a'}</span>
                            <span>v{card.version}</span>
                          </div>
                          <RelationshipEvidenceBlock card={card} />
                          {card.overrides.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {card.overrides.map((override) => (
                                <div key={override.id} className="inline-flex items-center gap-1">
                                  <Badge variant="secondary">{override.action_type || 'override'}</Badge>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2"
                                    disabled={removeOverrideMutation.isPending}
                                    onClick={() => removeOverrideMutation.mutate(override.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <RelationshipOverrideActions
                            card={card}
                            busy={overrideMutation.isPending}
                            onAction={(actionType) => overrideMutation.mutate({ cardId: card.id, actionType })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {relationshipMemory && (conversationItemsLoading || sessionConversationItems.length > 0) ? (
                <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,#fcfcff_0%,#f7f8ff_100%)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Session Evidence Timeline</div>
                      <div className="mt-1 text-xs text-muted-foreground">按完整会话顺序看上下文，命中的 relationship evidence 会高亮。</div>
                    </div>
                    <Badge variant="secondary">{sessionConversationItems.length} 条消息</Badge>
                  </div>
                  {conversationItemsLoading ? (
                    <div className="mt-4 h-32 animate-pulse rounded-2xl border border-border bg-muted/40" />
                  ) : (
                    <div className="mt-4 space-y-3">
                      {sessionConversationItems.map((message: SessionConversationItemRecord) => {
                        const highlighted = evidenceMessageIds.has(message.id);
                        return (
                          <div
                            key={message.id}
                            id={`relationship-evidence-message-${message.id}`}
                            className={`rounded-xl border p-3 ${highlighted ? 'border-sky-300 bg-sky-50/80' : 'border-border/70 bg-background/80'}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <span>#{message.id} {message.role || 'message'}</span>
                                {highlighted ? <Badge variant="secondary">memory hit</Badge> : null}
                              </div>
                              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span>{message.group_index}.{message.item_index}</span>
                                {message.phase ? <span>{message.phase}</span> : null}
                                {message.created_at ? <span>{formatTimestamp(message.created_at)}</span> : null}
                              </div>
                            </div>
                            <div className="mt-2 text-sm text-foreground/85">{message.content || '无内容摘录'}</div>
                          </div>
                        );
                      })}
                      {sessionConversationItems.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                          当前会话还没有可展示的 conversation items。
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </SectionPanel>
      </div>
    </PageShell>
  );
};

function RelationshipOverrideActions(props: {
  card: RelationshipMemoryCardRecord;
  busy: boolean;
  onAction: (actionType: 'pin' | 'downrank' | 'archive') => void;
}) {
  const activeActions = new Set(
    props.card.overrides
      .map((override) => override.action_type)
      .filter((actionType): actionType is 'pin' | 'downrank' | 'archive' => actionType === 'pin' || actionType === 'downrank' || actionType === 'archive')
  );

  function renderAction(actionType: 'pin' | 'downrank' | 'archive', label: string) {
    const active = activeActions.has(actionType);
    return (
      <Button
        variant={active ? 'secondary' : 'outline'}
        size="sm"
        disabled={props.busy || active}
        onClick={() => props.onAction(actionType)}
      >
        {active ? `${label} 已生效` : label}
      </Button>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {renderAction('pin', 'Pin')}
      {renderAction('downrank', 'Downrank')}
      {renderAction('archive', 'Archive')}
    </div>
  );
}
