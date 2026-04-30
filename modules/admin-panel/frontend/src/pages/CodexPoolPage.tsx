import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, ExternalLink, KeyRound, RefreshCw, ServerCog, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { PageHeader, PageHeaderBadge } from '@/components/console/PageHeader';
import { PageShell } from '@/components/console/PageShell';
import { SectionPanel } from '@/components/console/SectionPanel';
import {
  activateCodexAccount,
  CodexAccountRow,
  completeCodexLogin,
  createCodexLoginSession,
  fetchCodexAccounts,
  fetchCodexPoolStatus,
  removeCodexAccount,
  refreshCodexAccount,
  setCodexAccountEnabled,
  type CodexLoginSessionResponse,
  type CodexPoolAccountsResponse,
  type CodexPoolStatusResponse
} from '@/lib/codexPool';

function formatTime(value: string | null) {
  if (!value) return '—';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
}

function describeWindow(minutes: number | null | undefined) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return '—';
  if (minutes % (60 * 24 * 7) === 0) return `${minutes / (60 * 24 * 7)}w`;
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function statusTone(status: CodexAccountRow['status']) {
  if (status === 'ready') return 'default';
  if (status === 'cooldown') return 'secondary';
  if (status === 'expired') return 'destructive';
  return 'outline';
}

