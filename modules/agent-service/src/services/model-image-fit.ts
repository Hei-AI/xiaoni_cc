// At-ingest image fitting: every image that enters Xiaoni's model context is brought inside
// the limits the model endpoint accepts BEFORE it is frozen into the stack.
//
// LongCat (measured 2026-09-25): a request body over 20 MiB is rejected (413), an image whose
// long edge is <= 16px or far past 8000px is rejected (400 "Image dimensions exceed ... limits").
// One such image in the stack makes every later request fail, and a single 16.5MB PNG (seen on
// 2026-09-01) is over the body cap by itself. Fitting:
//   · long edge > MAX_LONG_EDGE_PX  -> downscale to MAX_LONG_EDGE_PX, lossy WebP
//   · long edge < MIN_LONG_EDGE_PX  -> upscale to MIN_LONG_EDGE_PX, lossy WebP
//   · otherwise, bytes > MAX_IMAGE_BYTES -> re-encode at the same size, lossy WebP
//   · otherwise unchanged
// The fitted data URL is what the stack stores, so live build, stack replay and every fork
// clone read the same bytes — no cache drift. On any failure the item is returned unchanged.

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

export const MAX_LONG_EDGE_PX = 2000;
export const MIN_LONG_EDGE_PX = 32;
export const MAX_IMAGE_BYTES = 1_572_864; // 1.5 MiB
const FIT_WEBP_QUALITY = 85;
const CWEBP_TIMEOUT_MS = 30_000;

export type ImageDimensions = { width: number; height: number };

// Reads width/height from a PNG, JPEG, WebP or GIF header. Returns null when unknown.
export function readImageDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    return null;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        offset += marker === 0xff ? 1 : 2;
        continue;
      }
      const length = buf.readUInt16BE(offset + 2);
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) {
        return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

export type FitResize = { width: number; height: number } | null;

// What fitting an image of these dimensions/bytes needs: null = leave as is, otherwise the
// target size (equal to the input size for a same-size re-encode).
export function planImageFit(dims: ImageDimensions, bytes: number): FitResize {
  const longEdge = Math.max(dims.width, dims.height);
  if (longEdge <= 0) {
    return null;
  }
  const scaleTo = (edge: number): { width: number; height: number } => {
    const scale = edge / longEdge;
    return {
      width: Math.max(1, Math.round(dims.width * scale)),
      height: Math.max(1, Math.round(dims.height * scale))
    };
  };
  if (longEdge > MAX_LONG_EDGE_PX) {
    return scaleTo(MAX_LONG_EDGE_PX);
  }
  if (longEdge < MIN_LONG_EDGE_PX) {
    return scaleTo(MIN_LONG_EDGE_PX);
  }
  if (bytes > MAX_IMAGE_BYTES) {
    return { width: dims.width, height: dims.height };
  }
  return null;
}

export type WebpResizeEncoder = (input: Buffer, size: { width: number; height: number }) => Promise<Buffer>;

export function defaultCwebpResizeEncoder(input: Buffer, size: { width: number; height: number }): Promise<Buffer> {
  return (async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'xn-fit-'));
    const inPath = path.join(dir, 'in');
    const outPath = path.join(dir, 'out.webp');
    try {
      await fs.writeFile(inPath, input);
      await new Promise<void>((resolve, reject) => {
        const args = ['-quiet', '-q', String(FIT_WEBP_QUALITY), '-resize', String(size.width), String(size.height), inPath, '-o', outPath];
        const child = spawn('cwebp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('cwebp timeout'));
        }, CWEBP_TIMEOUT_MS);
        timer.unref?.();
        child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('error', (error) => { clearTimeout(timer); reject(error); });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`cwebp exit ${code}: ${stderr.slice(0, 200)}`));
        });
      });
      return await fs.readFile(outPath);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  })();
}

const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;
// cwebp reads PNG, JPEG, TIFF and WebP; anything else (GIF) is left unchanged.
const FITTABLE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/tiff']);

export async function fitImageDataUrlForModel(
  dataUrl: string,
  encoder: WebpResizeEncoder = defaultCwebpResizeEncoder
): Promise<string> {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match || !FITTABLE_MIME.has(match[1]!.toLowerCase())) {
    return dataUrl;
  }
  try {
    const input = Buffer.from(match[2]!, 'base64');
    const dims = readImageDimensions(input);
    if (!dims) {
      return dataUrl;
    }
    const target = planImageFit(dims, input.length);
    if (!target) {
      return dataUrl;
    }
    const webp = await encoder(input, target);
    if (!webp || webp.length === 0) {
      return dataUrl;
    }
    return `data:image/webp;base64,${webp.toString('base64')}`;
  } catch {
    return dataUrl;
  }
}

type InputImageLike = { type?: unknown; image_url?: unknown };

// Fits every input_image item (data URLs only); other items pass through untouched.
export async function fitInputImageItemsForModel<T>(
  items: T[],
  encoder: WebpResizeEncoder = defaultCwebpResizeEncoder
): Promise<T[]> {
  return Promise.all(items.map(async (item) => {
    const rec = item as unknown as InputImageLike;
    if (!rec || rec.type !== 'input_image' || typeof rec.image_url !== 'string') {
      return item;
    }
    const fitted = await fitImageDataUrlForModel(rec.image_url, encoder);
    return fitted === rec.image_url ? item : ({ ...(item as object), image_url: fitted } as unknown as T);
  }));
}
