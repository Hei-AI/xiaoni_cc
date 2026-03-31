import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSimpleQueueSimulationContext } from '../simple-queue-simulation-context';

test('marks @name group simulations as mentioned and strips mention from command body', () => {
  const context = buildSimpleQueueSimulationContext('group', {
    user_id: 3375477814,
    group_id: 1019235326,
    message: '@小腻 今天咋样？'
  });

  assert.equal(context.WasMentioned, true);
  assert.equal(context.BodyForAgent, '@小腻 今天咋样？');
  assert.equal(context.CommandBody, '今天咋样？');
  assert.deepEqual(context.MentionedUsers, [
    {
      userId: '1129974489',
      label: '小腻'
    }
  ]);
});

test('marks CQ at group simulations as mentioned and strips CQ tag from command body', () => {
  const context = buildSimpleQueueSimulationContext('group', {
    user_id: 3375477814,
    group_id: 1019235326,
    message: '[CQ:at,qq=1129974489] 今天咋样？'
  });

  assert.equal(context.WasMentioned, true);
  assert.equal(context.CommandBody, '今天咋样？');
  assert.deepEqual(context.MentionedUsers, [
    {
      userId: '1129974489',
      label: undefined
    }
  ]);
});

test('keeps plain group chatter unmentioned', () => {
  const context = buildSimpleQueueSimulationContext('group', {
    user_id: 3375477814,
    group_id: 1019235326,
    message: '今天咋样？'
  });

  assert.equal(context.WasMentioned, false);
  assert.equal(context.CommandBody, '今天咋样？');
  assert.equal(context.MentionedUsers, undefined);
});
