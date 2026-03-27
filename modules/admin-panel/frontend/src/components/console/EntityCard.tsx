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
  onClick?: () => void;
}

export function EntityCard({
  title,
  subtitle,
  badges,
  meta,
  action,
  children,
  className,
  onClick,
}: EntityCardProps) {
  const interactiveProps = onClick
    ? {
        onClick,
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
          }
        },
        role: 'button' as const,
        tabIndex: 0,
      }
    : {};

  return (
    <Card
      className={cn(
        'overflow-hidden',
        onClick ? 'cursor-pointer transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25' : undefined,
        className
      )}
      {...interactiveProps}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground sm:text-base">{title}</div>
            {subtitle && <div className="mt-1 text-sm leading-6 text-muted-foreground">{subtitle}</div>}
          </div>
          {action}
        </div>
        {badges && <div className="mt-3 flex flex-wrap gap-2">{badges}</div>}
        {children && <div className="mt-4 space-y-3">{children}</div>}
        {meta && <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground"><div className="flex flex-wrap items-center gap-x-4 gap-y-2">{meta}</div></div>}
      </CardContent>
    </Card>
  );
}
