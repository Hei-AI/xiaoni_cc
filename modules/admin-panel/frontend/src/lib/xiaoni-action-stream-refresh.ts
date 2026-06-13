export type ActionStreamRefreshValue = 'off' | '5s' | '10s' | '30s' | '1m';

export interface ActionStreamRefreshOption {
  value: Exclude<ActionStreamRefreshValue, 'off'>;
  label: string;
  milliseconds: number;
}

export const DEFAULT_ACTION_STREAM_REFRESH: ActionStreamRefreshValue = '10s';

export const ACTION_STREAM_REFRESH_OPTIONS: ActionStreamRefreshOption[] = [
  { value: '5s', label: '5s', milliseconds: 5_000 },
  { value: '10s', label: '10s', milliseconds: 10_000 },
  { value: '30s', label: '30s', milliseconds: 30_000 },
  { value: '1m', label: '1min', milliseconds: 60_000 },
];

export function coerceActionStreamRefresh(value: string | null | undefined): ActionStreamRefreshValue {
  if (value === 'off') {
    return 'off';
  }
  if (ACTION_STREAM_REFRESH_OPTIONS.some((option) => option.value === value)) {
    return value as ActionStreamRefreshValue;
  }
  return DEFAULT_ACTION_STREAM_REFRESH;
}

export function getActionStreamRefreshInterval(value: ActionStreamRefreshValue): number | false {
  if (value === 'off') {
    return false;
  }
  return ACTION_STREAM_REFRESH_OPTIONS.find((option) => option.value === value)?.milliseconds
    || ACTION_STREAM_REFRESH_OPTIONS.find((option) => option.value === DEFAULT_ACTION_STREAM_REFRESH)?.milliseconds
    || 10_000;
}
