import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';
import {
  Bot,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Network,
  Search,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { cn } from '../lib/utils';

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

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navigationGroups = [
    {
      label: 'Overview',
      items: [
        {
          href: '/dashboard',
          label: '指挥台',
          icon: LayoutDashboard,
          description: '系统总览、指标与健康状态',
          active: location.pathname === '/dashboard',
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
          description: '全局会话记录与时间线',
          active: location.pathname.startsWith('/conversation') || location.pathname.startsWith('/conversations'),
        },
        {
          href: '/groups',
          label: '群聊策略',
          icon: Users,
          description: '群配置、启用状态与活跃度',
          active: location.pathname.startsWith('/groups'),
        },
        {
          href: '/private-chats',
          label: '私聊策略',
          icon: User,
          description: '用户级配置与批量操作',
          active: location.pathname.startsWith('/private-chats'),
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
      ],
    },
    {
      label: 'Observability',
      items: [
        {
          href: '/queue-management',
          label: '队列管理',
          icon: ClipboardList,
          description: '运行时队列与消费状态',
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

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">QQ Bot Console</div>
            <div className="truncate text-xs text-muted-foreground">Admin workspace</div>
          </div>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="导航搜索"
            placeholder="Quick search..."
            className="h-7.5 border-border bg-card pl-8 text-xs shadow-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {navigationGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {group.label}
            </div>
            <nav className="space-y-0.5">
              {group.items.map((item: NavigationItem) => (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={cn(
                    'group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors',
                    item.active
                      ? 'border-primary/20 bg-primary/10 text-foreground shadow-sm'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground'
                  )}
                >
                  <item.icon className={cn('mt-0.5 h-[15px] w-[15px] flex-shrink-0', item.active ? 'text-primary/85' : 'text-slate-400 group-hover:text-slate-500')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('truncate text-[13px] font-medium', item.active ? 'text-foreground' : 'text-slate-700 group-hover:text-foreground')}>{item.label}</span>
                      {item.active && <ChevronRight className="h-3 w-3 text-primary/85" />}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-4.5 text-slate-500">
                      {item.description}
                    </div>
                  </div>
                </Link>
              ))}
            </nav>
          </div>
        ))}
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-[hsl(var(--success))]">
            <ShieldCheck className="h-3 w-3" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground">Runtime online</div>
            <div className="mt-0.5 text-[11px] leading-4.5 text-muted-foreground">
              Core / Admin / MySQL 已联机
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="console-shell">
      <div className="flex min-h-screen">
        <aside className="console-sidebar hidden w-[232px] shrink-0 lg:flex lg:flex-col">
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
                <div className="hidden rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground md:flex md:items-center md:gap-2">
                  <span className="status-dot bg-[hsl(var(--success))]" />
                  <span>System healthy</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                  Refresh
                </Button>
              </div>
            </div>
          </header>

          <main className="min-w-0 px-4 py-4 sm:px-6 lg:px-8">
            <div className="console-page min-h-[calc(100vh-7rem)] px-4 py-4 sm:px-5 lg:px-6">
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
