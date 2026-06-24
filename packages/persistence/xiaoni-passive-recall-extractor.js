'use strict';

const XIAONI_RUNTIME_ROOT = '/xiaoni-runtime';
const HOST_XIAONI_RUNTIME_ROOT = '/home/liahua/.qqbot-local/xiaoni-runtime';

const INDEXABLE_RUNTIME_DIRS = new Set([
  'forever',
  'notes',
  'reading',
  'toys'
]);

const EXCLUDED_RUNTIME_DIRS = new Set([
  'git-archives',
  'logs',
  'media',
  'picture',
  'sessions'
]);

const OPERATIONAL_SOURCES = new Set([
  'llm_request',
  'llm_stack_item',
  'compression_fork_llm_request',
  'compression_fork_item',
  'compression_fork_tool_execution',
  'core_memory_compression_fork',
  'subconscious_agent_fork',
  'subconscious_fork_llm_request',
  'subconscious_fork_item',
  'subconscious_fork_tool_execution',
  'image_vision_fork',
  'image_vision_fork_observation',
  'image_vision_fork_llm_request',
  'cache_heartbeat'
]);

const SPOKEN_KINDS = new Set([
  'qq_self_message',
  'send_in_group',
  'send_in_private'
]);

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function compactWhitespace(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function truncateText(value, maxLength = 480) {
  const compact = compactWhitespace(value);
  if (!compact) {
    return null;
  }
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseJsonPreview(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeTagKey(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const key = value.trim().toLowerCase();
  return key || null;
}

function addFeature(features, seen, key) {
  const normalized = normalizeTagKey(key);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  features.push(normalized);
}

function actionStreamTagKeys(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  return tags
    .map((tag) => normalizeTagKey(typeof tag === 'string' ? tag : tag?.key))
    .filter(Boolean);
}

function normalizeRuntimePath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    return null;
  }
  let normalized = path.trim()
    .replace(/[),.;:]+$/g, '')
    .replace(/^['"]|['"]$/g, '');
  if (normalized.startsWith(HOST_XIAONI_RUNTIME_ROOT)) {
    normalized = `${XIAONI_RUNTIME_ROOT}${normalized.slice(HOST_XIAONI_RUNTIME_ROOT.length)}`;
  }
  if (!normalized.startsWith(`${XIAONI_RUNTIME_ROOT}/`)) {
    return null;
  }
  return normalized.replace(/\/+/g, '/');
}

function classifyRuntimePath(path) {
  const normalized = normalizeRuntimePath(path);
  if (!normalized) {
    return null;
  }
  const relativePath = normalized.slice(XIAONI_RUNTIME_ROOT.length + 1);
  const segments = relativePath.split('/').filter(Boolean);
  const runtimeDir = segments[0] || null;
  const basename = segments[segments.length - 1] || null;
  const extension = basename && basename.includes('.')
    ? basename.slice(basename.lastIndexOf('.') + 1).toLowerCase()
    : null;
  const excluded = !runtimeDir
    || EXCLUDED_RUNTIME_DIRS.has(runtimeDir)
    || segments.includes('dist')
    || segments.includes('node_modules');
  const indexable = !excluded
    && INDEXABLE_RUNTIME_DIRS.has(runtimeDir)
    && ['md', 'txt'].includes(extension);
  return {
    path: normalized,
    relativePath,
    runtimeDir,
    basename,
    extension,
    indexable,
    excluded
  };
}

function extractRuntimePaths(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }
  const matches = text.match(/(?:\/home\/liahua\/\.qqbot-local)?\/xiaoni-runtime\/[^\s'"`<>|;&]+/g) || [];
  const seen = new Set();
  const paths = [];
  for (const match of matches) {
    const classified = classifyRuntimePath(match);
    if (!classified || seen.has(classified.path)) {
      continue;
    }
    seen.add(classified.path);
    paths.push(classified);
  }
  return paths;
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferFileOperation(command, path) {
  if (!command || !path) {
    return 'reference';
  }
  const escaped = regexEscape(path);
  if (new RegExp(`(?:^|\\s)(?:cat\\s*)?>\\s*['"]?${escaped}`).test(command)
    || new RegExp(`(?:^|\\s)>>\\s*['"]?${escaped}`).test(command)
    || new RegExp(`\\btee\\s+(?:-a\\s+)?['"]?${escaped}`).test(command)) {
    return 'write';
  }
  if (new RegExp(`\\b(cat|sed|head|tail|rg|grep|wc|ls|stat)\\b[^\\n;|&]*['"]?${escaped}`).test(command)) {
    return 'read';
  }
  return 'reference';
}

function extractCommand(item) {
  const metadata = item?.metadata || {};
  const parsed = parseJsonPreview(metadata.toolArgumentsPreview)
    || parseJsonPreview(metadata.argumentsPreview)
    || parseJsonPreview(item?.body);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return firstString(
      parsed.cmd,
      parsed.command,
      parsed.shell_command,
      parsed.shellCommand,
      parsed.input,
      parsed.text
    );
  }
  return firstString(metadata.toolArgumentsPreview, metadata.argumentsPreview, item?.body);
}

function extractQqUsage(command) {
  if (typeof command !== 'string') {
    return null;
  }
  const match = command.match(/(?:^|\s)(?:python3?\s+)?(?:\/app\/modules\/agent-service\/skills\/qq-usage\/scripts\/)?qq_usage\.py\s+([a-z_]+)(?:\s+([^\s]+))?/);
  if (!match) {
    return null;
  }
  return {
    mode: match[1],
    peerId: match[2] || null
  };
}

function sourceKindForItem(item) {
  const source = firstString(item?.source);
  const kind = firstString(item?.kind);
  const toolName = firstString(item?.metadata?.toolName, source === 'tool_execution' ? kind : null);
  const command = toolName === 'exec_command' ? extractCommand(item) : null;
  const paths = extractRuntimePaths(command || '');
  const qqUsage = extractQqUsage(command);

  if (source === 'tool_execution' && toolName === 'exec_command' && paths.some((entry) => entry.indexable)) {
    return 'db_file_provenance';
  }
  if (qqUsage) {
    return 'db_life_cue';
  }
  if (SPOKEN_KINDS.has(kind) || (source === 'tool_execution' && SPOKEN_KINDS.has(toolName))) {
    return 'db_spoken_fragment';
  }
  // Generic tool lifecycle and provider trace rows are useful for debugging,
  // but they are too broad to become passive-recall candidates by themselves.
  // Later activation code can still consult those rows as side-channel weights.
  if (source === 'tool_execution' || (source && OPERATIONAL_SOURCES.has(source))) {
    return null;
  }
  return null;
}

function privacyScopeForItem(item, cueClass) {
  const kind = firstString(item?.kind);
  const toolName = firstString(item?.metadata?.toolName, item?.source === 'tool_execution' ? kind : null);
  if (kind === 'send_in_private' || toolName === 'send_in_private') {
    return 'private_peer';
  }
  if (kind === 'send_in_group' || toolName === 'send_in_group') {
    return 'group';
  }
  if (kind === 'qq_message_seen' || toolName === 'qq_usage' || cueClass === 'db_life_cue') {
    return 'transient_private';
  }
  if (cueClass === 'db_operational_trace') {
    return 'operator_only';
  }
  return 'self_private';
}

function memoryCandidateForCue(cueClass) {
  switch (cueClass) {
    case 'db_file_provenance':
      return 'file_memory';
    case 'db_spoken_fragment':
      return 'spoken_fragment';
    default:
      return null;
  }
}

function buildSafeEmbeddingText({ item, cueClass, features, runtimePaths, command, qqUsage }) {
  const source = firstString(item?.source);
  const kind = firstString(item?.kind);
  const title = firstString(item?.title);
  const body = firstString(item?.body);

  if (cueClass === 'db_operational_trace') {
    return null;
  }

  if (cueClass === 'db_file_provenance') {
    const pathText = runtimePaths
      .filter((entry) => entry.indexable)
      .map((entry) => `${entry.runtimeDir} ${entry.relativePath.replace(/[._/-]+/g, ' ')}`)
      .join('\n');
    return truncateText([
      'xiaoni runtime file provenance',
      pathText,
      features.join(' ')
    ].filter(Boolean).join('\n'), 1200);
  }

  if (qqUsage) {
    return truncateText([
      'xiaoni qq usage cue',
      `mode ${qqUsage.mode}`,
      qqUsage.peerId ? `peer ${qqUsage.peerId}` : null,
      features.join(' ')
    ].filter(Boolean).join('\n'), 800);
  }

  if (cueClass === 'db_spoken_fragment') {
    return truncateText([
      'xiaoni spoken fragment',
      title,
      body,
      features.join(' ')
    ].filter(Boolean).join('\n'), 1200);
  }

  if (source === 'runtime_input') {
    return truncateText([
      'xiaoni runtime input cue',
      title,
      features.join(' ')
    ].filter(Boolean).join('\n'), 800);
  }

  return truncateText([
    'xiaoni life cue',
    source,
    kind,
    title,
    features.join(' ')
  ].filter(Boolean).join('\n'), 800);
}

function extractPassiveRecallCueFromActionStreamItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const source = firstString(item.source);
  const kind = firstString(item.kind);
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const toolName = firstString(metadata.toolName, source === 'tool_execution' ? kind : null);
  const command = toolName === 'exec_command' ? extractCommand(item) : null;
  const qqUsage = extractQqUsage(command);
  const cueClass = sourceKindForItem(item);
  if (!cueClass) {
    return null;
  }
  const featureSet = new Set();
  const features = [];

  addFeature(features, featureSet, source ? `source:${source}` : null);
  addFeature(features, featureSet, kind ? `kind:${kind}` : null);
  addFeature(features, featureSet, toolName ? `tool:${toolName}` : null);
  for (const tagKey of actionStreamTagKeys(item)) {
    addFeature(features, featureSet, tagKey);
  }
  if (qqUsage) {
    addFeature(features, featureSet, 'skill:qq_usage');
    addFeature(features, featureSet, `im:${qqUsage.mode}`);
    addFeature(features, featureSet, qqUsage.peerId ? `peer:${qqUsage.peerId}` : null);
  }

  const runtimePaths = extractRuntimePaths(command || '')
    .map((entry) => ({
      ...entry,
      operation: inferFileOperation(command, entry.path)
    }))
    .filter((entry) => entry.indexable);
  for (const entry of runtimePaths) {
    addFeature(features, featureSet, `runtime_dir:${entry.runtimeDir}`);
    addFeature(features, featureSet, `file_op:${entry.operation}`);
  }

  const privacyScope = privacyScopeForItem(item, cueClass);
  return {
    cueClass,
    itemId: firstString(item.id, item.eventId),
    source,
    kind,
    timestamp: firstString(item.timestamp),
    runId: firstString(item.runId),
    traceId: firstString(item.traceId),
    toolName,
    qqUsage,
    runtimePaths,
    features,
    privacyScope,
    memoryCandidate: memoryCandidateForCue(cueClass),
    safeEmbeddingText: buildSafeEmbeddingText({
      item,
      cueClass,
      features,
      runtimePaths,
      command,
      qqUsage
    })
  };
}

function extractPassiveRecallCuesFromActionStream(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map(extractPassiveRecallCueFromActionStreamItem)
    .filter(Boolean);
}

module.exports = {
  classifyRuntimePath,
  extractPassiveRecallCueFromActionStreamItem,
  extractPassiveRecallCuesFromActionStream,
  extractRuntimePaths
};