export function CodexPoolPage() {
  const queryClient = useQueryClient();
  const [callbackUrl, setCallbackUrl] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const statusQuery = useQuery<CodexPoolStatusResponse>({
    queryKey: ['codexPoolStatus'],
    queryFn: fetchCodexPoolStatus,
    staleTime: 15_000,
  });

  const accountsQuery = useQuery<CodexPoolAccountsResponse>({
    queryKey: ['codexAccounts'],
    queryFn: fetchCodexAccounts,
    staleTime: 15_000,
  });

  const loginSessionMutation = useMutation({
    mutationFn: async (replaceAccountId?: string) => createCodexLoginSession({ replaceAccountId }),
    onSuccess: (response: CodexLoginSessionResponse) => {
      const url = response.data?.authorizeUrl;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        setFlash(`已生成授权链接，回调地址默认使用 ${response.data?.redirectUri}。完成登录后把完整 callback URL 粘回来。`);
      }
    }
  });

  const completeLoginMutation = useMutation({
    mutationFn: async () => completeCodexLogin(callbackUrl.trim()),
    onSuccess: async () => {
      setCallbackUrl('');
      setFlash('Codex 账号已入库。');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['codexPoolStatus'] }),
        queryClient.invalidateQueries({ queryKey: ['codexAccounts'] })
      ]);
    }
  });

  const activateMutation = useMutation({
    mutationFn: async (accountId: string) => activateCodexAccount(accountId),
    onSuccess: async () => {
      setFlash('激活账号已切换，`codex-provider` 将继续读取 `.codex/auth.json`。');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['codexPoolStatus'] }),
        queryClient.invalidateQueries({ queryKey: ['codexAccounts'] })
      ]);
    }
  });

  const refreshMutation = useMutation({
    mutationFn: async (accountId: string) => refreshCodexAccount(accountId),
    onSuccess: async () => {
      setFlash('账号凭据已刷新。');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['codexPoolStatus'] }),
        queryClient.invalidateQueries({ queryKey: ['codexAccounts'] })
      ]);
    }
  });

  const enabledMutation = useMutation({
    mutationFn: async ({ accountId, enabled }: { accountId: string; enabled: boolean }) => setCodexAccountEnabled(accountId, enabled),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['codexPoolStatus'] }),
        queryClient.invalidateQueries({ queryKey: ['codexAccounts'] })
      ]);
    }
  });

  const removeMutation = useMutation({
    mutationFn: async (accountId: string) => removeCodexAccount(accountId),
    onSuccess: async () => {
      setFlash('账号已移除。');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['codexPoolStatus'] }),
        queryClient.invalidateQueries({ queryKey: ['codexAccounts'] })
      ]);
    }
  });

  const status = statusQuery.data?.data;
  const accounts = useMemo(() => accountsQuery.data?.data || status?.accounts || [], [accountsQuery.data, status]);
  const busyAccountId =
    activateMutation.variables ||
    refreshMutation.variables ||
    removeMutation.variables ||
    enabledMutation.variables?.accountId ||
    loginSessionMutation.variables ||
    null;
  const errorMessage =
    (statusQuery.error instanceof Error && statusQuery.error.message) ||
    (accountsQuery.error instanceof Error && accountsQuery.error.message) ||
    (loginSessionMutation.error instanceof Error && loginSessionMutation.error.message) ||
    (completeLoginMutation.error instanceof Error && completeLoginMutation.error.message) ||
    (activateMutation.error instanceof Error && activateMutation.error.message) ||
    (refreshMutation.error instanceof Error && refreshMutation.error.message) ||
    (removeMutation.error instanceof Error && removeMutation.error.message) ||
    (enabledMutation.error instanceof Error && enabledMutation.error.message) ||
    null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Codex 账号池"
        description="账号池发生在 `.codex/auth.json` 背后。`codex-provider` 继续读 Codex 的 auth 文件，不切协议。"
        icon={<ServerCog className="h-4 w-4" />}
        badge={<PageHeaderBadge>Codex Auth Manager</PageHeaderBadge>}
      />

      {flash ? (
        <Alert>
          <AlertDescription>{flash}</AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <SectionPanel
        title="当前状态"
        description="这里展示当前激活账号、账号仓可用性，以及是否还有可切换的就绪账号。"
        icon={<ShieldCheck className="h-4 w-4 text-primary" />}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={status?.available ? 'default' : 'secondary'}>{status?.available ? 'manager ready' : 'manager unavailable'}</Badge>
          <Badge variant="outline">accounts: {status?.totalAccounts ?? 0}</Badge>
          <Badge variant="outline">enabled: {status?.enabledAccounts ?? 0}</Badge>
          <Badge variant="outline">ready: {status?.readyAccounts ?? 0}</Badge>
          <Badge variant="outline">active: {status?.activeAccountId || '—'}</Badge>
        </div>
        <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-foreground">
          store: {status?.storeDir || 'loading...'}
        </div>
      </SectionPanel>

      <SectionPanel
        title="OAuth 入池"
        description="先生成授权链接，在浏览器完成登录，再把完整 callback URL 粘回来。"
        icon={<KeyRound className="h-4 w-4 text-primary" />}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => loginSessionMutation.mutate(undefined)} disabled={loginSessionMutation.isPending}>
              生成授权链接
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </div>
          <Input
            value={callbackUrl}
            onChange={(event) => setCallbackUrl(event.target.value)}
            placeholder="粘贴完整 callback URL，例如 http://localhost:1455/auth/callback?code=...&state=..."
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => completeLoginMutation.mutate()} disabled={!callbackUrl.trim() || completeLoginMutation.isPending}>
              完成登录并入库
            </Button>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        title="账号卡片"
        description="激活账号会被投影到 `.codex/auth.json`。这里直接看每个账号的 5h 窗口、周窗口和下次刷新时间。"
        icon={<RefreshCw className="h-4 w-4 text-primary" />}
      >
        {accounts.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            还没有 Codex 账号。先生成授权链接，再把 callback URL 粘回来。
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => {
              const fiveHour = account.rateLimits?.primary || null;
              const weekly = account.rateLimits?.secondary || null;
              return (
                <Card key={account.id} className="border-border/80 bg-card/95">
                  <CardHeader className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{account.email || account.accountId || account.id}</CardTitle>
                        <div className="mt-1 truncate text-xs text-muted-foreground">{account.accountId || account.id}</div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Badge variant={statusTone(account.status) as any}>{account.status}</Badge>
                        {account.isActive ? <Badge>active</Badge> : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">5h limit</div>
                        <div className="mt-2 text-xl font-semibold text-foreground">{formatPercent(fiveHour?.usedPercent)}</div>
                        <Progress className="mt-2 h-2" value={fiveHour?.usedPercent || 0} />
                        <div className="mt-2 text-xs text-muted-foreground">
                          window {describeWindow(fiveHour?.windowDurationMins)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          refresh {formatTime(fiveHour?.resetsAt || null)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Week usage</div>
                        <div className="mt-2 text-xl font-semibold text-foreground">{formatPercent(weekly?.usedPercent)}</div>
                        <Progress className="mt-2 h-2" value={weekly?.usedPercent || 0} />
                        <div className="mt-2 text-xs text-muted-foreground">
                          window {describeWindow(weekly?.windowDurationMins)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          refresh {formatTime(weekly?.resetsAt || null)}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/40 px-3 py-2">
                      <div>
                        <div className="text-xs text-muted-foreground">启用状态</div>
                        <div className="text-sm text-foreground">{account.enabled ? 'enabled' : 'disabled'}</div>
                      </div>
                      <Switch
                        checked={account.enabled}
                        onCheckedChange={(enabled) => enabledMutation.mutate({ accountId: account.id, enabled })}
                        disabled={enabledMutation.isPending && busyAccountId === account.id}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                      <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.14em]">Stats</div>
                        <div className="mt-1">ok {account.stats.successCount}</div>
                        <div>err {account.stats.errorCount}</div>
                        <div>quota {account.stats.quotaExceededCount}</div>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.14em]">Recent</div>
                        <div className="mt-1">used {formatTime(account.lastUsedAt)}</div>
                        <div>activated {formatTime(account.lastActivatedAt)}</div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>checked {formatTime(account.rateLimits?.checkedAt || null)}</span>
                      </div>
                      <div className="mt-1">expires {formatTime(account.expiresAt)}</div>
                      {account.cooldownUntil ? <div className="mt-1">cooldown until {formatTime(account.cooldownUntil)}</div> : null}
                      {account.lastError ? <div className="mt-1 text-destructive">{account.lastError}</div> : null}
                      {!account.rateLimits ? (
                        <div className="mt-1 text-amber-600">
                          当前拿不到 quota。通常是 access token 已失效，先点“重新登录”，不行再移除后重新入池。
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                  <CardFooter className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={account.isActive ? 'secondary' : 'default'}
                      disabled={account.isActive || activateMutation.isPending}
                      onClick={() => activateMutation.mutate(account.id)}
                    >
                      设为激活
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={refreshMutation.isPending}
                      onClick={() => refreshMutation.mutate(account.id)}
                    >
                      刷新
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loginSessionMutation.isPending}
                      onClick={() => loginSessionMutation.mutate(account.id)}
                    >
                      重新登录
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={removeMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`确认移除账号 ${account.email || account.accountId || account.id} 吗？`)) {
                          removeMutation.mutate(account.id);
                        }
                      }}
                    >
                      移除
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </SectionPanel>
    </PageShell>
  );
}
