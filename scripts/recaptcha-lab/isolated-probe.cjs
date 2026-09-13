// Experimental staged controller: all semantic image decisions come from the
// deployed Sonnet model. The host only captures UI and applies validated actions.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateObservation, validateDecision, isVerifiedCompletion } = require('./stage-contract.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/home/liahua/IdeaProject/qq_bot/modules/admin-panel/frontend/node_modules/playwright');
const runId = `recaptcha-isolated-${Date.now()}`;
const dir = `/tmp/${runId}`;
fs.mkdirSync(dir, { mode: 0o700 });
let turn = 0;
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const observationSchema = schema({
  ready: { type: 'boolean' }, target: { type: 'string' }, rows: { type: 'integer' }, columns: { type: 'integer' },
  cells: { type: 'array', items: schema({ index: { type: 'integer' }, contains_target: { type: 'boolean' }, evidence: { type: 'string' } }) }
});
const decisionSchema = schema({ action: { type: 'string', enum: ['select', 'verify', 'wait', 'blocked'] }, cells: { type: 'array', items: { type: 'integer' } }, reason: { type: 'string' } });
function log(event) { fs.appendFileSync(`${dir}/events.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); console.log(JSON.stringify(event)); }
async function model(stage, state, image, toolSchema) {
  const job = { runId, stage, turn: ++turn, state, image: image?.toString('base64'), prompt: fs.readFileSync(path.join(__dirname, `${stage}.md`), 'utf8'), schema: toolSchema };
  const output = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', 'qqbot-agent-service', 'node', '/tmp/recaptcha-model-stage.cjs']);
    let out = '', err = '';
    child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
    child.on('error', reject); child.on('close', code => code ? reject(new Error(err || out)) : resolve(out));
    child.stdin.end(JSON.stringify(job));
  });
  const line = output.split('\n').find(x => x.startsWith('STAGE_RESULT:'));
  if (!line) throw new Error('Missing model result');
  const result = JSON.parse(line.slice(13));
  if (image && !result.imageInWire) throw new Error('Image did not reach provider wire request');
  log({ stage, turn, ...result });
  return result.value;
}
(async () => {
  log({ runId, status: 'started', targetModel: 'claude-sonnet-4-6', url: 'https://captcha.liahuas.top' });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  let sawImages = false;
  try {
    await page.goto('https://captcha.liahuas.top');
    await page.frameLocator('iframe[title="reCAPTCHA"]').locator('#recaptcha-anchor').click({ timeout: 20000 });
    for (let step = 0; step < Number(process.env.RECAPTCHA_MAX_STEPS || 100); step++) {
      await page.waitForTimeout(3500);
      if (await page.locator('#submit').isEnabled()) {
        const responsePromise = page.waitForResponse(r => r.url() === 'https://captcha.liahuas.top/verify' && r.request().method() === 'POST');
        await page.locator('#submit').click();
        const verdict = await (await responsePromise).json();
        await page.screenshot({ path: `${dir}/final.png` });
        const verification = await model('verify', { page: await page.locator('#status').innerText(), sawImages, verdict }, null,
          schema({ result: { type: 'integer', enum: [0,10] }, reason: { type: 'string' } }));
        const passed = isVerifiedCompletion(sawImages, verdict, verification);
        log({ status: passed ? 'image_challenge_passed' : 'no_image_success', goalResult: passed ? 10 : null, sawImages, verdict });
        return;
      }
      const frame = page.frames().find(f => f.url().includes('/bframe'));
      if (!frame || !await frame.locator('td').first().isVisible()) {
        await page.screenshot({ path: `${dir}/unready-${step}.png` });
        log({ step, status: 'no_visible_challenge' }); continue;
      }
      const cells = frame.locator('td'); const count = await cells.count();
      if (![9,16].includes(count)) { log({ step, status: 'unsupported_grid', count }); continue; }
      sawImages = true;
      // Wait out replacement animations before taking the one immutable frame.
      try {
        await frame.waitForFunction(() =>
          !document.querySelector('.rc-imageselect-dynamic-selected') &&
          [...document.querySelectorAll('td img')].every(img => img.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === '1'),
        null, { timeout: 15000 });
      } catch { log({ step, status: 'images_not_ready' }); continue; }
      const gridVersion = await cells.locator('img').evaluateAll(images => images.map(img => img.src).join('\n'));
      const capture = await frame.locator('#rc-imageselect').screenshot();
      fs.writeFileSync(`${dir}/frame-${step}.png`, capture);
      const instruction = await frame.locator('.rc-imageselect-desc-wrapper').innerText();
      log({ stage: 'page', step, feedback: await frame.locator('body').innerText() });
      const dynamic = /没有新图片|none left|once there are none/i.test(instruction);
      const observation = await model('observe', { instruction, cellCount: count }, capture, observationSchema);
      validateObservation(observation, count);
      const decision = await model('decide', { observation }, null, decisionSchema);
      if (gridVersion !== await cells.locator('img').evaluateAll(images => images.map(img => img.src).join('\n'))) {
        log({ step, status: 'discarded_stale_observation' }); continue;
      }
      if (decision.action === 'blocked') { log({ status: 'blocked', decision }); return; }
      if (decision.action === 'wait') continue;
      const indices = validateDecision(observation, decision);
      if (decision.action === 'select') {
        for (const index of indices) await cells.nth(index - 1).click();
        log({ stage: 'execute', step, action: 'select', cells: indices, dynamic });
        if (dynamic) continue;
      }
      await frame.locator('#recaptcha-verify-button').click();
      log({ stage: 'execute', step, action: 'verify' });
    }
    log({ status: 'step_budget_exhausted', sawImages });
  } finally { await browser.close(); }
})().catch(error => { log({ status: 'error', error: error.message }); process.exitCode = 1; });
