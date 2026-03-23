import {
  AgentBeliefPolarity,
  AgentBeliefSubjectType,
  AgentBeliefType,
  QQMessage
} from '../types';

export interface AgentBeliefCandidate {
  subject_type: AgentBeliefSubjectType;
  subject_id: string;
  belief_type: AgentBeliefType;
  belief_key: string;
  claim: string;
  normalized_claim: string;
  polarity: AgentBeliefPolarity;
  confidence: number;
}

const MAX_SHORT_FRAGMENT_LENGTH = 30;

function normalizeFragment(value: string): string {
  return value
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .slice(0, MAX_SHORT_FRAGMENT_LENGTH);
}

function normalizeClaim(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim()
    .slice(0, 255);
}

function captureShort(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  const value = match?.[1];
  if (!value) {
    return null;
  }

  const normalized = normalizeFragment(value);
  return normalized.length > 0 ? normalized : null;
}

export function extractBeliefCandidatesFromMessage(message: QQMessage): AgentBeliefCandidate[] {
  const sourceText = typeof message.normalized_text === 'string'
    ? message.normalized_text.trim()
    : '';

  if (!sourceText) {
    return [];
  }

  const subjectId = String(message.user_id);
  const subjectType: AgentBeliefSubjectType = 'user';
  const candidates: AgentBeliefCandidate[] = [];

  const negativePreference = captureShort(
    sourceText,
    /我(?:真的|其实|一直)?(?:不喜欢|讨厌)([^，。！？,.!?]{1,20})/
  );
  if (negativePreference) {
    const claim = `用户不喜欢${negativePreference}`;
    candidates.push({
      subject_type: subjectType,
      subject_id: subjectId,
      belief_type: 'preference',
      belief_key: `preference:${negativePreference}`,
      claim,
      normalized_claim: normalizeClaim(claim),
      polarity: 'negative',
      confidence: 0.78
    });
  }

  const positivePreference = captureShort(
    sourceText,
    /我(?:真的|其实|很|特别)?喜欢([^，。！？,.!?]{1,20})/
  );
  if (positivePreference) {
    const claim = `用户喜欢${positivePreference}`;
    candidates.push({
      subject_type: subjectType,
      subject_id: subjectId,
      belief_type: 'preference',
      belief_key: `preference:${positivePreference}`,
      claim,
      normalized_claim: normalizeClaim(claim),
      polarity: 'positive',
      confidence: 0.78
    });
  }

  const identity = captureShort(
    sourceText,
    /我是([^，。！？,.!?]{1,20})/
  );
  if (identity) {
    const claim = `用户是${identity}`;
    candidates.push({
      subject_type: subjectType,
      subject_id: subjectId,
      belief_type: 'identity_fact',
      belief_key: `identity:${identity}`,
      claim,
      normalized_claim: normalizeClaim(claim),
      polarity: 'neutral',
      confidence: 0.74
    });
  }

  const commitment = captureShort(
    sourceText,
    /我(?:会|准备|打算)([^，。！？,.!?]{1,30})/
  );
  if (commitment) {
    const claim = `用户打算${commitment}`;
    candidates.push({
      subject_type: subjectType,
      subject_id: subjectId,
      belief_type: 'commitment',
      belief_key: `commitment:${commitment}`,
      claim,
      normalized_claim: normalizeClaim(claim),
      polarity: 'neutral',
      confidence: 0.68
    });
  }

  return candidates;
}
