import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card } from './ui/card';
import { Button } from './ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';
import {
  LayoutDashboard,
  MessageCircle,
  Bot,
  Users,
  User,
  FileText,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Menu,
  Network,
  FileStack,
  Sparkles,
  ShieldCheck,
  ArrowUpRight,
  MessagesSquare
} from 'lucide-react';
import { cn } from '../lib/utils';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  const navigationGroups = [
    {
      label: '总览',
      items: [
        {
          href: '/dashboard',
          label: '指挥台',
          icon: LayoutDashboard,
          description: '系统健康、KPI、最近动态',
          active: location.pathname === '/dashboard',
        },
      ],
    },
    {
      label: '会话',
      items: [
        {
          href: '/conversations',
          label: '对话流',
          icon: MessageCircle,
          description: '全局对话记录与检索',
          active: location.pathname.startsWith('/conversation') || location.pathname.startsWith('/conversations'),
        },
        {
          href: '/groups',
          label: '群聊策略',
          icon: Users,
          description: '群配置、活跃度、开关',
          active: location.pathname.startsWith('/groups'),
        },
        {
          href: '/private-chats',
          label: '私聊策略',
          icon: User,
          description: '用户层配置与批量操作',
          active: location.pathname.startsWith('/private-chats'),
        },
      ],
    },
    {
      label: '配置',
      items: [
        {
          href: '/prompts',
          label: 'Prompt 工作台',
          icon: FileText,
          description: '模板、变量、调试',
          active: location.pathname.startsWith('/prompts'),
        },
      ],
    },
    {
      label: '监控',
      items: [
        {
          href: '/queue-management',
          label: '队列雷达',
          icon: ClipboardList,
          description: '实时队列与消费状态',
          active: location.pathname === '/queue-management',
        },
        {
          href: '/traffic',
          label: '流量镜像',
          icon: Network,
          description: 'HTTP 请求、回放与异常',
          active: location.pathname.startsWith('/traffic') && !location.pathname.startsWith('/traffic/replay/templates'),
        },
        {
          href: '/traffic/replay/templates',
          label: '回放模板',
          icon: FileStack,
          description: '模板化重放配置',
          active: location.pathname.startsWith('/traffic/replay/templates'),
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
    <div className="flex h-full flex-col gap-4">
      <Card className="surface-grid px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-[0_0_24px_-12px_hsl(var(--primary))]">
            <Bot className="h-5 w-5" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">QQ Bot Exchange Console</p>
              <p className="text-xs text-muted-foreground">Ops / Prompt / Queue / Traffic</p>
            </div>
          )}
        </div>
      </Card>

      <div className="flex-1 overflow-y-auto pr-1">
        {navigationGroups.map((group) => (
          <div key={group.label} className="mb-5">
            {!isCollapsed && (
              <div className="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                {group.label}
              </div>
            )}
            <nav className="space-y-1.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={cn(
                    "group flex items-center rounded-2xl border px-3 py-3 transition-all duration-200",
                    item.active
                      ? "border-primary/25 bg-primary/12 text-primary shadow-[0_18px_35px_-26px_hsl(var(--primary))]"
                      : "border-transparent bg-transparent text-muted-foreground hover:border-white/10 hover:bg-white/[0.04] hover:text-foreground"
                  )}
                  title={isCollapsed ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {!isCollapsed && (
                    <div className="ml-3 min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.label}</div>
                      <div className="truncate text-xs text-muted-foreground group-hover:text-muted-foreground">
                        {item.description}
                      </div>
                    </div>
                  )}
                  {!isCollapsed && item.active && <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0" />}
                </Link>
              ))}
            </nav>
          </div>
        ))}
      </div>

      <Card className="px-4 py-4">
        <div className={cn("flex items-center gap-3", isCollapsed && "justify-center")}>
          <div className="status-dot bg-[hsl(var(--success))]" />
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">Runtime Online</div>
              <div className="text-xs text-muted-foreground">Core / Admin / MySQL 已联机</div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );

  return (
    <div className="app-shell">
      <div className="mx-auto flex min-h-screen max-w-[1720px] gap-4 px-3 py-3 sm:px-4 lg:gap-6 lg:px-6">
        <aside
          className={cn(
            "hidden shrink-0 transition-all duration-300 lg:block",
            isCollapsed ? "w-24" : "w-[300px]"
          )}
        >
          <div className="sticky top-3 flex h-[calc(100vh-1.5rem)] flex-col rounded-[1.6rem] border border-white/10 bg-black/20 p-3 backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSidebar}
                title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
              >
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </Button>
            </div>
            {sidebarContent}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4 lg:gap-5">
          <header className="sticky top-3 z-30 rounded-[1.6rem] border border-white/10 bg-black/25 px-4 py-3 backdrop-blur-xl sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => setMobileNavOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <div className="hidden h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary sm:flex">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-lg font-semibold text-foreground sm:text-xl">{currentItem.label}</h1>
                    <span className="hidden rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-primary sm:inline-flex">
                      Live
                    </span>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{currentItem.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground sm:flex">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  <span>Admin Panel v1.0.0</span>
                </div>
                <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground md:flex">
                  <div className="status-dot bg-[hsl(var(--success))]" />
                  <span>System Healthy</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                  刷新界面
                </Button>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 pb-6">
            {children}
          </main>
        </div>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="border-white/10 bg-[#050b19] p-0 sm:max-w-sm">
          <div className="flex h-full flex-col p-4">
            <SheetHeader className="mb-4 border-b border-white/10 pb-4 text-left">
              <SheetTitle className="flex items-center gap-2">
                <MessagesSquare className="h-4 w-4 text-primary" />
                Navigation
              </SheetTitle>
            </SheetHeader>
            {sidebarContent}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};
