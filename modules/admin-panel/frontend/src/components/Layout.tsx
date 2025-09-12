import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { 
  LayoutDashboard, 
  MessageCircle, 
  Settings, 
  Activity,
  Bot
} from 'lucide-react';
import { cn } from '../lib/utils';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  
  const navigationItems = [
    {
      href: '/dashboard',
      label: '仪表盘',
      icon: LayoutDashboard,
      active: location.pathname === '/dashboard'
    },
    {
      href: '/conversations',
      label: '对话管理', 
      icon: MessageCircle,
      active: location.pathname.startsWith('/conversation')
    },
    {
      href: '/monitoring',
      label: '监控',
      icon: Activity,
      active: location.pathname === '/monitoring'
    },
    {
      href: '/settings',
      label: '设置',
      icon: Settings,
      active: location.pathname === '/settings'
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-semibold">QQ Bot 管理后台</h1>
            </div>
            <div className="text-sm text-muted-foreground">
              Admin Panel v1.0.0
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 flex gap-6">
        {/* Sidebar Navigation */}
        <aside className="w-64 space-y-2">
          <Card>
            <CardContent className="p-3">
              <nav className="space-y-1">
                {navigationItems.map((item) => (
                  <Link key={item.href} to={item.href}>
                    <Button
                      variant={item.active ? 'default' : 'ghost'}
                      className={cn(
                        'w-full justify-start gap-2',
                        item.active && 'bg-primary text-primary-foreground'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Button>
                  </Link>
                ))}
              </nav>
            </CardContent>
          </Card>
        </aside>

        {/* Main Content */}
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
};