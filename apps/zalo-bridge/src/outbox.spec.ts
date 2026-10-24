import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Outbox } from './outbox';
import type { ZaloBridgeEvent } from './types';

const ev = (msgId: string): ZaloBridgeEvent => ({ type: 'undo', groupId: 'g', msgId });
const file = (dir: string) => join(dir, 'outbox.jsonl');

describe('Outbox', () => {
  it('retry hai lần rồi ok thì gửi đúng 3 lần và tệp rỗng', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    let t = 1_000_000;
    const post = vi.fn<(e: ZaloBridgeEvent) => Promise<'ok' | 'retry' | 'drop'>>();
    post.mockResolvedValueOnce('retry').mockResolvedValueOnce('retry').mockResolvedValue('ok');
    const ob = new Outbox(dir, post, () => t);
    await ob.push(ev('1'));
    expect(ob.size()).toBe(1);

    await ob.flushOnce();
    expect(post).toHaveBeenCalledTimes(1);
    await ob.flushOnce(); // chưa tới giờ thử lại
    expect(post).toHaveBeenCalledTimes(1);
    t += 5_000;
    await ob.flushOnce();
    expect(post).toHaveBeenCalledTimes(2);
    t += 10_000; // lùi nhân đôi: 10 giây
    await ob.flushOnce();
    expect(post).toHaveBeenCalledTimes(3);
    expect(ob.size()).toBe(0);
    expect((await readFile(file(dir), 'utf8')).trim()).toBe('');
  });

  it('ghi tệp trước khi gửi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    const ob = new Outbox(dir, async () => 'ok', () => 0);
    await ob.push(ev('1'));
    expect(await readFile(file(dir), 'utf8')).toContain('"msgId":"1"');
  });

  it('Outbox mới trên cùng thư mục gửi tiếp sự kiện chưa gửi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    const first = new Outbox(dir, async () => 'retry', () => 0);
    await first.push(ev('1'));
    await first.push(ev('2'));

    const sent: string[] = [];
    const second = new Outbox(
      dir,
      async (e) => {
        if (e.type === 'undo') sent.push(e.msgId);
        return 'ok';
      },
      () => 0,
    );
    expect(second.size()).toBe(2);
    await second.flushOnce();
    expect(sent).toEqual(['1', '2']);
    expect(second.size()).toBe(0);
  });

  it('sự kiện 25 giờ tuổi bị bỏ không gửi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    let t = 0;
    const post = vi.fn(async () => 'ok' as const);
    const ob = new Outbox(dir, post, () => t);
    await ob.push(ev('old'));
    t += 25 * 3600_000;
    await ob.flushOnce();
    expect(post).not.toHaveBeenCalled();
    expect(ob.size()).toBe(0);
  });

  it('drop thì bỏ ngay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    const post = vi.fn(async () => 'drop' as const);
    const ob = new Outbox(dir, post, () => 0);
    await ob.push(ev('1'));
    await ob.flushOnce();
    expect(ob.size()).toBe(0);
  });

  it('tệp không đọc được vì lý do khác ENOENT thì ném, không bắt đầu rỗng để rồi ghi đè', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    await mkdir(file(dir));
    expect(() => new Outbox(dir, async () => 'ok', () => 0)).toThrow();
  });

  it('chưa có tệp (ENOENT) thì bắt đầu rỗng', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    expect(new Outbox(dir, async () => 'ok', () => 0).size()).toBe(0);
  });

  it('dòng hỏng trong tệp bị bỏ qua, không làm sập', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    await writeFile(file(dir), 'không phải json\n');
    expect(new Outbox(dir, async () => 'ok', () => 0).size()).toBe(0);
  });

  it('push khi đã start thì tự gửi, không đợi vòng quét', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    const post = vi.fn(async () => 'ok' as const);
    const ob = new Outbox(dir, post, () => Date.now());
    ob.start();
    try {
      await ob.push(ev('1'));
      await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    } finally {
      ob.stop();
    }
  });

  it('một lần ghi đĩa lỗi không làm hỏng các lần sau và không gây unhandled rejection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    let calls = 0;
    const write = vi.fn(async (path: string, data: string) => {
      if (++calls === 1) throw new Error('đĩa đầy');
      await writeFile(path, data);
    });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const post = vi.fn(async () => 'retry' as const);
      const ob = new Outbox(dir, post, () => 0, write);
      await expect(ob.push(ev('1'))).rejects.toThrow('đĩa đầy');
      await ob.push(ev('2'));
      expect(await readFile(file(dir), 'utf8')).toContain('"msgId":"2"');
      await ob.flushOnce();
      expect(post).toHaveBeenCalledTimes(2);
      await new Promise((r) => setImmediate(r));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      err.mockRestore();
    }
  });

  it('flushOnce không ném khi ghi đĩa lỗi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    let fail = false;
    const write = vi.fn(async (path: string, data: string) => {
      if (fail) throw new Error('đĩa đầy');
      await writeFile(path, data);
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const ob = new Outbox(dir, async () => 'ok', () => 0, write);
      await ob.push(ev('1'));
      fail = true;
      await expect(ob.flushOnce()).resolves.toBeUndefined();
      expect(ob.size()).toBe(0);
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  it('sự kiện quá 24 giờ bị bỏ: ghi log id và tuổi (không nội dung), tăng dropped()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    let t = 1_000_000;
    const post = vi.fn<(e: ZaloBridgeEvent) => Promise<'ok' | 'retry' | 'drop'>>(async () => 'retry');
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ob = new Outbox(dir, post, () => t);
    expect(ob.dropped()).toBe(0);
    await ob.push({ type: 'message', groupId: 'g', msgId: 'M42', cliMsgId: 'c', uidFrom: 'u', dName: 'Lan', isSelf: false, ts: 1, text: 'BÍ MẬT 0901234567', imageUrl: null, quote: null });
    t += 24 * 3_600_000 + 5 * 3_600_000;
    await ob.flushOnce();
    expect(ob.size()).toBe(0);
    expect(ob.dropped()).toBe(1);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain('M42');
    expect(logged).toContain('message');
    expect(logged).toMatch(/29/);
    expect(logged).not.toContain('BÍ MẬT');
    expect(logged).not.toContain('0901234567');
    err.mockRestore();
  });

  it('sự kiện drop do API từ chối (400) không tính vào dropped()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ob-'));
    const ob = new Outbox(dir, async () => 'drop', () => 0);
    await ob.push(ev('1'));
    await ob.flushOnce();
    expect(ob.dropped()).toBe(0);
  });
});
