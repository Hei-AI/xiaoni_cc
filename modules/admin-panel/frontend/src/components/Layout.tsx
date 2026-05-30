import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { StatusPill } from './console/StatusPill';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';
import {
  Activity,
  Bot,
  ChevronRight,
  ClipboardList,
  FileText,
  ImagePlus,
  Menu,
  MessageCircle,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Search,
  ShieldCheck,
  ServerCog,
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

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const isPlaygroundRoute = location.pathname.startsWith('/playground');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getInitialSidebarCollapsed(location.pathname));
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

  const navigationGroups = [
    {
      label: 'Overview',
      items: [
        {
          href: '/xiaoni-activity',
          label: '小腻活动',
          icon: Activity,
          description: 'action/tool、in_context 与真实 trace',
          active: location.pathname === '/xiaoni-activity',
        },
      ],
    },
    {
      label: 'Engagement',
      items: [
        {
          href: '/conversations',
          label: '对话流',
          icon: MessageCircle,
          description: '按会话和 agent run 查看输入批次与回复原因',
          active: location.pathname.startsWith('/conversations') || location.pathname.startsWith('/runs/'),
        },
      ],
    },
    {
      label: 'Configuration',
      items: [
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
    {
      label: 'Operations',
      items: [
        {
          href: '/operations/codex-pool',
          label: 'Codex 账号',
          icon: ServerCog,
          description: '管理 Codex OAuth 登录、账号启停与 active auth 投影',
          active: location.pathname.startsWith('/operations/codex-pool'),
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
    </div>
  );
};
