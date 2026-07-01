import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QqSendImageService } from '../services/qq-send-image-service';

// 耐久性铁律：她发出去的图必须拷进持久归档目录，重启/清理原图后 inspect 仍可解。
test('sendPrivate archives the sent image into a persistent picture/outbound copy', async () => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qqimg-'));
  try {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 7)
    ]);
    const srcDir = path.join(runtimeRoot, 'gen');
    await fs.mkdir(srcDir, { recursive: true });
    const srcPath = path.join(srcDir, 'sent.png');
    await fs.writeFile(srcPath, png);

    const service = new QqSendImageService({
      runtimeRoot,
      allowedRoots: [runtimeRoot],
      fetchImpl: (async () => ({
        ok: true,
        text: async () => JSON.stringify({ success: true, data: { message_id: 42 } })
      })) as any
    });

    const result = await service.sendPrivate({ user_id: 85178516, image_path: srcPath });

    assert.notEqual(result.failed, true);
    assert.ok(result.archived_path, 'archived_path returned');
    const outboundDir = path.join(runtimeRoot, 'picture', 'outbound');
    assert.ok(result.archived_path!.startsWith(outboundDir + path.sep), 'archived under picture/outbound (provider-readable, persistent)');
    const archived = await fs.readFile(result.archived_path!);
    assert.deepEqual(archived, png, 'archive is a byte copy of the sent image');

    // 幂等：同图再发一次，归档到同一个内容哈希文件，不新建
    const again = await service.sendPrivate({ user_id: 85178516, image_path: srcPath });
    assert.equal(again.archived_path, result.archived_path, 'same bytes -> same archived path (content-hash)');
  } finally {
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
});
