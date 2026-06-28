import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInboundLiveness, type NapcatLivenessProbe } from '../inbound-liveness';

const MIN = 60_000;
const STALE = 15 * MIN;
const NOW = 1_000_000_000;

function ev(over: Partial<Parameters<typeof evaluateInboundLiveness>[0]> = {}) {
  return evaluateInboundLiveness({
    probe: { reachable: true, online: true } as NapcatLivenessProbe,
    lastEventAt: NOW - MIN,
    now: NOW,
    staleMs: STALE,
    ...over
  });
}

test('healthy when online and events flowing', () => {
  const s = ev();
  assert.equal(s.state, 'healthy');
  assert.equal(s.healthy, true);
  assert.equal(s.staleForMs, MIN);
});

test('inbound_dead: online but stale (green but dead)', () => {
  const s = ev({ lastEventAt: NOW - (STALE + MIN) });
  assert.equal(s.state, 'inbound_dead');
  assert.equal(s.healthy, false);
  assert.match(s.detail, /docker restart napcat/);
});

test('napcat_offline when account logged out', () => {
  const s = ev({ probe: { reachable: true, online: false } });
  assert.equal(s.state, 'napcat_offline');
  assert.equal(s.healthy, false);
});

test('napcat_unreachable only once also stale; transient blip stays healthy', () => {
  assert.equal(ev({ probe: { reachable: false, online: null } }).state, 'healthy');
  const dead = ev({ probe: { reachable: false, online: null }, lastEventAt: NOW - (STALE + MIN) });
  assert.equal(dead.state, 'napcat_unreachable');
  assert.equal(dead.healthy, false);
});

test('unknown (no baseline) is treated healthy, never dead', () => {
  const s = ev({ lastEventAt: null });
  assert.equal(s.state, 'unknown');
  assert.equal(s.healthy, true);
  assert.equal(s.staleForMs, null);
});

test('online unknown but reachable + stale is not flagged dead (needs online===true)', () => {
  const s = ev({ probe: { reachable: true, online: null }, lastEventAt: NOW - (STALE + MIN) });
  assert.equal(s.state, 'healthy');
});

test('exactly at threshold is not yet stale', () => {
  const s = ev({ lastEventAt: NOW - STALE });
  assert.equal(s.state, 'healthy');
});
