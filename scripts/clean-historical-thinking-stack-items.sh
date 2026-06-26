#!/usr/bin/env bash
# Clean historical Anthropic thinking/reasoning blocks from Xiaoni's replay stack.
#
# Context: extended thinking is now globally OFF at the Claude provider
# (ANTHROPIC_THINKING_ENABLED unset/false -> anthropic-translate strips reasoning items
# at translate time). The stored reasoning stack items are therefore dead weight: loaded
# from agent_stack_items on every request, then dropped before the wire. This removes them
# from storage so the replay prefix stops carrying them.
#
# Target rows: agent_stack_items where
#     identity_key   = 'xiaoni'
#     item_kind      = 'assistant_output'
#     content->>'type' = 'reasoning'          (a {type:reasoning, encrypted_content:<thinking>} item)
#
# SAFE: deleting them does NOT change wire behavior — with thinking off the provider
# already strips them. Caveat: historical llm_request_slices.input_stack_item_ids may
# reference these rows for Raw Trace audit; after deletion those audit entries lose the
# reasoning item (live replay/behavior is unaffected). This only touches reasoning items,
# never assistant text, tool calls, or tool outputs.
#
# Usage (runs against the MAIN-STACK postgres via docker exec):
#     scripts/clean-historical-thinking-stack-items.sh            # DRY RUN (count only)
#     scripts/clean-historical-thinking-stack-items.sh --apply    # actually delete (batched)
#
set -euo pipefail

CONTAINER="${PG_CONTAINER:-qqbot-postgres}"
DB_USER="${PG_USER:-qqbot_user}"
DB_NAME="${PG_DB:-qqbot_db}"
IDENTITY="${XIAONI_IDENTITY_KEY:-xiaoni}"
BATCH="${BATCH_SIZE:-5000}"

WHERE="identity_key = '${IDENTITY}' AND item_kind = 'assistant_output' AND content->>'type' = 'reasoning'"

psql() { docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"; }

count() { psql -t -A -c "SELECT count(*) FROM agent_stack_items WHERE ${WHERE};"; }

echo "Target: agent_stack_items reasoning items for identity '${IDENTITY}'"
BEFORE="$(count)"
echo "  matching rows: ${BEFORE}"

if [[ "${1:-}" != "--apply" ]]; then
  echo ""
  echo "DRY RUN only. Sample (first 2, truncated):"
  psql -c "SELECT id, stack_index, left(content::text, 120) AS content_preview
           FROM agent_stack_items WHERE ${WHERE} ORDER BY id LIMIT 2;"
  echo ""
  echo "Re-run with --apply to delete the ${BEFORE} rows above."
  exit 0
fi

echo ""
echo "APPLYING delete in batches of ${BATCH}..."
while :; do
  DELETED="$(psql -t -A -c "
    WITH victims AS (
      SELECT id FROM agent_stack_items WHERE ${WHERE} ORDER BY id LIMIT ${BATCH}
    )
    DELETE FROM agent_stack_items a USING victims v WHERE a.id = v.id
    RETURNING 1;" | grep -c 1 || true)"
  echo "  deleted batch: ${DELETED}"
  [[ "${DELETED}" -eq 0 ]] && break
done

AFTER="$(count)"
echo ""
echo "Done. remaining matching rows: ${AFTER} (was ${BEFORE})."
