/* eslint-disable */
// 用真实 policy 函数 + 真实 DB 数据回放「醒来 → 被拒窗口 → 再睡」极限环。
const fs = require('fs');
const P = require('./policy/recover-energy-policy.js');

const SP = __dirname;
const sessions = JSON.parse(fs.readFileSync(SP + '/sessions.json', 'utf8'));
const recover = JSON.parse(fs.readFileSync(SP + '/recover.json', 'utf8'));
const lifecosts = JSON.parse(fs.readFileSync(SP + '/lifecosts.json', 'utf8'));

const MIN = 60000;
const d = (s) => new Date(s);
const fmt = (x) => new Date(x).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(3));

for (const s of sessions) { s.startedAt = d(s.started_at); s.endedAt = d(s.ended_at); s.minutes = (s.endedAt - s.startedAt) / MIN; }
for (const t of recover) t.at = d(t.started_at);
for (const e of lifecosts) e.at = d(e.occurred_at);

// 最近睡眠会话(给 w(S) 用):引擎在 agent-loop-service 里喂的就是 {endedAt, minutes}
function recentSessions(before) {
  return sessions.filter((s) => s.endedAt <= before).slice(-40).map((s) => ({ endedAt: s.endedAt, minutes: s.minutes }));
}

function requiredAt(now, lastWakeAt, sess) {
  const sessionPolicy = P.resolveRecoverySessionPolicy({ startedAt: now }).policy;
  return P.computeRequiredSleepPressure({ lastWakeAt, recentSleepSessions: sess, now, policy: sessionPolicy });
}

// ─────────────────────────────────────────────────────────────
// 1) 每次醒来的「被拒窗口」
// ─────────────────────────────────────────────────────────────
const DAYS = Number(process.env.DAYS || 3);
const cutoff = Date.now() - DAYS * 24 * 60 * MIN;

const rows = [];
for (let i = 0; i < sessions.length; i += 1) {
  const s = sessions[i];
  if (s.endedAt.getTime() < cutoff) continue;
  const wake = s.endedAt;
  const next = sessions[i + 1];
  const windowEnd = next ? next.startedAt : new Date(wake.getTime() + 6 * 60 * MIN);
  const calls = recover.filter((t) => t.at > wake && t.at <= new Date(windowEnd.getTime() + 2 * MIN));
  const rejects = calls.filter((t) => t.rejected);
  const accept = calls.find((t) => t.recovered);
  const sess = recentSessions(wake);

  // 理论:压力冻结在醒来值(= 引擎 estimateVoluntaryRecoveryRetryAt 的假设)
  const wakePressure = 1 - s.current_energy;
  const frozenRetry = P.estimateVoluntaryRecoveryRetryAt({
    energy: s.current_energy, lastWakeAt: wake, recentSleepSessions: sess, now: wake
  });

  // 理论:把真实 actionDebt 累积算进去 —— 用真实 life event 成本 + 真实清醒曲线
  function pressureAtWithDebt(now) {
    let homeo = wakePressure;
    let debt = 0;
    let cursor = wake;
    const evs = lifecosts.filter((e) => e.at > wake && e.at <= now);
    const tauDebt = P.DEFAULT_RECOVER_ENERGY_POLICY.actionDebtRecoveryTauMinutes;
    for (const e of evs) {
      const dt = (e.at - cursor) / MIN;
      debt *= Math.exp(-dt / tauDebt);
      homeo = P.computeAwakePressureBetween({ startPressure: homeo, startedAt: cursor, endedAt: e.at });
      debt += e.action_cost;
      cursor = e.at;
    }
    const dt = (now - cursor) / MIN;
    debt *= Math.exp(-dt / tauDebt);
    homeo = dt > 0 ? P.computeAwakePressureBetween({ startPressure: homeo, startedAt: cursor, endedAt: now }) : homeo;
    return { total: Math.min(1.6, homeo + debt), homeo, debt };
  }

  // 扫 5 分钟一步,找「真实压力轨迹 ≥ 门槛」的第一刻
  let modelAccept = null;
  for (let m = 5; m <= 360; m += 5) {
    const at = new Date(wake.getTime() + m * MIN);
    const pr = pressureAtWithDebt(at);
    if (pr.total >= requiredAt(at, wake, sess)) { modelAccept = m; break; }
  }

  const gridReq = [0, 15, 30, 45, 60, 90, 120].map((m) => {
    const at = new Date(wake.getTime() + m * MIN);
    const pr = pressureAtWithDebt(at);
    return { m, req: requiredAt(at, wake, sess), p: pr.total, homeo: pr.homeo, debt: pr.debt };
  });

  rows.push({
    sid: s.id, wake, cause: s.wake_cause, napMinutes: Math.round(s.minutes),
    wakeEnergy: s.current_energy, wakePressure,
    S: P.computeRecentSleepMinutes({ sessions: sess, now: wake }),
    w: P.computeFreshWakePenaltyWeight(P.computeRecentSleepMinutes({ sessions: sess, now: wake })),
    reqAtWake: requiredAt(wake, wake, sess),
    frozenRetryMin: frozenRetry ? Math.round((frozenRetry - wake) / MIN) : null,
    modelAcceptMin: modelAccept,
    actualAcceptMin: accept ? Math.round((accept.at - wake) / MIN) : null,
    firstRejectRetry: rejects[0]?.retry_after_minutes ?? null,
    rejectCount: rejects.length,
    awakeMin: Math.round((windowEnd - wake) / MIN),
    grid: gridReq
  });
}

