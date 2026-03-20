import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActionItem {
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}

interface ActionMenuProps {
  items: ActionItem[];
  className?: string;
}

export function ActionMenu({ items, className }: ActionMenuProps) {
  return (
    <details className={cn('relative', className)}>
      <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground">
        <MoreHorizontal className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 top-11 z-30 min-w-[160px] rounded-2xl border border-white/10 bg-popover/95 p-1 shadow-[0_18px_60px_-28px_rgba(2,6,23,0.95)] backdrop-blur-xl">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={cn(
              'block w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/8',
              item.tone === 'danger' ? 'text-destructive' : 'text-foreground'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}
