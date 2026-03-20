import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  className?: string;
}

const toneClasses: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'text-primary',
  success: 'text-[hsl(var(--success))]',
  warning: 'text-[hsl(var(--warning))]',
  danger: 'text-destructive',
};

export function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = 'default',
  className,
}: MetricCardProps) {
  return (
    <Card className={cn('surface-grid overflow-hidden', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            <div className="mt-2 text-[2rem] font-semibold leading-none text-foreground">{value}</div>
            {detail && <div className="mt-2 text-sm leading-5 text-muted-foreground">{detail}</div>}
          </div>
          {icon && (
            <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border/90 bg-card/90', toneClasses[tone])}>
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
