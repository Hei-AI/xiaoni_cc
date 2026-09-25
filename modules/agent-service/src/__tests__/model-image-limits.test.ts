import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  readImageDimensions,
  planImageFit,
  fitImageDataUrlForModel,
  fitInputImageItemsForModel,
  MAX_LONG_EDGE_PX,
  MIN_LONG_EDGE_PX,
  MAX_IMAGE_BYTES
} from '../services/model-image-fit';

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function jpegHeader(width: number, height: number): Buffer {
  // SOI, APP0 (len 16), SOF0 with height/width
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(16)]);
}

function webpVp8x(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

test('readImageDimensions reads PNG, JPEG and WebP headers', () => {
  assert.deepEqual(readImageDimensions(png(37, 11)), { width: 37, height: 11 });
  assert.deepEqual(readImageDimensions(jpegHeader(2626, 8056)), { width: 2626, height: 8056 });
  assert.deepEqual(readImageDimensions(webpVp8x(4000, 300)), { width: 4000, height: 300 });
  assert.equal(readImageDimensions(Buffer.from('not an image')), null);
});

test('planImageFit: downscales oversized, upscales tiny, re-encodes heavy, leaves normal images', () => {
  assert.deepEqual(planImageFit({ width: 2626, height: 8056 }, 100), { width: 652, height: MAX_LONG_EDGE_PX });
  assert.deepEqual(planImageFit({ width: 20000, height: 100 }, 100), { width: MAX_LONG_EDGE_PX, height: 10 });
  assert.deepEqual(planImageFit({ width: 16, height: 8 }, 100), { width: MIN_LONG_EDGE_PX, height: 16 });
  assert.deepEqual(planImageFit({ width: 1520, height: 1035 }, MAX_IMAGE_BYTES + 1), { width: 1520, height: 1035 });
  assert.equal(planImageFit({ width: 1024, height: 506 }, 800_000), null);
});

test('fitImageDataUrlForModel re-encodes only images that need it, via the encoder', async () => {
  const calls: Array<{ width: number; height: number }> = [];
  const encoder = async (_input: Buffer, size: { width: number; height: number }) => {
    calls.push(size);
    return Buffer.from('webp-bytes');
  };
  const normal = `data:image/png;base64,${png(100, 50).toString('base64')}`;
  assert.equal(await fitImageDataUrlForModel(normal, encoder), normal);
  assert.equal(calls.length, 0);

  const tiny = `data:image/png;base64,${png(8, 8).toString('base64')}`;
  assert.equal(await fitImageDataUrlForModel(tiny, encoder), `data:image/webp;base64,${Buffer.from('webp-bytes').toString('base64')}`);
  assert.deepEqual(calls, [{ width: MIN_LONG_EDGE_PX, height: MIN_LONG_EDGE_PX }]);
});

test('fitImageDataUrlForModel keeps the original on encoder failure, GIF, or non-data URLs', async () => {
  const failing = async () => { throw new Error('cwebp missing'); };
  const tiny = `data:image/png;base64,${png(8, 8).toString('base64')}`;
  assert.equal(await fitImageDataUrlForModel(tiny, failing), tiny);
  const gif = `data:image/gif;base64,${Buffer.from('GIF89a\x08\x00\x08\x00').toString('base64')}`;
  assert.equal(await fitImageDataUrlForModel(gif, failing), gif);
  assert.equal(await fitImageDataUrlForModel('https://example.com/a.png', failing), 'https://example.com/a.png');
});

test('fitInputImageItemsForModel only touches input_image items and keeps other fields', async () => {
  const encoder = async () => Buffer.from('w');
  const tiny = `data:image/png;base64,${png(8, 8).toString('base64')}`;
  const items = [
    { type: 'input_text', text: 'hi' },
    { type: 'input_image', image_url: tiny, detail: 'original' }
  ];
  const [text, image] = await fitInputImageItemsForModel(items, encoder) as any[];
  assert.equal(text, items[0]);
  assert.equal(image.detail, 'original');
  assert.equal(image.image_url, `data:image/webp;base64,${Buffer.from('w').toString('base64')}`);
});
