import { DatabaseManager } from '../database';

describe('DatabaseManager cognition persistence helpers', () => {
  function createSubject() {
    const subject = Object.create(DatabaseManager.prototype) as DatabaseManager & {
      executeInsertAndReturnId: jest.Mock;
      executeQuery: jest.Mock;
      executeUpdate: jest.Mock;
    };

    subject.executeInsertAndReturnId = jest.fn();
    subject.executeQuery = jest.fn();
    subject.executeUpdate = jest.fn();
    return subject;
  }

  it('serializes observation payloads before insert', async () => {
    const subject = createSubject();
    subject.executeInsertAndReturnId.mockResolvedValue(91);

    const insertId = await DatabaseManager.prototype.saveAgentObservation.call(subject, {
      trace_id: 'trace-1',
      conversation_id: 'conv-1',
      source_type: 'compaction_flush',
      field_scope: 'private_chat',
      message_type: 'private',
      user_id: 123456,
      group_id: null,
      subject_user_id: 123456,
      counterparty_ids: [123456],
      content: 'flush snapshot',
      tool_payload_ref: null,
      raw_payload: {
        flush_reason: 'pre_compaction_threshold',
        source_observation_ids: [1, 2, 3]
      },
      occurred_at: new Date('2026-03-23T00:00:00.000Z')
    });

    expect(insertId).toBe(91);
    expect(subject.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_observations'),
      expect.arrayContaining([
        'trace-1',
        'conv-1',
        'compaction_flush',
        'private_chat',
        'private',
        123456,
        null,
        123456,
        JSON.stringify([123456]),
        'flush snapshot',
        null,
        JSON.stringify({
          flush_reason: 'pre_compaction_threshold',
          source_observation_ids: [1, 2, 3]
        })
      ])
    );
  });

  it('revises conflicting beliefs before inserting a new active belief', async () => {
    const subject = createSubject();
    subject.executeQuery.mockResolvedValue([
      {
        id: 11,
        subject_type: 'user',
        subject_id: '123456',
        belief_type: 'preference',
        belief_key: 'preference:香菜',
        normalized_claim: '用户喜欢香菜',
        polarity: 'positive',
        confidence: 0.72,
        status: 'active'
      }
    ]);
    subject.executeUpdate.mockResolvedValue(1);
    subject.executeInsertAndReturnId.mockResolvedValue(12);

    const insertedId = await DatabaseManager.prototype.upsertAgentBelief.call(subject, {
      subject_type: 'user',
      subject_id: '123456',
      belief_type: 'preference',
      belief_key: 'preference:香菜',
      claim: '用户不喜欢香菜',
      normalized_claim: '用户不喜欢香菜',
      polarity: 'negative',
      confidence: 0.78,
      status: 'active',
      observation_count: 1,
      last_evidence_id: 101,
      first_observed_at: new Date('2026-03-23T00:00:00.000Z'),
      last_observed_at: new Date('2026-03-23T00:00:00.000Z')
    });

    expect(insertedId).toBe(12);
    expect(subject.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'revised'"),
      [11]
    );
    expect(subject.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_beliefs'),
      expect.arrayContaining([
        'user',
        '123456',
        'preference',
        'preference:香菜',
        '用户不喜欢香菜',
        '用户不喜欢香菜',
        'negative',
        0.78,
        'active',
        1,
        101
      ])
    );
  });
});
