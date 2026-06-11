import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StructuredDataViewer } from '@/components/StructuredDataViewer';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

type HttpPayloadSectionId = 'headers' | 'body';

interface HttpPayloadAccordionProps {
  headers: unknown;
  body: unknown;
  className?: string;
  headersTitle?: string;
  bodyTitle?: string;
  bodyEmptyLabel?: string;
  headersEmptyLabel?: string;
  bodyHeightClassName?: string;
  headersHeightClassName?: string;
  bodyNotice?: React.ReactNode;
  defaultHeadersOpen?: boolean;
  defaultBodyOpen?: boolean;
}

interface PayloadSectionProps {
  id: HttpPayloadSectionId;
  title: string;
  value: unknown;
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  emptyLabel: string;
  heightClassName: string;
  notice?: React.ReactNode;
}

function PayloadSection({
  id,
  title,
  value,
  open,
  onOpenChange,
  emptyLabel,
  heightClassName,
  notice,
}: PayloadSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-2xl border border-border/70 bg-background/90">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {id === 'body' ? '点击展开格式化后的请求/响应体。' : '点击展开请求/响应头。'}
          </div>
        </div>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/70 px-3 pb-3 pt-3">
        <StructuredDataViewer
          title={title}
          value={value}
          emptyLabel={emptyLabel}
          heightClassName={heightClassName}
          notice={notice}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function HttpPayloadAccordion({
  headers,
  body,
  className,
  headersTitle = 'Headers',
  bodyTitle = 'Body',
  bodyEmptyLabel = '无 Body',
  headersEmptyLabel = '无 Headers',
  bodyHeightClassName = 'h-[20rem]',
  headersHeightClassName = 'h-[16rem]',
  bodyNotice,
  defaultHeadersOpen = false,
  defaultBodyOpen = true,
}: HttpPayloadAccordionProps) {
  const [sectionsOpen, setSectionsOpen] = React.useState<Record<HttpPayloadSectionId, boolean>>({
    headers: defaultHeadersOpen,
    body: defaultBodyOpen,
  });

  const handleSectionToggle = React.useCallback((sectionId: HttpPayloadSectionId, nextOpen: boolean) => {
    setSectionsOpen((current) => ({
      ...current,
      [sectionId]: nextOpen,
    }));
  }, []);

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1', className)}>
      <PayloadSection
        id="headers"
        title={headersTitle}
        value={headers}
        open={sectionsOpen.headers}
        onOpenChange={(nextOpen) => handleSectionToggle('headers', nextOpen)}
        emptyLabel={headersEmptyLabel}
        heightClassName={headersHeightClassName}
      />
      <PayloadSection
        id="body"
        title={bodyTitle}
        value={body}
        open={sectionsOpen.body}
        onOpenChange={(nextOpen) => handleSectionToggle('body', nextOpen)}
        emptyLabel={bodyEmptyLabel}
        heightClassName={bodyHeightClassName}
        notice={bodyNotice}
      />
    </div>
  );
}