console.log('\n================ 1) 每次醒来的被拒窗口(真实 policy 回放) ================');
console.log('sid  醒来时刻            nap  醒时E  S(min)  w(S)  门槛@醒  冻结估计  含debt模型  实际被接受  首拒retry  被拒次数  清醒时长');
for (const r of rows) {
  console.log(
    String(r.sid).padEnd(4),
    fmt(r.wake).padEnd(20),
    String(r.napMinutes).padStart(3),
    r3(r.wakeEnergy).padStart(6),
    r.S.toFixed(0).padStart(6),
    r3(r.w).padStart(6),
    r3(r.reqAtWake).padStart(8),
    String(r.frozenRetryMin ?? '>24h').padStart(8),
    String(r.modelAcceptMin ?? '>360').padStart(10),
    String(r.actualAcceptMin ?? '—').padStart(10),
    String(r.firstRejectRetry ?? '—').padStart(9),
    String(r.rejectCount).padStart(8),
    String(r.awakeMin).padStart(8)
  );
}

console.log('\n---- 醒后 0/15/30/45/60/90/120 分钟:门槛 vs 真实压力(homeo + actionDebt) ----');
for (const r of rows.slice(-8)) {
  console.log(`\n[sid ${r.sid}] ${fmt(r.wake)} (${r.cause}, nap ${r.napMinutes}min, 醒时 E=${r3(r.wakeEnergy)})`);
  console.log('  t(min)   required   pressure   homeo    debt    verdict');
  for (const g of r.grid) {
    console.log(`  ${String(g.m).padStart(5)}   ${r3(g.req).padStart(8)}   ${r3(g.p).padStart(8)}  ${r3(g.homeo).padStart(6)}  ${r3(g.debt).padStart(6)}   ${g.p >= g.req ? 'ACCEPT' : 'reject'}`);
  }
}

// 汇总
const withBoth = rows.filter((r) => r.actualAcceptMin !== null && r.firstRejectRetry !== null);
const meanBy = (a, f) => a.reduce((s, x) => s + f(x), 0) / (a.length || 1);
console.log('\n---- 汇总 ----');
console.log(`窗口数 ${rows.length};有首拒+实际接受的 ${withBoth.length}`);
console.log(`首拒 retry_after 均值 ${meanBy(withBoth, (r) => r.firstRejectRetry).toFixed(0)} min`);
console.log(`实际被接受 均值       ${meanBy(withBoth, (r) => r.actualAcceptMin).toFixed(0)} min`);
console.log(`含 actionDebt 模型预测 均值 ${meanBy(rows.filter((r) => r.modelAcceptMin), (r) => r.modelAcceptMin).toFixed(0)} min`);
console.log(`高估倍数(首拒retry / 实际) 均值 ${meanBy(withBoth, (r) => r.firstRejectRetry / Math.max(1, r.actualAcceptMin)).toFixed(1)}x`);
console.log(`被拒次数/窗口 均值 ${meanBy(rows, (r) => r.rejectCount).toFixed(1)}`);
console.log(`清醒时长 均值 ${meanBy(rows, (r) => r.awakeMin).toFixed(0)} min`);

