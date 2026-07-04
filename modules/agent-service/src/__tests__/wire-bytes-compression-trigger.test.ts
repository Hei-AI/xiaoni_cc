import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateCanonicalRequestWireBytes,
  setCompressionTriggerWireBytes,
  setCompressionWireBytesCalibrationFactor,
  __setCompressionWireTriggerCounterForTest,
  shouldTriggerCompressionFromWireBytes,
  isWireBytesOverrun,
  transcodeInputImageItemsToWebpLossless
} from '../services/agent-loop-service';

// Unit coverage for the BYTE-side compression trigger (the image-heavy blind spot the token
// trigger can't see) and the at-ingest WebP transcode. These are the pieces that keep the main
// loop from silently 413-ing on Anthropic's 32MB per-request cap.

const MiB = 1024 * 1024;

test('estimateCanonicalRequestWireBytes: JSON byte length scaled by the calibration factor', () => {
  setCompressionWireBytesCalibrationFactor(1.0);
  const small = estimateCanonicalRequestWireBytes({ a: 'x' });
  const big = estimateCanonicalRequestWireBytes({ a: 'x'.repeat(10000) });
  assert.ok(big > small, 'bigger payload → bigger estimate');
  assert.ok(big >= 10000, 'base64/ASCII length ≈ bytes');

  // The factor scales the estimate linearly.
  setCompressionWireBytesCalibrationFactor(2.0);
  const scaled = estimateCanonicalRequestWireBytes({ a: 'x'.repeat(1000) });
  setCompressionWireBytesCalibrationFactor(1.0);
  const unscaled = estimateCanonicalRequestWireBytes({ a: 'x'.repeat(1000) });
  assert.ok(scaled > unscaled * 1.8, 'factor 2.0 roughly doubles the estimate');
});

test('estimateCanonicalRequestWireBytes: unserializable input returns 0 (never false-trips the halt)', () => {
  setCompressionWireBytesCalibrationFactor(1.0);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(estimateCanonicalRequestWireBytes(circular), 0);
});

test('soft trigger: fires only after the consecutive-over-soft debounce (mirrors the token side)', () => {
  const key = 'test-wire-soft';
  __setCompressionWireTriggerCounterForTest(key, 0);
  assert.equal(shouldTriggerCompressionFromWireBytes(key), false);
  __setCompressionWireTriggerCounterForTest(key, 1);
  assert.equal(shouldTriggerCompressionFromWireBytes(key), false, '1 turn < 2-turn debounce');
  __setCompressionWireTriggerCounterForTest(key, 2);
  assert.equal(shouldTriggerCompressionFromWireBytes(key), true, '2 consecutive over-soft turns arm it');
});

test('hard line: an estimate past soft + 6 MiB margin trips the pre-send overrun halt', () => {
  setCompressionTriggerWireBytes(24 * MiB); // 24 MiB soft → 30 MiB hard
  assert.equal(isWireBytesOverrun(29 * MiB), false, 'under the hard line');
  assert.equal(isWireBytesOverrun(31 * MiB), true, 'over the hard line');

  // The configurable soft line moves the hard line with it.
  setCompressionTriggerWireBytes(10 * MiB); // 10 MiB soft → 16 MiB hard
  assert.equal(isWireBytesOverrun(15 * MiB), false);
  assert.equal(isWireBytesOverrun(17 * MiB), true);

  setCompressionTriggerWireBytes(24 * MiB); // restore the default for other tests
});

test('WebP transcode: non-image items pass through untouched', async () => {
  const items = [{ type: 'input_text', text: 'hi' }] as never[];
  const out = await transcodeInputImageItemsToWebpLossless(items);
  assert.deepEqual(out, items);
});

test('WebP transcode: deterministic (stack-replay consistency) and never throws', async () => {
  // A valid 1x1 PNG. cwebp may or may not be installed on the test host; either way the transform
  // MUST be deterministic — same input → byte-identical output — so a later stack replay reproduces
  // exactly what was stored (the cache-prefix-safety requirement). It must also never throw.
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const items = [{ type: 'input_image', image_url: `data:image/png;base64,${png1x1}`, detail: 'original' }] as never[];

  const out1 = await transcodeInputImageItemsToWebpLossless(items);
  const out2 = await transcodeInputImageItemsToWebpLossless(items);
  assert.deepEqual(out1, out2, 'two runs are byte-identical → replay-safe');

  const url = (out1[0] as unknown as { image_url: string }).image_url;
  const original = (items[0] as unknown as { image_url: string }).image_url;
  // Either it transcoded to webp, or (cwebp missing / no-shrink on a 1x1) it kept the original PNG.
  // Both are valid, both are data URLs — what matters is it's one of the two, deterministically.
  assert.ok(
    url.startsWith('data:image/webp;base64,') || url === original,
    'result is either lossless webp or the untouched original data URL'
  );
});

test('WebP transcode: a non-PNG/JPEG data URL is left untouched', async () => {
  const gif = [{ type: 'input_image', image_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', detail: 'auto' }] as never[];
  const out = await transcodeInputImageItemsToWebpLossless(gif);
  assert.deepEqual(out, gif, 'GIF (maybe animated) is out of scope — passthrough');
});
