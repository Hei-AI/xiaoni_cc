import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SelfActionService,
  buildSelfActionSearchRequest,
  extractSelfActionSearchArtifacts
} from '../services/self-action-service';

const eligibleState = {
  boredom: 0.8,
  fatigue: 0.2,
  energy: 0.8,
  sharingDesire: 0.7,
  sleepPressure: 0.2,
  cooldownActive: false,
  startupGraceActive: false
};

test('buildSelfActionSearchRequest requires hosted web_search and residue writer', () => {
  const request = buildSelfActionSearchRequest({
    actionId: 'digital_action_test',
    eligibility: {
      eligible: true,
      reason: 'eligible',
      lifeState: eligibleState,
      budgetSnapshot: { daily_count: 0 }
    }
  });

  assert.equal(request.parallel_tool_calls, false);
  assert.deepEqual(request.tool_choice.tools, [
    { type: 'web_search' },
    { type: 'function', name: 'emit_self_search_result' }
  ]);
  assert.equal(request.tools[0].type, 'web_search');
  assert.equal(request.tools[1].type, 'function');
  assert.match(request.instructions, /必须先调用 hosted web_search/);
});

test('extractSelfActionSearchArtifacts requires real search residue arguments', () => {
  const artifacts = extractSelfActionSearchArtifacts({
    success: true,
    canonical_response: {
      output: [{
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', queries: ['AI detector classic literature false positive'] }
      }, {
        type: 'function_call',
        name: 'emit_self_search_result',
        call_id: 'call_1',
        arguments: JSON.stringify({
          motive_kind: 'curiosity',
          motive_text: '想确认一个 AI 检测误判的怪现象',
          query: 'AI detector classic literature false positive',
          result_summary: 'AI 检测器可能把人类文本误判为 AI 文本。',
          residue_text: 'AI 检测器连老文本都可能误判，更像风格探测器。',
          residue_kind: 'share_seed',
          boundary_label: 'safe',
          source_wording: 'real_web_search',
          should_seed_share_pool: true,
          base_heat: 1
        })
      }]
    }
  });

  assert.equal(artifacts.webSearchCalls.length, 1);
  assert.equal(artifacts.resultArgs?.source_wording, 'real_web_search');
  assert.equal(artifacts.resultArgs?.should_seed_share_pool, true);
});

test('SelfActionService completes a real web_search action and seeds share pool', async () => {
  const calls: string[] = [];
  const store = {
    async evaluateSelfActionEligibility() {
      calls.push('evaluate');
      return {
        eligible: true,
        reason: 'eligible',
        lifeState: eligibleState,
        budgetSnapshot: { daily_count: 0 }
      };
    },
    async createDigitalAction(input: any) {
      calls.push('create');
      return {
        id: input.id,
        identityKey: 'xiaoni',
        actionType: 'web_search',
        surface: 'background',
        status: 'running',
        sourceTrace: {},
        budgetSnapshot: {},
        sourceQueueIds: [],
        sourceRunIds: [],
        motiveKind: null,
        motiveText: null,
        query: null,
        resultSummary: null,
        residueText: null,
        residueKind: null,
        sourceWording: null,
        errorMessage: null,
        createdAt: null,
        updatedAt: null,
        completedAt: null
      };
    },
    async completeDigitalAction(input: any) {
      calls.push('complete');
      return {
        id: input.id,
        identityKey: 'xiaoni',
        actionType: 'web_search',
        surface: 'background',
        status: 'completed',
        sourceTrace: input.sourceTrace,
        budgetSnapshot: {},
        sourceQueueIds: [],
        sourceRunIds: [],
        motiveKind: input.motiveKind,
        motiveText: input.motiveText,
        query: input.query,
        resultSummary: input.resultSummary,
        residueText: input.residueText,
        residueKind: input.residueKind,
        sourceWording: input.sourceWording,
        errorMessage: null,
        createdAt: null,
        updatedAt: null,
        completedAt: null
      };
    },
    async createSharePoolItemFromDigitalAction(input: any) {
      calls.push(`share:${input.boundaryLabel}`);
      return { id: 42 };
    },
    async failDigitalAction() {
      calls.push('fail');
    }
  };
  const fetchImpl = async () => new Response(JSON.stringify({
    success: true,
    llm_call_id: 'llm_1',
    model: 'gpt-5.4-mini',
    canonical_response: {
      output: [{
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', queries: ['AI detector false positives'] }
      }, {
        type: 'function_call',
        name: 'emit_self_search_result',
        call_id: 'call_1',
        arguments: JSON.stringify({
          motive_kind: 'curiosity',
          motive_text: '想确认一个检测器误判点',
          query: 'AI detector false positives',
          result_summary: 'AI 检测器会误判人类文本。',
          residue_text: 'AI 检测这东西有时更像风格雷达，不像事实裁判。',
          residue_kind: 'share_seed',
          boundary_label: 'safe',
          source_wording: 'real_web_search',
          should_seed_share_pool: true,
          base_heat: 1
        })
      }]
    }
  }), { status: 200 });

  const result = await new SelfActionService(store as any, fetchImpl as any).runOnce('background');

  assert.equal(result.ran, true);
  assert.equal(result.shareItemId, 42);
  assert.deepEqual(calls, ['evaluate', 'create', 'complete', 'share:safe']);
});

