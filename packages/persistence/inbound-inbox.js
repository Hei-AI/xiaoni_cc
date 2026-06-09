'use strict';

const { serializeTimestampForApi } = require('./time');

const TABLE_NAME = 'agent_inbound_messages';
const DEFAULT_CLAIM_LIMIT = 20;
const DEFAULT_MESSAGE_LIMIT = 100;

function effectiveUnreadPredicate(alias, lastReadExpression) {
  return `${alias}.is_read = 0 AND ${alias}.received_at > COALESCE(${lastReadExpression || `(
            SELECT MAX(r.received_at)
            FROM ${TABLE_NAME} r
            WHERE r.session_key = ${alias}.session_key
              AND r.is_read = 1
          )`}, '-infinity'::timestamp)`;
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
            read_at TIMESTAMP(3) NULL,
            received_at TIMESTAMP(3) NOT NULL,
            message_timestamp TIMESTAMP(3) NULL,
            body_for_agent TEXT NOT NULL,
            raw_body TEXT NULL,
            command_body TEXT NULL,
            was_mentioned INTEGER NOT NULL DEFAULT 0,
            reply_to_id VARCHAR(191) NULL,
            reply_to_body TEXT NULL,
            reply_to_sender VARCHAR(255) NULL,
            raw_payload JSONB NOT NULL,
            inbound_context JSONB NOT NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );

      const rows = await sql.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?`,
        [TABLE_NAME]
      );
      const existing = new Set(rows.map((row) => row.indexname));
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

      await sql.execute(
        `
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
          ON CONFLICT (dedupe_key) DO UPDATE SET
            trace_id = EXCLUDED.trace_id,
            raw_payload = EXCLUDED.raw_payload,
            inbound_context = EXCLUDED.inbound_context,
            updated_at = CURRENT_TIMESTAMP
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
          JSON.stringify(input.rawPayload || input.raw_payload || {}),
          JSON.stringify(inboundContext)
        ]
      );

      const rows = await sql.query(
        `
          SELECT *
          FROM ${TABLE_NAME}
          WHERE dedupe_key = ?
          LIMIT 1
        `,
        [dedupeKey]
      );

      if (!rows[0]) {
        throw new Error('Failed to read persisted inbound message');
      }

      return mapRow(rows[0]);
    });
  }

  async function getInboundInboxStats(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          WITH last_read AS (
            SELECT session_key, MAX(received_at) AS last_read_received_at
            FROM ${TABLE_NAME}
            WHERE is_read = 1
            GROUP BY session_key
          )
          SELECT
            COUNT(DISTINCT m.session_key) AS total_conversations,
            COUNT(*) AS total_messages,
            COUNT(DISTINCT CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} THEN m.session_key END) AS unread_conversations,
            SUM(CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} THEN 1 ELSE 0 END) AS unread_messages,
            MAX(m.received_at) AS last_received_at
          FROM ${TABLE_NAME} m
          LEFT JOIN last_read lr ON lr.session_key = m.session_key
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
            m.session_key,
            MIN(m.chat_type) AS chat_type,
            MIN(m.peer_id) AS peer_id,
            MIN(m.peer_name) AS peer_name,
            MIN(m.account_id) AS account_id,
            SUM(CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} THEN 1 ELSE 0 END) AS unread_count,
            COUNT(*) AS total_messages,
            MAX(m.received_at) AS last_received_at,
            MAX(CASE WHEN m.is_read = 1 THEN m.received_at ELSE NULL END) AS last_read_received_at,
            MAX(CASE WHEN ${effectiveUnreadPredicate('m', 'lr.last_read_received_at')} THEN m.received_at ELSE NULL END) AS latest_unread_received_at,
            (
              SELECT x.body_for_agent
              FROM ${TABLE_NAME} x
              WHERE x.session_key = m.session_key
              ORDER BY x.received_at DESC, x.id DESC
              LIMIT 1
            ) AS latest_body_for_agent,
            (
              SELECT x.sender_id
              FROM ${TABLE_NAME} x
              WHERE x.session_key = m.session_key
              ORDER BY x.received_at DESC, x.id DESC
              LIMIT 1
            ) AS latest_sender_id,
            (
              SELECT x.sender_name
              FROM ${TABLE_NAME} x
              WHERE x.session_key = m.session_key
              ORDER BY x.received_at DESC, x.id DESC
              LIMIT 1
            ) AS latest_sender_name
          FROM ${TABLE_NAME} m
          LEFT JOIN (
            SELECT session_key, MAX(received_at) AS last_read_received_at
            FROM ${TABLE_NAME}
            WHERE is_read = 1
            GROUP BY session_key
          ) lr ON lr.session_key = m.session_key
          GROUP BY m.session_key, lr.last_read_received_at
          ORDER BY last_received_at DESC
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

        return tx.query(
          `
            SELECT *
            FROM ${TABLE_NAME}
            WHERE id IN (${placeholders})
            ORDER BY received_at ASC, id ASC
          `,
          ids
        );
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
      return sql.execute(
        `
          UPDATE ${TABLE_NAME}
          SET is_read = 1, read_at = COALESCE(read_at, NOW())
          WHERE id IN (${placeholders})
        `,
        uniqueIds
      );
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
