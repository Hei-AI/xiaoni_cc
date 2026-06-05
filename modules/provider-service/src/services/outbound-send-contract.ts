export type InternalPrivateSendRequest = {
  userId: number;
  messages: string[];
  enforcePolicy: boolean;
};

export type InternalGroupSendRequest = {
  groupId: number;
  messages: string[];
  mentionUserIds: number[];
  sessionKey: string | null;
  enforcePolicy: boolean;
};

export function normalizeOutboundMessages(body: Record<string, unknown>) {
  if (Array.isArray(body.messages)) {
    const messages: string[] = [];
    for (const item of body.messages) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error('messages must be an array of non-empty strings');
      }
      messages.push(item.trim());
    }
    if (messages.length > 0) {
      return messages;
    }
  }

  if (typeof body.message === 'string' && body.message.trim()) {
    return [body.message.trim()];
  }

  return [];
}

export function normalizeOptionalNumericIdList(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of numeric ids`);
  }

  return Array.from(new Set(value.map((item) => {
    const numeric = Number(item);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${fieldName} must be an array of numeric ids`);
    }
    return Math.trunc(numeric);
  })));
}

export function resolveInternalPrivateSendRequest(body: Record<string, unknown>): InternalPrivateSendRequest {
  return {
    userId: Number(body.user_id),
    messages: normalizeOutboundMessages(body),
    enforcePolicy: Boolean(body.enforce_policy)
  };
}

export function resolveInternalGroupSendRequest(body: Record<string, unknown>): InternalGroupSendRequest {
  return {
    groupId: Number(body.group_id),
    messages: normalizeOutboundMessages(body),
    mentionUserIds: normalizeOptionalNumericIdList(body.mention_user_ids, 'mention_user_ids'),
    sessionKey: typeof body.session_key === 'string' && body.session_key.trim().length > 0
      ? body.session_key.trim()
      : null,
    enforcePolicy: Boolean(body.enforce_policy)
  };
}
