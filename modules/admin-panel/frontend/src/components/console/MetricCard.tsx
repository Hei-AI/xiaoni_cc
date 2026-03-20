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
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
            <div className="mt-3 text-2xl font-semibold text-foreground sm:text-3xl">{value}</div>
            {detail && <div className="mt-2 text-sm text-muted-foreground">{detail}</div>}
          </div>
          {icon && (
            <div className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white/6', toneClasses[tone])}>
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
