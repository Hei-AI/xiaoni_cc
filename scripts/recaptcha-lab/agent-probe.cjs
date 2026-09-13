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
  const imageRequirement = process.env.RECAPTCHA_REQUIRE_IMAGE_CHALLENGE === 'true'
    ? '本轮目标是图片选择挑战（例如汽车、红绿灯），仅勾选后直接通过不算图片题成功；若没有出现图片题，明确报告未触发，不得把它当作解题成功。'
    : '';
  const result = await service.runSherlockFork({
    diveId: '', forkRunId: id,
    question: `请实际操作浏览器，测试用户自建的验证码页面 ${url}：打开新标签页，完成 Google reCAPTCHA 复选框及页面出现的挑战，点击提交验证，读取最终服务端验证结果并截图。必须基于页面实际结果报告；注明页面是官方测试模式还是真实模式，是否实际出现图片挑战。${imageRequirement}不要修改网页或响应，不要直接注入 token，不要伪造验证成功。若无法完成，报告具体阻塞。`,
    searchedPaths: '这是用户明确授权的自有网站集成测试。浏览器在宿主机，因此 URL 的 127.0.0.1 指向宿主机。使用现役 $xiaoni-browser 技能：先读 /app/modules/agent-service/skills/xiaoni-browser/SKILL.md，然后通过 exec_command 调用技能里的浏览器桥。不改动其他标签页，不发 QQ 消息。',
    previousDirection: null,
    queueMessage: { runId: id, traceId: id, sessionKey: id, chatType: 'private', inboundContext: {} },
    runtimePrompt: { modelName: 'claude-sonnet-4-6', parameters: {}, promptName: 'recaptcha-lab' }
  });
  const report = { id, finishedAt: new Date().toISOString(), ...result };
  writeFileSync('/tmp/recaptcha-agent-result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})().catch(error => { console.error(error.message); process.exit(1); });
