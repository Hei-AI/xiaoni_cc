import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, MessageCircleMore, RefreshCw, Search, Workflow } from 'lucide-react';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { SectionPanel } from '@/components/console/SectionPanel';
import { ErrorState } from '@/components/console/ErrorState';
import { EmptyState } from '@/components/console/EmptyState';
import { StatusPill } from '@/components/console/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatTimestamp } from '@/lib/utils';
import { useAgentRunDetail, useRunSessions, useSessionRuns } from '@/hooks/useAgentRuns';

function toneForRun(status: string, noReply?: boolean): 'danger' | 'warning' | 'success' | 'info' {
  if (status === 'failed') return 'danger';
  if (noReply) return 'warning';
  if (status === 'completed') return 'success';
  return 'info';
}

export const ConversationsPage: React.FC = () => {
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
  const runDetailQuery = useAgentRunDetail(selectedRunId);
  const runDetail = runDetailQuery.data;

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

  return (
    <PageShell>
      <PageHeader
        eyebrow="Agent Run Workspace"
        title="对话流"
        description="按会话中的 agent run 阅读这批消息是怎么被消费的，以及为什么回或为什么没回。"
        icon={<Workflow className="h-5 w-5" />}
        actions={(
          <Button variant="outline" size="sm" onClick={() => { void sessionsQuery.refetch(); void sessionRunsQuery.refetch(); void runDetailQuery.refetch(); }}>
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

      <div className="grid gap-4 xl:grid-cols-[280px_320px_minmax(0,1fr)]">
        <SectionPanel
          title="会话"
          description="每个会话展示最近一次 run 的结论。"
          contentClassName="pt-3"
        >
          <div className="space-y-3">
            {sessionsQuery.error ? (
              <ErrorState description={sessionsQuery.error.message} onRetry={() => sessionsQuery.refetch()} />
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

        <SectionPanel
          title="Runs"
          description="按一次 agent 开始处理的一批消息组织。"
          contentClassName="pt-3"
        >
          <div className="space-y-3">
            {sessionRunsQuery.error ? (
              <ErrorState description={sessionRunsQuery.error.message} onRetry={() => sessionRunsQuery.refetch()} />
            ) : runs.length === 0 ? (
              <EmptyState icon={<Bot className="h-10 w-10" />} title="暂无 runs" description="选择一个有数据的会话。" />
            ) : (
              runs.map((run) => (
                <button
                  type="button"
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
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
                    {run.termination_reason ? <Badge variant="outline">{run.termination_reason}</Badge> : null}
                  </div>
                  <div className="mt-3 text-sm text-foreground/85">{run.final_response || run.finish_outcome || run.error_message || '未产生最终回复'}</div>
                </button>
              ))
            )}
          </div>
        </SectionPanel>

        <SectionPanel
          title="Run Workspace"
          description="先看本次输入消息批，再看为什么回或为什么没回。"
          contentClassName="pt-3"
        >
          {runDetailQuery.error ? (
            <ErrorState description={runDetailQuery.error.message} onRetry={() => runDetailQuery.refetch()} />
          ) : !runDetail ? (
            <EmptyState icon={<Workflow className="h-10 w-10" />} title="选择一个 run" description="右侧会显示本次输入、结论和 trace 入口。" />
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3">
                    <span>为什么回 / 为什么没回</span>
                    <StatusPill tone={toneForRun(runDetail.run.status, runDetail.run.no_reply)}>
                      {runDetail.run.no_reply ? 'no_reply' : runDetail.run.status}
                    </StatusPill>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Termination</div>
                    <div className="mt-2 text-sm font-medium text-foreground">{runDetail.run.termination_reason || 'n/a'}</div>
                    <div className="mt-3 text-xs text-muted-foreground">finish.reason</div>
                    <div className="mt-1 text-sm text-foreground">{runDetail.run.finish_reason || 'n/a'}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Outcome</div>
                    <div className="mt-2 text-sm text-foreground">{runDetail.run.finish_outcome || runDetail.result.final_response || runDetail.result.error_message || 'n/a'}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">{runDetail.input_batch.message_count} 条输入</Badge>
                      <Badge variant="outline">{runDetail.decision.llm_calls_count} LLM</Badge>
                      <Badge variant="outline">{runDetail.decision.tool_calls_count} Tool</Badge>
                      <Badge variant="outline">{runDetail.run.total_turns} Turns</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>本次输入消息批</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {runDetail.input_batch.messages.map((message) => (
                    <div key={`${message.queue_message_id}-${message.position}`} className="rounded-2xl border border-border bg-background p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">#{message.position}</Badge>
                        <span>{message.sender_name || message.sender_id}</span>
                        {message.created_at ? <span>{formatTimestamp(message.created_at)}</span> : null}
                      </div>
                      <div className="mt-3 whitespace-pre-wrap text-sm text-foreground">{message.body_for_agent}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>结果</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-foreground whitespace-pre-wrap">
                    {runDetail.result.final_response || '未发送最终回复'}
                  </div>
                  {runDetail.result.sent_messages.length > 0 ? (
                    <div className="space-y-2">
                      {runDetail.result.sent_messages.map((message, index) => (
                        <div key={`${index}-${message}`} className="rounded-xl border border-border bg-background p-3 text-sm whitespace-pre-wrap">
                          {message}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3">
                    <span>深度证据</span>
                    <div className="flex items-center gap-2">
                      {runDetail.trace_summary.conversation_id ? (
                        <Link to={`/playground?conversationId=${runDetail.trace_summary.conversation_id}`}>
                          <Button variant="outline" size="sm">Run 到 Playground</Button>
                        </Link>
                      ) : null}
                      <Link to={`/runs/${runDetail.run.id}/trace`}>
                        <Button size="sm">
                          Trace 详情
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <div>trace_id: {runDetail.trace_summary.trace_id}</div>
                  <div>conversation_id: {runDetail.trace_summary.conversation_id ?? 'pending'}</div>
                  <div>timeline events: {runDetail.decision.timeline.length}</div>
                </CardContent>
              </Card>
            </div>
          )}
        </SectionPanel>
      </div>
    </PageShell>
  );
};
