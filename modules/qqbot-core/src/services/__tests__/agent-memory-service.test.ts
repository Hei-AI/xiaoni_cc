import AgentMemoryService from '../agent-memory-service';
import type { QQMessage } from '../../types';

function createMessage(overrides: Partial<QQMessage> = {}): QQMessage {
  return {
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    user_id: 123456,
    message_id: 100,
    raw_message: '我喜欢蓝莓',
    normalized_text: '我喜欢蓝莓',
    message: [],
    font: 14,
    sender: { user_id: 123456 },
    time: Math.floor(Date.now() / 1000),
    self_id: 1129974489,
    ...overrides
  } as unknown as QQMessage;
}

function createBeliefRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    subject_type: 'user',
    subject_id: '123456',
    belief_type: 'commitment',
    belief_key: 'commitment:周末学Rust',
    claim: '用户打算周末学Rust',
    normalized_claim: '用户打算周末学rust',
    polarity: 'neutral',
    confidence: 0.68,
    status: 'active',
    observation_count: 1,
    last_evidence_id: 9,
    first_observed_at: '2026-03-23T00:00:00.000Z',
    last_observed_at: '2026-03-23T00:00:00.000Z',
    created_at: '2026-03-23T00:00:00.000Z',
    updated_at: '2026-03-23T00:00:00.000Z',
    ...overrides
  };
}

function createObservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    source_type: 'incoming_message',
    field_scope: 'private_chat',
    user_id: 123456,
    group_id: null,
    subject_user_id: 123456,
    content: '我打算周末学Rust',
    occurred_at: '2026-03-23T00:00:00.000Z',
    created_at: '2026-03-23T00:00:00.000Z',
    ...overrides
  };
}

function createMemoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    memory_scope: 'person_global',
    memory_type: 'commitment',
    subject_type: 'user',
    subject_id: '123456',
    field_scope: 'private_chat',
    user_id: 123456,
    group_id: null,
    target_user_id: null,
    conversation_id: null,
    title: 'commitment',
    content: '用户打算周末学Rust',
    normalized_content: '用户打算周末学Rust',
    confidence: 0.68,
    salience: 0.73,
    status: 'active',
    source_kind: 'daily_reflection',
    promoted_from_belief_id: 1,
    last_recalled_at: null,
    last_observed_at: '2026-03-23T00:00:00.000Z',
    created_at: '2026-03-23T00:00:00.000Z',
    updated_at: '2026-03-23T00:00:00.000Z',
    ...overrides
  };
}

function createCurrentSelfModelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    identity_summary: '小腻当前处于持续观察、整理记忆与跟进的运行阶段；本次日度反思整理了1条稳定记忆。',
    core_traits: '[]',
    long_term_goals: '[]',
    current_concerns: '[]',
    availability: null,
    energy: null,
    source_reflection_id: 31,
    is_current: 1,
    created_at: '2026-03-23T00:00:00.000Z',
    updated_at: '2026-03-23T00:00:00.000Z',
    ...overrides
  };
}

