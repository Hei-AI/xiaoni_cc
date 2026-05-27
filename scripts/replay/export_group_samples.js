#!/usr/bin/env node

'use strict';

const path = require('path');
const { createSqlAdapter } = require('../../packages/persistence');
const { parseArgs, parseJson, writeJsonl } = require('./common');

function usage() {
  console.log([
    'Usage: node scripts/replay/export_group_samples.js --group-id <id> [options]',
    '',
    'Options:',
    '  --group-id <id>       Required. QQ group id / peer id.',
    '  --limit <n>           Number of current-message samples to export. Default: 50',
    '  --recent-window <n>   Number of prior inbound messages to include. Default: 6',
    '  --out <path>          Output JSONL path. Default: ~/.gstack/projects/<slug>/replay/group-<id>-samples.jsonl',
    '  --help                Show this message'
  ].join('\n'));
}

function buildDefaultOutput(groupId) {
  const home = process.env.HOME || '.';
  return path.join(home, '.gstack', 'projects', 'liahua-qq_bot', 'replay', `group-${groupId}-samples.jsonl`);
}

function buildSnapshotSessionId(groupId) {
  return `group:${groupId}`;
}

function normalizeSelfEvolutionState(row) {
  return {
    id: Number(row.id),
    scope_type: row.scope_type,
    target_user_id: row.target_user_id === null ? null : Number(row.target_user_id),
    social_presence_baseline: row.social_presence_baseline,
    entry_preference: row.entry_preference,
    warmth_bias: row.warmth_bias,
    familiarity_ceiling: row.familiarity_ceiling,
    topic_resonance: Array.isArray(row.topic_resonance) ? row.topic_resonance : [],
    boundary_tendencies: row.boundary_tendencies && typeof row.boundary_tendencies === 'object' ? row.boundary_tendencies : {},
    reinforced_modes: Array.isArray(row.reinforced_modes) ? row.reinforced_modes : [],
    suppressed_modes: Array.isArray(row.suppressed_modes) ? row.suppressed_modes : [],
    summary_text: row.summary_text,
    source_event_ids: Array.isArray(row.source_event_ids) ? row.source_event_ids.map(Number) : [],
    source_message_ids: Array.isArray(row.source_message_ids) ? row.source_message_ids.map(Number) : [],
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args['group-id']) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const groupId = Number(args['group-id']);
  const limit = Math.max(1, Math.min(Number(args.limit || 50), 500));
  const recentWindow = Math.max(1, Math.min(Number(args['recent-window'] || 6), 20));
  const outPath = args.out ? path.resolve(String(args.out)) : buildDefaultOutput(groupId);
  const sql = createSqlAdapter({ applicationName: 'memory-replay-export' });

  try {
    const rows = await sql.query(
      `
        SELECT
          id,
          session_key,
          peer_id,
          sender_id,
          sender_name,
          body_for_agent,
          inbound_context,
          created_at
        FROM agent_queue_messages
        WHERE chat_type = 'group'
          AND peer_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      [String(groupId), limit]
    );

    const snapshotRows = await sql.query(
      `
        SELECT
          summary_text,
          summarized_through_conversation_id
        FROM chat_transcript_snapshots
        WHERE session_id = ?
          AND summary_status = 'ready'
        LIMIT 1
      `,
      [buildSnapshotSessionId(groupId)]
    );
    const snapshot = snapshotRows[0] || null;

    const exported = [];

    for (const row of rows.reverse()) {
      const inboundContext = parseJson(row.inbound_context, {});
      const recentRows = await sql.query(
        `
          SELECT
            id,
            sender_id,
            sender_name,
            body_for_agent,
            inbound_context,
            created_at
          FROM agent_queue_messages
          WHERE session_key = ?
            AND id <= ?
          ORDER BY id DESC
          LIMIT ?
        `,
        [row.session_key, Number(row.id), recentWindow]
      );

      const recentMessages = recentRows
        .reverse()
        .filter((candidate) => Number(candidate.id) !== Number(row.id))
        .map((candidate) => {
          const context = parseJson(candidate.inbound_context, {});
          return {
            queue_message_id: Number(candidate.id),
            sender_id: Number(candidate.sender_id),
            sender_name: candidate.sender_name || null,
            body_for_agent: candidate.body_for_agent,
            reply_to_body: typeof context.ReplyToBody === 'string' ? context.ReplyToBody : null,
            timestamp: candidate.created_at
          };
        });

      const recentUserIds = [];
      const seen = new Set();
      for (const message of [...recentMessages].reverse()) {
        const senderId = Number(message.sender_id);
        if (!Number.isFinite(senderId) || senderId <= 0 || senderId === Number(row.sender_id) || seen.has(senderId)) {
          continue;
        }
        seen.add(senderId);
        recentUserIds.push(senderId);
        if (recentUserIds.length >= 2) {
          break;
        }
      }

      const selfEvolutionRows = await sql.query(
        `
          SELECT *
          FROM self_evolution_states
          WHERE session_key = ?
            AND group_id = ?
            AND is_active = TRUE
            AND (
              target_user_id IS NULL
              OR target_user_id = ?
              OR target_user_id = ANY(?::bigint[])
            )
          ORDER BY updated_at DESC, id DESC
          LIMIT 20
        `,
        [row.session_key, groupId, Number(row.sender_id), recentUserIds]
      );

      const groupStates = [];
      const currentUserStates = [];
      const recentUserStates = [];

      for (const state of selfEvolutionRows.map(normalizeSelfEvolutionState)) {
        if (state.target_user_id === null) {
          groupStates.push(state);
          continue;
        }
        if (state.target_user_id === Number(row.sender_id)) {
          currentUserStates.push(state);
          continue;
        }
        recentUserStates.push(state);
      }

      exported.push({
        sample_id: `group-${groupId}-queue-${row.id}`,
        source: {
          queue_message_id: Number(row.id),
          exported_at: new Date().toISOString()
        },
        chat_type: 'group',
        group_id: groupId,
        session_key: row.session_key,
        message: {
          sender_id: Number(row.sender_id),
          sender_name: row.sender_name || null,
          body_for_agent: row.body_for_agent,
          reply_to_body: typeof inboundContext.ReplyToBody === 'string' ? inboundContext.ReplyToBody : null,
          was_mentioned: inboundContext.WasMentioned === true || inboundContext.wasMentioned === true,
          timestamp: row.created_at
        },
        recent_messages: recentMessages,
        summary_text: snapshot?.summary_text || null,
        summarized_through_conversation_id: snapshot ? Number(snapshot.summarized_through_conversation_id) : null,
        self_evolution_states: {
          group_states: groupStates,
          current_user_states: currentUserStates,
          recent_user_states: recentUserStates
        },
        topic_projection: [],
        ground_truth: {
          should_reply: null,
          cue_to_xiaoni: null,
          target_user_id: null,
          relevant_memory_ids: [],
          memory_would_help: null,
          bad_reply_failure_mode: null,
          notes: ''
        }
      });
    }

    writeJsonl(outPath, exported);
    console.log(`Exported ${exported.length} replay samples to ${outPath}`);
  } finally {
    await sql.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
