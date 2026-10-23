import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore } from './config-store';

describe('ConfigStore', () => {
  it('mặc định groupId null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfg-'));
    expect(new ConfigStore(dir).get()).toEqual({ groupId: null });
  });

  it('lưu rồi tạo store mới vẫn đọc được; đặt null để xoá', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfg-'));
    await new ConfigStore(dir).set('g1');
    expect(new ConfigStore(dir).get()).toEqual({ groupId: 'g1' });
    const s = new ConfigStore(dir);
    await s.set(null);
    expect(s.get()).toEqual({ groupId: null });
    expect(new ConfigStore(dir).get()).toEqual({ groupId: null });
  });

  it('tệp hỏng thì coi như chưa cấu hình', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfg-'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'config.json'), '{hỏng');
    expect(new ConfigStore(dir).get()).toEqual({ groupId: null });
  });
});
