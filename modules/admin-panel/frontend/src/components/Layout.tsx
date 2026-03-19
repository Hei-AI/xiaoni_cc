import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
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
  FileStack
} from 'lucide-react';
import { cn } from '../lib/utils';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };
  
  const navigationItems = [
    {
      href: '/dashboard',
      label: '仪表盘',
      icon: LayoutDashboard,
      active: location.pathname === '/dashboard'
    },
    {
      href: '/groups',
      label: '群聊管理', 
      icon: Users,
      active: location.pathname === '/groups'
    },
    {
      href: '/private-chats',
      label: '私聊管理', 
      icon: User,
      active: location.pathname.startsWith('/private-chats')
    },
    {
      href: '/prompts',
      label: 'Prompt 管理', 
      icon: FileText,
      active: location.pathname.startsWith('/prompts')
    },
    {
      href: '/queue-management',
      label: '队列管理', 
      icon: ClipboardList,
      active: location.pathname === '/queue-management'
    },
    {
      href: '/conversations',
      label: '对话管理',
      icon: MessageCircle,
      active: location.pathname.startsWith('/conversation')
    },
    {
      href: '/traffic',
      label: 'HTTP流量监控',
      icon: Network,
      active: location.pathname.startsWith('/traffic')
    },
    {
      href: '/traffic/replay/templates',
      label: '回放模板',
      icon: FileStack,
      active: location.pathname.startsWith('/traffic/replay/templates')
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card flex-shrink-0">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSidebar}
                className="p-2"
                title={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <Bot className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-semibold">QQ Bot 管理后台</h1>
            </div>
            <div className="text-sm text-muted-foreground">
              Admin Panel v1.0.0
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex gap-4 px-4 py-4 min-h-0">
        {/* Sidebar Navigation */}
        <aside
          className={cn(
            "transition-all duration-300 ease-in-out space-y-2 flex-shrink-0",
            isCollapsed ? "w-16" : "w-64"
          )}
        >
          <Card>
            <CardContent className="p-3">
              {!isCollapsed && (
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">导航菜单</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleSidebar}
                    className="p-1 h-6 w-6"
                    title="收起侧边栏"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <nav className="space-y-1">
                {navigationItems.map((item) => (
                  <Link key={item.href} to={item.href}>
                    <Button
                      variant={item.active ? 'default' : 'ghost'}
                      className={cn(
                        'w-full transition-all duration-200',
                        isCollapsed ? 'justify-center p-2' : 'justify-start gap-2',
                        item.active && 'bg-primary text-primary-foreground'
                      )}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </Button>
                  </Link>
                ))}
              </nav>
              {isCollapsed && (
                <div className="mt-3 pt-3 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleSidebar}
                    className="w-full p-2"
                    title="展开侧边栏"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