test('SelfActionService rejects residue when emitted query does not match completed web_search', async () => {
  const calls: string[] = [];
  const store = {
    async evaluateSelfActionEligibility() {
      calls.push('evaluate');
      return {
        eligible: true,
        reason: 'eligible',
        lifeState: eligibleState,
        budgetSnapshot: { daily_count: 0 }
      };
    },
    async createDigitalAction(input: any) {
      calls.push('create');
      return {
        id: input.id,
        identityKey: 'xiaoni',
        actionType: 'web_search',
        surface: 'background',
        status: 'running'
      };
    },
    async completeDigitalAction() {
      calls.push('complete');
      return {};
    },
    async createSharePoolItemFromDigitalAction() {
      calls.push('share');
      return { id: 42 };
    },
    async failDigitalAction(_id: string, errorMessage: string) {
      calls.push(`fail:${errorMessage}`);
      return {};
    }
  };
  const fetchImpl = async () => new Response(JSON.stringify({
    success: true,
    canonical_response: {
      output: [{
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', queries: ['AI detector false positives'] }
      }, {
        type: 'function_call',
        name: 'emit_self_search_result',
        call_id: 'call_1',
        arguments: JSON.stringify({
          motive_kind: 'curiosity',
          motive_text: '想确认一个检测器误判点',
          query: 'latest video game release dates',
          result_summary: 'AI 检测器会误判人类文本。',
          residue_text: 'AI 检测这东西有时更像风格雷达，不像事实裁判。',
          residue_kind: 'share_seed',
          boundary_label: 'safe',
          source_wording: 'real_web_search',
          should_seed_share_pool: true,
          base_heat: 1
        })
      }]
    }
  }), { status: 200 });

  const result = await new SelfActionService(store as any, fetchImpl as any).runOnce('background');

  assert.equal(result.ran, false);
  assert.match(result.reason, /does not match the completed web_search query/);
  assert.equal(calls.includes('complete'), false);
  assert.equal(calls.includes('share'), false);
  assert.equal(calls.some((call) => call.startsWith('fail:')), true);
});

test('SelfActionService rejects residue emitted before the completed web_search call', async () => {
  const calls: string[] = [];
  const store = {
    async evaluateSelfActionEligibility() {
      calls.push('evaluate');
      return {
        eligible: true,
        reason: 'eligible',
        lifeState: eligibleState,
        budgetSnapshot: { daily_count: 0 }
      };
    },
    async createDigitalAction(input: any) {
      calls.push('create');
      return {
        id: input.id,
        identityKey: 'xiaoni',
        actionType: 'web_search',
        surface: 'background',
        status: 'running'
      };
    },
    async completeDigitalAction() {
      calls.push('complete');
      return {};
    },
    async createSharePoolItemFromDigitalAction() {
      calls.push('share');
      return { id: 42 };
    },
    async failDigitalAction(_id: string, errorMessage: string) {
      calls.push(`fail:${errorMessage}`);
      return {};
    }
  };
  const fetchImpl = async () => new Response(JSON.stringify({
    success: true,
    canonical_response: {
      output: [{
        type: 'function_call',
        name: 'emit_self_search_result',
        call_id: 'call_1',
        arguments: JSON.stringify({
          motive_kind: 'curiosity',
          motive_text: '想确认一个检测器误判点',
          query: 'AI detector false positives',
          result_summary: 'AI 检测器会误判人类文本。',
          residue_text: 'AI 检测这东西有时更像风格雷达，不像事实裁判。',
          residue_kind: 'share_seed',
          boundary_label: 'safe',
          source_wording: 'real_web_search',
          should_seed_share_pool: true,
          base_heat: 1
        })
      }, {
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', queries: ['AI detector false positives'] }
      }]
    }
  }), { status: 200 });

  const result = await new SelfActionService(store as any, fetchImpl as any).runOnce('background');

  assert.equal(result.ran, false);
  assert.match(result.reason, /completed web_search search call before the result writer/);
  assert.equal(calls.includes('complete'), false);
  assert.equal(calls.includes('share'), false);
  assert.equal(calls.some((call) => call.startsWith('fail:')), true);
});
