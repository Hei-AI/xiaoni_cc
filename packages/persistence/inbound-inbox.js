'use strict';

const { serializeTimestampForApi } = require('./time');

const TABLE_NAME = 'agent_inbound_messages';
const THREAD_STATE_TABLE_NAME = 'agent_inbound_thread_states';
const DEFAULT_CLAIM_LIMIT = 20;
const DEFAULT_MESSAGE_LIMIT = 100;

function effectiveUnreadPredicate(alias, lastReadExpression) {
  return `${alias}.is_read = 0 AND ${alias}.received_at > COALESCE(${lastReadExpression || `(
            SELECT MAX(r.received_at)
            FROM ${TABLE_NAME} r
            WHERE r.session_key = ${alias}.session_key
              AND r.is_read = 1
          )`}, '-infinity'::timestamptz)`;
}

function normalizeIso(value) {
  return serializeTimestampForApi(value);
}

function parseJsonRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toChatType(value) {
  return value === 'group' ? 'group' : 'direct';
}

function buildPeerId(context) {
  if (toChatType(context.ChatType) === 'group') {
    return context.NativeChannelId || String(context.To || '').replace(/^group:/, '') || 'unknown-group';
  }

  return context.NativeChannelId
    || String(context.To || '').replace(/^user:/, '')
    || context.SenderId
    || 'unknown-user';
}

function buildPeerName(context) {
  if (toChatType(context.ChatType) === 'group') {
    return context.GroupSubject || context.ConversationLabel || undefined;
  }

  return context.ConversationLabel || context.SenderName || undefined;
}

function toReceivedAt() {
  return new Date();
}

function toMessageTimestamp(context) {
  if (!context.Timestamp || !Number.isFinite(Number(context.Timestamp))) {
    return null;
  }

  return new Date(Number(context.Timestamp));
}

function mapRow(row) {
  return {
    id: Number(row.id),
    traceId: row.trace_id,
    source: row.source,
    messageSid: row.message_sid,
    dedupeKey: row.dedupe_key,
    chatType: row.chat_type === 'group' ? 'group' : 'direct',
    sessionKey: row.session_key,
    peerId: row.peer_id,
    peerName: row.peer_name || undefined,
    senderId: row.sender_id,
    senderName: row.sender_name || undefined,
    accountId: row.account_id,
    isRead: Boolean(Number(row.is_read)),
    readAt: normalizeIso(row.read_at),
    receivedAt: normalizeIso(row.received_at) || new Date().toISOString(),
    messageTimestamp: normalizeIso(row.message_timestamp),
    bodyForAgent: row.body_for_agent,
    rawBody: row.raw_body || row.body_for_agent,
    commandBody: row.command_body || row.body_for_agent,
    wasMentioned: Boolean(Number(row.was_mentioned)),
    replyToId: row.reply_to_id || undefined,
    replyToBody: row.reply_to_body || undefined,
    replyToSender: row.reply_to_sender || undefined,
    rawPayload: parseJsonRecord(row.raw_payload),
    inboundContext: parseJsonRecord(row.inbound_context)
  };
}

function isInsertedRow(row) {
  return row?.inserted === true || row?.inserted === 't' || row?.inserted === 1 || row?.inserted === '1';
}

