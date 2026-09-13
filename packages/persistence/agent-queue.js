'use strict';

const { randomUUID } = require('crypto');

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : String(value);
}

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseJson(value, fallback) {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeQueueRow(row, fallbackPayload = null) {
  if (!row) {
    return null;
  }
  return {
    queueId: Number(row.id || 0),
    traceId: row.trace_id,
    dedupeKey: row.dedupe_key,
    status: row.status,
    attempts: Number(row.attempts || 0),
    availableAt: normalizeDate(row.available_at),
    payload: row.payload || fallbackPayload || {}
  };
}

function buildBatchSummary(rows) {
  return rows.map((row, index) => `#${index + 1} ${row.sender_name || row.sender_id}: ${row.body_for_agent}`).join('\n');
}

function mapClaimedRun(input) {
  const messages = input.rows.map((row) => {
    const payload = parseJson(row.payload, {});
    const rawPayload = parseJson(row.raw_payload, {});
    return {
      queueMessageId: Number(row.id),
      traceId: input.traceId,
      source: row.source,
      messageId: payload.messageId ?? Number(row.id),
      messageSid: row.message_sid,
      chatType: row.chat_type === 'group' ? 'group' : 'direct',
      sessionKey: row.session_key,
      peerId: row.peer_id,
      peerName: row.peer_name || undefined,
      senderId: row.sender_id,
      senderName: row.sender_name || undefined,
      accountId: row.account_id,
      bodyForAgent: row.body_for_agent,
      rawBody: payload.rawBody || row.body_for_agent,
      commandBody: payload.commandBody || row.body_for_agent,
      wasMentioned: Boolean(payload.wasMentioned),
      receivedAt: payload.receivedAt || normalizeDate(row.created_at) || new Date().toISOString(),
      messageTimestamp: payload.messageTimestamp ?? null,
      rawPayload: {
        ...rawPayload,
        ...(payload.phoneNotification ? { phoneNotification: payload.phoneNotification } : {}),
        ...(payload.imageTaskNotification ? { imageTaskNotification: payload.imageTaskNotification } : {}),
        ...(payload.systemReminder ? { systemReminder: payload.systemReminder } : {})
      },
      inboundContext: parseJson(row.inbound_context, {})
    };
  });

  const latest = messages[messages.length - 1];
  const latestPayload = parseJson(input.rows[input.rows.length - 1]?.payload, {});
  const phoneNotifications = input.rows
    .map((row) => parseJson(row.payload, {}).phoneNotification)
    .filter(Boolean);
  const latestPhoneNotification = phoneNotifications[phoneNotifications.length - 1] || latestPayload.phoneNotification;
  const systemReminders = input.rows
    .map((row) => parseJson(row.payload, {}).systemReminder)
    .filter(Boolean);
  const latestSystemReminder = systemReminders[systemReminders.length - 1] || latestPayload.systemReminder;
  const phoneNotification = latestPhoneNotification
    ? {
        ...latestPhoneNotification,
        unreadDelta: phoneNotifications.reduce((sum, notification) => sum + Math.max(1, Number(notification.unreadDelta || 1)), 0) || Math.max(1, messages.length),
        directMentions: phoneNotifications.reduce((sum, notification) => sum + Math.max(0, Number(notification.directMentions || 0)), 0)
      }
    : undefined;
  const payload = {
    traceId: input.traceId,
    runId: input.runId,
    batchId: input.batchId,
    source: latest.source,
    chatType: latest.chatType,
    sessionKey: latest.sessionKey,
    peerId: latest.peerId,
    peerName: latest.peerName,
    senderId: latest.senderId,
    senderName: latest.senderName,
    accountId: latest.accountId,
    bodyForAgent: buildBatchSummary(input.rows),
    rawBody: messages.map((message) => message.rawBody).join('\n'),
    commandBody: messages.map((message) => message.commandBody).join('\n'),
    wasMentioned: messages.some((message) => message.wasMentioned),
    receivedAt: latest.receivedAt,
    messageTimestamp: latest.messageTimestamp,
    rawPayload: latest.rawPayload,
    inboundContext: latest.inboundContext,
    messages,
    ...(phoneNotification ? { phoneNotification } : {}),
    ...(latestSystemReminder ? { systemReminder: latestSystemReminder } : {}),
    ...(latestPayload.consciousnessTick ? { consciousnessTick: latestPayload.consciousnessTick } : {}),
    ...(latestPayload.presenceTick ? { presenceTick: latestPayload.presenceTick } : {}),
    ...(latestPayload.selfContinuation ? { selfContinuation: latestPayload.selfContinuation } : {})
  };

  return {
    id: input.runId,
    traceId: input.traceId,
    batchId: input.batchId,
    status: 'processing',
    attempts: Math.max(...input.rows.map((row) => Number(row.attempts || 0) + 1), 1),
    maxAttempts: Math.max(...input.rows.map((row) => Number(row.max_attempts || 3)), 1),
    createdAt: normalizeDate(input.rows[0]?.created_at) || new Date().toISOString(),
    processingStartedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: null,
    errorMessage: null,
    queueMessageIds: input.rows.map((row) => Number(row.id)),
    payload
  };
}

// 被动召回投递的 dedupe_key 前缀。睡觉期间召回这个场景不触发(agent-service xiaoni-recall-hook /
// xiaoni-recall-delivery 在触发点上按 active 睡眠会话拦);这里只留醒来那一帧的 flush:把睡前残留的
// 召回 pending 冲掉。入队口不做睡眠判断 —— 入队和消费是两个概念,其它通知睡觉期间照常入队、醒来消费。
const RECALL_SURFACE_DEDUPE_PREFIX = 'recall-surface:';

// ── Latest-wins 槽 & 开窗纪律（docs/NOTIFY_BUCKET_LATEST_WINS_COLLAPSE.md §2/§3/§5）──────────
//
// `lw:` 前缀的 dedupe_key 是「latest-wins 槽」：同 key 的新入队在既有行**仍 pending** 时就地覆盖
// （新覆盖旧，未读增量累加），既有行已被 claim/折叠时先把它的 key 轮换成历史唯一值（消费时做，见
// claim/fold 的 UPDATE），稳定槽让出来给下一条 pending。非 `lw:` 键（recall-surface 等）保持
// first-wins：那些调用方靠「撞键 = 早就投过」做投递账本，绝不能覆盖也绝不能轮换。
const LATEST_WINS_DEDUPE_PREFIX = 'lw:';
// 能叫醒她 / 开窗的事件只有一种标记：入队 payload 里的 `wakesXiaoni: true`（用户 2026-09-13 拍板：
// 「给 Notify 事件结构加一个睡觉唤醒属性，只给 QQ 私聊和群里 @ 她的事件加，其它不加；独立唤醒窗口只读
// 这一个属性、只累积这一个」）。产生事件的一方在入队时标：provider-service 给私聊 / 群 @ 标，
// 她自己的 notify 脚本可以显式传 wake。自驱动 plan、报时、被动召回、外部通知默认都不标 —— 它们
// 留在 pending，等下一个窗打开时一次折叠进去消费。睡眠期间的唤醒计数（agent-recovery-sessions.js）
// 读的也是同一个标记。
const WAKE_FLAG_PAYLOAD_KEY = 'wakesXiaoni';

function readWakesXiaoni(row) {
  const payload = parseJson(row.payload, {});
  const value = payload && typeof payload === 'object' ? payload[WAKE_FLAG_PAYLOAD_KEY] : undefined;
  return value === true || value === 'true';
}

function isWindowOpeningQueueRow(row) {
  if (!row) {
    return false;
  }
  return readWakesXiaoni(row);
}

// 消费时把 latest-wins 槽轮换成历史唯一值（dedupe_key 是簿记字段、从不进模型，轮换不违反上下文不可变）。
// 后缀带上行自己的 id:同一个槽在同一个 run 里被消费两次(开窗 claim 一次 + 后续 fold 一次)时,
// 两行不能轮换成同一个值,否则撞 dedupe_key 唯一索引、fold 事务回滚、主 run 被判 failed。
const ROTATE_LATEST_WINS_KEY_SQL = `dedupe_key = CASE
                  WHEN dedupe_key LIKE '${LATEST_WINS_DEDUPE_PREFIX}%' THEN dedupe_key || ':run:' || ? || ':' || id
                  ELSE dedupe_key
                END`;

function mergeLatestWinsPayload(existingPayload, incomingPayload) {
  const existing = parseJson(existingPayload, {}) || {};
  const incoming = incomingPayload && typeof incomingPayload === 'object' ? incomingPayload : {};
  const merged = { ...existing, ...incoming };
  const prev = existing.phoneNotification;
  const next = incoming.phoneNotification;
  if (prev && next && typeof prev === 'object' && typeof next === 'object') {
    merged.phoneNotification = {
      ...next,
      unreadDelta: Math.max(1, Number(prev.unreadDelta || 1)) + Math.max(1, Number(next.unreadDelta || 1)),
      directMentions: Math.max(0, Number(prev.directMentions || 0)) + Math.max(0, Number(next.directMentions || 0))
    };
  }
  return merged;
}

function mergeLatestWinsRawPayload(existingRaw, incomingRaw) {
  const existing = parseJson(existingRaw, {}) || {};
  const incoming = incomingRaw && typeof incomingRaw === 'object' ? incomingRaw : {};
  const merged = { ...existing, ...incoming };
  if ('unread_delta' in existing || 'unread_delta' in incoming) {
    merged.unread_delta = Math.max(1, Number(existing.unread_delta || 1)) + Math.max(1, Number(incoming.unread_delta || 1));
  }
  if ('direct_mentions' in existing || 'direct_mentions' in incoming) {
    merged.direct_mentions = Math.max(0, Number(existing.direct_mentions || 0)) + Math.max(0, Number(incoming.direct_mentions || 0));
  }
  return merged;
}

function isRecallSurfaceDedupeKey(dedupeKey) {
  return typeof dedupeKey === 'string' && dedupeKey.startsWith(RECALL_SURFACE_DEDUPE_PREFIX);
}

function createAgentQueuePersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  function createSql(input, config) {
    if (input?.sqlAdapter) {
      return {
        sql: input.sqlAdapter,
        shouldClose: false
      };
    }
    if (typeof createSqlAdapter !== 'function') {
      throw new Error('agent queue SQL operations require createSqlAdapter');
    }
    return {
      sql: createSqlAdapter(config),
      shouldClose: true
    };
  }

  async function enqueueAgentQueueMessage(input, config = {}) {
    const prisma = getClient(config);
    const message = input.message || input;
    const dedupeKey = normalizeOptionalString(message.dedupeKey || message.dedupe_key)
      || `${message.source}:${message.messageSid || message.message_sid}`;
    const payload = normalizeJsonObject(input.payload, message);
    const availableAt = input.availableAt || input.available_at || new Date();
    // Defense-in-depth (docs/CACHE_CONTRACT.md §3): a trace_id must never persist empty. The
    // stack runtime-input event_id keys on it (stack:<traceId>:runtime-input); an empty
    // trace_id collapses onto the runId fallback, and two such rows in one run then collide
    // under appendAgentStackItems' ON CONFLICT(event_id) — the second's content is dropped,
    // the next run's stack-replay rebuilds a shorter body, and the prompt cache breaks at the
    // run boundary. Production callers always supply a real trace_id (provider-service
    // createTraceId); this guards simulator / internal / replay callers that don't.
    const resolvedTraceId = normalizeOptionalString(message.traceId || message.trace_id)
      || `runtrace_${Date.now()}_${randomUUID().slice(0, 8)}`;

    const createRow = () => prisma.agentQueueMessage.create({
        data: {
          trace_id: resolvedTraceId,
          source: String(message.source || 'provider'),
          message_sid: String(message.messageSid || message.message_sid || dedupeKey),
          dedupe_key: dedupeKey,
          chat_type: message.chatType === 'direct' ? 'direct' : 'group',
          session_key: String(message.sessionKey || message.session_key || ''),
          peer_id: String(message.peerId || message.peer_id || ''),
          peer_name: normalizeOptionalString(message.peerName || message.peer_name),
          sender_id: String(message.senderId || message.sender_id || ''),
          sender_name: normalizeOptionalString(message.senderName || message.sender_name),
          account_id: String(message.accountId || message.account_id || ''),
          body_for_agent: String(message.bodyForAgent || message.body_for_agent || ''),
          raw_payload: normalizeJsonObject(message.rawPayload || message.raw_payload),
          inbound_context: normalizeJsonObject(message.inboundContext || message.inbound_context),
          payload,
          status: 'pending',
          available_at: availableAt
        }
      });
    // lw: 槽的 supersede 与 claim/fold 不是原子的:create 撞键 → findUnique 看到 pending → 这期间
    // claim 事务把那行消费并轮换了 key → updateMany 命中 0 行。此时稳定槽已经空出,再 INSERT 一次
    // 即可,绝不能退回「返回既有行」——那等于把这条新门铃静默丢掉(旧实现每条一个唯一键,没有这条丢失路径)。
    for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const created = await createRow();
      // created:true 只在真的新插了一行时为真。撞唯一索引返回既有行时是 false ——
      // 调用方(如被动浮现投递闸)靠它区分「这次投出去了」和「早就投过了」,
      // 光看 status 区分不了(既有行没被消费时同样是 pending)。
      return { ...normalizeQueueRow(created, payload), created: true };
    } catch (error) {
      if (error?.code !== 'P2002') {
        throw error;
      }
      const existing = await prisma.agentQueueMessage.findUnique({
        where: { dedupe_key: dedupeKey }
      });
      if (dedupeKey.startsWith(LATEST_WINS_DEDUPE_PREFIX) && !existing && attempt === 0) {
        // 撞键之后槽已被轮换走 → 再插一次。
        continue;
      }
      // latest-wins 槽：既有行还没进过上下文（pending）→ 新内容就地覆盖，未读增量累加。
      // 已进上下文的行（consumed/settled…）冻结不动：它的 key 在消费时已轮换走，正常情况下
      // 不会撞到这里；撞到了就是并发窗口，退回 first-wins 返回既有行。
      if (
        dedupeKey.startsWith(LATEST_WINS_DEDUPE_PREFIX)
        && existing
        && existing.status === 'pending'
      ) {
        const mergedPayload = mergeLatestWinsPayload(existing.payload, payload);
        const mergedRaw = mergeLatestWinsRawPayload(
          existing.raw_payload,
          normalizeJsonObject(message.rawPayload || message.raw_payload)
        );
        const incomingAvailableAt = normalizeDate(availableAt);
        const existingAvailableAt = normalizeDate(existing.available_at);
        const nextAvailableAt = existingAvailableAt && incomingAvailableAt && existingAvailableAt < incomingAvailableAt
          ? new Date(existingAvailableAt)
          : new Date(incomingAvailableAt || Date.now());
        const superseded = await prisma.agentQueueMessage.updateMany({
          where: { id: existing.id, status: 'pending' },
          data: {
            trace_id: resolvedTraceId,
            message_sid: String(message.messageSid || message.message_sid || dedupeKey),
            peer_name: normalizeOptionalString(message.peerName || message.peer_name),
            sender_id: String(message.senderId || message.sender_id || existing.sender_id || ''),
            sender_name: normalizeOptionalString(message.senderName || message.sender_name),
            body_for_agent: String(message.bodyForAgent || message.body_for_agent || ''),
            raw_payload: mergedRaw,
            inbound_context: normalizeJsonObject(message.inboundContext || message.inbound_context),
            payload: mergedPayload,
            attempts: 0,
            available_at: nextAvailableAt,
            updated_at: new Date()
          }
        });
        if (superseded && Number(superseded.count) > 0) {
          const refreshed = await prisma.agentQueueMessage.findUnique({ where: { id: existing.id } });
          return { ...normalizeQueueRow(refreshed || existing, mergedPayload), created: false, superseded: true };
        }
        if (attempt === 0) {
          // 既有行在 findUnique 与 updateMany 之间被消费(key 已轮换)→ 槽空了,再插一次。
          continue;
        }
      }
      const normalized = normalizeQueueRow(existing, payload) || {
        queueId: 0,
        traceId: resolvedTraceId,
        dedupeKey,
        status: 'pending',
        attempts: 0,
        availableAt: normalizeDate(availableAt),
        payload
      };
      return { ...normalized, created: false };
    }
    }
    throw new Error('enqueueAgentQueueMessage: unreachable');
  }

  // 按 dedupe_key 前缀列最近的入队键(新→旧)。入队记录本身就是投递账本(行自 2026-03 起
  // 从不清理),不必再建投递计数表。返回键而不是条数,是因为调用方要从**同一次读**里同时得到
  // 「投了几条」和「上一条是哪一类」—— dedupe_key 的前缀段就编着类别,两件事一个查询解决,
  // 不为轮转另开第二个真理源。
  async function listRecentAgentQueueDedupeKeys(params = {}, config = {}) {
    const prisma = getClient(config);
    const prefix = typeof params.prefix === 'string' ? params.prefix : '';
    if (!prefix) {
      return [];
    }
    const since = params.since instanceof Date ? params.since : new Date(Number(params.since) || 0);
    const take = Math.max(1, Math.min(Number(params.limit) || 500, 2000));
    const rows = await prisma.agentQueueMessage.findMany({
      where: { dedupe_key: { startsWith: prefix }, created_at: { gte: since } },
      select: { dedupe_key: true },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take
    });
    return rows.map((row) => row.dedupe_key).filter(Boolean);
  }

  // 某个 dedupe_key 前缀下最近一次入队的时刻(毫秒)。给「判断力缺席时按最小间隔节流」用。
  async function getLastAgentQueueEnqueuedAt(params = {}, config = {}) {
    const prisma = getClient(config);
    const prefix = typeof params.prefix === 'string' ? params.prefix : '';
    if (!prefix) {
      return null;
    }
    const row = await prisma.agentQueueMessage.findFirst({
      where: { dedupe_key: { startsWith: prefix } },
      select: { created_at: true },
      orderBy: { created_at: 'desc' }
    });
    return row && row.created_at ? new Date(row.created_at).getTime() : null;
  }

  async function claimNextAgentQueueMessage(input = {}, config = {}) {
    const workerId = normalizeOptionalString(input.workerId || input.worker_id) || 'agent-worker';
    // windowOpen=true：调用方已经因为别的原因开了窗（睡醒续帧等），pending 全部折进来。
    // 默认 false：只有 pending 里含「开窗」行时才起 run；否则一条都不动、返回 null。
    const windowOpen = input.windowOpen === true || input.window_open === true;
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await sql.withTransaction(async (tx) => {
        const rows = await tx.query(
          `
            SELECT *
            FROM agent_queue_messages
            WHERE status = 'pending'
              AND available_at <= NOW()
            ORDER BY available_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
          `
        );

        if (rows.length === 0) {
          return null;
        }
        if (!windowOpen && !rows.some(isWindowOpeningQueueRow)) {
          return null;
        }

        const id = randomUUID().slice(0, 8);
        const now = Date.now();
        const batchId = `batch_${now}_${id}`;
        const runId = `run_${now}_${randomUUID().slice(0, 8)}`;
        const traceId = `runtrace_${now}_${randomUUID().slice(0, 8)}`;
        const latest = rows[rows.length - 1];
        const placeholders = rows.map(() => '?').join(', ');
        const queueIds = rows.map((row) => Number(row.id));
        const chatType = latest.chat_type === 'group' ? 'group' : 'direct';

        await tx.insert(
          `
            INSERT INTO agent_message_batches (
              id,
              trace_id,
              session_key,
              chat_type,
              peer_id,
              peer_name,
              account_id,
              status,
              reason_for_start,
              input_message_count,
              summary,
              processing_started_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'debounce_window_elapsed', ?, ?, NOW())
          `,
          [
            batchId,
            traceId,
            latest.session_key,
            chatType,
            latest.peer_id,
            latest.peer_name,
            latest.account_id,
            rows.length,
            buildBatchSummary(rows)
          ]
        );

        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          await tx.insert(
            `
              INSERT INTO agent_message_batch_items (
                batch_id,
                queue_message_id,
                inbound_message_id,
                message_sid,
                position
              )
              VALUES (?, ?, ?, ?, ?)
            `,
            [batchId, row.id, row.id, row.message_sid, index + 1]
          );
        }

        await tx.insert(
          `
            INSERT INTO agent_runs (
              id,
              batch_id,
              trace_id,
              session_key,
              chat_type,
              peer_id,
              peer_name,
              account_id,
              status,
              delivery_phase,
              started_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', 'reasoning_open', NOW())
          `,
          [
            runId,
            batchId,
            traceId,
            latest.session_key,
            chatType,
            latest.peer_id,
            latest.peer_name,
            latest.account_id
          ]
        );

        await tx.execute(
          `
            UPDATE agent_queue_messages
            SET status = 'consumed',
                attempts = attempts + 1,
                locked_at = NOW(),
                locked_by = ?,
                processing_started_at = COALESCE(processing_started_at, NOW()),
                batch_id = ?,
                run_id = ?,
                trace_id = ?,
                result = ?::jsonb,
                ${ROTATE_LATEST_WINS_KEY_SQL},
                updated_at = NOW()
            WHERE id IN (${placeholders})
          `,
          [
            workerId,
            batchId,
            runId,
            traceId,
            JSON.stringify({
              doorbell_consumed: true,
              consumed_at: new Date(now).toISOString(),
              worker_id: workerId
            }),
            runId,
            ...queueIds
          ]
        );

        return mapClaimedRun({
          runId,
          batchId,
          traceId,
          rows: rows.map((row) => ({
            ...row,
            batch_id: batchId,
            run_id: runId,
            trace_id: traceId
          }))
        });
      });
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  // Fold any pending doorbell messages into an ALREADY-RUNNING parent run,
  // WITHOUT minting a new agent_runs / agent_message_batches row. This is the
  // non-blocking notify-append path: one execution consuming an extra notify,
  // not a second run. By keying the folded messages to the parent run_id, the
  // existing settle/fail/retry functions (all WHERE run_id = ?) cover them, so:
  //   * parent settles  -> folded messages settle (acked only on success)
  //   * parent retries   -> folded messages reset to pending (reprocessed, not lost)
  //   * parent fails     -> folded messages fail (recorded, not silently dropped)
  // The old path used claimNextAgentQueueMessage here, which minted a phantom
  // run/batch row (the "two runs on one conversation" artifact) AND acked the
  // message at fold time, so a transient parent failure dropped it forever.
  async function foldPendingNotifyMessagesIntoRun(input = {}, config = {}) {
    const workerId = normalizeOptionalString(input.workerId || input.worker_id) || 'agent-worker';
    const parentRunId = normalizeOptionalString(input.parentRunId || input.parent_run_id);
    const parentBatchId = normalizeOptionalString(input.parentBatchId || input.parent_batch_id);
    if (!parentRunId || !parentBatchId) {
      throw new Error('foldPendingNotifyMessagesIntoRun requires parentRunId and parentBatchId');
    }
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await sql.withTransaction(async (tx) => {
        const rows = await tx.query(
          `
            SELECT *
            FROM agent_queue_messages
            WHERE status = 'pending'
              AND available_at <= NOW()
            ORDER BY available_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
          `
        );

        if (rows.length === 0) {
          return null;
        }

        const now = Date.now();
        const placeholders = rows.map(() => '?').join(', ');
        const queueIds = rows.map((row) => Number(row.id));

        await tx.execute(
          `
            UPDATE agent_queue_messages
            SET status = 'consumed',
                attempts = attempts + 1,
                locked_at = NOW(),
                locked_by = ?,
                processing_started_at = COALESCE(processing_started_at, NOW()),
                batch_id = ?,
                run_id = ?,
                result = ?::jsonb,
                ${ROTATE_LATEST_WINS_KEY_SQL},
                updated_at = NOW()
            WHERE id IN (${placeholders})
          `,
          [
            workerId,
            parentBatchId,
            parentRunId,
            JSON.stringify({
              folded_nonblocking_notify: true,
              parent_run_id: parentRunId,
              folded_at: new Date(now).toISOString(),
              worker_id: workerId
            }),
            parentRunId,
            ...queueIds
          ]
        );

        // Preserve each folded message's own trace_id (NOT overwritten above) for
        // archival lineage; key the returned record to the parent run/batch so the
        // caller settles/fails/retries it through the parent's lifecycle.
        return mapClaimedRun({
          runId: parentRunId,
          batchId: parentBatchId,
          traceId: rows[rows.length - 1].trace_id,
          rows: rows.map((row) => ({
            ...row,
            batch_id: parentBatchId,
            run_id: parentRunId
          }))
        });
      });
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function settleAgentQueueMessages(input = {}, config = {}) {
    const runId = normalizeOptionalString(input.runId || input.run_id);
    if (!runId) {
      throw new Error('settleAgentQueueMessages requires runId');
    }
    const { sql, shouldClose } = createSql(input, config);
    try {
      await sql.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'settled',
              result = ?::jsonb,
              completed_at = NOW(),
              updated_at = NOW(),
              error_message = NULL
          WHERE run_id = ?
        `,
        [
          JSON.stringify(normalizeJsonObject(input.result)),
          runId
        ]
      );
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function failAgentQueueMessage(input = {}, config = {}) {
    const runId = normalizeOptionalString(input.runId || input.run_id);
    if (!runId) {
      throw new Error('failAgentQueueMessage requires runId');
    }
    const { sql, shouldClose } = createSql(input, config);
    try {
      await sql.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'failed',
              error_message = ?,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE run_id = ?
        `,
        [
          String(input.errorMessage || input.error_message || ''),
          runId
        ]
      );
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function retryAgentQueueMessage(input = {}, config = {}) {
    const runId = normalizeOptionalString(input.runId || input.run_id);
    if (!runId) {
      throw new Error('retryAgentQueueMessage requires runId');
    }
    const retryDelayMs = Math.max(0, Number(input.retryDelayMs ?? input.retry_delay_ms ?? 0) || 0);
    const errorMessage = String(input.errorMessage || input.error_message || '');
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await sql.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'pending',
              available_at = NOW() + (? * INTERVAL '1 millisecond'),
              locked_at = NULL,
              locked_by = NULL,
              batch_id = NULL,
              run_id = NULL,
              completed_at = NULL,
              error_message = ?,
              result = ?::jsonb,
              updated_at = NOW()
          WHERE run_id = ?
            AND attempts < max_attempts
        `,
        [
          retryDelayMs,
          errorMessage,
          JSON.stringify({
            doorbell_retry_pending: true,
            failed_run_id: runId,
            retry_after_ms: retryDelayMs,
            error_message: errorMessage,
            retry_scheduled_at: new Date().toISOString()
          }),
          runId
        ]
      );
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  // 报时(clock_ping)只应该存在「现在」这一条。停机调试期间 supervisor 照常按格入队,一夜就
  // 攒六条;她一恢复会连着读到六个不同的时刻和六个不同的「你醒了多久」——正好制造出这套
  // 机制要消灭的那种时间错乱。所以入队新一格之前,把更早的 pending 报时直接判为过期。
  //
  // 只碰 pending 且 reason=clock_ping 的行:已被 claim 的(consumed/settled)绝不回改——那些
  // 已经进过她的上下文,而上下文一旦消费就冻结不可变。keepMessageSid 是本次要留的那一条。
  async function supersedePendingClockPings(input = {}, config = {}) {
    const sessionKey = normalizeOptionalString(input.sessionKey || input.session_key);
    if (!sessionKey) {
      throw new Error('supersedePendingClockPings requires sessionKey');
    }
    const keepMessageSid = normalizeOptionalString(input.keepMessageSid || input.keep_message_sid);
    const { sql, shouldClose } = createSql(input, config);
    try {
      // execute() 返回 rowCount(见 createSqlExecutor),不返回行——所以不要 RETURNING。
      const supersededCount = await sql.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'settled',
              completed_at = NOW(),
              updated_at = NOW(),
              result = ?::jsonb
          WHERE status = 'pending'
            AND session_key = ?
            AND raw_payload->>'reason' = 'clock_ping'
            -- 显式 ::text:裸参数的 IS NULL 在 PG 上推不出类型,会直接报
            -- "could not determine data type of parameter"。真库用例钉住这一点。
            AND (?::text IS NULL OR message_sid <> ?::text)
        `,
        [
          JSON.stringify({ superseded_by_newer_clock_ping: true, kept_message_sid: keepMessageSid }),
          sessionKey,
          keepMessageSid,
          keepMessageSid
        ]
      );
      return { supersededCount: Number(supersededCount) || 0 };
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  // 醒来那一帧调用:把所有还 pending 的被动召回投递(dedupe_key `recall-surface:*`)冲掉。它们是睡前 /
  // 睡觉期间攒下的联想,对醒来的她已经是旧的;其它通知一条不动。已被 claim(processing)的行绝不回改。
  async function flushPendingRecallSurfaceQueueMessages(input = {}, config = {}) {
    const recoverySessionId = Number.isFinite(Number(input.recoverySessionId ?? input.recovery_session_id))
      ? Number(input.recoverySessionId ?? input.recovery_session_id)
      : null;
    const { sql, shouldClose } = createSql(input, config);
    try {
      const flushedCount = await sql.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'settled',
              completed_at = NOW(),
              updated_at = NOW(),
              result = ?::jsonb
          WHERE status = 'pending'
            AND dedupe_key LIKE ?
        `,
        [
          JSON.stringify({ flushed_on_wake: true, recovery_session_id: recoverySessionId }),
          `${RECALL_SURFACE_DEDUPE_PREFIX}%`
        ]
      );
      return { flushedCount: Number(flushedCount) || 0 };
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  return {
    enqueueAgentQueueMessage,
    flushPendingRecallSurfaceQueueMessages,
    isWindowOpeningQueueRow,
    LATEST_WINS_DEDUPE_PREFIX,
    WAKE_FLAG_PAYLOAD_KEY,
    listRecentAgentQueueDedupeKeys,
    getLastAgentQueueEnqueuedAt,
    claimNextAgentQueueMessage,
    foldPendingNotifyMessagesIntoRun,
    settleAgentQueueMessages,
    supersedePendingClockPings,
    failAgentQueueMessage,
    retryAgentQueueMessage
  };
}

module.exports = {
  RECALL_SURFACE_DEDUPE_PREFIX,
  isRecallSurfaceDedupeKey,
  createAgentQueuePersistence
};
