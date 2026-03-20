import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
}

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}
