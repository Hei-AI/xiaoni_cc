/**
 * Claude Code cch signing for the x-anthropic-billing-header system[0] block.
 *
 * Real Claude Code puts `x-anthropic-billing-header: cc_version=...; cc_entrypoint=...;
 * cch=<5 hex>;` as system[0].text and sets cch to an integrity checksum of the whole
 * request body (no secret key — just xxHash64 with a fixed public seed). The endpoint
 * verifies it by zeroing the cch in the received bytes and re-hashing. We reproduce it
 * exactly (matches CLIProxyAPI internal/runtime/executor/claude_signing.go):
 *
 *   cch = xxHash64( body-bytes-with-cch=00000 , 0x6E52736AC806831E ) & 0xFFFFF  -> %05x
 *
 * This changes per request, but Anthropic excludes its own billing block from the
 * prompt-cache key, so signing does NOT bust the prefix cache.
 */

const MASK64 = (1n << 64n) - 1n;
const PRIME64_1 = 0x9e3779b185ebca87n;
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn;
const PRIME64_3 = 0x165667b19e3779f9n;
const PRIME64_4 = 0x85ebca77c2b2ae63n;
const PRIME64_5 = 0x27d4eb2f165667c5n;

const CCH_SEED = 0x6e52736ac806831en;

const mul = (a: bigint, b: bigint): bigint => (a * b) & MASK64;
const add = (a: bigint, b: bigint): bigint => (a + b) & MASK64;
const rotl64 = (x: bigint, r: bigint): bigint => ((x << r) | (x >> (64n - r))) & MASK64;

function round(acc: bigint, input: bigint): bigint {
  acc = add(acc, mul(input, PRIME64_2));
  acc = rotl64(acc, 31n);
  return mul(acc, PRIME64_1);
}

function mergeRound(acc: bigint, val: bigint): bigint {
  acc ^= round(0n, val);
  return add(mul(acc, PRIME64_1), PRIME64_4);
}

function read64LE(buf: Uint8Array, i: number): bigint {
  let v = 0n;
  for (let j = 7; j >= 0; j -= 1) {
    v = (v << 8n) | BigInt(buf[i + j]!);
  }
  return v & MASK64;
}

function read32LE(buf: Uint8Array, i: number): bigint {
  let v = 0n;
  for (let j = 3; j >= 0; j -= 1) {
    v = (v << 8n) | BigInt(buf[i + j]!);
  }
  return v & MASK64;
}

/** Canonical XXH64 (64-bit) of a byte buffer with the given seed. */
export function xxh64(buf: Uint8Array, seed: bigint): bigint {
  const len = buf.length;
  let h64: bigint;
  let p = 0;

  if (len >= 32) {
    let v1 = add(add(seed, PRIME64_1), PRIME64_2);
    let v2 = add(seed, PRIME64_2);
    let v3 = add(seed, 0n);
    let v4 = (seed - PRIME64_1) & MASK64;
    const limit = len - 32;
    while (p <= limit) {
      v1 = round(v1, read64LE(buf, p)); p += 8;
      v2 = round(v2, read64LE(buf, p)); p += 8;
      v3 = round(v3, read64LE(buf, p)); p += 8;
      v4 = round(v4, read64LE(buf, p)); p += 8;
    }
    h64 = add(add(add(rotl64(v1, 1n), rotl64(v2, 7n)), rotl64(v3, 12n)), rotl64(v4, 18n));
    h64 = mergeRound(h64, v1);
    h64 = mergeRound(h64, v2);
    h64 = mergeRound(h64, v3);
    h64 = mergeRound(h64, v4);
  } else {
    h64 = add(seed, PRIME64_5);
  }

  h64 = add(h64, BigInt(len));
  let remaining = len - p;
  while (remaining >= 8) {
    h64 ^= round(0n, read64LE(buf, p));
    h64 = add(mul(rotl64(h64, 27n), PRIME64_1), PRIME64_4);
    p += 8; remaining -= 8;
  }
  if (remaining >= 4) {
    h64 ^= mul(read32LE(buf, p), PRIME64_1);
    h64 = add(mul(rotl64(h64, 23n), PRIME64_2), PRIME64_3);
    p += 4; remaining -= 4;
  }
  while (remaining > 0) {
    h64 ^= mul(BigInt(buf[p]!), PRIME64_5);
    h64 = mul(rotl64(h64, 11n), PRIME64_1);
    p += 1; remaining -= 1;
  }

  h64 ^= h64 >> 33n;
  h64 = mul(h64, PRIME64_2);
  h64 ^= h64 >> 29n;
  h64 = mul(h64, PRIME64_3);
  h64 ^= h64 >> 32n;
  return h64 & MASK64;
}

const CCH_PATTERN = /cch=[0-9a-f]{5};/;

/**
 * Sign the billing block in-place: if system[0].text is the x-anthropic-billing-header,
 * zero its cch, hash the whole serialized body, and write the 5-hex checksum back.
 * No-op if there is no billing block (then this isn't a cloaked request).
 */
export function signClaudeBillingCch(body: { system?: Array<{ type: 'text'; text: string }> }): void {
  const block = body.system?.[0];
  if (!block || typeof block.text !== 'string' || !block.text.startsWith('x-anthropic-billing-header:')) {
    return;
  }
  if (!CCH_PATTERN.test(block.text)) {
    return;
  }
  // 1. zero the cch
  block.text = block.text.replace(CCH_PATTERN, 'cch=00000;');
  // 2. hash the exact UTF-8 body bytes (with cch=00000) — same serialization axios sends
  const checksum = xxh64(Buffer.from(JSON.stringify(body), 'utf8'), CCH_SEED) & 0xfffffn;
  const cch = checksum.toString(16).padStart(5, '0');
  // 3. write it back (same length, so the sent bytes differ from the hashed bytes only here)
  block.text = block.text.replace('cch=00000;', `cch=${cch};`);
}
