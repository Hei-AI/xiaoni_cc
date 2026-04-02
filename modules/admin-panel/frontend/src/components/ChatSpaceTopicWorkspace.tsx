import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatTimestamp } from '@/lib/utils';
import { AlertTriangle, Brain, FileClock, GitCompareArrows, Layers3, Users } from 'lucide-react';

type TopicVersionSummary = {
  id: number;
  version_number: number;
  status: string | null;
  lifecycle_state: string | null;
  title: string | null;
  summary_text: string;
  review_priority_score: number;
  heat_score: number;
  evidence_count: number;
  relationship_count: number;
  runtime_hit_count: number;
  last_runtime_hit_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type TopicSummary = {
  id: number;
  chat_space_type: 'group' | 'direct';
  chat_space_id: number;
  topic_status: string | null;
  lifecycle_state: string;
  canonical_title: string | null;
  started_at: string | null;
  last_activity_at: string | null;
  closed_at: string | null;
  current_accepted_version_id: number | null;
  current_candidate_version_id: number | null;
  accepted_version: TopicVersionSummary | null;
  candidate_version: TopicVersionSummary | null;
  latest_failed_version: TopicVersionSummary | null;
  review_count: number;
  golden_case_count: number;
  review_priority_score: number;
  heat_score: number;
};

type TopicWorkspaceResponse = {
  success: boolean;
  data: {
    chat_space_type: 'group' | 'direct';
    chat_space_id: number;
    current_topics: TopicSummary[];
    historical_topics: TopicSummary[];
    latest_jobs: Array<{
      id: number;
      status: string;
      trigger_type?: string | null;
      updated_at?: string | null;
    }>;
  };
};

type TopicDetailResponse = {
  success: boolean;
  data: {
    topic: TopicSummary;
    versions: TopicVersionSummary[];
    accepted_version: TopicVersionSummary | null;
    candidate_version: TopicVersionSummary | null;
    latest_failed_version: TopicVersionSummary | null;
    detail_version: TopicVersionSummary | null;
    relationships: Array<{
      id: number;
      target_user_id?: number | null;
      relationship_kind?: string | null;
      summary_text: string;
      source_event_ids?: unknown[];
      source_message_ids?: unknown[];
    }>;
    evidence: Array<{
      id: number;
      source_kind: string;
      source_id: number;
      excerpt_text: string | null;
      speaker_id?: string | null;
      occurred_at?: string | null;
    }>;
    review_events: Array<{
      id: number;
      action_type: string;
      status?: string | null;
      created_at?: string | null;
      manual_note?: string | null;
    }>;
    golden_cases: Array<{
      id: number;
      label?: string | null;
      status?: string | null;
      created_at?: string | null;
    }>;
  };
};

async function fetchTopicWorkspace(chatSpaceType: 'group' | 'direct', chatSpaceId: number): Promise<TopicWorkspaceResponse> {
  const response = await fetch(`/api/topic-lab/chat-spaces/${chatSpaceType}/${chatSpaceId}/workspace`);
  if (!response.ok) {
    throw new Error('Failed to fetch topic workspace');
  }
  return response.json();
}

async function fetchTopicDetail(topicId: number): Promise<TopicDetailResponse> {
  const response = await fetch(`/api/topic-lab/topics/${topicId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch topic detail');
  }
  return response.json();
}

async function triggerTopicReprojection(topicId: number, sourceProjectionVersionId?: number | null) {
  const response = await fetch(`/api/topic-lab/topics/${topicId}/reprojection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source_projection_version_id: sourceProjectionVersionId ?? undefined
    })
  });
  if (!response.ok) {
    throw new Error('Failed to trigger topic reprojection');
  }
  return response.json();
}

