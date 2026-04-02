import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Sparkles, X } from 'lucide-react';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { useSessionConversationItems, useSessionRelationshipMemory } from '@/hooks/useAgentRuns';
import { cn, formatTimestamp } from '@/lib/utils';
import type { RelationshipMemoryCardRecord, SessionConversationItemRecord } from '@/types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

type WorkspaceMode = 'workspace' | 'run-reference';

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }
  return `${Math.round(value * 100)}%`;
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

function RelationshipEvidenceBlock({ card }: { card: RelationshipMemoryCardRecord }) {
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
                {message.sender_name ? <span>{message.sender_name}</span> : null}
                {message.message_sid ? <span>{message.message_sid}</span> : null}
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
}

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

function RelationshipCardColumn(props: {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  cards: RelationshipMemoryCardRecord[];
  allowOverrideActions: boolean;
  overrideBusy: boolean;
  removeBusy: boolean;
  onOverride: (cardId: number, actionType: 'pin' | 'downrank' | 'archive') => void;
  onRemoveOverride: (overrideId: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{props.title}</div>
      {props.cards.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-8 w-8" />} title={props.emptyTitle} description={props.emptyDescription} />
      ) : props.cards.map((card) => (
        <div key={card.id} className="rounded-2xl border border-border/70 bg-background/80 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">{card.summary_text}</div>
              {card.target_user_id ? (
                <div className="mt-1 text-xs text-muted-foreground">target {card.target_user_id}</div>
              ) : null}
            </div>
            <Badge variant="outline">{formatPercent(card.decayed_score)}</Badge>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {card.context_before ? `前因: ${card.context_before}` : card.trigger ? `触发: ${card.trigger}` : '暂无上下文摘要'}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {card.entered_runtime ? <Badge variant="secondary">已进入 runtime</Badge> : <Badge variant="outline">尚未命中 runtime</Badge>}
            <span>最近命中: {card.last_hit_at ? formatTimestamp(card.last_hit_at) : 'n/a'}</span>
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
                  {props.allowOverrideActions ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      disabled={props.removeBusy}
                      onClick={() => props.onRemoveOverride(override.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {props.allowOverrideActions ? (
            <RelationshipOverrideActions
              card={card}
              busy={props.overrideBusy}
              onAction={(actionType) => props.onOverride(card.id, actionType)}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ChatSpaceRelationshipMemoryWorkspace(props: {
  sessionKey: string | null;
  mode?: WorkspaceMode;
  chatDetailHref?: string;
  className?: string;
}) {
  const mode = props.mode || 'workspace';
  const queryClient = useQueryClient();
  const relationshipMemoryQuery = useSessionRelationshipMemory(props.sessionKey);
  const relationshipMemory = relationshipMemoryQuery.data;
  const showConversationTimeline = mode === 'run-reference';
  const conversationItemsQuery = useSessionConversationItems(showConversationTimeline ? props.sessionKey : null);
  const sessionConversationItems = conversationItemsQuery.data || [];
  const evidenceMessageIds = React.useMemo(
    () => new Set([
      ...((relationshipMemory?.group_cards || []).flatMap((card) => card.source_message_ids || [])),
      ...((relationshipMemory?.person_cards || []).flatMap((card) => card.source_message_ids || []))
    ]),
    [relationshipMemory]
  );
  const allowOverrideActions = mode === 'workspace';

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
      await queryClient.invalidateQueries({ queryKey: ['session-relationship-memory', props.sessionKey] });
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
      await queryClient.invalidateQueries({ queryKey: ['session-relationship-memory', props.sessionKey] });
    }
  });

  const title = mode === 'workspace' ? 'Relationship Memory' : 'Relationship Memory References';
  const description = mode === 'workspace'
    ? '长期关系卡、job 状态和可追溯证据都收敛在这里。'
    : '这里只解释这段会话沉淀过什么；长期管理优先回聊天详情页处理。';
  const hasAnyMemory = Boolean(
    relationshipMemory
    && ((relationshipMemory.group_cards.length + relationshipMemory.person_cards.length + relationshipMemory.jobs.length) > 0)
  );

  return (
    <Card className={cn(mode === 'run-reference' && 'border-dashed bg-[linear-gradient(180deg,#f7fcff_0%,#f8fbff_100%)]', props.className)}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-sky-600" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1">
              {description}
            </CardDescription>
            {relationshipMemory?.normalized_session_key ? (
              <div className="mt-2 text-xs text-muted-foreground">
                session: {relationshipMemory.normalized_session_key}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {relationshipMemory ? (
              <>
                <Badge variant="secondary">{relationshipMemory.group_cards.length} 群卡</Badge>
                <Badge variant="secondary">{relationshipMemory.person_cards.length} 人际卡</Badge>
              </>
            ) : null}
            {props.chatDetailHref && mode === 'run-reference' ? (
              <Button asChild variant="outline" size="sm">
                <Link to={props.chatDetailHref}>去聊天详情管理</Link>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => relationshipMemoryQuery.refetch()} disabled={relationshipMemoryQuery.isFetching}>
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {relationshipMemoryQuery.error ? (
          <ErrorState description={relationshipMemoryQuery.error.message} onRetry={() => relationshipMemoryQuery.refetch()} />
        ) : relationshipMemoryQuery.isLoading || relationshipMemoryQuery.isFetching ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-2xl border border-border bg-muted/40" />
            ))}
          </div>
        ) : !props.sessionKey ? (
          <EmptyState icon={<Sparkles className="h-8 w-8" />} title="还没选中聊天空间" description="先选一个会话或聊天详情，再查看 relationship memory。" />
        ) : !relationshipMemory ? (
          <EmptyState icon={<AlertTriangle className="h-8 w-8" />} title="Relationship memory 不可用" description="接口没有返回可展示数据。" />
        ) : (
          <>
            {!hasAnyMemory ? (
              <EmptyState
                icon={<Sparkles className="h-8 w-8" />}
                title={relationshipMemory.chat_type === 'direct' ? '当前私聊还没有关系卡片' : '当前聊天空间还没有关系卡片'}
                description={relationshipMemory.chat_type === 'direct'
                  ? '后续如果有 direct-scope 的 relationship memory 产物，也会收敛到这里。'
                  : '等待 provider 刷出新卡片，或先检查 compact checkpoint 和 job 状态。'}
              />
            ) : null}

            {relationshipMemory.jobs.length > 0 ? (
              <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <div className="mb-3 text-sm font-semibold text-foreground">Recent Jobs</div>
                <div className="space-y-3">
                  {relationshipMemory.jobs.slice(0, mode === 'run-reference' ? 2 : 4).map((job) => (
                    <div key={job.id} className="rounded-2xl border border-border/60 bg-card p-3">
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

            {(relationshipMemory.group_cards.length > 0 || relationshipMemory.person_cards.length > 0) ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <RelationshipCardColumn
                  title="群公共卡片"
                  emptyTitle="暂无群卡片"
                  emptyDescription="这段会话还没沉淀出 group memory。"
                  cards={relationshipMemory.group_cards}
                  allowOverrideActions={allowOverrideActions}
                  overrideBusy={overrideMutation.isPending}
                  removeBusy={removeOverrideMutation.isPending}
                  onOverride={(cardId, actionType) => overrideMutation.mutate({ cardId, actionType })}
                  onRemoveOverride={(overrideId) => removeOverrideMutation.mutate(overrideId)}
                />
                <RelationshipCardColumn
                  title="人际卡片"
                  emptyTitle="暂无人际卡片"
                  emptyDescription="这段会话还没沉淀出 person memory。"
                  cards={relationshipMemory.person_cards}
                  allowOverrideActions={allowOverrideActions}
                  overrideBusy={overrideMutation.isPending}
                  removeBusy={removeOverrideMutation.isPending}
                  onOverride={(cardId, actionType) => overrideMutation.mutate({ cardId, actionType })}
                  onRemoveOverride={(overrideId) => removeOverrideMutation.mutate(overrideId)}
                />
              </div>
            ) : null}

            {showConversationTimeline ? (
              <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,#fcfcff_0%,#f7f8ff_100%)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Session Evidence Timeline</div>
                    <div className="mt-1 text-xs text-muted-foreground">按完整会话顺序看上下文，命中的 relationship evidence 会高亮。</div>
                  </div>
                  <Badge variant="secondary">{sessionConversationItems.length} 条消息</Badge>
                </div>
                {conversationItemsQuery.error ? (
                  <div className="mt-4">
                    <ErrorState description={conversationItemsQuery.error.message} onRetry={() => conversationItemsQuery.refetch()} />
                  </div>
                ) : conversationItemsQuery.isLoading || conversationItemsQuery.isFetching ? (
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
                              {message.sender_name ? <span>{message.sender_name}</span> : null}
                              {message.message_sid ? <span>{message.message_sid}</span> : null}
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
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default ChatSpaceRelationshipMemoryWorkspace;
