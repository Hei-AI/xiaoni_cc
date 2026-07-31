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

// 一段睡眠,直接来自 agent_recovery_sessions(管理端 /agent-runtime/recovery-sessions 同一
// 条路):睡着和醒来都是记下来的真值,不用反推。
export type SleepSegment = {
  sleptAt: string;
  wokeAt: string;
  wakeCause?: string | null;
};

// 时钟格式(不带日期),给同一天内的区间用:「22:45 睡到 00:15」。跨天的那条由调用方
// 用完整戳补日期,避免她把「00:15」读成前一天。
function formatEast8Clock(ms: number) {
  return formatEast8Timestamp(new Date(ms)).slice(11);
}

function east8DayKey(ms: number) {
  return formatEast8Timestamp(new Date(ms)).slice(0, 10);
}

// 段边界锚:告诉她手里这份 <xiaoni_status> 到底覆盖哪一段时间。
//
// 她压缩完 89 秒说过「记忆整理之后我已经分不清哪些是这一轮的哪些是上一轮的了」
// (2026-07-28 10:10:36 exec 注释)。那是**段边界**不清,不是够不到更早的段:请求头里
// <xiaoni_diary_index> 已经按天往回铺 4-7 天,但压缩每天跑 2-3 次,同一天内的段边界
// 在头里没有任何标记。这一行就是那个标记。
//
// 和本文件其它函数不同,这一条**允许进 cacheable 前缀**,因为它不含 now:两个时刻都是
// agent_stack_items 的落库时刻(append-only,写完就不再变),在压缩提交那一帧算一次、
// 冻结进 context_summary,之后每次 build 只是把那一列原样渲染。绝不可改成每次 build
// 重算 —— 那就变回 runtime reminder 的双戳漂移事故形态了。
//
// 两头读不到就返回 '',调用方原样提交她写的近况(压缩在关键路径上,绝不因为一行锚点失败)。
export function renderCompressionSpanAnchor(input: {
  windowStartedAt: string | null;
  windowEndedAt: string | null;
}): string {
  const startMs = input.windowStartedAt ? new Date(input.windowStartedAt).getTime() : Number.NaN;
  const endMs = input.windowEndedAt ? new Date(input.windowEndedAt).getTime() : Number.NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return '';
  }
  // 同一天只写一次日期,跨天两头都带日期 —— 否则「01:12 → 10:09」会被读成同一天。
  const end = east8DayKey(endMs) === east8DayKey(startMs)
    ? formatEast8Clock(endMs).slice(0, 5)
    : formatEast8Timestamp(new Date(endMs)).slice(0, 16);
  return `（这一份近况覆盖 ${formatEast8Timestamp(new Date(startMs)).slice(0, 16)} 到 ${end}，`
    + `${formatEast8Duration(startMs, endMs)}。再往前的事在下面的日记目录里。）`;
}

// 她写近况时手边的完整时间线,取代原来那句「别自己推算,这段里看不出来」的禁令。
//
// 禁令的前提是「中间睡过几觉,上下文里看不出来」——那是引擎不给,不是事实上取不到:
// agent_life_events 的 sleep_period 每条都记着醒来时刻和真实睡了多久。把这段直接摆到
// 她眼前,她就不用推算,也不用被禁止推算;她照着念就是对的。
//
// 只讲事实,不下判断(不说「你该睡了」)——那是精力引擎的事,这里只负责让时间对得上。
// 同 renderWakeAnchorSentence:具体时刻,只进尾部项,绝不进 cacheable 前缀。
export function renderSleepTimelineBlock(input: {
  windowStartedAt: string | null;
  sleeps: SleepSegment[];
  lastWakeAt: string | null;
  now: Date;
  maxSegments?: number;
}): string {
  const nowMs = input.now.getTime();
  const windowStartMs = input.windowStartedAt ? new Date(input.windowStartedAt).getTime() : Number.NaN;
  const hasWindow = Number.isFinite(windowStartMs);
  const segments = input.sleeps
    .map((sleep) => {
      const sleptMs = new Date(sleep.sleptAt).getTime();
      const wokeMs = new Date(sleep.wokeAt).getTime();
      if (!Number.isFinite(sleptMs) || !Number.isFinite(wokeMs) || wokeMs < sleptMs) {
        return null;
      }
      return { sleptMs, wokeMs };
    })
    .filter((segment): segment is { sleptMs: number; wokeMs: number } => segment !== null)
    .sort((a, b) => a.wokeMs - b.wokeMs);

  // 窗口起点取不到(cutoff 为空/查库失败)就退回单句锚点 —— 半截的窗口描述比没有更糟。
  if (!hasWindow) {
    return renderWakeAnchorSentence(input.lastWakeAt, input.now);
  }

  const head = `这段上下文覆盖的是 ${formatEast8Timestamp(new Date(windowStartMs))} 到现在。`;
  if (segments.length === 0) {
    const tail = renderWakeAnchorSentence(input.lastWakeAt, input.now);
    return `${head}这中间你一觉没睡。${tail ? ` ${tail}` : ''}`.trimEnd();
  }

  // 上限只为挡住极长窗口把提醒撑肥;截掉的条数明说,不静默吞。
  const maxSegments = Math.max(1, input.maxSegments ?? 12);
  const dropped = Math.max(0, segments.length - maxSegments);
  const shown = dropped > 0 ? segments.slice(-maxSegments) : segments;

  const lines = shown.map((segment) => {
    const sleptText = formatEast8Timestamp(new Date(segment.sleptMs));
    // 同一天的醒来只写时钟,跨天写完整戳 —— 免得她把「00:15」读成前一天。
    const sameDay = east8DayKey(segment.sleptMs) === east8DayKey(segment.wokeMs);
    const wokeText = sameDay
      ? formatEast8Clock(segment.wokeMs)
      : formatEast8Timestamp(new Date(segment.wokeMs));
    return `- ${sleptText} 睡到 ${wokeText}（${formatEast8Duration(segment.sleptMs, segment.wokeMs)}）`;
  });

  const countText = dropped > 0
    ? `这中间你睡过 ${segments.length} 觉，最近 ${shown.length} 觉是：`
    : `这中间你睡过 ${segments.length} 觉：`;
  const lastWokeMs = shown[shown.length - 1]!.wokeMs;
  const awakeMs = input.lastWakeAt ? new Date(input.lastWakeAt).getTime() : lastWokeMs;
  const awakeFromMs = Number.isFinite(awakeMs) ? Math.max(awakeMs, lastWokeMs) : lastWokeMs;
  const tail = `最后一次醒来到现在，你连续醒着 ${formatEast8Duration(awakeFromMs, nowMs)}。`;
  return [`${head}${countText}`, ...lines, tail].join('\n');
}
