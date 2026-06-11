import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import * as QRCode from 'qrcode';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { StatusPill } from './console/StatusPill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  ImagePlus,
  Loader2,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Power,
  QrCode,
  RefreshCw,
  Sparkles,
  Search,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { cn, formatTimestamp } from '../lib/utils';

interface LayoutProps {
  children: React.ReactNode;
}

interface NavigationItem {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}

type RuntimeTone = 'success' | 'warning' | 'danger';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'qqbot-admin-sidebar-collapsed';
const PLAYGROUND_SIDEBAR_COLLAPSED_STORAGE_KEY = 'qqbot-admin-sidebar-collapsed-playground';

function getSidebarCollapsedStorageKey(pathname: string): string {
  return pathname.startsWith('/playground')
    ? PLAYGROUND_SIDEBAR_COLLAPSED_STORAGE_KEY
    : SIDEBAR_COLLAPSED_STORAGE_KEY;
}

function getInitialSidebarCollapsed(pathname: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const storageKey = getSidebarCollapsedStorageKey(pathname);
  const storedValue = window.localStorage.getItem(storageKey);
  if (storedValue !== null) {
    return storedValue === 'true';
  }

  return pathname.startsWith('/playground');
}

interface RuntimeStatusPayload {
  status: 'healthy' | 'degraded' | 'offline';
  provider: {
    live: boolean;
    connected: boolean;
    status: 'online' | 'offline' | 'error';
    botId: string | null;
    httpServerRunning: boolean;
    lastHeartbeat: string | null;
    errorMessage: string | null;
    url: string;
    healthStatusCode: number | null;
  };
  admin: {
    live: boolean;
    status: 'online' | 'offline';
  };
  database: {
    live: boolean;
    status: 'online' | 'offline';
  };
}

interface NapcatLoginStatusPayload {
  napcatReachable: boolean;
  qqLoggedIn: boolean;
  qqAccountId: string | null;
  qrAvailable: boolean;
  qrPayload: string | null;
  qrPayloadType: 'url' | null;
  webuiConfigured: boolean;
  message: string | null;
  lastCheckedAt: string;
}

const runtimeToneMap: Record<RuntimeStatusPayload['status'], RuntimeTone> = {
  healthy: 'success',
  degraded: 'warning',
  offline: 'danger',
};

function formatRuntimeTitle(runtimeStatus?: RuntimeStatusPayload): string {
  if (!runtimeStatus) {
    return 'Runtime loading';
  }

  if (runtimeStatus.status === 'offline') {
    return 'Runtime offline';
  }

  if (runtimeStatus.status === 'degraded') {
    return 'Runtime degraded';
  }

  return 'Runtime healthy';
}

function formatRuntimeSummary(runtimeStatus?: RuntimeStatusPayload): string {
  if (!runtimeStatus) {
    return '正在获取 Provider / Admin / Database 状态';
  }

  const providerLabel = runtimeStatus.provider.live
    ? runtimeStatus.provider.connected
      ? 'Provider live'
      : 'Provider live / NapCat down'
    : 'Provider offline';
  const adminLabel = runtimeStatus.admin.live ? 'Admin live' : 'Admin offline';
  const databaseLabel = runtimeStatus.database.live ? 'PostgreSQL live' : 'PostgreSQL offline';

  return `${providerLabel} • ${adminLabel} • ${databaseLabel}`;
}

function formatHeartbeat(lastHeartbeat: string | null | undefined): string | null {
  return lastHeartbeat
    ? formatTimestamp(lastHeartbeat, { fallback: '' }) || null
    : null;
}

