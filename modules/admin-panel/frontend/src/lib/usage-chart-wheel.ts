export interface UsageChartWheelWindowInput {
  isActive: boolean;
  deltaY: number;
  pointerRatio: number;
  domainEndMs: number;
  fullStartMs: number;
  fullEndMs: number;
  visibleStartMs: number;
  visibleEndMs: number;
}

export interface UsageChartWheelWindow {
  startMs: number;
  endMs: number;
  endIsNow: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function calculateUsageChartWheelWindow(input: UsageChartWheelWindowInput): UsageChartWheelWindow | null {
  if (!input.isActive || input.fullEndMs <= input.fullStartMs) {
    return null;
  }

  const ratio = clamp(input.pointerRatio, 0, 1);
  const currentDuration = Math.max(60_000, input.visibleEndMs - input.visibleStartMs);
  const factor = input.deltaY < 0 ? 0.72 : 1.28;
  const maxDuration = Math.max(60_000, input.fullEndMs - input.fullStartMs);
  const nextDuration = clamp(currentDuration * factor, 60_000, maxDuration);
  const anchorMs = input.visibleStartMs + currentDuration * ratio;
  let nextStart = anchorMs - nextDuration * ratio;
  let nextEnd = nextStart + nextDuration;

  if (nextStart < input.fullStartMs) {
    nextStart = input.fullStartMs;
    nextEnd = nextStart + nextDuration;
  }
  if (nextEnd > input.fullEndMs) {
    nextEnd = input.fullEndMs;
    nextStart = nextEnd - nextDuration;
  }

  return {
    startMs: nextStart,
    endMs: nextEnd,
    endIsNow: nextEnd >= input.domainEndMs - 1000,
  };
}
