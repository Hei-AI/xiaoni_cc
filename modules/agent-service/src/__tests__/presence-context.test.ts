import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPresenceContextBlock,
  deriveLifeState,
  scoreSharePoolItem,
  shouldFirePresenceTick
} from '../services/presence-context';

test('deriveLifeState makes boredom grow with idle time and respects cooldown', () => {
  const now = new Date('2026-05-26T12:00:00.000Z');
  const state = deriveLifeState({
    now,
    serviceStartedAt: '2026-05-26T06:00:00.000Z',
    lastBoredomResetAt: '2026-05-26T09:00:00.000Z',
    lastActiveAt: '2026-05-26T06:00:00.000Z',
    lastPresenceTickEnqueuedAt: '2026-05-26T11:30:00.000Z'
  }, {
    cooldownMs: 45 * 60 * 1000,
    startupGraceMs: 5 * 60 * 1000
  });

  assert.ok(state.boredom >= 0.9);
  assert.ok(state.energy > 0.5);
  assert.equal(state.cooldownActive, true);
  assert.equal(shouldFirePresenceTick(state).reason, 'cooldown');
});

test('shouldFirePresenceTick allows bored, energetic state after cooldown', () => {
  const state = deriveLifeState({
    now: new Date('2026-05-26T12:00:00.000Z'),
    serviceStartedAt: '2026-05-26T06:00:00.000Z',
    lastBoredomResetAt: '2026-05-26T08:00:00.000Z',
    lastActiveAt: '2026-05-26T08:00:00.000Z',
    lastPresenceTickEnqueuedAt: '2026-05-26T10:00:00.000Z'
  }, {
    cooldownMs: 45 * 60 * 1000,
    startupGraceMs: 5 * 60 * 1000
  });

  assert.equal(shouldFirePresenceTick(state).shouldEnqueue, true);
});

test('presence sharing desire is not suppressed by previous proactive count', () => {
  const state = deriveLifeState({
    now: new Date('2026-05-26T12:00:00.000Z'),
    serviceStartedAt: '2026-05-26T06:00:00.000Z',
    lastBoredomResetAt: '2026-05-26T08:00:00.000Z',
    lastActiveAt: '2026-05-26T08:00:00.000Z',
    lastPresenceTickEnqueuedAt: '2026-05-26T10:00:00.000Z',
    dailyProactiveCount: 12
  }, {
    cooldownMs: 45 * 60 * 1000,
    startupGraceMs: 5 * 60 * 1000
  });

  assert.ok(state.sharingDesire > 0.35);
  assert.equal(shouldFirePresenceTick(state).reason, 'eligible');
});

test('scoreSharePoolItem boosts fresh safe material over stale reframe material', () => {
  const now = new Date('2026-05-26T12:00:00.000Z');
  const fresh = scoreSharePoolItem({
    id: 1,
    content: '一个关于游戏 UI 的短吐槽',
    sourceKind: 'mock',
    boundaryLabel: 'safe',
    sourceWording: 'mock_only',
    effortCost: 1,
    baseHeat: 1,
    createdAt: '2026-05-26T11:30:00.000Z'
  }, now);
  const stale = scoreSharePoolItem({
    id: 2,
    content: '需要改写掉本地细节的话题',
    sourceKind: 'group_residue',
    boundaryLabel: 'reframe',
    sourceWording: 'mock_only',
    effortCost: 4,
    baseHeat: 1,
    createdAt: '2026-05-23T12:00:00.000Z'
  }, now);

  assert.ok(fresh.finalScore > stale.finalScore);
});

test('buildPresenceContextBlock is factual and includes source boundary', () => {
  const block = buildPresenceContextBlock({
    state: {
      boredom: 0.7,
      fatigue: 0.2,
      energy: 0.8,
      sharingDesire: 0.6,
      sleepPressure: 0.2,
      cooldownActive: false,
      startupGraceActive: false
    },
    items: [{
      id: 1,
      content: '一个关于 AI 检测像算命的想法',
      sourceKind: 'mock',
      boundaryLabel: 'safe',
      sourceWording: 'mock_only',
      effortCost: 1,
      baseHeat: 1,
      createdAt: '2026-05-26T11:30:00.000Z'
    }],
    scores: [],
    isPresenceTick: true
  });

  assert.match(block, /<小腻当前状态>/);
  assert.match(block, /当前状态：当前精力=0\.80/);
  assert.doesNotMatch(block, /当前状态：.*无聊=|当前状态：.*疲劳=|当前状态：.*分享欲=/);
  assert.match(block, /模拟或整理出来的材料不能说成刚看到/);
  assert.match(block, /没有真实浏览器证据/);
  assert.doesNotMatch(block, /你应该|必须回复|请主动/);
});

test('buildPresenceContextBlock exposes real web search material without old runner residue', () => {
  const block = buildPresenceContextBlock({
    state: {
      boredom: 0.7,
      fatigue: 0.2,
      energy: 0.8,
      sharingDesire: 0.6,
      sleepPressure: 0.2,
      cooldownActive: false,
      startupGraceActive: false
    },
    items: [{
      id: 2,
      content: 'AI 检测工具把经典散文判高 AI 率这件事很反讽',
      sourceKind: 'web_search',
      boundaryLabel: 'safe',
      sourceWording: 'real_web_search',
      effortCost: 1,
      baseHeat: 1,
      createdAt: '2026-05-26T11:30:00.000Z'
    }],
    scores: [],
    isPresenceTick: true
  });

  assert.match(block, /有真实网页搜索留下的内容/);
  assert.match(block, /来源：真实网页搜索材料/);
  assert.doesNotMatch(block, /没有真实浏览器证据/);
});

test('buildPresenceContextBlock includes constructed material without source inflation', () => {
  const block = buildPresenceContextBlock({
    state: {
      boredom: 0.6,
      fatigue: 0.2,
      energy: 0.8,
      sharingDesire: 0.5,
      sleepPressure: 0.2,
      cooldownActive: false,
      startupGraceActive: false
    },
    items: [{
      id: 3,
      content: '旧构造材料只能当作内部整理，不等于真的刚看过资料。',
      sourceKind: 'reflect',
      boundaryLabel: 'safe',
      sourceWording: 'constructed_only',
      effortCost: 1,
      baseHeat: 0.9,
      createdAt: '2026-05-31T01:30:00.000Z'
    }],
    scores: [],
    isPresenceTick: true
  });

  assert.match(block, /来源：整理出来的材料/);
  assert.match(block, /没有真实浏览器证据/);
  assert.match(block, /不能伪装成实时来源/);
});
