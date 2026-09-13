// Executed in the current agent-service container. Transport and audit are the
// deployed help worker's real implementations. Every invocation has fresh input.
const { AgentLoopService } = require('/app/modules/agent-service/dist/services/agent-loop-service');
const { RuntimeStore } = require('/app/modules/agent-service/dist/services/runtime-store');
const { createHash } = require('node:crypto');
(async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const store = new RuntimeStore();
  const service = new AgentLoopService(store);
  const model = 'claude-sonnet-4-6';
  const request = {
    model, instructions: job.prompt,
    input: [{ type: 'message', role: 'user', content: [
      { type: 'input_text', text: JSON.stringify(job.state) },
      ...(job.image ? [{ type: 'input_image', image_url: `data:image/png;base64,${job.image}` }] : [])
    ] }],
    tools: [{ type: 'function', function: { name: 'stage_result', description: 'Return only the result of the assigned stage.', parameters: job.schema } }],
    tool_choice: { type: 'allowed_tools', mode: 'required', tools: [{ type: 'function', name: 'stage_result' }] },
    parallel_tool_calls: false, max_output_tokens: 1600, store: false
  };
  const result = await service.executeSubconsciousAgentForkTurn(request,
    { traceId: job.runId, runId: job.runId, sessionKey: job.runId, inboundContext: {} },
    { modelName: model, parameters: {}, promptName: `recaptcha-isolated-${job.stage}` }, job.turn,
    { agentType: 'sherlock_visual_stage', executionMode: 'sherlock_fork_no_persist' });
  await store.recordFailureReviewForkSlice({
    sliceId: result.llm_request_slice_id || result.llm_call_id,
    forkRunId: job.runId, diveId: '', traceId: job.runId, runId: job.runId,
    agentTurn: job.turn, modelName: result.model || model, status: 'completed',
    canonicalRequest: result.canonical_request || request, wireRequest: result.wire_request,
    canonicalResponse: result.canonical_response, wireResponse: result.wire_response,
    metadata: { experiment: 'recaptcha-isolated-stages', stage: job.stage, fresh_context: true,
      prompt_sha256: createHash('sha256').update(job.prompt).digest('hex') }
  });
  const calls = service.responseActionRouter.route(result.canonical_response).toolCalls;
  if (calls.length !== 1 || calls[0].name !== 'stage_result') throw new Error('Invalid stage tool result');
  const wire = JSON.stringify(result.wire_request || {});
  console.log('STAGE_RESULT:' + JSON.stringify({
    value: calls[0].args, model: result.model || model, slice: result.llm_call_id,
    imageInWire: /"type":"image"|"type":"input_image"/.test(wire),
    inputItems: (result.canonical_request || request).input?.length,
    wireMessageCount: result.wire_request?.messages?.length,
    wireRoles: result.wire_request?.messages?.map(message => message.role)
  }));
  process.exit(0);
})().catch(error => { console.error(error.message); process.exit(1); });