async function readApiData<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || payload?.error || fallbackMessage);
  }

  return payload.data as T;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const queryClient = useQueryClient();
  const isPlaygroundRoute = location.pathname.startsWith('/playground');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getInitialSidebarCollapsed(location.pathname));
  const [napcatLoginOpen, setNapcatLoginOpen] = useState(false);
  const [qrPayloadOverride, setQrPayloadOverride] = useState<string | null>(null);
  const [qrImageDataUrl, setQrImageDataUrl] = useState<string | null>(null);
  const [qrRenderError, setQrRenderError] = useState<string | null>(null);
  const [qrRefreshPending, setQrRefreshPending] = useState(false);
  const [qrRefreshError, setQrRefreshError] = useState<string | null>(null);
  const autoQrcodeRequestedRef = useRef(false);
  const { data: runtimeStatus } = useQuery<RuntimeStatusPayload>({
    queryKey: ['runtimeStatus'],
    queryFn: async () => {
      const response = await fetch('/api/runtime/status');
      if (!response.ok) {
        throw new Error('Failed to fetch runtime status');
      }

      const payload = await response.json();
      return payload.data as RuntimeStatusPayload;
    },
    staleTime: 5000,
    refetchInterval: 15000,
  });
  const {
    data: napcatLoginStatus,
    error: napcatLoginQueryError,
    isFetching: napcatLoginFetching,
    refetch: refetchNapcatLoginStatus,
  } = useQuery<NapcatLoginStatusPayload>({
    queryKey: ['napcatLoginStatus'],
    enabled: napcatLoginOpen,
    queryFn: async () => {
      const response = await fetch('/api/runtime/napcat-login/status');
      return readApiData<NapcatLoginStatusPayload>(response, 'Failed to fetch NapCat login status');
    },
    staleTime: 1000,
    refetchInterval: napcatLoginOpen ? 2500 : false,
  });

  const navigationGroups = [
    {
      label: 'Overview',
      items: [
        {
          href: '/xiaoni-action-stream',
          label: '小腻行动流',
          icon: Activity,
          description: 'provider、tool、消息和状态事件',
          active: location.pathname === '/xiaoni-action-stream'
            || location.pathname === '/xiaoni-activity'
            || location.pathname.startsWith('/xiaoni/action-stream/events/'),
        },
      ],
    },
    {
      label: 'Engagement',
      items: [
        {
          href: '/groups',
          label: '群聊 IM 入口',
          icon: Users,
          description: '配置哪些群进入小腻 IM',
          active: location.pathname.startsWith('/groups'),
        },
        {
          href: '/private-chats',
          label: '私聊 IM 入口',
          icon: User,
          description: '配置哪些私聊进入小腻 IM',
          active: location.pathname.startsWith('/private-chats'),
        },
      ],
    },
    {
      label: 'Configuration',
      items: [
        {
          href: '/xiaoni-runtime-settings',
          label: '小腻运行配置',
          icon: Power,
          description: '暂停或恢复小腻主循环',
          active: location.pathname.startsWith('/xiaoni-runtime-settings'),
        },
        {
          href: '/prompts',
          label: 'Prompt 管理',
          icon: FileText,
          description: '模板、变量、模型与调试',
          active: location.pathname.startsWith('/prompts'),
        },
        {
          href: '/playground',
          label: 'Playground',
          icon: Sparkles,
          description: '真实样本驱动的 Prompt 实验台',
          active: location.pathname.startsWith('/playground'),
        },
        {
          href: '/image-lab',
          label: 'Image Lab',
          icon: ImagePlus,
          description: 'gpt-image-2 生图与编辑实验台',
          active: location.pathname.startsWith('/image-lab'),
        },
      ],
    },
    {
      label: 'Observability',
      items: [
        {
          href: '/queue-management',
          label: '队列管理',
          icon: ClipboardList,
          description: '群聊/私聊对象列表与模拟投递',
          active: location.pathname === '/queue-management',
        },
        {
          href: '/traffic',
          label: '流量监控',
          icon: Network,
          description: 'HTTP 请求、回放与异常',
          active: location.pathname.startsWith('/traffic'),
        },
      ],
    },
  ];

  const allItems = navigationGroups.flatMap((group) => group.items);
  const currentItem = useMemo(
    () => allItems.find((item) => item.active) ?? allItems[0],
    [allItems]
  );
  const runtimeTitle = formatRuntimeTitle(runtimeStatus);
  const runtimeSummary = formatRuntimeSummary(runtimeStatus);
  const runtimeTone = runtimeToneMap[runtimeStatus?.status ?? 'degraded'];
  const heartbeatLabel = formatHeartbeat(runtimeStatus?.provider.lastHeartbeat);
  const runtimeIssue = runtimeStatus?.provider.errorMessage;
  const sidebarWidthClass = sidebarCollapsed ? 'w-[68px]' : 'w-[240px]';
  const activeQrPayload = napcatLoginStatus?.qrPayload || qrPayloadOverride;
  const napcatLoginError = qrRefreshError
    || qrRenderError
    || (napcatLoginQueryError instanceof Error ? napcatLoginQueryError.message : null);

  const requestNapcatLoginQrcode = useCallback(async () => {
    setQrRefreshPending(true);
    setQrRefreshError(null);
    try {
      const response = await fetch('/api/runtime/napcat-login/qrcode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      const data = await readApiData<NapcatLoginStatusPayload>(response, 'Failed to fetch NapCat login QR');
      setQrPayloadOverride(data.qrPayload);
      queryClient.setQueryData(['napcatLoginStatus'], data);
      if (data.qqLoggedIn) {
        await queryClient.invalidateQueries({ queryKey: ['runtimeStatus'] });
      }
    } catch (error) {
      setQrRefreshError(error instanceof Error ? error.message : 'Failed to fetch NapCat login QR');
    } finally {
      setQrRefreshPending(false);
    }
  }, [queryClient]);

  useEffect(() => {
    setSidebarCollapsed(getInitialSidebarCollapsed(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storageKey = getSidebarCollapsedStorageKey(location.pathname);
    window.localStorage.setItem(storageKey, String(sidebarCollapsed));
  }, [location.pathname, sidebarCollapsed]);

  useEffect(() => {
    if (!napcatLoginOpen) {
      autoQrcodeRequestedRef.current = false;
      setQrPayloadOverride(null);
      setQrRefreshError(null);
      return;
    }

    if (
      autoQrcodeRequestedRef.current
      || !napcatLoginStatus
      || napcatLoginStatus.qqLoggedIn
      || napcatLoginStatus.qrPayload
      || qrPayloadOverride
      || qrRefreshPending
    ) {
      return;
    }

    autoQrcodeRequestedRef.current = true;
    void requestNapcatLoginQrcode();
  }, [
    napcatLoginOpen,
    napcatLoginStatus,
    qrPayloadOverride,
    qrRefreshPending,
    requestNapcatLoginQrcode
  ]);

  useEffect(() => {
    if (!activeQrPayload || napcatLoginStatus?.qqLoggedIn) {
      setQrImageDataUrl(null);
      setQrRenderError(null);
      return;
    }

    let cancelled = false;
    setQrRenderError(null);
    QRCode.toDataURL(activeQrPayload, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    }).then((dataUrl) => {
      if (!cancelled) {
        setQrImageDataUrl(dataUrl);
      }
    }).catch((error) => {
      if (!cancelled) {
        setQrImageDataUrl(null);
        setQrRenderError(error instanceof Error ? error.message : 'Failed to render NapCat QR');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeQrPayload, napcatLoginStatus?.qqLoggedIn]);

  useEffect(() => {
    if (napcatLoginStatus?.qqLoggedIn) {
      setQrPayloadOverride(null);
      void queryClient.invalidateQueries({ queryKey: ['runtimeStatus'] });
    }
  }, [napcatLoginStatus?.qqLoggedIn, queryClient]);

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className={cn('border-b border-border py-3', sidebarCollapsed ? 'px-3' : 'px-4')}>
        <div className={cn('flex items-center', sidebarCollapsed ? 'justify-center' : 'gap-2.5')}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="h-3.5 w-3.5" />
          </div>
          {!sidebarCollapsed ? (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">QQ Bot Console</div>
              <div className="truncate text-xs text-muted-foreground">Admin workspace</div>
            </div>
          ) : null}
        </div>

        {!sidebarCollapsed ? (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="导航搜索"
              placeholder="Quick search..."
              className="h-7.5 border-border bg-card pl-8 text-xs shadow-none"
            />
          </div>
        ) : (
          <div className="mt-3 flex justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
              <Search className="h-4 w-4" />
            </div>
          </div>
        )}
      </div>

      <div className={cn('flex-1 overflow-y-auto py-3', sidebarCollapsed ? 'px-2' : 'px-3')}>
        {navigationGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!sidebarCollapsed ? (
              <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {group.label}
              </div>
            ) : null}
            <nav className="space-y-0.5">
              {group.items.map((item: NavigationItem) => (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={cn(
                    'group rounded-lg border transition-colors',
                    sidebarCollapsed
                      ? 'flex justify-center px-2 py-2.5'
                      : 'flex items-start gap-2.5 px-2.5 py-2',
                    item.active
                      ? 'border-primary/20 bg-primary/10 text-foreground shadow-sm'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground'
                  )}
                >
                  <item.icon
                    className={cn(
                      'h-[15px] w-[15px] flex-shrink-0',
                      !sidebarCollapsed && 'mt-0.5',
                      item.active ? 'text-primary/85' : 'text-slate-400 group-hover:text-slate-500'
                    )}
                  />
                  {!sidebarCollapsed ? (
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('truncate text-[13px] font-medium', item.active ? 'text-foreground' : 'text-slate-700 group-hover:text-foreground')}>{item.label}</span>
                        {item.active && <ChevronRight className="h-3 w-3 text-primary/85" />}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-4.5 text-slate-500">
                        {item.description}
                      </div>
                    </div>
                  ) : null}
                </Link>
              ))}
            </nav>
          </div>
        ))}
      </div>

      <div className={cn('border-t border-border py-3', sidebarCollapsed ? 'px-2' : 'px-4')}>
        <div className={cn('flex', sidebarCollapsed ? 'justify-center' : 'items-start gap-2.5')}>
          <div
            className={cn(
              'mt-0.5 flex h-6 w-6 items-center justify-center rounded-full',
              runtimeTone === 'success' && 'bg-emerald-50 text-[hsl(var(--success))]',
              runtimeTone === 'warning' && 'bg-amber-50 text-[hsl(var(--warning))]',
              runtimeTone === 'danger' && 'bg-red-50 text-destructive'
            )}
          >
            <ShieldCheck className="h-3 w-3" />
          </div>
          {!sidebarCollapsed ? (
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">{runtimeTitle}</div>
              <div className="mt-0.5 text-[11px] leading-4.5 text-muted-foreground">
                {runtimeSummary}
              </div>
              {heartbeatLabel && (
                <div className="mt-1 text-[11px] leading-4.5 text-muted-foreground">
                  Provider heartbeat {heartbeatLabel}
                </div>
              )}
              {runtimeIssue && runtimeTone !== 'success' && (
                <div className="mt-1 line-clamp-2 text-[11px] leading-4.5 text-muted-foreground">
                  {runtimeIssue}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div className="console-shell">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'console-sidebar hidden shrink-0 transition-[width] duration-200 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col',
            sidebarWidthClass
          )}
        >
          {sidebarContent}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex min-h-[64px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => setMobileNavOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden lg:inline-flex"
                  title={sidebarCollapsed ? '展开导航' : '折叠导航'}
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                >
                  {sidebarCollapsed ? <PanelLeftOpen className="mr-2 h-4 w-4" /> : <PanelLeftClose className="mr-2 h-4 w-4" />}
                  {sidebarCollapsed ? 'Expand' : 'Collapse'}
                </Button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Tunnels</span>
                    <ChevronRight className="h-3 w-3" />
                    <span className="truncate">{currentItem.label}</span>
                  </div>
                  <h1 className="truncate pt-0.5 text-[1.75rem] font-semibold text-foreground">
                    {currentItem.label}
                  </h1>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden md:block">
                  <StatusPill tone={runtimeTone}>
                    {runtimeTitle}
                  </StatusPill>
                </div>
                <Button
                  variant={runtimeTone === 'success' ? 'outline' : 'default'}
                  size="sm"
                  className={cn(
                    'gap-2',
                    runtimeTone !== 'success' && 'border-amber-600 bg-amber-500 text-white hover:border-amber-600 hover:bg-amber-600'
                  )}
                  onClick={() => setNapcatLoginOpen(true)}
                >
                  <QrCode className="h-4 w-4" />
                  <span className="hidden sm:inline">NapCat 登录</span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                  Refresh
                </Button>
              </div>
            </div>
          </header>

          <main
            className={cn(
              'min-w-0 py-4',
              isPlaygroundRoute ? 'px-0 pl-3 sm:pl-4 lg:pl-6 lg:pr-0' : 'px-2 sm:px-3 lg:px-4'
            )}
          >
            <div className="min-h-[calc(100vh-5rem)]">
              {children}
            </div>
          </main>
        </div>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[320px] border-r border-border bg-[#f8f7f5] p-0">
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border px-4 py-4 text-left">
              <SheetTitle className="text-base">Navigation</SheetTitle>
            </SheetHeader>
            {sidebarContent}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={napcatLoginOpen} onOpenChange={setNapcatLoginOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" />
              NapCat 登录
            </DialogTitle>
            <DialogDescription>
              WSL2 重启后可在这里刷新扫码登录二维码。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {napcatLoginStatus?.qqLoggedIn ? (
              <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">NapCat 已登录</div>
                  {napcatLoginStatus.qqAccountId ? (
                    <div className="mt-0.5 text-emerald-700">QQ {napcatLoginStatus.qqAccountId}</div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-border bg-card p-5">
                {qrImageDataUrl ? (
                  <div className="space-y-3 text-center">
                    <img
                      src={qrImageDataUrl}
                      alt="NapCat login QR"
                      className="mx-auto h-64 w-64 rounded-lg border border-border bg-white p-3 shadow-sm"
                    />
                    <div className="text-xs text-muted-foreground">
                      {napcatLoginFetching ? '正在确认登录状态' : '打开 QQ 扫码登录'}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                    {napcatLoginFetching || qrRefreshPending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <QrCode className="h-5 w-5" />
                    )}
                    <div>{napcatLoginFetching || qrRefreshPending ? '正在获取二维码' : '二维码暂不可用'}</div>
                  </div>
                )}
              </div>
            )}

            {!napcatLoginStatus?.qqLoggedIn && napcatLoginError ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 break-words">{napcatLoginError}</span>
              </div>
            ) : null}

            {!napcatLoginStatus?.qqLoggedIn && napcatLoginStatus?.message && !napcatLoginError ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {napcatLoginStatus.message}
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetchNapcatLoginStatus()}
              disabled={napcatLoginFetching}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', napcatLoginFetching && 'animate-spin')} />
              检查状态
            </Button>
            <Button
              size="sm"
              onClick={() => void requestNapcatLoginQrcode()}
              disabled={napcatLoginStatus?.qqLoggedIn || qrRefreshPending}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', qrRefreshPending && 'animate-spin')} />
              刷新二维码
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
