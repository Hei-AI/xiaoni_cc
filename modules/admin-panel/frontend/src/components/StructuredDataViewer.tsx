import React from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface StructuredDataViewerProps {
  value: unknown;
  title?: string;
  emptyLabel?: string;
  className?: string;
  heightClassName?: string;
  notice?: React.ReactNode;
}

function formatStructuredData(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function StructuredDataViewer({
  value,
  title,
  emptyLabel = 'No data captured',
  className,
  heightClassName = 'h-[30rem]',
  notice,
}: StructuredDataViewerProps) {
  const [copied, setCopied] = React.useState(false);
  const formattedValue = React.useMemo(() => formatStructuredData(value), [value]);
  const hasContent = formattedValue.trim().length > 0;

  React.useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const handleCopy = async () => {
    if (!hasContent || !navigator?.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(formattedValue);
    setCopied(true);
  };

  return (
    <div className={cn('rounded-2xl border border-border bg-slate-950/95', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          {title ? <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">{title}</div> : null}
          <div className="mt-1 text-xs text-slate-400">
            {hasContent ? '格式化展示，滚动查看完整内容。' : emptyLabel}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          disabled={!hasContent}
          className="shrink-0 border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white"
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          {copied ? '已复制' : '复制'}
        </Button>
      </div>

      {notice ? <div className="border-b border-slate-800 bg-slate-900/80 px-4 py-3 text-xs text-slate-300">{notice}</div> : null}

      {hasContent ? (
        <ScrollArea className={cn('w-full', heightClassName)}>
          <div className="min-w-full w-fit">
            <pre className="min-h-full min-w-max px-4 py-4 font-mono text-xs leading-6 text-slate-100 whitespace-pre">
              {formattedValue}
            </pre>
          </div>
        </ScrollArea>
      ) : (
        <div className={cn('flex items-center justify-center px-4 py-6 text-sm text-slate-400', heightClassName)}>{emptyLabel}</div>
      )}
    </div>
  );
}