describe('AgentMemoryService', () => {
  it('promotes explicit commitments into stable memories', async () => {
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 1,
            subject_type: 'user',
            subject_id: '123456',
            belief_type: 'commitment',
            belief_key: 'commitment:周末学Rust',
            claim: '用户打算周末学Rust',
            normalized_claim: '用户打算周末学rust',
            polarity: 'neutral',
            confidence: 0.68,
            status: 'active',
            observation_count: 1,
            last_evidence_id: 9,
            first_observed_at: '2026-03-23T00:00:00.000Z',
            last_observed_at: '2026-03-23T00:00:00.000Z',
            created_at: '2026-03-23T00:00:00.000Z',
            updated_at: '2026-03-23T00:00:00.000Z'
          }
        ])
        .mockResolvedValueOnce([
          {
            id: 9,
            source_type: 'incoming_message',
            field_scope: 'private_chat',
            user_id: 123456,
            group_id: null,
            subject_user_id: 123456,
            content: '我打算周末学Rust',
            occurred_at: '2026-03-23T00:00:00.000Z',
            created_at: '2026-03-23T00:00:00.000Z'
          }
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 11,
            memory_scope: 'person_global',
            memory_type: 'commitment',
            subject_type: 'user',
            subject_id: '123456',
            field_scope: 'private_chat',
            user_id: 123456,
            group_id: null,
            target_user_id: null,
            conversation_id: null,
            title: 'commitment',
            content: '用户打算周末学Rust',
            normalized_content: '用户打算周末学Rust',
            confidence: 0.68,
            salience: 0.73,
            status: 'active',
            source_kind: 'explicit_commitment',
            promoted_from_belief_id: 1,
            last_recalled_at: null,
            last_observed_at: '2026-03-23T00:00:00.000Z',
            created_at: '2026-03-23T00:00:00.000Z',
            updated_at: '2026-03-23T00:00:00.000Z'
          }
        ]),
      executeUpdate: jest.fn(),
      executeInsertAndReturnId: jest
        .fn()
        .mockResolvedValueOnce(11)
        .mockResolvedValueOnce(21)
    };

    const service = new AgentMemoryService(database as any);
    const memory = await service.maybePromoteBelief(1, { evidenceObservationId: 9 });

    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_memories'),
      expect.arrayContaining([
        'person_global',
        'commitment',
        'user',
        '123456'
      ])
    );
    expect(memory).toMatchObject({
      id: 11,
      memory_scope: 'person_global',
      memory_type: 'commitment'
    });
  });

  it('prefers embedding-ranked memory candidates when available', async () => {
    const database = {
      executeQuery: jest.fn().mockResolvedValueOnce([
        {
          id: 2,
          memory_scope: 'person_global',
          memory_type: 'preference',
          subject_type: 'user',
          subject_id: '123456',
          field_scope: 'private_chat',
          user_id: 123456,
          group_id: null,
          target_user_id: null,
          conversation_id: null,
          title: 'preference',
          content: '用户喜欢芒果',
          normalized_content: '用户喜欢芒果',
          confidence: 0.8,
          salience: 0.8,
          status: 'active',
          source_kind: 'repeated_signal',
          promoted_from_belief_id: 2,
          last_recalled_at: null,
          last_observed_at: '2026-03-23T00:00:00.000Z',
          created_at: '2026-03-23T00:00:00.000Z',
          updated_at: '2026-03-23T00:00:00.000Z'
        },
        {
          id: 1,
          memory_scope: 'person_global',
          memory_type: 'preference',
          subject_type: 'user',
          subject_id: '123456',
          field_scope: 'private_chat',
          user_id: 123456,
          group_id: null,
          target_user_id: null,
          conversation_id: null,
          title: 'preference',
          content: '用户喜欢蓝莓',
          normalized_content: '用户喜欢蓝莓',
          confidence: 0.8,
          salience: 0.8,
          status: 'active',
          source_kind: 'repeated_signal',
          promoted_from_belief_id: 1,
          last_recalled_at: null,
          last_observed_at: '2026-03-23T00:00:00.000Z',
          created_at: '2026-03-23T00:00:00.000Z',
          updated_at: '2026-03-23T00:00:00.000Z'
        }
      ]),
      executeUpdate: jest.fn(),
      executeInsertAndReturnId: jest.fn()
    };
    const embeddingStore = {
      searchByQuery: jest.fn().mockResolvedValue([
        { entity_id: 2 },
        { entity_id: 1 }
      ])
    };

    const service = new AgentMemoryService(database as any, embeddingStore as any);
    const memories = await service.getRetrievedMemoriesForMessage(createMessage(), 2);

    expect(embeddingStore.searchByQuery).toHaveBeenCalled();
    expect(memories.map(memory => memory.id)).toEqual([2, 1]);
  });

  it('reranks hybrid memory candidates with temporal decay instead of using semantic similarity alone', async () => {
    const database = {
      executeQuery: jest.fn().mockResolvedValue([
        createMemoryRow({
          id: 1,
          content: '用户喜欢蓝莓',
          last_observed_at: '2026-02-01T00:00:00.000Z',
          updated_at: '2026-02-01T00:00:00.000Z'
        }),
        createMemoryRow({
          id: 2,
          content: '用户最近在学Rust',
          memory_type: 'commitment',
          title: 'commitment',
          last_observed_at: '2026-03-23T00:00:00.000Z',
          updated_at: '2026-03-23T00:00:00.000Z'
        })
      ]),
      executeUpdate: jest.fn(),
      executeInsertAndReturnId: jest.fn()
    };
    const embeddingStore = {
      searchByQuery: jest.fn().mockResolvedValue([
        { entity_id: 1, similarity: 0.76 },
        { entity_id: 2, similarity: 0.72 }
      ])
    };

    const service = new AgentMemoryService(database as any, embeddingStore as any);
    const memories = await service.getRetrievedMemoriesForMessage(
      createMessage({
        raw_message: 'Rust 最近进展怎样',
        normalized_text: 'Rust 最近进展怎样'
      }),
      2
    );

    expect(memories.map(memory => memory.id)).toEqual([2, 1]);
  });

  it('writes silent flush observations before compaction without mutating stable memories', async () => {
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(
          Array.from({ length: 12 }, (_, index) => createObservationRow({
            id: index + 1,
            content: `最近消息 ${index + 1}`,
            occurred_at: `2026-03-23T00:${String(index).padStart(2, '0')}:00.000Z`
          }))
        ),
      executeUpdate: jest.fn(),
      executeInsertAndReturnId: jest.fn(),
      saveAgentObservation: jest.fn().mockResolvedValue(501)
    };

    const service = new AgentMemoryService(database as any);
    jest.spyOn(service, 'getCurrentSelfModel').mockResolvedValue(createCurrentSelfModelRow() as any);
    jest.spyOn(service, 'getActivePlansForMessage').mockResolvedValue([
      {
        id: 71,
        plan_type: 'followup_queue',
        target_field_scope: 'private_chat',
        target_user_id: 123456,
        target_group_id: null,
        goal: '跟进：用户打算周末学Rust',
        trigger_condition: '下次自然窗口继续问进展',
        status: 'queued',
        scheduled_start_at: null,
        scheduled_end_at: null,
        source_reflection_id: 31,
        created_at: new Date('2026-03-23T00:00:00.000Z'),
        updated_at: new Date('2026-03-23T00:00:00.000Z')
      }
    ]);
    jest.spyOn(service, 'getRetrievedMemoriesForMessage').mockResolvedValue([
      createMemoryRow({ id: 81, content: '用户打算周末学Rust' }) as any
    ]);

    const flushId = await service.maybeFlushDurableContext(
      createMessage({
        user_id: 123456,
        message_id: 3001,
        raw_message: '最近有空吗',
        normalized_text: '最近有空吗'
      }),
      {
        conversationId: 'conv-1',
        traceId: 'trace-1',
        now: new Date('2026-03-23T01:00:00.000Z'),
        minPendingObservations: 10
      }
    );

    expect(flushId).toBe(501);
    expect(database.saveAgentObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'compaction_flush',
        conversation_id: 'conv-1',
        trace_id: 'trace-1',
        raw_payload: expect.objectContaining({
          flush_reason: 'pre_compaction_threshold',
          active_plan_ids: [71],
          retrieved_memory_ids: [81]
        })
      })
    );
    expect(database.executeInsertAndReturnId).not.toHaveBeenCalled();
    expect(database.executeUpdate).not.toHaveBeenCalled();
  });

  it('writes reflection, self model, and followup plan during daily reflection', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([createBeliefRow()])
        .mockResolvedValueOnce([createObservationRow()])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createMemoryRow()])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createMemoryRow()])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([createCurrentSelfModelRow()])
        .mockResolvedValueOnce([{ id: 31, reflection_kind: 'daily' }])
        .mockResolvedValueOnce([{ id: 31, reflection_kind: 'daily' }])
        .mockResolvedValueOnce([{ id: 30, reflection_kind: 'weekly' }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }]),
      executeUpdate: jest.fn().mockResolvedValue(undefined),
      executeInsertAndReturnId: jest
        .fn()
        .mockResolvedValueOnce(11)
        .mockResolvedValueOnce(21)
        .mockResolvedValueOnce(31)
        .mockResolvedValueOnce(41)
        .mockResolvedValueOnce(51)
        .mockResolvedValueOnce(61)
    };

    const service = new AgentMemoryService(database as any);
    await service.runScheduledReflectionsIfDue(now);

    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_reflections'),
      expect.arrayContaining([
        'daily',
        'daily:2026-03-23'
      ])
    );
    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_self_model'),
      expect.arrayContaining([
        expect.stringContaining('日度反思整理了1条稳定记忆'),
        '[]',
        '[]',
        '[]',
        null,
        null,
        31
      ])
    );
    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_plans'),
      [
        'followup_queue',
        'private_chat',
        123456,
        null,
        '跟进：用户打算周末学Rust',
        '下一次合适的对话窗口确认这项承诺的进展。',
        now,
        31
      ]
    );
    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_plans'),
      [
        'day_plan',
        '今日优先：跟进用户123456关于“打算周末学Rust”；保持记忆整理与克制主动的节奏。',
        '今天在自然对话窗口中优先推进这些事项，并保持记忆整理节奏。',
        now,
        31
      ]
    );
    expect(database.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agent_self_model SET is_current = 0 WHERE is_current = 1')
    );
  });

  it('refreshes self model and reuses existing followup plans without duplicating them', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([createBeliefRow({ confidence: 0.75 })])
        .mockResolvedValueOnce([createObservationRow()])
        .mockResolvedValueOnce([createMemoryRow({ id: 11, source_kind: 'explicit_commitment' })])
        .mockResolvedValueOnce([createMemoryRow({ id: 11, source_kind: 'daily_reflection' })])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createMemoryRow({ id: 11 })])
        .mockResolvedValueOnce([
          {
            id: 88,
            target_user_id: 123456,
            target_group_id: null,
            goal: '跟进：用户打算周末学Rust'
          }
        ])
        .mockResolvedValueOnce([{ id: 88 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([createCurrentSelfModelRow({ id: 99, source_reflection_id: 31 })])
        .mockResolvedValueOnce([{ id: 31, reflection_kind: 'daily' }])
        .mockResolvedValueOnce([{ id: 31, reflection_kind: 'daily' }])
        .mockResolvedValueOnce([{ id: 30, reflection_kind: 'weekly' }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }]),
      executeUpdate: jest.fn().mockResolvedValue(undefined),
      executeInsertAndReturnId: jest
        .fn()
        .mockResolvedValueOnce(21)
        .mockResolvedValueOnce(31)
        .mockResolvedValueOnce(41)
        .mockResolvedValueOnce(51)
    };

    const service = new AgentMemoryService(database as any);
    await service.runScheduledReflectionsIfDue(now);

    expect(database.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agent_memories'),
      expect.arrayContaining([
        'person_global',
        'private_chat',
        123456,
        null,
        'commitment',
        '用户打算周末学Rust'
      ])
    );
    expect(database.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agent_self_model SET is_current = 0 WHERE is_current = 1')
    );
    expect(database.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agent_plans'),
      [
        'private_chat',
        '下一次合适的对话窗口确认这项承诺的进展。',
        now,
        31,
        88
      ]
    );
    expect(database.executeInsertAndReturnId).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_plans'),
      expect.arrayContaining(['followup_queue'])
    );
  });

  it('writes weekly focus during weekly reflection', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([createBeliefRow()])
        .mockResolvedValueOnce([createObservationRow()])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createMemoryRow({ id: 12, source_kind: 'weekly_reflection' })])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createMemoryRow()])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createCurrentSelfModelRow({ id: 77, source_reflection_id: 31 })])
        .mockResolvedValueOnce([{ id: 31, reflection_kind: 'weekly' }])
        .mockResolvedValueOnce([{ id: 21, reflection_kind: 'daily' }])
        .mockResolvedValueOnce([{ id: 31, reflection_kind: 'weekly' }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }]),
      executeUpdate: jest.fn().mockResolvedValue(undefined),
      executeInsertAndReturnId: jest
        .fn()
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(22)
        .mockResolvedValueOnce(31)
        .mockResolvedValueOnce(41)
        .mockResolvedValueOnce(51)
        .mockResolvedValueOnce(61)
    };

    const service = new AgentMemoryService(database as any);
    await service.runScheduledReflectionsIfDue(now);

    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_reflections'),
      expect.arrayContaining([
        'weekly',
        'weekly:2026-W13'
      ])
    );
    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_plans'),
      [
        'weekly_focus',
        '本周重点：跟进用户123456关于“打算周末学Rust”；持续沉淀稳定承诺与关系线索。',
        '本周在主动跟进与回复决策中优先围绕这些重点展开。',
        now,
        31
      ]
    );
  });

  it('creates micro intention for private messages at turn time', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([]),
      executeUpdate: jest.fn().mockResolvedValue(undefined),
      executeInsertAndReturnId: jest.fn().mockResolvedValue(91)
    };

    const service = new AgentMemoryService(database as any);
    const plan = await service.upsertMicroIntentionForMessage(
      createMessage({
        user_id: 123456,
        raw_message: '你今晚方便聊一下吗？',
        normalized_text: '你今晚方便聊一下吗？'
      }),
      now
    );

    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_plans'),
      [
        'private_chat',
        123456,
        null,
        '本回合优先：回应用户123456的“你今晚方便聊一下吗？”，判断是直接回复、追问、记录还是延后。',
        '收到新的私聊消息，时间=2026-03-23T10:00:00.000Z。',
        now
      ]
    );
    expect(plan).toMatchObject({
      id: 91,
      plan_type: 'micro_intention',
      target_user_id: 123456,
      target_group_id: null,
      status: 'active'
    });
  });

  it('refreshes existing group micro intention instead of inserting duplicates', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ id: 92 }]),
      executeUpdate: jest.fn().mockResolvedValue(undefined),
      executeInsertAndReturnId: jest.fn()
    };

    const service = new AgentMemoryService(database as any);
    const plan = await service.upsertMicroIntentionForMessage(
      createMessage({
        message_type: 'group',
        group_id: 10001,
        user_id: 123456,
        raw_message: '@1129974489 你怎么看？',
        normalized_text: '@1129974489 你怎么看？',
        reply_intent_context: {
          message_kind: 'directed_reply',
          semantic_anchor: {
            message_id: 88,
            sender_id: 123456,
            sender_nickname: '测试用户',
            text: '上一句'
          },
          address_target: {
            type: 'mention',
            user_id: 1129974489,
            nickname: '小腻'
          },
          interpretation: 'reply'
        }
      }),
      now
    );

    expect(database.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agent_plans'),
      [
        'group_chat',
        '本回合优先：在群组10001处理用户123456的“@1129974489 你怎么看？”，先判断是否需要发言，再决定回复方式。',
        '当前群消息带有 reply 锚点或明确指向，需要优先校准回应对象。',
        now,
        92
      ]
    );
    expect(database.executeInsertAndReturnId).not.toHaveBeenCalled();
    expect(plan).toMatchObject({
      id: 92,
      plan_type: 'micro_intention',
      target_group_id: 10001,
      status: 'active'
    });
  });

  it('executes due followup plans and records completed action logs', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 5,
            plan_type: 'followup_queue',
            target_field_scope: 'private_chat',
            target_user_id: 123456,
            target_group_id: null,
            goal: '跟进：用户打算周末学Rust',
            trigger_condition: '下一次合适的对话窗口确认这项承诺的进展。',
            status: 'queued',
            scheduled_start_at: '2026-03-23T09:00:00.000Z',
            scheduled_end_at: null,
            source_reflection_id: 31,
            created_at: '2026-03-23T08:00:00.000Z',
            updated_at: '2026-03-23T08:00:00.000Z'
          }
        ]),
      executeUpdate: jest.fn().mockResolvedValue(undefined),
      executeInsertAndReturnId: jest.fn().mockResolvedValue(71)
    };
    const sendPrivateMessage = jest.fn().mockResolvedValue(undefined);

    const service = new AgentMemoryService(database as any);
    const result = await service.executeDueFollowupPlans({
      now,
      limit: 1,
      sendPrivateMessage
    });

    expect(sendPrivateMessage).toHaveBeenCalledWith(
      123456,
      '前几天你提到打算周末学Rust，最近进展怎么样？',
      expect.objectContaining({ id: 5, plan_type: 'followup_queue' })
    );
    expect(database.executeUpdate).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("UPDATE agent_plans"),
      [now, 5]
    );
    expect(database.executeUpdate).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE agent_plans"),
      [now, 5]
    );
    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_action_logs'),
      expect.arrayContaining([
        'followup_private_message',
        'followup_queue',
        5,
        123456,
        null,
        expect.any(String),
        'completed',
        now
      ])
    );
    expect(result).toEqual({
      processed: 1,
      completed: 1,
      skipped: 0,
      failed: 0
    });
  });

  it('reschedules blocked followup plans and records skipped action logs', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 6,
            plan_type: 'followup_queue',
            target_field_scope: 'private_chat',
            target_user_id: 123456,
            target_group_id: null,
            goal: '跟进：用户打算周末学Rust',
            trigger_condition: '下一次合适的对话窗口确认这项承诺的进展。',
            status: 'queued',
            scheduled_start_at: '2026-03-23T09:00:00.000Z',
            scheduled_end_at: null,
            source_reflection_id: 31,
            created_at: '2026-03-23T08:00:00.000Z',
            updated_at: '2026-03-23T08:00:00.000Z'
          }
        ]),
      executeUpdate: jest.fn().mockResolvedValue(undefined),
      executeInsertAndReturnId: jest.fn().mockResolvedValue(72)
    };
    const sendPrivateMessage = jest.fn().mockResolvedValue(undefined);

    const service = new AgentMemoryService(database as any);
    const result = await service.executeDueFollowupPlans({
      now,
      limit: 1,
      retryDelayMs: 60 * 60 * 1000,
      canSendToUser: jest.fn().mockResolvedValue({
        allowed: false,
        reason: 'auto_reply_disabled'
      }),
      sendPrivateMessage
    });

    expect(sendPrivateMessage).not.toHaveBeenCalled();
    expect(database.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE agent_plans"),
      [new Date('2026-03-23T11:00:00.000Z'), 6]
    );
    expect(database.executeInsertAndReturnId).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_action_logs'),
      expect.arrayContaining([
        'followup_private_message',
        'followup_queue',
        6,
        123456,
        null,
        expect.any(String),
        'skipped:auto_reply_disabled',
        now
      ])
    );
    expect(result).toEqual({
      processed: 1,
      completed: 0,
      skipped: 1,
      failed: 0
    });
  });

  it('returns persisted proactivity controls with queue and action stats', async () => {
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            id: 1,
            followup_enabled: 0,
            is_paused: 1,
            allowed_user_ids: '[123456, 789012]',
            max_per_run: 2,
            retry_delay_ms: 7200000,
            created_at: '2026-03-23T00:00:00.000Z',
            updated_at: '2026-03-23T01:00:00.000Z'
          }
        ])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ queued_total: 3, active_total: 1 }])
        .mockResolvedValueOnce([{ recent_total: 4, last_action_at: '2026-03-23T02:00:00.000Z' }]),
      executeUpdate: jest.fn(),
      executeInsertAndReturnId: jest.fn()
    };

    const service = new AgentMemoryService(database as any);
    const state = await service.getProactivityControls({
      followupEnabled: true,
      isPaused: false,
      allowedUserIds: [],
      maxPerRun: 1,
      retryDelayMs: 21600000
    });

    expect(state).toEqual({
      followupEnabled: false,
      isPaused: true,
      allowedUserIds: [123456, 789012],
      maxPerRun: 2,
      retryDelayMs: 7200000,
      queuedFollowups: 3,
      activeFollowups: 1,
      recentActionLogCount: 4,
      lastActionAt: '2026-03-23T02:00:00.000Z',
      createdAt: '2026-03-23T00:00:00.000Z',
      updatedAt: '2026-03-23T01:00:00.000Z',
      source: 'database'
    });
  });

  it('persists proactivity control updates and returns refreshed runtime state', async () => {
    const database = {
      executeQuery: jest
        .fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            id: 1,
            followup_enabled: 1,
            is_paused: 0,
            allowed_user_ids: '[]',
            max_per_run: 1,
            retry_delay_ms: 21600000,
            created_at: '2026-03-23T00:00:00.000Z',
            updated_at: '2026-03-23T00:00:00.000Z'
          }
        ])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            id: 1,
            followup_enabled: 1,
            is_paused: 1,
            allowed_user_ids: '[123456]',
            max_per_run: 3,
            retry_delay_ms: 5400000,
            created_at: '2026-03-23T00:00:00.000Z',
            updated_at: '2026-03-23T03:00:00.000Z'
          }
        ])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ queued_total: 2, active_total: 0 }])
        .mockResolvedValueOnce([{ recent_total: 1, last_action_at: '2026-03-23T02:30:00.000Z' }]),
      executeUpdate: jest.fn().mockResolvedValue(undefined),
      executeInsertAndReturnId: jest.fn()
    };

    const service = new AgentMemoryService(database as any);
    const state = await service.updateProactivityControls(
      {
        isPaused: true,
        allowedUserIds: [123456],
        maxPerRun: 3,
        retryDelayMs: 5400000
      },
      {
        followupEnabled: true,
        isPaused: false,
        allowedUserIds: [],
        maxPerRun: 1,
        retryDelayMs: 21600000
      }
    );

    expect(database.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_proactivity_controls'),
      [1, 1, '[123456]', 3, 5400000]
    );
    expect(state).toMatchObject({
      followupEnabled: true,
      isPaused: true,
      allowedUserIds: [123456],
      maxPerRun: 3,
      retryDelayMs: 5400000,
      queuedFollowups: 2,
      activeFollowups: 0,
      recentActionLogCount: 1,
      source: 'database'
    });
  });
});
