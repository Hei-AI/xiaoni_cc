import {
  coerceActionStreamRefresh,
  DEFAULT_ACTION_STREAM_REFRESH,
  getActionStreamRefreshInterval,
} from '../xiaoni-action-stream-refresh';

describe('Xiaoni action stream refresh helpers', () => {
  it('defaults missing or invalid URL values to 10s', () => {
    expect(coerceActionStreamRefresh(null)).toBe(DEFAULT_ACTION_STREAM_REFRESH);
    expect(coerceActionStreamRefresh('')).toBe(DEFAULT_ACTION_STREAM_REFRESH);
    expect(coerceActionStreamRefresh('2s')).toBe(DEFAULT_ACTION_STREAM_REFRESH);
  });

  it('supports disabling automatic refresh', () => {
    expect(coerceActionStreamRefresh('off')).toBe('off');
    expect(getActionStreamRefreshInterval('off')).toBe(false);
  });

  it('maps supported refresh steps to milliseconds', () => {
    expect(getActionStreamRefreshInterval('5s')).toBe(5_000);
    expect(getActionStreamRefreshInterval('10s')).toBe(10_000);
    expect(getActionStreamRefreshInterval('30s')).toBe(30_000);
    expect(getActionStreamRefreshInterval('1m')).toBe(60_000);
  });
});
