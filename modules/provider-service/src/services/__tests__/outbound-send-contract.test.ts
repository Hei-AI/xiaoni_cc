import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveInternalGroupSendRequest,
  resolveInternalPrivateSendRequest
} from '../outbound-send-contract';

test('/api/internal/send_private uses caller-provided user_id as the send target', () => {
  const request = resolveInternalPrivateSendRequest({
    user_id: '10001',
    group_id: '99999',
    session_key: 'qq:private:20002',
    message: '  cross-session private send  ',
    queue_message: {
      sender_id: 30003
    }
  });

  assert.equal(request.userId, 10001);
  assert.deepEqual(request.messages, ['cross-session private send']);
  assert.equal(request.enforcePolicy, false);
});

test('/api/internal/send_group uses caller-provided group_id as the send target', () => {
  const request = resolveInternalGroupSendRequest({
    group_id: '40004',
    user_id: '10001',
    session_key: 'qq:group:99999',
    messages: [' first message ', 'second message'],
    mention_user_ids: ['50005', 50005, '60006'],
    enforce_policy: true,
    queue_message: {
      group_id: 70007
    }
  });

  assert.equal(request.groupId, 40004);
  assert.deepEqual(request.messages, ['first message', 'second message']);
  assert.deepEqual(request.mentionUserIds, [50005, 60006]);
  assert.equal(request.sessionKey, 'qq:group:99999');
  assert.equal(request.enforcePolicy, true);
});

test('internal send endpoints do not derive targets from session keys or queue messages', () => {
  const privateRequest = resolveInternalPrivateSendRequest({
    session_key: 'qq:private:12345',
    message: 'missing explicit user target',
    queue_message: {
      sender_id: 12345
    }
  });
  const groupRequest = resolveInternalGroupSendRequest({
    session_key: 'qq:group:67890',
    message: 'missing explicit group target',
    queue_message: {
      group_id: 67890
    }
  });

  assert.equal(Number.isFinite(privateRequest.userId), false);
  assert.equal(Number.isFinite(groupRequest.groupId), false);
});
