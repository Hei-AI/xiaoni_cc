// Experimental staged controller: all semantic image decisions come from the
// deployed Sonnet model. The host only captures UI and applies validated actions.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { validateObservation, validateDecision, isVerifiedCompletion } = require('./stage-contract.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/home/liahua/IdeaProject/qq_bot/modules/admin-panel/frontend/node_modules/playwright');
const { createRequire } = require('node:module');
const { PNG } = createRequire(require.resolve(process.env.PLAYWRIGHT_MODULE || '/home/liahua/IdeaProject/qq_bot/modules/admin-panel/frontend/node_modules/playwright'))('pngjs');
const runId = `recaptcha-isolated-${Date.now()}`;
const dir = `/tmp/${runId}`;
fs.mkdirSync(dir, { mode: 0o700 });
let turn = 0;
const prompts = Object.fromEntries(['observe','tile','decide','verify'].map(stage => [stage, fs.readFileSync(path.join(__dirname, `${stage}.md`), 'utf8')]));
const tileCache = new Map();
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const observationSchema = schema({
  ready: { type: 'boolean' }, target: { type: 'string' }, rows: { type: 'integer' }, columns: { type: 'integer' },
  cells: { type: 'array', items: schema({ index: { type: 'integer' }, contains_target: { type: 'boolean' }, evidence: { type: 'string' } }) }
});
const decisionSchema = schema({ action: { type: 'string', enum: ['select', 'verify', 'wait', 'blocked'] }, cells: { type: 'array', items: { type: 'integer' } }, reason: { type: 'string' } });
function log(event) { fs.appendFileSync(`${dir}/events.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); console.log(JSON.stringify(event)); }
async function model(stage, state, image, toolSchema, contextImage) {
  const job = { runId, stage, turn: ++turn, state, image: image?.toString('base64'), contextImage: contextImage?.toString('base64'), prompt: prompts[stage], schema: toolSchema };
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
  log({ stage, turn: job.turn, tileIndex: state.index, ...result });
  return { ...result.value, _sourceSlice: result.slice };
}
(async () => {
  log({ runId, status: 'started', targetModel: 'claude-sonnet-4-6', url: 'https://captcha.liahuas.top' });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  let sawImages = false;
  let imageVerifySubmitted = false;
  try {
    await page.goto('https://captcha.liahuas.top');
    await page.frameLocator('iframe[title="reCAPTCHA"]').locator('#recaptcha-anchor').click({ timeout: 20000 });
    for (let step = 0; step < Number(process.env.RECAPTCHA_MAX_STEPS || 100); step++) {
      try {
      await page.waitForTimeout(3500);
      if (await page.locator('#submit').isEnabled()) {
        const responsePromise = page.waitForResponse(r => r.url() === 'https://captcha.liahuas.top/verify' && r.request().method() === 'POST');
        await page.locator('#submit').click();
        const verdict = await (await responsePromise).json();
        await page.screenshot({ path: `${dir}/final.png` });
        const verification = await model('verify', { page: await page.locator('#status').innerText(), sawImages, imageVerifySubmitted, verdict }, null,
          schema({ result: { type: 'integer', enum: [0,10] }, reason: { type: 'string' } }));
        const passed = isVerifiedCompletion(sawImages, verdict, verification, imageVerifySubmitted);
        log({ status: passed ? 'image_challenge_passed' : 'no_image_success', goalResult: passed ? 10 : null, sawImages, imageVerifySubmitted, verdict });
        if (passed) console.log('10');
        else process.exitCode = 2;
        return;
      }
      const frame = page.frames().find(f => f.url().includes('/bframe'));
      const visibleBounds = frame ? await frame.locator('#rc-imageselect').boundingBox() : null;
      const viewport = page.viewportSize();
      if (!frame || !visibleBounds || visibleBounds.x < 0 || visibleBounds.y < 0 ||
          visibleBounds.x + visibleBounds.width > viewport.width + 1 || visibleBounds.y + visibleBounds.height > viewport.height + 1 ||
          !await frame.locator('td').first().isVisible()) {
        await page.screenshot({ path: `${dir}/unready-${step}.png` });
        log({ step, status: 'no_visible_challenge' });
        const anchor = page.frameLocator('iframe[title="reCAPTCHA"]').locator('#recaptcha-anchor');
        if (await anchor.isVisible() && await anchor.getAttribute('aria-checked') !== 'true') {
          sawImages = false; imageVerifySubmitted = false;
          await anchor.click({ timeout: 3000 });
          log({ step, status: 'new_checkbox_attempt', imageEvidenceReset: true });
        }
        continue;
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
      const clip = await frame.locator('#rc-imageselect').boundingBox();
      if (!clip) continue;
      const boxes = await Promise.all(Array.from({ length: count }, (_, i) => cells.nth(i).boundingBox()));
      const capture = await page.screenshot({ clip, timeout: 15000 });
      fs.writeFileSync(`${dir}/frame-${step}.png`, capture);
      const instruction = await frame.locator('.rc-imageselect-desc-wrapper').innerText();
      log({ stage: 'page', step, feedback: await frame.locator('body').innerText() });
      const dynamic = /没有新图片|none left|once there are none/i.test(instruction);
      let observation;
      if (process.env.RECAPTCHA_OBSERVATION === 'grid') {
        observation = await model('observe', { instruction, cellCount: count }, capture, observationSchema);
      } else {
        const decoded = PNG.sync.read(capture);
        const tileImages = boxes.map(box => {
          if (!box) throw new Error('Missing tile bounds');
          const x = Math.max(0, Math.round(box.x - clip.x) + 2), y = Math.max(0, Math.round(box.y - clip.y) + 2);
          const w = Math.min(Math.floor(box.width) - 4, decoded.width - x), h = Math.min(Math.floor(box.height) - 4, decoded.height - y);
          const png = new PNG({ width: w, height: h });
          PNG.bitblt(decoded, png, x, y, w, h, 0, 0);
          let nonWhite = 0;
          for (let i = 0; i < png.data.length; i += 4) if (Math.min(png.data[i], png.data[i+1], png.data[i+2]) < 245) nonWhite++;
          const enlarged = new PNG({ width: w*4, height: h*4 });
          for (let y2=0; y2<enlarged.height; y2++) for (let x2=0; x2<enlarged.width; x2++) {
            const source = (Math.floor(y2/4)*w + Math.floor(x2/4))*4;
            const dest = (y2*enlarged.width + x2)*4;
            png.data.copy(enlarged.data,dest,source,source+4);
          }
          return { bytes: PNG.sync.write(enlarged), blank: nonWhite / (w*h) < 0.005 };
        });
        if (tileImages.some(tile => tile.blank)) { log({ step, status: 'blank_tile_wait' }); continue; }
        const observations = [];
        // Independent tile requests; reuse only byte-identical visual facts.
        const concurrency = Math.max(1, Math.min(6, Number(process.env.RECAPTCHA_TILE_CONCURRENCY || 6)));
        for (let offset = 0; offset < count; offset += concurrency) {
          const batch = await Promise.allSettled(tileImages.slice(offset, offset + concurrency).map(async (tile, j) => {
            const index = offset + j + 1;
            fs.writeFileSync(`${dir}/tile-${step}-${index}.png`, tile.bytes);
            const key = createHash('sha256').update(JSON.stringify({ instruction, index: count === 16 ? index : 0 })).update(tile.bytes).update(count === 16 ? capture : '').digest('hex');
            if (tileCache.has(key)) {
              const value = tileCache.get(key);
              log({ stage: 'tile_cache', step, index, key, sourceSlice: value._sourceSlice });
              return { index, ...value };
            }
            const value = await model('tile', { instruction, index, row: Math.ceil(index/Math.sqrt(count)), column: (index-1)%Math.sqrt(count)+1,
              imageMode: count === 16 ? 'full-scene then exact tile' : 'single separate photo' }, tile.bytes,
              schema({ ready: { type: 'boolean' }, contains_target: { type: 'boolean' }, evidence: { type: 'string' } }),
              count === 16 ? capture : undefined);
            if (value.ready) tileCache.set(key, value);
            return { index, ...value };
          }));
          for (const result of batch) {
            if (result.status === 'rejected') throw result.reason;
            observations.push(result.value);
          }
        }
        observation = { ready: observations.every(cell => cell.ready), target: instruction, rows: Math.sqrt(count), columns: Math.sqrt(count), cells: observations };
      }
      validateObservation(observation, count);
      const decision = await model('decide', { observation }, null, decisionSchema);
      if (!await cells.first().isVisible() || gridVersion !== await cells.locator('img').evaluateAll(images => images.map(img => img.src).join('\n'))) {
        log({ step, status: 'discarded_stale_observation' }); continue;
      }
      if (decision.action === 'blocked') { log({ status: 'blocked', decision }); process.exitCode = 2; return; }
      if (decision.action === 'wait') continue;
      const indices = validateDecision(observation, decision);
      if (decision.action === 'select') {
        for (const index of indices) {
          const cell = cells.nth(index - 1);
          const bounds = await cell.boundingBox();
          if (!await cell.isVisible() || !bounds) throw new Error('Visual action target disappeared');
          await page.mouse.click(bounds.x + bounds.width/2, bounds.y + bounds.height/2);
          await page.waitForTimeout(250);
        }
        log({ stage: 'execute', step, action: 'select', cells: indices, dynamic });
        if (dynamic) continue;
      }
      await frame.locator('#recaptcha-verify-button').click({ timeout: 3000 });
      imageVerifySubmitted = true;
      log({ stage: 'execute', step, action: 'verify' });
      } catch (error) {
        log({ step, status: 'step_interrupted', error: error.message });
        await page.screenshot({ path: `${dir}/interruption-${step}.png`, timeout: 5000 }).catch(() => {});
        if (!/Timeout|disappeared|detached|closed|Clipped area/i.test(error.message)) throw error;
        if (page.isClosed()) throw error;
      }
    }
    log({ status: 'step_budget_exhausted', sawImages });
    process.exitCode = 2;
  } finally { await browser.close(); }
})().catch(error => { log({ status: 'error', error: error.message }); process.exitCode = 1; });
