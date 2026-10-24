import { mkdtemp, readFile, readdir, type FileHandle } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from './fs-atomic';

const order: string[] = [];

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (path: string, ...rest: unknown[]) => {
      const h = await (actual.open as (...a: unknown[]) => Promise<FileHandle>)(path, ...rest);
      const kind = String(path).endsWith('.tmp') ? 'file' : 'dir';
      return new Proxy(h, {
        get(t, k) {
          const v = Reflect.get(t, k, t) as unknown;
          if (typeof v !== 'function') return v;
          return (...a: unknown[]) => {
            if (k === 'sync' || k === 'close') order.push(`${kind}.${String(k)}`);
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        },
      });
    },
    rename: async (...a: Parameters<typeof actual.rename>) => {
      order.push('rename');
      return actual.rename(...a);
    },
  };
});

describe('writeFileAtomic', () => {
  it('nhiều lần ghi đồng thời không đè lên tệp tạm của nhau, tệp đích luôn là một bản nguyên vẹn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fa-'));
    const path = join(dir, 'config.json');
    const bodies = Array.from({ length: 20 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(50_000) }));
    await Promise.all(bodies.map((b) => writeFileAtomic(path, b)));
    expect(bodies).toContain(await readFile(path, 'utf8'));
    expect(await readdir(dir)).toEqual(['config.json']);
  });

  it('thứ tự: ghi tệp tạm, fsync, đóng, rename, rồi fsync thư mục', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fa-'));
    order.length = 0;
    await writeFileAtomic(join(dir, 'c.json'), '{}');
    expect(order).toEqual(['file.sync', 'file.close', 'rename', 'dir.sync', 'dir.close']);
  });
});
