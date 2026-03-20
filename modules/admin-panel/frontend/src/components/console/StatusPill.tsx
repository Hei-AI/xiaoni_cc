import React from 'react';
import { cn } from '@/lib/utils';

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface StatusPillProps {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}

const toneMap: Record<StatusTone, string> = {
  neutral: 'border-white/10 bg-white/6 text-foreground',
  success: 'border-[hsl(var(--success))]/20 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]',
  warning: 'border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]',
  danger: 'border-destructive/20 bg-destructive/10 text-destructive',
  info: 'border-primary/20 bg-primary/10 text-primary',
};

export function StatusPill({ tone = 'neutral', children, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
        toneMap[tone],
        className
      )}
    >
      <span className={cn('status-dot h-2 w-2', tone === 'success' && 'bg-[hsl(var(--success))]', tone === 'warning' && 'bg-[hsl(var(--warning))]', tone === 'danger' && 'bg-destructive', tone === 'info' && 'bg-primary', tone === 'neutral' && 'bg-white/50')} />
      {children}
    </span>
  );
}