async function submitTopicReviewAction(topicId: number, payload: Record<string, unknown>) {
  const response = await fetch(`/api/topic-lab/topics/${topicId}/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error('Failed to apply topic review action');
  }
  return response.json();
}

function formatMaybeTime(value: string | null | undefined) {
  return value ? formatTimestamp(value) : '无';
}

function lifecycleVariant(state: string | null | undefined): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (state) {
    case 'active':
    case 'reopened':
      return 'default';
    case 'cooling':
    case 'candidate':
      return 'secondary';
    case 'archived':
      return 'outline';
    default:
      return 'outline';
  }
}

function versionStatusVariant(status: string | null | undefined): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'accepted':
      return 'default';
    case 'candidate':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

function primaryVersion(topic: TopicSummary) {
  return topic.accepted_version || topic.candidate_version || topic.latest_failed_version || null;
}

function TopicListItem(props: {
  topic: TopicSummary;
  selected: boolean;
  onSelect: (topicId: number) => void;
}) {
  const version = primaryVersion(props.topic);

  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.topic.id)}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        props.selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">
            {props.topic.canonical_title || version?.title || `Topic ${props.topic.id}`}
          </div>
          <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {version?.summary_text || '暂无摘要'}
          </div>
        </div>
        <Badge variant={lifecycleVariant(props.topic.lifecycle_state)}>
          {props.topic.lifecycle_state}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Priority {props.topic.review_priority_score.toFixed(2)}</span>
        <span>Heat {props.topic.heat_score.toFixed(2)}</span>
        <span>Reviews {props.topic.review_count}</span>
        <span>Golden {props.topic.golden_case_count}</span>
      </div>
    </button>
  );
}

function TopicVersionChip(props: { label: string; version: TopicVersionSummary | null }) {
  if (!props.version) {
    return null;
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{props.label}</span>
        <Badge variant={versionStatusVariant(props.version.status)}>
          v{props.version.version_number}
        </Badge>
      </div>
      <div className="text-sm">{props.version.title || '未命名版本'}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {props.version.summary_text}
      </div>
    </div>
  );
}

export function ChatSpaceTopicWorkspace(props: {
  chatSpaceType: 'group' | 'direct';
  chatSpaceId: number;
}) {
  const queryClient = useQueryClient();
  const [selectedTopicId, setSelectedTopicId] = React.useState<number | null>(null);
  const workspaceQuery = useQuery({
    queryKey: ['topic-workspace', props.chatSpaceType, props.chatSpaceId],
    queryFn: () => fetchTopicWorkspace(props.chatSpaceType, props.chatSpaceId)
  });

  const currentTopics = workspaceQuery.data?.data.current_topics ?? [];
  const historicalTopics = workspaceQuery.data?.data.historical_topics ?? [];

  React.useEffect(() => {
    if (selectedTopicId) {
      return;
    }
    const firstTopic = currentTopics[0] || historicalTopics[0] || null;
    if (firstTopic) {
      setSelectedTopicId(firstTopic.id);
    }
  }, [currentTopics, historicalTopics, selectedTopicId]);

  const detailQuery = useQuery({
    queryKey: ['topic-detail', selectedTopicId],
    queryFn: () => fetchTopicDetail(selectedTopicId!),
    enabled: !!selectedTopicId
  });
  const reprojectionMutation = useMutation({
    mutationFn: (params: { topicId: number; sourceProjectionVersionId?: number | null }) =>
      triggerTopicReprojection(params.topicId, params.sourceProjectionVersionId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['topic-workspace', props.chatSpaceType, props.chatSpaceId] }),
        selectedTopicId
          ? queryClient.invalidateQueries({ queryKey: ['topic-detail', selectedTopicId] })
          : Promise.resolve()
      ]);
    }
  });
  const reviewMutation = useMutation({
    mutationFn: (params: { topicId: number; payload: Record<string, unknown> }) =>
      submitTopicReviewAction(params.topicId, params.payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['topic-workspace', props.chatSpaceType, props.chatSpaceId] }),
        selectedTopicId
          ? queryClient.invalidateQueries({ queryKey: ['topic-detail', selectedTopicId] })
          : Promise.resolve()
      ]);
    }
  });

  const latestJobs = workspaceQuery.data?.data.latest_jobs ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Topic Memory Lab
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {workspaceQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">正在加载 topic workspace...</div>
        ) : workspaceQuery.error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {workspaceQuery.error instanceof Error ? workspaceQuery.error.message : '加载 topic workspace 失败'}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {reprojectionMutation.error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {reprojectionMutation.error instanceof Error ? reprojectionMutation.error.message : '触发 reprojection 失败'}
                </AlertDescription>
              </Alert>
            ) : null}

            {reviewMutation.error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {reviewMutation.error instanceof Error ? reviewMutation.error.message : '执行 review action 失败'}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">Current Topics</div>
                <div className="mt-2 text-2xl font-semibold">{currentTopics.length}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">Historical Topics</div>
                <div className="mt-2 text-2xl font-semibold">{historicalTopics.length}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">Latest Jobs</div>
                <div className="mt-2 text-2xl font-semibold">{latestJobs.length}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">Selected Topic</div>
                <div className="mt-2 text-sm font-medium">
                  {selectedTopicId ? `#${selectedTopicId}` : '暂无'}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="space-y-4">
                <Tabs defaultValue="current">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="current">当前主题</TabsTrigger>
                    <TabsTrigger value="history">历史主题</TabsTrigger>
                  </TabsList>
                  <TabsContent value="current" className="mt-3">
                    <ScrollArea className="h-[480px] rounded-lg border">
                      <div className="space-y-3 p-3">
                        {currentTopics.length > 0 ? currentTopics.map((topic) => (
                          <TopicListItem
                            key={topic.id}
                            topic={topic}
                            selected={selectedTopicId === topic.id}
                            onSelect={setSelectedTopicId}
                          />
                        )) : (
                          <div className="text-sm text-muted-foreground">当前没有 topic。</div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                  <TabsContent value="history" className="mt-3">
                    <ScrollArea className="h-[480px] rounded-lg border">
                      <div className="space-y-3 p-3">
                        {historicalTopics.length > 0 ? historicalTopics.map((topic) => (
                          <TopicListItem
                            key={topic.id}
                            topic={topic}
                            selected={selectedTopicId === topic.id}
                            onSelect={setSelectedTopicId}
                          />
                        )) : (
                          <div className="text-sm text-muted-foreground">还没有历史 topic。</div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>

                <div className="rounded-lg border p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <FileClock className="h-4 w-4" />
                    Recent Jobs
                  </div>
                  <div className="space-y-2">
                    {latestJobs.length > 0 ? latestJobs.map((job) => (
                      <div key={job.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <div>
                          <div>#{job.id}</div>
                          <div className="text-xs text-muted-foreground">{job.trigger_type || 'projection'}</div>
                        </div>
                        <Badge variant={versionStatusVariant(job.status)}>
                          {job.status}
                        </Badge>
                      </div>
                    )) : (
                      <div className="text-sm text-muted-foreground">暂无 job。</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {!selectedTopicId ? (
                  <Alert>
                    <AlertDescription>先从左侧选择一个 topic。</AlertDescription>
                  </Alert>
                ) : detailQuery.isLoading ? (
                  <div className="text-sm text-muted-foreground">正在加载 topic detail...</div>
                ) : detailQuery.error ? (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      {detailQuery.error instanceof Error ? detailQuery.error.message : '加载 topic detail 失败'}
                    </AlertDescription>
                  </Alert>
                ) : detailQuery.data?.data ? (
                  <>
                    <div className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold">
                            {detailQuery.data.data.topic.canonical_title || detailQuery.data.data.detail_version?.title || `Topic ${detailQuery.data.data.topic.id}`}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {detailQuery.data.data.detail_version?.summary_text || '暂无版本摘要'}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={lifecycleVariant(detailQuery.data.data.topic.lifecycle_state)}>
                            {detailQuery.data.data.topic.lifecycle_state}
                          </Badge>
                          {detailQuery.data.data.detail_version?.status ? (
                            <Badge variant={versionStatusVariant(detailQuery.data.data.detail_version.status)}>
                              {detailQuery.data.data.detail_version.status}
                            </Badge>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => reprojectionMutation.mutate({
                              topicId: detailQuery.data!.data.topic.id,
                              sourceProjectionVersionId: detailQuery.data!.data.detail_version?.id ?? null
                            })}
                            disabled={reprojectionMutation.isPending || reviewMutation.isPending}
                          >
                            {reprojectionMutation.isPending ? '重跑中...' : 'Manual Reprojection'}
                          </Button>
                          {detailQuery.data.data.candidate_version ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => reviewMutation.mutate({
                                topicId: detailQuery.data!.data.topic.id,
                                payload: {
                                  action_type: 'approve_candidate',
                                  base_projection_version_id: detailQuery.data!.data.candidate_version?.id,
                                  apply_now: true
                                }
                              })}
                              disabled={reviewMutation.isPending || reprojectionMutation.isPending}
                            >
                              {reviewMutation.isPending ? '处理中...' : 'Approve Candidate'}
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const nextTitle = window.prompt('输入新标题', detailQuery.data!.data.detail_version?.title || detailQuery.data!.data.topic.canonical_title || '');
                              if (!nextTitle || !nextTitle.trim()) {
                                return;
                              }
                              reviewMutation.mutate({
                                topicId: detailQuery.data!.data.topic.id,
                                payload: {
                                  action_type: 'retitle',
                                  base_projection_version_id: detailQuery.data!.data.detail_version?.id,
                                  patch_json: { title: nextTitle.trim() },
                                  apply_now: true
                                }
                              });
                            }}
                            disabled={reviewMutation.isPending || reprojectionMutation.isPending}
                          >
                            Retitle
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <div>
                          <div className="text-xs text-muted-foreground">Started</div>
                          <div className="text-sm">{formatMaybeTime(detailQuery.data.data.topic.started_at)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Last Activity</div>
                          <div className="text-sm">{formatMaybeTime(detailQuery.data.data.topic.last_activity_at)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Reviews</div>
                          <div className="text-sm">{detailQuery.data.data.review_events.length}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Golden Cases</div>
                          <div className="text-sm">{detailQuery.data.data.golden_cases.length}</div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <TopicVersionChip label="Accepted" version={detailQuery.data.data.accepted_version} />
                          <TopicVersionChip label="Candidate" version={detailQuery.data.data.candidate_version} />
                          <TopicVersionChip label="Latest Failed" version={detailQuery.data.data.latest_failed_version} />
                        </div>

                        <div className="rounded-lg border p-4">
                          <div className="mb-3 flex items-center gap-2 font-medium">
                            <Users className="h-4 w-4" />
                            Topic Relationships
                          </div>
                          <div className="space-y-3">
                            {detailQuery.data.data.relationships.length > 0 ? detailQuery.data.data.relationships.map((relationship) => (
                              <div key={relationship.id} className="rounded-lg border p-3">
                                <div className="mb-1 flex items-center justify-between gap-3">
                                  <div className="font-medium">
                                    target #{relationship.target_user_id ?? 'unknown'}
                                  </div>
                                  {relationship.relationship_kind ? (
                                    <Badge variant="outline">{relationship.relationship_kind}</Badge>
                                  ) : null}
                                </div>
                                <div className="text-sm text-muted-foreground">{relationship.summary_text}</div>
                              </div>
                            )) : (
                              <div className="text-sm text-muted-foreground">当前版本没有 relationship projection。</div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg border p-4">
                          <div className="mb-3 flex items-center gap-2 font-medium">
                            <GitCompareArrows className="h-4 w-4" />
                            Evidence
                          </div>
                          <div className="space-y-3">
                            {detailQuery.data.data.evidence.length > 0 ? detailQuery.data.data.evidence.map((item) => (
                              <div key={item.id} className="rounded-lg border p-3">
                                <div className="mb-1 flex items-center justify-between gap-3">
                                  <Badge variant="outline">{item.source_kind}</Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {formatMaybeTime(item.occurred_at)}
                                  </span>
                                </div>
                                <div className="text-sm">{item.excerpt_text || `source #${item.source_id}`}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  source #{item.source_id}{item.speaker_id ? ` · speaker ${item.speaker_id}` : ''}
                                </div>
                              </div>
                            )) : (
                              <div className="text-sm text-muted-foreground">当前版本没有 evidence。</div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-lg border p-4">
                          <div className="mb-3 flex items-center gap-2 font-medium">
                            <Layers3 className="h-4 w-4" />
                            Versions
                          </div>
                          <div className="space-y-2">
                            {detailQuery.data.data.versions.map((version) => (
                              <div key={version.id} className="rounded-md border p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="font-medium">v{version.version_number}</div>
                                  <Badge variant={versionStatusVariant(version.status)}>
                                    {version.status || 'unknown'}
                                  </Badge>
                                </div>
                                <div className="mt-1 text-sm">{version.title || '未命名版本'}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Priority {version.review_priority_score.toFixed(2)} · Heat {version.heat_score.toFixed(2)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-lg border p-4">
                          <div className="mb-3 text-sm font-medium">Review Events</div>
                          <div className="space-y-2">
                            {detailQuery.data.data.review_events.length > 0 ? detailQuery.data.data.review_events.map((event) => (
                              <div key={event.id} className="rounded-md border p-3 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span>{event.action_type}</span>
                                  {event.status ? <Badge variant="outline">{event.status}</Badge> : null}
                                </div>
                                {event.manual_note ? (
                                  <div className="mt-1 text-xs text-muted-foreground">{event.manual_note}</div>
                                ) : null}
                              </div>
                            )) : (
                              <div className="text-sm text-muted-foreground">还没有 review event。</div>
                            )}
                          </div>
                        </div>

                        <Separator />

                        <div className="rounded-lg border p-4">
                          <div className="mb-3 text-sm font-medium">Golden Cases</div>
                          <div className="space-y-2">
                            {detailQuery.data.data.golden_cases.length > 0 ? detailQuery.data.data.golden_cases.map((item) => (
                              <div key={item.id} className="rounded-md border p-3 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span>{item.label || `Golden #${item.id}`}</span>
                                  {item.status ? <Badge variant="outline">{item.status}</Badge> : null}
                                </div>
                              </div>
                            )) : (
                              <div className="text-sm text-muted-foreground">还没有 golden case。</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => workspaceQuery.refetch()}>
                刷新 Topic Workspace
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default ChatSpaceTopicWorkspace;
