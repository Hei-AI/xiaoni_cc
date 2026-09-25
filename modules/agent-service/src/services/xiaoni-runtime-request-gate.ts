import { getAgentRuntimeControl } from '@qq-bot/persistence';
import { databaseConfig } from '../config';

// Check immediately before dispatch, including retries and fire-and-forget work.
// A failed control read must not send an unapproved model request.
export async function assertXiaoniRuntimeRequestEnabled(): Promise<void> {
  const control = await getAgentRuntimeControl({ identityKey: 'xiaoni' }, databaseConfig);
  if (control.enabled === false) {
    throw new Error('Xiaoni runtime is disabled');
  }
}