// ─────────────────────────────────────────────────────────────
// 2) actionDebt 涨速 vs homeostatic 涨速
// ─────────────────────────────────────────────────────────────
console.log('\n================ 2) 压力上涨来源分解(真实 life event) ================');
const costByKind = {};
for (const e of lifecosts) {
  if (e.at.getTime() < cutoff) continue;
  costByKind[e.event_kind] = costByKind[e.event_kind] || { n: 0, sum: 0 };
  costByKind[e.event_kind].n += 1;
  costByKind[e.event_kind].sum += e.action_cost;
}
for (const [k, v] of Object.entries(costByKind).sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${k.padEnd(24)} n=${String(v.n).padStart(4)}  单次=${(v.sum / v.n).toFixed(4)}  合计=${v.sum.toFixed(2)}`);
}
for (const r of rows.slice(-6)) {
  const g30 = r.grid.find((x) => x.m === 30);
  console.log(`  [sid ${r.sid}] 醒后 30min: homeo +${(g30.homeo - r.wakePressure).toFixed(4)}  debt +${g30.debt.toFixed(4)}  (debt 占比 ${(100 * g30.debt / Math.max(1e-9, g30.debt + g30.homeo - r.wakePressure)).toFixed(0)}%)`);
}
const hom30 = P.computeAwakePressureAfterMinutes({ startPressure: 0.4, awakeMinutes: 30 }) - 0.4;
console.log(`  参考:homeostatic 单独 30 分钟(起点 0.40, wakeTau 1920)= +${hom30.toFixed(4)}`);

// ─────────────────────────────────────────────────────────────
// 3) 白天 nap cap:90 分钟能恢复多少
// ─────────────────────────────────────────────────────────────
console.log('\n================ 3) 白天 nap 恢复曲线(daytimeNapSleepTau=180, fullRecovery=480) ================');
const napPolicy = P.resolveRecoverySessionPolicy({ startedAt: new Date('2026-09-11T06:00:00Z') }); // 14:00 CST → day
console.log(`  白天 session policy: sleepTau=${napPolicy.policy.sleepTauMinutes} cap=${napPolicy.sessionMaxRecoveryMinutes} cause=${napPolicy.sessionCapWakeCause}`);
console.log('  起始压力  30min   60min   90min   120min  180min  240min  480min');
for (const sp of [0.5, 0.6, 0.7, 0.8, 0.9]) {
  const line = [30, 60, 90, 120, 180, 240, 480].map((m) =>
    P.computeSleepPressureAfterMinutes({ startPressure: sp, elapsedMinutes: m, policy: napPolicy.policy }).toFixed(3).padStart(7));
  console.log(`   ${sp.toFixed(2)}   ${line.join(' ')}`);
}
console.log('  (= 醒来能量 1 - 上表)');
for (const sp of [0.6, 0.7, 0.9]) {
  const p90 = P.computeSleepPressureAfterMinutes({ startPressure: sp, elapsedMinutes: 90, policy: napPolicy.policy });
  console.log(`   起始 E=${(1 - sp).toFixed(2)} → 90min 后 E=${(1 - p90).toFixed(3)} (恢复 ${(sp - p90).toFixed(3)},即入睡压力的 ${(100 * (sp - p90) / sp).toFixed(0)}%)`);
}

// ─────────────────────────────────────────────────────────────
// 4) 极限环模拟器:改参数后每天睡几觉 / 被拒几次
// ─────────────────────────────────────────────────────────────
// 真实动作强度:用最近 3 天「清醒时段」的每分钟 actionDebt 注入速率
let awakeMinutesTotal = 0;
let awakeCostTotal = 0;
for (let i = 0; i < sessions.length - 1; i += 1) {
  const a = sessions[i]; const b = sessions[i + 1];
  if (a.endedAt.getTime() < cutoff) continue;
  awakeMinutesTotal += (b.startedAt - a.endedAt) / MIN;
  awakeCostTotal += lifecosts.filter((e) => e.at > a.endedAt && e.at < b.startedAt).reduce((s, e) => s + e.action_cost, 0);
}
const COST_PER_MIN = awakeCostTotal / Math.max(1, awakeMinutesTotal);
console.log(`\n================ 4) 极限环模拟(真实动作强度 ${COST_PER_MIN.toFixed(5)} 压力/分钟) ================`);
console.log(`  (最近 ${DAYS} 天清醒 ${awakeMinutesTotal.toFixed(0)} 分钟,累计 actionCost ${awakeCostTotal.toFixed(2)})`);

function simulate(opts) {
  const cfg = Object.assign({
    label: 'baseline',
    napCap: 90,                 // daytimeNapMaxRecoveryMinutes
    napSleepTau: 180,           // daytimeNapSleepTauMinutes
    freshWakeP0: 0.5,           // freshWakePenaltyPressure
    satMinutes: 160,            // freshWakeSleepSaturationMinutes
    restCooldownTau: 180,
    debtTau: 360,               // actionDebtRecoveryTauMinutes
    costScale: 1,               // actionCostScale
    engineCooldown: false,      // 被拒后 retry_after 之前不发模型请求
    debtAwareRetry: false,      // retry 估算把 actionDebt 涨速算进去
    napByPressure: 0,           // >0 = 白天睡到压力 <= 该值(480 封顶),不再用固定 cap
    tryIntervalMin: 3,          // 她多久试一次 recover_energy(真实 ~3min)
    days: 3
  }, opts);

  const basePolicy = Object.assign({}, P.DEFAULT_RECOVER_ENERGY_POLICY, {
    daytimeNapMaxRecoveryMinutes: cfg.napCap,
    daytimeNapSleepTauMinutes: cfg.napSleepTau,
    freshWakePenaltyPressure: cfg.freshWakeP0,
    freshWakeSleepSaturationMinutes: cfg.satMinutes,
    restCooldownTauMinutes: cfg.restCooldownTau
  });

  const start = new Date('2026-09-09T00:01:00+08:00').getTime();
  let t = start;
  const endT = start + cfg.days * 24 * 60 * MIN;
  const STEP = 1; // 1 分钟
  let homeo = 0.37; let debt = 0;
  let asleep = true; let sleepStart = t; let sleepStartPressure = homeo + debt;
  let lastWakeAt = null;
  const hist = [];             // {endedAt, minutes}
  let naps = 0; let nightSleeps = 0; let rejects = 0; let totalSleep = 0;
  let cooldownUntil = 0;
  let lastTry = -1e9;

  // debt-aware retry:debt 的 ODE 有闭式解 debt(t) = ss + (debt0-ss)·e^(-t/τ),ss = 速率·τ
  function retryDebtAware(now, homeo0, debt0) {
    const ss = COST_PER_MIN * cfg.costScale * cfg.debtTau;
    for (let m = 5; m <= 1440; m += 5) {
      const at = new Date(now.getTime() + m * MIN);
      const dbt = ss + (debt0 - ss) * Math.exp(-m / cfg.debtTau);
      const hm = P.computeAwakePressureAfterMinutes({ startPressure: homeo0, awakeMinutes: m, policy: basePolicy });
      const pr = Math.min(1.6, hm + dbt);
      const sessPolicy = P.resolveRecoverySessionPolicy({ startedAt: at, policy: basePolicy }).policy;
      const required = P.computeRequiredSleepPressure({ lastWakeAt, recentSleepSessions: hist.slice(-40), now: at, policy: sessPolicy });
      if (pr >= required) return at;
    }
    return null;
  }

  while (t < endT) {
    const now = new Date(t);
    const sp = P.resolveRecoverySessionPolicy({ startedAt: new Date(asleep ? sleepStart : t), policy: basePolicy });
    if (asleep) {
      const elapsed = (t - sleepStart) / MIN;
      const pol = sp.policy;
      const pressure = P.computeSleepPressureAfterMinutes({ startPressure: sleepStartPressure, elapsedMinutes: elapsed, policy: pol });
      homeo = pressure; debt = 0;
      const sessionMax = (cfg.napByPressure > 0 && sp.sessionCapWakeCause === 'daytime_nap_cap')
        ? 480
        : sp.sessionMaxRecoveryMinutes;
      const pressureTargetHit = cfg.napByPressure > 0 && sp.sessionCapWakeCause === 'daytime_nap_cap'
        ? pressure <= cfg.napByPressure
        : false;
      if (elapsed >= sessionMax || pressureTargetHit || pressure <= pol.naturalWakePressure) {
        asleep = false;
        lastWakeAt = new Date(t);
        hist.push({ endedAt: new Date(t), minutes: elapsed });
        totalSleep += elapsed;
        if (sp.sessionCapWakeCause === 'daytime_nap_cap') naps += 1; else nightSleeps += 1;
        cooldownUntil = 0; lastTry = -1e9;
      }
    } else {
      homeo = P.computeAwakePressureAfterMinutes({ startPressure: homeo, awakeMinutes: STEP, policy: P.resolveCircadianAwakePolicy(now, basePolicy) });
      debt = debt * Math.exp(-STEP / cfg.debtTau) + COST_PER_MIN * STEP * cfg.costScale;
      const pressure = Math.min(1.6, homeo + debt);
      const tryNow = (t - lastTry) / MIN >= cfg.tryIntervalMin && (!cfg.engineCooldown || t >= cooldownUntil);
      if (tryNow) {
        lastTry = t;
        const sessPolicy = P.resolveRecoverySessionPolicy({ startedAt: now, policy: basePolicy }).policy;
        const required = P.computeRequiredSleepPressure({ lastWakeAt, recentSleepSessions: hist.slice(-40), now, policy: sessPolicy });
        if (pressure >= required) {
          asleep = true; sleepStart = t; sleepStartPressure = pressure;
        } else {
          rejects += 1;
          const retry = cfg.debtAwareRetry
            ? retryDebtAware(now, homeo, debt)
            : P.estimateVoluntaryRecoveryRetryAt({
              energy: 1 - pressure, lastWakeAt, recentSleepSessions: hist.slice(-40), now, basePolicy
            });
          cooldownUntil = retry ? retry.getTime() : t + 24 * 60 * MIN;
        }
      }
    }
    t += STEP * MIN;
  }
  return {
    label: cfg.label,
    napsPerDay: naps / cfg.days,
    nightPerDay: nightSleeps / cfg.days,
    rejectsPerDay: rejects / cfg.days,
    sleepMinPerDay: totalSleep / cfg.days,
    awakeMinPerDay: 1440 - totalSleep / cfg.days
  };
}

const scenarios = [
  { label: 'baseline(现状)' },
  { label: 'A 引擎级冷却(被拒到 retry 前不再发请求)', engineCooldown: true },
  { label: 'B nap cap 90→180', napCap: 180 },
  { label: 'B2 nap cap 90→240', napCap: 240 },
  { label: 'C w(S) S0 160→320(刚醒惩罚更轻)', satMinutes: 320 },
  { label: 'C2 P0 0.5→0.30', freshWakeP0: 0.30 },
  { label: 'D actionCostScale 1→0.4', costScale: 0.4 },
  { label: 'D2 debtTau 360→120(动作成本快回落)', debtTau: 120 },
  { label: 'E retry 估算 debt-aware(只改数字)', debtAwareRetry: true },
  { label: 'F 冷却 + debt-aware retry(A+E)', engineCooldown: true, debtAwareRetry: true },
  { label: 'G 收帧后 20min 不自触发(试探间隔 3→20)', tryIntervalMin: 20 },
  { label: 'H 白天睡到压力≤0.25(不用固定 cap)', napByPressure: 0.25 },
  { label: 'F+B nap180 + 冷却 + debt-aware', napCap: 180, engineCooldown: true, debtAwareRetry: true },
  { label: 'F+H 压力驱动 nap + 冷却 + debt-aware', napByPressure: 0.25, engineCooldown: true, debtAwareRetry: true },
  { label: 'F+H+C S0 320 + 压力nap + 冷却 + debt-aware', napByPressure: 0.25, satMinutes: 320, engineCooldown: true, debtAwareRetry: true },
  { label: 'A+B nap180 + 冷却(冻结retry)', napCap: 180, engineCooldown: true },
  { label: 'A+B+D nap180 + 冷却 + costScale0.4', napCap: 180, engineCooldown: true, costScale: 0.4 },
  { label: 'A+B2+D nap240 + 冷却 + costScale0.4', napCap: 240, engineCooldown: true, costScale: 0.4 }
];
console.log('\n  方案'.padEnd(46), '小睡/天  整觉/天  被拒/天  睡眠min/天  清醒min/天');
for (const sc of scenarios) {
  const r = simulate(sc);
  console.log('  ' + r.label.padEnd(44),
    r.napsPerDay.toFixed(1).padStart(6),
    r.nightPerDay.toFixed(1).padStart(8),
    r.rejectsPerDay.toFixed(0).padStart(8),
    r.sleepMinPerDay.toFixed(0).padStart(10),
    r.awakeMinPerDay.toFixed(0).padStart(11));
}

// ─────────────────────────────────────────────────────────────
// 5) retry_after:冻结压力 vs 含 debt 涨速
// ─────────────────────────────────────────────────────────────
console.log('\n================ 5) retry_after 高估量化 ================');
for (const r of rows.slice(-10)) {
  console.log(`  [sid ${r.sid}] 首拒 retry=${String(r.firstRejectRetry ?? '—').padStart(4)}min  含debt模型=${String(r.modelAcceptMin ?? '>360').padStart(4)}min  实际=${String(r.actualAcceptMin ?? '—').padStart(4)}min`);
}
