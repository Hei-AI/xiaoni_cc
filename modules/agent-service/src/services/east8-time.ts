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

// Human-readable gap between two concrete instants ("3 小时 12 分钟" / "47 分钟").
// Companion to formatEast8Timestamp: wherever we hand her a wake anchor we also
// hand her the distance to it, so she never has to subtract two timestamps in
// her head — that arithmetic is exactly what she gets wrong.
//
// Same rule as the timestamp sink: concrete instants only, tail items only.
// Never render this into the cached prefix.
export function formatEast8Duration(fromMs: number, toMs: number) {
  const totalMinutes = Math.max(0, Math.round((toMs - fromMs) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes} 分钟`;
  }
  if (minutes === 0) {
    return `${hours} 小时`;
  }
  return `${hours} 小时 ${minutes} 分钟`;
}

// The one sentence that tells her when she last woke and how far that is from now.
// Every surface that hands her a wake anchor renders it through here, so the wording
// can never drift between surfaces — she would then hear two different accounts of
// the same fact and have to reconcile them, which is the whole failure this exists to
// prevent. Returns '' when no wake has been recorded yet; callers drop the empty line.
//
// Same rule as the two functions above: concrete instants, tail items only. Never
// render this into the cached prefix.
export function renderWakeAnchorSentence(lastWakeAt: string | null, now: Date): string {
  const lastWakeMs = lastWakeAt ? new Date(lastWakeAt).getTime() : Number.NaN;
  if (!Number.isFinite(lastWakeMs)) {
    return '';
  }
  return `你上一次睡醒是 ${formatEast8Timestamp(new Date(lastWakeMs))}，`
    + `到现在过去了 ${formatEast8Duration(lastWakeMs, now.getTime())}。`;
}
