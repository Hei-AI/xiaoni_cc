import * as React from 'react';
import { cn } from '@/lib/utils';

type SplitDirection = 'horizontal' | 'vertical';

interface ResizableSplitProps {
  direction: SplitDirection;
  first: React.ReactNode;
  second: React.ReactNode;
  defaultSize?: number;
  minFirstSize?: number;
  minSecondSize?: number;
  maxFirstSize?: number;
  maxSecondSize?: number;
  disabled?: boolean;
  className?: string;
  firstClassName?: string;
  secondClassName?: string;
  handleClassName?: string;
  handleLabel?: string;
}

const HANDLE_SIZE = 12;
const KEYBOARD_STEP = 2;

function clampSizePercentage(
  percentage: number,
  containerSize: number,
  minFirstSize: number,
  minSecondSize: number,
  maxFirstSize?: number,
  maxSecondSize?: number
) {
  if (!Number.isFinite(containerSize) || containerSize <= 0) {
    return percentage;
  }

  const lowerBound = Math.max(
    0,
    minFirstSize,
    typeof maxSecondSize === 'number' ? containerSize - maxSecondSize : 0
  );
  const upperBound = Math.min(
    containerSize,
    typeof maxFirstSize === 'number' ? maxFirstSize : containerSize,
    containerSize - minSecondSize
  );

  if (upperBound <= lowerBound) {
    return (Math.max(0, Math.min(containerSize, lowerBound)) / containerSize) * 100;
  }

  const requestedPixels = (percentage / 100) * containerSize;
  const clampedPixels = Math.min(upperBound, Math.max(lowerBound, requestedPixels));
  return (clampedPixels / containerSize) * 100;
}

export function ResizableSplit({
  direction,
  first,
  second,
  defaultSize = 50,
  minFirstSize = 240,
  minSecondSize = 240,
  maxFirstSize,
  maxSecondSize,
  disabled = false,
  className,
  firstClassName,
  secondClassName,
  handleClassName,
  handleLabel = direction === 'horizontal' ? '调整左右面板宽度' : '调整上下面板高度',
}: ResizableSplitProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<{
    startPosition: number;
    startSize: number;
  } | null>(null);
  const [firstSize, setFirstSize] = React.useState(defaultSize);
  const [isDragging, setIsDragging] = React.useState(false);

  const isHorizontal = direction === 'horizontal';

  const clampAgainstContainer = React.useCallback((nextSize: number) => {
    const container = containerRef.current;
    if (!container) {
      return nextSize;
    }

    const rect = container.getBoundingClientRect();
    const containerSize = isHorizontal ? rect.width : rect.height;
    return clampSizePercentage(
      nextSize,
      containerSize,
      minFirstSize,
      minSecondSize,
      maxFirstSize,
      maxSecondSize
    );
  }, [isHorizontal, maxFirstSize, maxSecondSize, minFirstSize, minSecondSize]);

  React.useEffect(() => {
    setFirstSize((current) => clampAgainstContainer(current));
  }, [clampAgainstContainer]);

  React.useEffect(() => {
    if (disabled || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      setFirstSize((current) => clampAgainstContainer(current));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [clampAgainstContainer, disabled]);

  React.useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    document.body.dataset.resizeActive = direction;
    return () => {
      delete document.body.dataset.resizeActive;
    };
  }, [direction, isDragging]);

  React.useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    const updateSize = (position: number) => {
      const container = containerRef.current;
      const dragState = dragStateRef.current;
      if (!container || !dragState) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const containerSize = isHorizontal ? rect.width : rect.height;
      if (containerSize <= 0) {
        return;
      }

      const delta = position - dragState.startPosition;
      const nextPixels = ((dragState.startSize / 100) * containerSize) + delta;
      const nextPercentage = (nextPixels / containerSize) * 100;
      setFirstSize(clampSizePercentage(
        nextPercentage,
        containerSize,
        minFirstSize,
        minSecondSize,
        maxFirstSize,
        maxSecondSize
      ));
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateSize(isHorizontal ? event.clientX : event.clientY);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [direction, isDragging, isHorizontal, maxFirstSize, maxSecondSize, minFirstSize, minSecondSize]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }

    event.preventDefault();
    const pointerPosition = isHorizontal ? event.clientX : event.clientY;
    dragStateRef.current = {
      startPosition: pointerPosition,
      startSize: firstSize,
    };
    setIsDragging(true);
  };

  const handleKeyboardResize = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }

    const isDecreaseKey = isHorizontal ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
    const isIncreaseKey = isHorizontal ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
    if (!isDecreaseKey && !isIncreaseKey) {
      return;
    }

    event.preventDefault();
    const delta = isDecreaseKey ? -KEYBOARD_STEP : KEYBOARD_STEP;
    setFirstSize((current) => clampAgainstContainer(current + delta));
  };

  if (disabled) {
    return (
      <div ref={containerRef} className={cn('flex min-h-0 min-w-0 flex-col gap-4', className)}>
        <div className={cn('min-h-0 min-w-0', firstClassName)}>{first}</div>
        <div className={cn('min-h-0 min-w-0', secondClassName)}>{second}</div>
      </div>
    );
  }

  const firstBasis = `calc(${firstSize}% - ${HANDLE_SIZE / 2}px)`;
  const secondBasis = `calc(${100 - firstSize}% - ${HANDLE_SIZE / 2}px)`;
  const firstStyle = { flexBasis: firstBasis };
  const secondStyle = { flexBasis: secondBasis };

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex min-h-0 min-w-0',
        isHorizontal ? 'flex-row' : 'flex-col',
        className
      )}
    >
      <div
        className={cn('min-h-0 min-w-0 shrink-0', firstClassName)}
        style={firstStyle}
      >
        {first}
      </div>

      <button
        type="button"
        aria-label={handleLabel}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyboardResize}
        className={cn(
          'group relative shrink-0 rounded-full bg-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          isHorizontal
            ? 'mx-1 h-auto cursor-col-resize touch-none'
            : 'my-1 w-auto cursor-row-resize touch-none',
          handleClassName
        )}
        style={isHorizontal ? { width: HANDLE_SIZE } : { height: HANDLE_SIZE }}
      >
        <span
          className={cn(
            'pointer-events-none absolute inset-0 rounded-full bg-border/80 transition group-hover:bg-primary/35 group-focus-visible:bg-primary/35',
            isDragging && 'bg-primary/50'
          )}
        />
        <span
          className={cn(
            'pointer-events-none absolute rounded-full bg-background/90 shadow-sm',
            isHorizontal
              ? 'left-1/2 top-1/2 h-16 w-[4px] -translate-x-1/2 -translate-y-1/2'
              : 'left-1/2 top-1/2 h-[4px] w-16 -translate-x-1/2 -translate-y-1/2'
          )}
        />
      </button>

      <div
        className={cn('min-h-0 min-w-0 shrink-0', secondClassName)}
        style={secondStyle}
      >
        {second}
      </div>
    </div>
  );
}
