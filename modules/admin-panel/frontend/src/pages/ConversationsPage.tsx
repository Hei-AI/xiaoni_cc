import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, MessageCircleMore, RefreshCw, Search, Workflow } from 'lucide-react';
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
import { useRunSessions, useSessionRuns } from '@/hooks/useAgentRuns';

function toneForRun(status: string, noReply?: boolean): 'danger' | 'warning' | 'success' | 'info' {
  if (status === 'failed') return 'danger';
  if (noReply) return 'warning';
  if (status === 'completed') return 'success';
  return 'info';
}

function formatTokenCount(value: number | null | undefined): string {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
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

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
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
          description="二级选择区；点击一个 run 直接进入 Trace 详情。"
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
                <button
                  type="button"
                  key={run.id}
                  onClick={() => navigate(`/runs/${run.id}/trace`)}
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
                  <div className="mt-4 text-xs font-medium text-primary">进入 Trace 详情</div>
                </button>
              ))
            )}
          </div>
        </SectionPanel>
      </div>
    </PageShell>
  );
};
