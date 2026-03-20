import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface SelectionBarProps {
  summary: React.ReactNode;
  actions: React.ReactNode;
}

export function SelectionBar({ summary, actions }: SelectionBarProps) {
  return (
    <Card className="border-primary/15 bg-primary/10">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-foreground">{summary}</div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </CardContent>
    </Card>
  );
}
