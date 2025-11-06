import { config } from '../src/config';
import { getDatabaseManager } from '../src/services/database';
import { ContextManager } from '../src/services/context-manager';
import { QQMessage } from '../src/types';

async function fetchLatestRawMessage(
  scope: 'group' | 'private'
): Promise<QQMessage | null> {
  const database = getDatabaseManager(config.database);
  const column = scope === 'group' ? 'group_id IS NOT NULL' : 'group_id IS NULL';
  const rows = await database.executeQuery<{ raw_request: string | null }>(
    `SELECT raw_request FROM conversations WHERE raw_request IS NOT NULL AND ${column} ORDER BY timestamp DESC LIMIT 1`
  );

  const raw = rows[0]?.raw_request;
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as QQMessage;
  } catch (error) {
    console.error('Failed to parse raw_request JSON', error);
    return null;
  }
}

async function dumpContext(scope: 'group' | 'private'): Promise<void> {
  const database = getDatabaseManager(config.database);
  const contextManager = new ContextManager(database);

  const message = await fetchLatestRawMessage(scope);
  if (!message) {
    console.error(`No ${scope} message found to build context.`);
    return;
  }

  const context = await contextManager.buildMessageContext(message, 10);
  const prompt = contextManager.formatContextForAI(context);

  console.log(`=== ${scope.toUpperCase()} CONTEXT ===`);
  console.log('History count:', context.historyMessages.length);
  console.log('First history entry:', context.historyMessages[0]);
  console.log('Last history entry:', context.historyMessages[context.historyMessages.length - 1]);
  console.log('Prompt plain text:');
  console.log(prompt.plainText);
  console.log('Prompt parts:');
  console.log(JSON.stringify(prompt.parts, null, 2));
  console.log();
}

(async () => {
  await dumpContext('group');
  await dumpContext('private');
})().catch(error => {
  console.error('Error dumping contexts', error);
});
