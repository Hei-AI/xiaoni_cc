import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface SectionPanelProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SectionPanel({
  title,
  description,
  icon,
  action,
  children,
  className,
  contentClassName,
}: SectionPanelProps) {
  return (
    <Card className={className}>
      <CardHeader className="gap-2 !px-4 !py-3 sm:!px-5 sm:!py-3.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-[15px] sm:text-base">
              {icon}
              <span>{title}</span>
            </CardTitle>
            {description && <CardDescription className="mt-1 text-[13px] leading-5">{description}</CardDescription>}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className={cn('pt-4', contentClassName)}>{children}</CardContent>
    </Card>
  );
}
