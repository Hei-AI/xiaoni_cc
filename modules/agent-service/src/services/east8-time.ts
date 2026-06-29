const EAST8_OFFSET_MS = 8 * 60 * 60 * 1000;

function padTwoDigits(value: number) {
  return String(value).padStart(2, '0');
}

// Shared sink for every timestamp that enters Xiaoni's context. Renders a
// concrete instant (tool completion, message received, wake moment, time
// broadcast) in East-8 with one fixed format ("YYYY-MM-DD HH:MM:SS"), so her
// whole context speaks a single timezone — no UTC/East-8 split.
//
// This is NOT the removed synthetic "current time" system-prompt stamp. Callers
// pass a concrete event Date; never wire this into the cached system-prompt
// prefix (that is what broke the prompt cache and was deliberately deleted).
export function formatEast8Timestamp(now: Date = new Date()) {
  const timestamp = now instanceof Date ? now.getTime() : Number.NaN;
  const date = new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) + EAST8_OFFSET_MS);
  return [
    `${date.getUTCFullYear()}-${padTwoDigits(date.getUTCMonth() + 1)}-${padTwoDigits(date.getUTCDate())}`,
    `${padTwoDigits(date.getUTCHours())}:${padTwoDigits(date.getUTCMinutes())}:${padTwoDigits(date.getUTCSeconds())}`
  ].join(' ');
}
