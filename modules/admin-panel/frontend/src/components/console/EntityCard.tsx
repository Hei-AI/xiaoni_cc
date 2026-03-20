import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface EntityCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function EntityCard({
  title,
  subtitle,
  badges,
  meta,
  action,
  children,
  className,
}: EntityCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-foreground">{title}</div>
            {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
          </div>
          {action}
        </div>
        {badges && <div className="mt-3 flex flex-wrap gap-2">{badges}</div>}
        {children && <div className="mt-4 space-y-3">{children}</div>}
        {meta && <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">{meta}</div>}
      </CardContent>
    </Card>
  );
}
