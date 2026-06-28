// Inbound liveness evaluation.
//
// NapCat can report `online:true` (login heartbeat alive, WebUI green, docker
// healthcheck `pgrep QQ` passing) while its actual message-receive pipe is dead
// — events stop reaching provider's /webhook. On 2026-06-28 this stayed silent
// ~1.5h (agent_inbound_messages stalled at 19:29) before anyone noticed, because
// no existing health signal tests whether messages actually flow.
//
// This module derives an inbound-liveness verdict from "how long since NapCat
// last delivered ANY event to /webhook" plus the get_status online flag. It is
// surfaced through provider /health -> admin /runtime/status -> the dashboard
// health check. It deliberately does NOT push anything over QQ (a DM would be
// sent from Xiaoni's own account and pollute her conversation context), and it
// is strictly upstream of and never touches the agent runtime enable toggle.

export type NapcatLivenessProbe = {
  // false when provider could not reach NapCat's HTTP API at all.
  reachable: boolean;
  // get_status `online`; null when unknown / probe failed.
  online: boolean | null;
};

export type InboundLivenessState =
  | 'healthy'
  | 'unknown'             // no baseline yet (just booted, nothing seen)
  | 'inbound_dead'        // online:true but no events for staleMs — the "green but dead" case
  | 'napcat_offline'      // QQ account logged out
  | 'napcat_unreachable'; // provider can't reach NapCat HTTP API

export type InboundLivenessSummary = {
  state: InboundLivenessState;
  healthy: boolean;
  reachable: boolean;
  online: boolean | null;
  lastEventAt: number | null;
  staleForMs: number | null;
  staleMs: number;
  detail: string;
};

export type InboundLivenessInput = {
  probe: NapcatLivenessProbe;
  // epoch ms of the last event NapCat pushed to /webhook (any post_type). null
  // when there is no baseline yet — reported as 'unknown', never as dead.
  lastEventAt: number | null;
  now: number;
  staleMs: number;
};

function describe(state: InboundLivenessState, staleForMs: number | null): string {
  const mins = staleForMs === null ? null : Math.round(staleForMs / 60000);
  switch (state) {
    case 'napcat_offline':
      return 'NapCat 报 QQ 账号离线,收不到任何 QQ 消息。检查 NapCat 登录态(docker logs napcat / WebUI 6099)。';
    case 'napcat_unreachable':
      return 'provider 连不上 NapCat HTTP API,且已无入站消息。检查 napcat 容器是否存活。';
    case 'inbound_dead':
      return `NapCat 显示在线但已 ${mins} 分钟没收到任何 QQ 消息,接收管道疑似挂了(绿但死)。修复:docker restart napcat。`;
    case 'unknown':
      return '尚无入站基线(provider 刚启动或还没收到任何事件)。';
    default:
      return '入站正常,NapCat 在持续投递事件。';
  }
}

// Pure verdict — no I/O, fully unit-testable.
export function evaluateInboundLiveness(input: InboundLivenessInput): InboundLivenessSummary {
  const { probe, lastEventAt, now, staleMs } = input;
  const staleForMs = lastEventAt === null ? null : Math.max(0, now - lastEventAt);
  const stale = staleForMs !== null && staleForMs > staleMs;

  let state: InboundLivenessState;
  if (!probe.reachable) {
    // Can't reach NapCat's API. Only a problem once inbound has also gone stale,
    // so transient API blips don't flip the dashboard red.
    state = stale ? 'napcat_unreachable' : (lastEventAt === null ? 'unknown' : 'healthy');
  } else if (probe.online === false) {
    // QQ account logged out — inbound is dead regardless of traffic.
    state = 'napcat_offline';
  } else if (lastEventAt === null) {
    state = 'unknown';
  } else if (probe.online === true && stale) {
    // online but no events for staleMs => "green but dead".
    state = 'inbound_dead';
  } else {
    state = 'healthy';
  }

  return {
    state,
    healthy: state === 'healthy' || state === 'unknown',
    reachable: probe.reachable,
    online: probe.online,
    lastEventAt,
    staleForMs,
    staleMs,
    detail: describe(state, staleForMs)
  };
}
