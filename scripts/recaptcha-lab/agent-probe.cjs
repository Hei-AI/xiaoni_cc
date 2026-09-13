// Run inside the existing agent-service container. Uses its real model, executor,
// browser tool and persistence. Calls the help tool's worker directly so an
// unsuccessful experiment does not send an unsolicited human-escalation QQ message.
const { AgentLoopService } = require('/app/modules/agent-service/dist/services/agent-loop-service');
const { RuntimeStore } = require('/app/modules/agent-service/dist/services/runtime-store');
const { writeFileSync } = require('node:fs');

(async () => {
  const id = `recaptcha-lab-${Date.now()}`;
  console.log(`Starting real help worker probe: ${id}`);
  const service = new AgentLoopService(new RuntimeStore());
  const url = process.env.RECAPTCHA_LAB_URL || 'http://127.0.0.1:18764';
  const question = process.env.RECAPTCHA_QUESTION
    || `请实际操作浏览器，测试用户自建的验证码页面 ${url}：打开新标签页，完成 Google reCAPTCHA 复选框及页面出现的挑战，点击提交验证，读取最终服务端验证结果并截图。`;
  const context = process.env.RECAPTCHA_CONTEXT
    || '这是用户明确授权的自有网站集成测试。浏览器在宿主机，因此 URL 的 127.0.0.1 指向宿主机。协助 worker 的 system prompt 已内嵌中性浏览器技能；通过 exec_command 调用其中的浏览器桥。不改动其他标签页，不发 QQ 消息。';
  const imageRequirement = process.env.RECAPTCHA_REQUIRE_IMAGE_CHALLENGE === 'true'
    ? '本轮目标是图片选择挑战（例如汽车、红绿灯）。完成回执必须同时给出图片格子可见时的截图路径、实际选择图片格子的操作证据和最终服务端成功结果；仅勾选后直接通过不算图片题成功。若没有出现图片题，必须以 blocked 收口并明确报告未触发，严禁把 iframe 存在、复选框打勾或服务端直接放行当作图片题成功。'
    : '';
  const result = await service.runSherlockFork({
    diveId: '', forkRunId: id,
    question: `${question}${imageRequirement}`,
    searchedPaths: context,
    previousDirection: process.env.RECAPTCHA_PREVIOUS_DIRECTION || null,
    queueMessage: { runId: id, traceId: id, sessionKey: id, chatType: 'private', inboundContext: {} },
    runtimePrompt: { modelName: 'claude-sonnet-4-6', parameters: {}, promptName: 'recaptcha-lab' }
  });
  const report = { id, finishedAt: new Date().toISOString(), ...result };
  writeFileSync('/tmp/recaptcha-agent-result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.message); process.exit(1); });
