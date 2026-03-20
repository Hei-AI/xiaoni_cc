import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  eyebrow?: string;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  badge,
  eyebrow,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <span className="status-dot bg-primary" />
            <span>{eyebrow}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          {icon && (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/70 text-primary">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[1.9rem] font-semibold text-foreground">{title}</h1>
              {badge ?? null}
            </div>
            {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
          </div>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>}
    </div>
  );
}

export function PageHeaderBadge({ children }: { children: React.ReactNode }) {
  return <Badge variant="outline">{children}</Badge>;
}
