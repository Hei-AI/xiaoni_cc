'use strict';

const { createHash, randomUUID } = require('node:crypto');
const TYPE = 'xiaoni_help';
const PROCESS_ID = randomUUID();

// Help shares the existing task ledger, with help_* states that the image worker
// cannot claim. CAS transitions prevent parallel calls from repeating operations.
function createXiaoniHelpPersistence({ getPrismaClient }) {
  async function beginXiaoniHelp(input, config = {}) {
    const prisma = getPrismaClient(config);
    const id = input.helpId || `help_${createHash('sha256').update(input.correlationKey || input.callId).digest('hex').slice(0, 40)}`;
    if (!input.helpId) {
      await prisma.agentTask.upsert({
        where: { id }, update: {},
        create: {
          id, task_type: TYPE, status: 'help_ready', session_key: 'xiaoni:global', chat_type: 'direct',
          prompt: input.request, source_trace_id: input.traceId, source_run_id: input.runId,
          input_json: { context: input.context }, result_json: { history: [] }
        }
      }).catch(error => { if (error.code !== 'P2002') throw error; });
    }
    const row = await prisma.agentTask.findUnique({ where: { id } });
    if (!row || row.task_type !== TYPE) return { ok: false, reason: 'help_not_found' };
    const history = Array.isArray(row.result_json?.history) ? row.result_json.history : [];
    const duplicate = history.find(entry => entry.call_id === input.callId);
    if (duplicate) return { ok: false, reason: 'already_processed', task: row, result: duplicate.result };
    if (row.status === 'help_human_sent' || row.status === 'help_human_sending') {
      return { ok: false, reason: row.status, task: row };
    }
    // The runtime host is a singleton. After a process replacement, a partially
    // executed task goes to human review instead of repeating unknown effects.
    const interrupted = row.status === 'help_running' && !row.claimed_by?.startsWith(`${PROCESS_ID}:`);
    if (row.status === 'help_running' && !interrupted) return { ok: false, reason: 'help_running', task: row };
    const claim = `${PROCESS_ID}:${randomUUID()}`;
    const updated = await prisma.agentTask.updateMany({
      where: { id, task_type: TYPE, status: row.status, updated_at: row.updated_at },
      data: { status: 'help_running', claimed_by: claim, claimed_at: new Date() }
    });
    if (updated.count !== 1) return { ok: false, reason: 'help_busy', task: row };
    return { ok: true, task: row, claim, history, interrupted };
  }

  async function finishXiaoniHelp(input, config = {}) {
    const prisma = getPrismaClient(config);
    const row = await prisma.agentTask.findUnique({ where: { id: input.helpId } });
    if (!row || row.task_type !== TYPE || row.claimed_by !== input.claim) return false;
    const history = Array.isArray(row.result_json?.history) ? row.result_json.history : [];
    const updated = await prisma.agentTask.updateMany({
      where: { id: row.id, task_type: TYPE, claimed_by: input.claim, status: { in: ['help_running', 'help_human_sending'] } },
      data: {
        status: input.status,
        attempts: { increment: input.helperAttempt ? 1 : 0 },
        result_json: { history: [...history, { call_id: input.callId, request: input.request, result: input.result }] },
        claimed_by: null,
        completed_at: new Date()
      }
    });
    return updated.count === 1;
  }

  async function markXiaoniHelpSending(input, config = {}) {
    const result = await getPrismaClient(config).agentTask.updateMany({
      where: { id: input.helpId, task_type: TYPE, claimed_by: input.claim, status: 'help_running' },
      data: { status: 'help_human_sending' }
    });
    return result.count === 1;
  }

  async function startXiaoniHelpAttempt(input, config = {}) {
    const result = await getPrismaClient(config).agentTask.updateMany({
      where: { id: input.helpId, task_type: TYPE, claimed_by: input.claim, status: 'help_running' },
      data: { attempts: { increment: 1 } }
    });
    return result.count === 1;
  }

  return { beginXiaoniHelp, finishXiaoniHelp, markXiaoniHelpSending, startXiaoniHelpAttempt };
}

module.exports = { createXiaoniHelpPersistence };
