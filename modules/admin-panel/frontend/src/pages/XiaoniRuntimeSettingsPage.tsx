import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2, Power, RefreshCw } from 'lucide-react';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { SectionPanel } from '@/components/console/SectionPanel';
import { ErrorState } from '@/components/console/ErrorState';
import { StatusPill } from '@/components/console/StatusPill';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { formatTimestamp } from '@/lib/utils';

type ApiResponse<T> = {
  success: boolean;
  data: T;
  error?: string;
};

type RuntimeControl = {
  identityKey: string;
  enabled: boolean;
  updatedAt: string | null;
};

async function fetchRuntimeControl(): Promise<RuntimeControl> {
  const response = await fetch('/api/agent-runtime/control');
  const payload = await response.json() as ApiResponse<RuntimeControl>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to load runtime control');
  }
  return payload.data;
}

async function updateRuntimeControl(enabled: boolean): Promise<RuntimeControl> {
  const response = await fetch('/api/agent-runtime/control', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
  const payload = await response.json() as ApiResponse<RuntimeControl>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to update runtime control');
  }
  return payload.data;
}

export const XiaoniRuntimeSettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const controlQuery = useQuery({
    queryKey: ['xiaoni-runtime-control'],
    queryFn: fetchRuntimeControl,
    refetchInterval: 10000
  });
  const mutation = useMutation({
    mutationFn: updateRuntimeControl,
    onSuccess: (data) => {
      queryClient.setQueryData(['xiaoni-runtime-control'], data);
      void queryClient.invalidateQueries({ queryKey: ['runtimeStatus'] });
      void queryClient.invalidateQueries({ queryKey: ['xiaoni-action-stream'] });
    }
  });

  const control = controlQuery.data;
  const enabled = mutation.isPending ? mutation.variables : control?.enabled ?? true;
  const updatedAt = control?.updatedAt ? formatTimestamp(control.updatedAt, { fallback: control.updatedAt }) : '默认开启';

  return (
    <PageShell className="max-w-4xl">
      <PageHeader
        eyebrow="Runtime Settings"
        title="小腻运行配置"
        description="控制小腻主循环是否继续消费队列和调用模型。"
        icon={<Power className="h-5 w-5" />}
        badge={<StatusPill tone={enabled ? 'success' : 'warning'}>{enabled ? '运行中' : '已暂停'}</StatusPill>}
        actions={
          <Button variant="outline" size="sm" onClick={() => void controlQuery.refetch()} disabled={controlQuery.isFetching}>
            <RefreshCw className={controlQuery.isFetching ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
            刷新
          </Button>
        }
      />

      {controlQuery.error ? (
        <ErrorState
          description={controlQuery.error instanceof Error ? controlQuery.error.message : '加载运行配置失败'}
          onRetry={() => void controlQuery.refetch()}
        />
      ) : null}

      <SectionPanel
        title="主循环"
        description="关闭后 agent-service 不再 claim 队列，不再发起新的模型请求；再次打开后继续从队列恢复。"
        icon={<Bot className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">小腻运行循环</div>
            <div className="text-sm text-muted-foreground">
              {enabled ? '开启时会持续处理小腻 runtime 队列。' : '关闭时只保留服务健康检查和配置 API。'}
            </div>
            <div className="text-xs text-muted-foreground">最后更新：{updatedAt}</div>
          </div>
          <div className="flex items-center gap-3">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            <Switch
              checked={enabled}
              disabled={controlQuery.isLoading || mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate(Boolean(checked))}
              aria-label="小腻运行循环"
            />
          </div>
        </div>
      </SectionPanel>
    </PageShell>
  );
};