async function refreshInboundThreadState(sql, sessionKey) {
  if (!sessionKey) {
    return 0;
  }

  return sql.execute(
    `
      INSERT INTO ${THREAD_STATE_TABLE_NAME} (
        session_key,
        chat_type,
        peer_id,
        peer_name,
        account_id,
        total_messages,
        unread_count,
        direct_mentions,
        last_message_id,
        last_received_at,
        latest_unread_received_at,
        last_read_received_at,
        updated_at
      )
      WITH scoped AS (
        SELECT *
        FROM ${TABLE_NAME}
        WHERE session_key = ?
      ),
      last_read AS (
        SELECT MAX(received_at) AS last_read_received_at
        FROM scoped
        WHERE is_read = 1
      ),
      latest AS (
        SELECT
          id AS last_message_id,
          session_key,
          chat_type,
          peer_id,
          peer_name,
          account_id,
          received_at AS last_received_at
        FROM scoped
        ORDER BY received_at DESC, id DESC
        LIMIT 1
      ),
      summary AS (
        SELECT
          COUNT(*) AS total_messages,
          SUM(CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} THEN 1 ELSE 0 END) AS unread_count,
          SUM(CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} AND m.was_mentioned = 1 THEN 1 ELSE 0 END) AS direct_mentions,
          MAX(CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} THEN m.received_at ELSE NULL END) AS latest_unread_received_at,
          lr.last_read_received_at
        FROM scoped m
        CROSS JOIN last_read lr
      )
      SELECT
        latest.session_key,
        latest.chat_type,
        latest.peer_id,
        latest.peer_name,
        latest.account_id,
        COALESCE(summary.total_messages, 0),
        COALESCE(summary.unread_count, 0),
        COALESCE(summary.direct_mentions, 0),
        latest.last_message_id,
        latest.last_received_at,
        summary.latest_unread_received_at,
        summary.last_read_received_at,
        CURRENT_TIMESTAMP
      FROM latest
      CROSS JOIN summary
      ON CONFLICT (session_key) DO UPDATE SET
        chat_type = EXCLUDED.chat_type,
        peer_id = EXCLUDED.peer_id,
        peer_name = EXCLUDED.peer_name,
        account_id = EXCLUDED.account_id,
        total_messages = EXCLUDED.total_messages,
        unread_count = EXCLUDED.unread_count,
        direct_mentions = EXCLUDED.direct_mentions,
        last_message_id = EXCLUDED.last_message_id,
        last_received_at = EXCLUDED.last_received_at,
        latest_unread_received_at = EXCLUDED.latest_unread_received_at,
        last_read_received_at = EXCLUDED.last_read_received_at,
        updated_at = CURRENT_TIMESTAMP
    `,
    [sessionKey]
  );
}

async function refreshInboundThreadStates(sql, sessionKeys) {
  const uniqueKeys = Array.from(new Set(sessionKeys.filter(Boolean)));
  let refreshed = 0;
  for (const sessionKey of uniqueKeys) {
    refreshed += await refreshInboundThreadState(sql, sessionKey);
  }
  return refreshed;
}

