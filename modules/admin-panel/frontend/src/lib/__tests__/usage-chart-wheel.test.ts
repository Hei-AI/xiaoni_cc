import { calculateUsageChartWheelWindow } from '@/lib/usage-chart-wheel';

const baseInput = {
  isActive: true,
  deltaY: -100,
  pointerRatio: 0.5,
  domainEndMs: 1_000_000,
  fullStartMs: 0,
  fullEndMs: 1_000_000,
  visibleStartMs: 200_000,
  visibleEndMs: 800_000,
};

describe('calculateUsageChartWheelWindow', () => {
  it('ignores wheel gestures until the chart is explicitly activated', () => {
    expect(calculateUsageChartWheelWindow({ ...baseInput, isActive: false })).toBeNull();
  });

  it('zooms around the pointer after activation', () => {
    expect(calculateUsageChartWheelWindow(baseInput)).toEqual({
      startMs: 284_000,
      endMs: 716_000,
      endIsNow: false,
    });
  });

  it('clamps zoom-out gestures to the full data bounds', () => {
    expect(calculateUsageChartWheelWindow({
      ...baseInput,
      deltaY: 100,
      pointerRatio: 0.95,
      visibleStartMs: 0,
      visibleEndMs: 900_000,
    })).toEqual({
      startMs: 0,
      endMs: 1_000_000,
      endIsNow: true,
    });
  });
});
