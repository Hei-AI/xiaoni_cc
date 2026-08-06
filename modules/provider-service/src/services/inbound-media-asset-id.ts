import { createHash } from 'crypto';

/**
 * Row identity for an inbound media asset.
 *
 * The id MUST be unique per (message_sid, media_tag), not per content, because that is
 * how media is read back:
 *   - `listAgentMediaAssets` (packages/persistence/agent-media.js) filters by
 *     session_key + message_sid, so each message needs to own a row;
 *   - the agent resolves an image by the very id carried in
 *     `inboundContext.MediaAssets[].id` (agent-loop-service media reference resolution),
 *     so the row id and the inbound-context id must be the same string.
 *
 * A pure content hash satisfies the second requirement but violates the first: re-sending
 * an image the bot has already seen produced a *new* (message_sid, media_tag) pair whose
 * create carried an *old* `id`, which blew up on the primary key. That throw escaped from
 * ingest — after the inbound row was written, before the notify step — so the message
 * landed in the inbox and 小腻 was never woken for it.
 *
 * Scoping the hash by message keeps both properties. Stored files stay content-addressed
 * separately, so identical bytes are still written to disk only once.
 */
export function buildInboundMediaAssetId(contentHash: string, scopeKey: string): string {
  if (!scopeKey) {
    return `media_${contentHash.slice(0, 48)}`;
  }
  const scoped = createHash('sha256').update(`${contentHash}:${scopeKey}`).digest('hex');
  return `media_${scoped.slice(0, 48)}`;
}

/**
 * Empty when there is no message identity: `upsertAgentMediaAsset` only takes the
 * (message_sid, media_tag) branch when a message_sid exists, and otherwise upserts by
 * `id` — which is collision-free by construction. Scoping those rows would gain nothing
 * and would gratuitously change ids that legacy rows already use.
 */
export function buildInboundMediaAssetScopeKey(messageSid?: string | null, mediaTag?: string | null): string {
  const sid = (messageSid || '').trim();
  if (!sid) {
    return '';
  }
  return `${sid}:${(mediaTag || '').trim()}`;
}
