import { mkdtemp, readFile, readdir, type FileHandle } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from './fs-atomic';

const order: string[] = [];
const faults = vi.hoisted(() => ({
  sync: {} as Record<string, string | undefined>,
  close: {} as Record<string, string | undefined>,
  openDir: undefined as string | undefined,
  rename: undefined as string | undefined,
}));
const fail = (code: string) => Object.assign(new Error(`falló ${code}`), { code });

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    open: async (path: string, ...rest: unknown[]) => {
      const kind = String(path).endsWith('.tmp') ? 'file' : 'dir';
      if (kind === 'dir' && faults.openDir) throw fail(faults.openDir);
      const h = await (actual.open as (...a: unknown[]) => Promise<FileHandle>)(path, ...rest);
      return new Proxy(h, {
        get(t, k) {
          const v = Reflect.get(t, k, t) as unknown;
          if (typeof v !== 'function') return v;
          return (...a: unknown[]) => {
            if (k === 'sync' || k === 'close') order.push(`${kind}.${String(k)}`);
            const code = k === 'sync' ? faults.sync[kind] : k === 'close' ? faults.close[kind] : undefined;
            if (code) {
              if (k === 'close') void (v as (...x: unknown[]) => unknown).apply(t, a);
              return Promise.reject(fail(code));
            }
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        },
      });
    },
    rename: async (...a: Parameters<typeof actual.rename>) => {
      order.push('rename');
      if (faults.rename) throw fail(faults.rename);
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

  describe('lỗi giữa chừng', () => {
    const reset = () => {
      faults.sync = {};
      faults.close = {};
      faults.openDir = undefined;
      faults.rename = undefined;
    };
    const run = async () => {
      reset();
      const dir = await mkdtemp(join(tmpdir(), 'fa-'));
      return { dir, path: join(dir, 'c.json') };
    };

    it('fsync tệp tạm lỗi thì ném lỗi gốc và xoá tệp tạm', async () => {
      const { dir, path } = await run();
      faults.sync.file = 'EIO';
      await expect(writeFileAtomic(path, '{}')).rejects.toMatchObject({ code: 'EIO' });
      expect(await readdir(dir)).toEqual([]);
      reset();
    });

    it('rename lỗi thì ném lỗi gốc và xoá tệp tạm', async () => {
      const { dir, path } = await run();
      faults.rename = 'EXDEV';
      await expect(writeFileAtomic(path, '{}')).rejects.toMatchObject({ code: 'EXDEV' });
      expect(await readdir(dir)).toEqual([]);
      reset();
    });

    it('close lỗi không che lỗi gốc của fsync', async () => {
      const { path } = await run();
      faults.sync.file = 'EIO';
      faults.close.file = 'EBADF';
      await expect(writeFileAtomic(path, '{}')).rejects.toMatchObject({ code: 'EIO' });
      reset();
    });

    it('fsync thư mục bị nền tảng từ chối (EPERM, EINVAL, EISDIR) hoặc không mở được thư mục thì vẫn thành công', async () => {
      for (const code of ['EPERM', 'EINVAL', 'EISDIR']) {
        const { path } = await run();
        faults.sync.dir = code;
        await writeFileAtomic(path, '{}');
        expect(await readFile(path, 'utf8')).toBe('{}');
      }
      const { path } = await run();
      faults.openDir = 'EPERM';
      await writeFileAtomic(path, '{}');
      reset();
    });

    it('fsync thư mục lỗi khác (EIO) sau rename thì ghi log và vẫn trả thành công vì tệp đã vào chỗ', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { path } = await run();
      faults.sync.dir = 'EIO';
      await writeFileAtomic(path, '{"a":1}');
      expect(await readFile(path, 'utf8')).toBe('{"a":1}');
      expect(err).toHaveBeenCalledTimes(1);
      expect(String(err.mock.calls[0][0])).toContain('EIO');
      expect(String(err.mock.calls[0][0])).not.toContain(path);
      err.mockRestore();
      reset();
    });
  });
});
