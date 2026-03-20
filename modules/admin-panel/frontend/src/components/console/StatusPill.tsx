import React from 'react';
import { cn } from '@/lib/utils';

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface StatusPillProps {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}

const toneMap: Record<StatusTone, string> = {
  neutral: 'border-border bg-muted/60 text-foreground',
  success: 'border-[hsl(var(--success))]/15 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]',
  warning: 'border-[hsl(var(--warning))]/15 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]',
  danger: 'border-destructive/15 bg-destructive/10 text-destructive',
  info: 'border-[hsl(var(--info))]/15 bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
};

export function StatusPill({ tone = 'neutral', children, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
        toneMap[tone],
        className
      )}
    >
      <span className={cn('status-dot h-2 w-2', tone === 'success' && 'bg-[hsl(var(--success))]', tone === 'warning' && 'bg-[hsl(var(--warning))]', tone === 'danger' && 'bg-destructive', tone === 'info' && 'bg-[hsl(var(--info))]', tone === 'neutral' && 'bg-slate-400')} />
      {children}
    </span>
  );
}
