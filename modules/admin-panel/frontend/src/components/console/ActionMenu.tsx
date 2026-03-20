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
      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground">
        <MoreHorizontal className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 top-10 z-30 min-w-[160px] rounded-lg border border-border bg-popover p-1 shadow-[0_14px_36px_-24px_rgba(15,23,42,0.3)]">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={cn(
              'block w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-muted',
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
