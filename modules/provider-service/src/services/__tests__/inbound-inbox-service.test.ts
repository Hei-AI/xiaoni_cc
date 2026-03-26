import test from 'node:test';
import assert from 'node:assert/strict';
import { InboundInboxService } from '../inbound-inbox-service';

test('finalizeSimulationContext fills session and message defaults for direct chat', async () => {
  const service = new InboundInboxService();
  const context = service.finalizeSimulationContext(
    {
      ChatType: 'direct',
      AccountId: '1129974489',
      SenderId: '85178516',
      NativeChannelId: '85178516',
      Body: '测试 inbox',
      BodyForAgent: '测试 inbox',
      RawBody: '测试 inbox',
      CommandBody: '测试 inbox',
      BodyForCommands: '测试 inbox',
    },
    '1129974489',
    'sim_fixed'
  );

  assert.equal(context.SessionKey, 'qq:direct:1129974489:85178516');
  assert.equal(context.MessageSid, 'sim_fixed');
  assert.equal(context.To, 'user:85178516');
  assert.equal(context.From, 'qq:85178516');
  assert.equal(context.Provider, 'qq');
  assert.equal(context.Surface, 'simulator');
  assert.equal(context.CommandAuthorized, false);
  await service.close();
});

test('finalizeSimulationContext preserves supplied group session data', async () => {
  const service = new InboundInboxService();
  const context = service.finalizeSimulationContext(
    {
      ChatType: 'group',
      AccountId: '1129974489',
      SenderId: '85178516',
      NativeChannelId: '1019235326',
      SessionKey: 'qq:group:1019235326',
      To: 'group:1019235326',
      From: 'qq:group:1019235326',
      Body: '@小腻 测试',
      BodyForAgent: '@小腻 测试',
      RawBody: '@小腻 测试',
      CommandBody: '测试',
      BodyForCommands: '测试',
      WasMentioned: true,
    },
    '1129974489',
    'sim_group'
  );

  assert.equal(context.SessionKey, 'qq:group:1019235326');
  assert.equal(context.MessageSid, 'sim_group');
  assert.equal(context.NativeChannelId, '1019235326');
  assert.equal(context.WasMentioned, true);
  await service.close();
});
