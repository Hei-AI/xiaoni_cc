import * as React from 'react';
import { Move, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type FloatingWorkspaceResizeMode = 'move' | 'right' | 'bottom' | 'corner';

export interface FloatingWorkspacePanelState {
  collapsed: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FloatingWorkspacePanelProps {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  onClose: () => void;
  onDragPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (mode: Exclude<FloatingWorkspaceResizeMode, 'move'>) => (event: React.PointerEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function FloatingWorkspacePanel({
  title,
  x,
  y,
  width,
  height,
  onClose,
  onDragPointerDown,
  onResizePointerDown,
  children,
  className,
  bodyClassName,
}: FloatingWorkspacePanelProps) {
  return (
    <div
      className={cn(
        'absolute z-20 hidden overflow-hidden rounded-[24px] border border-border bg-background/95 shadow-[0_30px_80px_-35px_rgba(15,23,42,0.45)] backdrop-blur lg:flex lg:flex-col',
        className
      )}
      style={{ left: x, top: y, width, height }}
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-border/80 bg-background/90 px-4 py-3"
        onPointerDown={onDragPointerDown}
      >
        <div className="flex items-center gap-2">
          <Move className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-sm font-semibold text-foreground">{title}</div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-hidden p-4', bodyClassName)}>
        {children}
      </div>

      <button
        type="button"
        aria-label={`${title} 水平拉伸`}
        className="absolute bottom-4 right-0 top-14 w-3 cursor-col-resize bg-transparent"
        onPointerDown={onResizePointerDown('right')}
      />
      <button
        type="button"
        aria-label={`${title} 垂直拉伸`}
        className="absolute bottom-0 left-4 right-4 h-3 cursor-row-resize bg-transparent"
        onPointerDown={onResizePointerDown('bottom')}
      />
      <button
        type="button"
        aria-label={`${title} 双向拉伸`}
        className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize bg-transparent"
        onPointerDown={onResizePointerDown('corner')}
      >
        <span className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-sm border-b-2 border-r-2 border-border/70" />
      </button>
    </div>
  );
}