function createInboundInboxPersistence({ createSqlAdapter, sqlAdapter } = {}) {
  function createSql(input = {}, config = {}) {
    if (input?.sqlAdapter) {
      return {
        sql: input.sqlAdapter,
        shouldClose: false
      };
    }
    if (sqlAdapter) {
      return {
        sql: sqlAdapter,
        shouldClose: false
      };
    }
    if (typeof createSqlAdapter !== 'function') {
      throw new Error('inbound inbox SQL operations require createSqlAdapter');
    }
    return {
      sql: createSqlAdapter(config),
      shouldClose: true
    };
  }

  async function withSql(input, config, callback) {
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await callback(sql);
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function ensureInboundInboxSchema(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
            id BIGSERIAL PRIMARY KEY,
            trace_id VARCHAR(128) NOT NULL,
            source VARCHAR(32) NOT NULL,
            message_sid VARCHAR(191) NOT NULL,
            dedupe_key VARCHAR(255) NOT NULL,
            chat_type VARCHAR(16) NOT NULL,
            session_key VARCHAR(191) NOT NULL,
            peer_id VARCHAR(191) NOT NULL,
            peer_name VARCHAR(255) NULL,
            sender_id VARCHAR(191) NOT NULL,
            sender_name VARCHAR(255) NULL,
            account_id VARCHAR(191) NOT NULL,
            is_read INTEGER NOT NULL DEFAULT 0,
            read_at TIMESTAMPTZ(3) NULL,
            received_at TIMESTAMPTZ(3) NOT NULL,
            message_timestamp TIMESTAMPTZ(3) NULL,
            body_for_agent TEXT NOT NULL,
            raw_body TEXT NULL,
            command_body TEXT NULL,
            was_mentioned INTEGER NOT NULL DEFAULT 0,
            reply_to_id VARCHAR(191) NULL,
            reply_to_body TEXT NULL,
            reply_to_sender VARCHAR(255) NULL,
            raw_payload JSONB NOT NULL,
            inbound_context JSONB NOT NULL,
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );

      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS ${THREAD_STATE_TABLE_NAME} (
            session_key VARCHAR(191) PRIMARY KEY,
            chat_type VARCHAR(16) NOT NULL,
            peer_id VARCHAR(191) NOT NULL,
            peer_name VARCHAR(255) NULL,
            account_id VARCHAR(191) NOT NULL,
            total_messages INTEGER NOT NULL DEFAULT 0,
            unread_count INTEGER NOT NULL DEFAULT 0,
            direct_mentions INTEGER NOT NULL DEFAULT 0,
            last_message_id BIGINT NULL,
            last_received_at TIMESTAMPTZ(3) NULL,
            latest_unread_received_at TIMESTAMPTZ(3) NULL,
            last_read_received_at TIMESTAMPTZ(3) NULL,
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `ALTER TABLE ${THREAD_STATE_TABLE_NAME} ADD COLUMN IF NOT EXISTS latest_unread_received_at TIMESTAMPTZ(3) NULL`
      );

      const rows = await sql.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?`,
        [TABLE_NAME]
      );
      const threadStateRows = await sql.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?`,
        [THREAD_STATE_TABLE_NAME]
      );
      const existing = new Set(rows.map((row) => row.indexname));
      const existingThreadState = new Set(threadStateRows.map((row) => row.indexname));
      const statements = [
        {
          name: 'uq_agent_inbound_messages_dedupe',
          sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_inbound_messages_dedupe ON ${TABLE_NAME} (dedupe_key)`
        },
        {
          name: 'idx_agent_inbound_messages_session_received',
          sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_messages_session_received ON ${TABLE_NAME} (session_key, received_at, id)`
        },
        {
          name: 'idx_agent_inbound_messages_unread_session',
          sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_messages_unread_session ON ${TABLE_NAME} (is_read, session_key, received_at, id)`
        },
        {
          name: 'idx_agent_inbound_messages_message_sid',
          sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_messages_message_sid ON ${TABLE_NAME} (message_sid)`
        },
        {
          name: 'idx_agent_inbound_messages_peer',
          sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_messages_peer ON ${TABLE_NAME} (chat_type, peer_id, received_at, id)`
        }
      ];

      for (const statement of statements) {
        if (!existing.has(statement.name)) {
          await sql.execute(statement.sql);
        }
      }

      const threadStateStatements = [
        {
          name: 'idx_agent_inbound_thread_states_last_received',
          sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_thread_states_last_received ON ${THREAD_STATE_TABLE_NAME} (last_received_at, session_key)`
        },
        {
          name: 'idx_agent_inbound_thread_states_peer',
          sql: `CREATE INDEX IF NOT EXISTS idx_agent_inbound_thread_states_peer ON ${THREAD_STATE_TABLE_NAME} (chat_type, peer_id)`
        }
      ];

      for (const statement of threadStateStatements) {
        if (!existingThreadState.has(statement.name)) {
          await sql.execute(statement.sql);
        }
      }

      await sql.execute(
        `
          INSERT INTO ${THREAD_STATE_TABLE_NAME} (
            session_key,
            chat_type,
            peer_id,
            peer_name,
            account_id,
            total_messages,
            unread_count,
            direct_mentions,
            last_message_id,
            last_received_at,
            latest_unread_received_at,
            last_read_received_at,
            updated_at
          )
          WITH last_read AS (
            SELECT session_key, MAX(received_at) AS last_read_received_at
            FROM ${TABLE_NAME}
            WHERE is_read = 1
            GROUP BY session_key
          ),
          latest AS (
            SELECT DISTINCT ON (session_key)
              session_key,
              id AS last_message_id,
              chat_type,
              peer_id,
              peer_name,
              account_id,
              received_at AS last_received_at
            FROM ${TABLE_NAME}
            ORDER BY session_key, received_at DESC, id DESC
          ),
          summary AS (
            SELECT
              m.session_key,
              COUNT(*) AS total_messages,
              SUM(CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} THEN 1 ELSE 0 END) AS unread_count,
              SUM(CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} AND m.was_mentioned = 1 THEN 1 ELSE 0 END) AS direct_mentions,
              MAX(CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} THEN m.received_at ELSE NULL END) AS latest_unread_received_at,
              lr.last_read_received_at
            FROM ${TABLE_NAME} m
            LEFT JOIN last_read lr ON lr.session_key = m.session_key
            GROUP BY m.session_key, lr.last_read_received_at
          )
          SELECT
            latest.session_key,
            latest.chat_type,
            latest.peer_id,
            latest.peer_name,
            latest.account_id,
            COALESCE(summary.total_messages, 0),
            COALESCE(summary.unread_count, 0),
            COALESCE(summary.direct_mentions, 0),
            latest.last_message_id,
            latest.last_received_at,
            summary.latest_unread_received_at,
            summary.last_read_received_at,
            CURRENT_TIMESTAMP
          FROM latest
          JOIN summary ON summary.session_key = latest.session_key
          ON CONFLICT (session_key) DO UPDATE SET
            chat_type = EXCLUDED.chat_type,
            peer_id = EXCLUDED.peer_id,
            peer_name = EXCLUDED.peer_name,
            account_id = EXCLUDED.account_id,
            total_messages = EXCLUDED.total_messages,
            unread_count = EXCLUDED.unread_count,
            direct_mentions = EXCLUDED.direct_mentions,
            last_message_id = EXCLUDED.last_message_id,
            last_received_at = EXCLUDED.last_received_at,
            latest_unread_received_at = EXCLUDED.latest_unread_received_at,
            last_read_received_at = EXCLUDED.last_read_received_at,
            updated_at = CURRENT_TIMESTAMP
        `
      );
    });
  }

  async function persistInboundMessage(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const inboundContext = input.inboundContext || input.inbound_context || {};
      const traceId = input.traceId || input.trace_id || '';
      const source = input.source || 'napcat';
      const messageSid = inboundContext.MessageSid || traceId;
      const sessionKey = inboundContext.SessionKey || traceId;
      const chatType = toChatType(inboundContext.ChatType);
      const peerId = buildPeerId(inboundContext);
      const peerName = buildPeerName(inboundContext);
      const senderId = inboundContext.SenderId || peerId;
      const senderName = inboundContext.SenderName || undefined;
      const accountId = inboundContext.AccountId || 'unknown-bot';
      const dedupeKey = `${source}:${messageSid}`;
      const receivedAt = toReceivedAt(inboundContext);
      const messageTimestamp = toMessageTimestamp(inboundContext);

      const rawPayloadJson = JSON.stringify(input.rawPayload || input.raw_payload || {});
      const inboundContextJson = JSON.stringify(inboundContext);
      const rows = await sql.query(
        `
          WITH inserted AS (
            INSERT INTO ${TABLE_NAME} (
              trace_id,
              source,
              message_sid,
              dedupe_key,
              chat_type,
              session_key,
              peer_id,
              peer_name,
              sender_id,
              sender_name,
              account_id,
              is_read,
              read_at,
              received_at,
              message_timestamp,
              body_for_agent,
              raw_body,
              command_body,
              was_mentioned,
              reply_to_id,
              reply_to_body,
              reply_to_sender,
              raw_payload,
              inbound_context
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb))
            ON CONFLICT (dedupe_key) DO NOTHING
            RETURNING *, TRUE AS inserted
          ),
          updated AS (
            UPDATE ${TABLE_NAME}
            SET
              trace_id = ?,
              raw_payload = CAST(? AS jsonb),
              inbound_context = CAST(? AS jsonb),
              updated_at = CURRENT_TIMESTAMP
            WHERE dedupe_key = ?
              AND NOT EXISTS (SELECT 1 FROM inserted)
            RETURNING *, FALSE AS inserted
          )
          SELECT *
          FROM inserted
          UNION ALL
          SELECT *
          FROM updated
          LIMIT 1
        `,
        [
          traceId,
          source,
          messageSid,
          dedupeKey,
          chatType,
          sessionKey,
          peerId,
          peerName || null,
          senderId,
          senderName || null,
          accountId,
          receivedAt,
          messageTimestamp,
          inboundContext.BodyForAgent,
          inboundContext.RawBody || inboundContext.BodyForAgent,
          inboundContext.CommandBody || inboundContext.BodyForCommands || inboundContext.BodyForAgent,
          inboundContext.WasMentioned === true ? 1 : 0,
          inboundContext.ReplyToId || null,
          inboundContext.ReplyToBody || null,
          inboundContext.ReplyToSender || null,
          rawPayloadJson,
          inboundContextJson,
          traceId,
          rawPayloadJson,
          inboundContextJson,
          dedupeKey
        ]
      );

      if (!rows[0]) {
        throw new Error('Failed to read persisted inbound message');
      }

      if (isInsertedRow(rows[0])) {
        await refreshInboundThreadState(sql, sessionKey);
      }

      return mapRow(rows[0]);
    });
  }

  async function getInboundInboxStats(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT
            COUNT(*) AS total_conversations,
            SUM(total_messages) AS total_messages,
            COUNT(CASE WHEN unread_count > 0 THEN 1 END) AS unread_conversations,
            SUM(unread_count) AS unread_messages,
            MAX(last_received_at) AS last_received_at
          FROM ${THREAD_STATE_TABLE_NAME}
        `
      );

      const row = rows[0];
      return {
        totalConversations: Number(row?.total_conversations || 0),
        totalMessages: Number(row?.total_messages || 0),
        unreadConversations: Number(row?.unread_conversations || 0),
        unreadMessages: Number(row?.unread_messages || 0),
        lastReceivedAt: normalizeIso(row?.last_received_at)
      };
    });
  }

  async function listInboundInboxConversations(input = {}, config = {}) {
    const limit = Math.max(Number(input.limit) || 100, 1);
    const offset = Math.max(Number(input.offset) || 0, 0);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT
            s.session_key,
            s.chat_type,
            s.peer_id,
            s.peer_name,
            s.account_id,
            s.unread_count,
            s.total_messages,
            s.last_received_at,
            s.latest_unread_received_at,
            s.last_read_received_at,
            (
              SELECT x.body_for_agent
              FROM ${TABLE_NAME} x
              WHERE x.id = s.last_message_id
              ORDER BY x.received_at DESC, x.id DESC
              LIMIT 1
            ) AS latest_body_for_agent,
            (
              SELECT x.sender_id
              FROM ${TABLE_NAME} x
              WHERE x.id = s.last_message_id
              ORDER BY x.received_at DESC, x.id DESC
              LIMIT 1
            ) AS latest_sender_id,
            (
              SELECT x.sender_name
              FROM ${TABLE_NAME} x
              WHERE x.id = s.last_message_id
              ORDER BY x.received_at DESC, x.id DESC
              LIMIT 1
            ) AS latest_sender_name
          FROM ${THREAD_STATE_TABLE_NAME} s
          ORDER BY s.last_received_at DESC
          LIMIT ? OFFSET ?
        `,
        [limit, offset]
      );

      return rows.map((row) => ({
        sessionKey: row.session_key,
        chatType: row.chat_type === 'group' ? 'group' : 'direct',
        peerId: row.peer_id,
        peerName: row.peer_name || undefined,
        accountId: row.account_id,
        unreadCount: Number(row.unread_count || 0),
        totalMessages: Number(row.total_messages || 0),
        lastReceivedAt: normalizeIso(row.last_received_at),
        latestUnreadReceivedAt: normalizeIso(row.latest_unread_received_at),
        latestBodyForAgent: row.latest_body_for_agent || undefined,
        latestSenderId: row.latest_sender_id || undefined,
        latestSenderName: row.latest_sender_name || undefined
      }));
    });
  }

  async function listInboundConversationMessages(input = {}, config = {}) {
    const limit = Math.max(input.limit || DEFAULT_MESSAGE_LIMIT, 1);
    const params = [input.sessionKey];
    const filters = ['session_key = ?'];

    if (!input.includeRead) {
      filters.push('is_read = 0');
    }

    params.push(limit);

    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT *
          FROM ${TABLE_NAME}
          WHERE ${filters.join(' AND ')}
          ORDER BY received_at DESC, id DESC
          LIMIT ?
        `,
        params
      );

      return rows.map(mapRow);
    });
  }

  async function listUnreadInboundMessages(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT m.*
          FROM ${TABLE_NAME} m
          WHERE ${effectiveUnreadPredicate('m')}
          ORDER BY m.received_at DESC, m.id DESC
        `
      );

      return rows.map(mapRow);
    });
  }

  async function claimInboundMessages(input = {}, config = {}) {
    const limit = Math.max(input.limit || DEFAULT_CLAIM_LIMIT, 1);
    const claimOrder = input.order === 'latest'
      ? 'received_at DESC, id DESC'
      : 'received_at ASC, id ASC';
    const shouldMarkRead = input.markRead !== false;
    const includeMessageIds = Array.isArray(input.includeMessageIds)
      ? input.includeMessageIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      : [];

    return withSql(input, config, async (sql) => {
      const rows = await sql.withTransaction(async (tx) => {
        const filters = [effectiveUnreadPredicate('m')];
        const params = [];

        if (input.sessionKey) {
          filters.push('m.session_key = ?');
          params.push(input.sessionKey);
        }

        params.push(limit);

        const idRows = await tx.query(
          `
            SELECT m.id
            FROM ${TABLE_NAME} m
            WHERE ${filters.join(' AND ')}
            ORDER BY m.${claimOrder.replace(', ', ', m.')}
            LIMIT ?
            FOR UPDATE
          `,
          params
        );

        const selectedIds = new Set(idRows.map((row) => Number(row.id)));
        if (includeMessageIds.length > 0) {
          const includePlaceholders = includeMessageIds.map(() => '?').join(', ');
          const includeFilters = ['is_read = 0', `id IN (${includePlaceholders})`];
          const includeParams = [...includeMessageIds];
          if (input.sessionKey) {
            includeFilters.push('session_key = ?');
            includeParams.push(input.sessionKey);
          }
          const includeRows = await tx.query(
            `
              SELECT id
              FROM ${TABLE_NAME}
              WHERE ${includeFilters.join(' AND ')}
              FOR UPDATE
            `,
            includeParams
          );
          for (const row of includeRows) {
            selectedIds.add(Number(row.id));
          }
        }

        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
          return [];
        }

        const placeholders = ids.map(() => '?').join(', ');

        if (shouldMarkRead) {
          await tx.execute(
            `
              UPDATE ${TABLE_NAME}
              SET is_read = 1, read_at = NOW()
              WHERE id IN (${placeholders})
            `,
            ids
          );
        }

        const rows = await tx.query(
          `
            SELECT *
            FROM ${TABLE_NAME}
            WHERE id IN (${placeholders})
            ORDER BY received_at ASC, id ASC
          `,
          ids
        );
        if (shouldMarkRead) {
          await refreshInboundThreadStates(tx, rows.map((row) => row.session_key));
        }
        return rows;
      });

      return rows.map(mapRow);
    });
  }

  async function markInboundMessagesRead(input = {}, config = {}) {
    const ids = Array.isArray(input.ids)
      ? input.ids
      : Array.isArray(input)
        ? input
        : [];
    const uniqueIds = Array.from(new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
    if (uniqueIds.length === 0) {
      return 0;
    }

    return withSql(input, config, async (sql) => {
      const placeholders = uniqueIds.map(() => '?').join(', ');
      return sql.withTransaction(async (tx) => {
        const rows = await tx.query(
          `
            SELECT DISTINCT session_key
            FROM ${TABLE_NAME}
            WHERE id IN (${placeholders})
          `,
          uniqueIds
        );
        const updated = await tx.execute(
          `
            UPDATE ${TABLE_NAME}
            SET is_read = 1, read_at = COALESCE(read_at, NOW())
            WHERE id IN (${placeholders})
          `,
          uniqueIds
        );
        await refreshInboundThreadStates(tx, rows.map((row) => row.session_key));
        return updated;
      });
    });
  }

  return {
    ensureInboundInboxSchema,
    persistInboundMessage,
    getInboundInboxStats,
    listInboundInboxConversations,
    listInboundConversationMessages,
    listUnreadInboundMessages,
    claimInboundMessages,
    markInboundMessagesRead
  };
}

module.exports = {
  createInboundInboxPersistence,
  effectiveUnreadPredicate
};
