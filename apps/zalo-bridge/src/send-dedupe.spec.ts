import { describe, expect, it } from 'vitest';
import { SendDedupe } from './send-dedupe';

describe('SendDedupe', () => {
  it('lưu và đọc', () => {
    const d = new SendDedupe();
    expect(d.get('k')).toBeUndefined();
    d.set('k', 'm1');
    expect(d.get('k')).toBe('m1');
  });

  it('hết TTL thì get trả undefined', () => {
    let t = 0;
    const d = new SendDedupe(1000, 10, () => t);
    d.set('k', 'm1');
    t = 1001;
    expect(d.get('k')).toBeUndefined();
  });

  it('vượt max thì bỏ mục cũ nhất', () => {
    const d = new SendDedupe(1000, 2);
    d.set('a', '1');
    d.set('b', '2');
    d.set('c', '3');
    expect(d.get('a')).toBeUndefined();
    expect(d.get('c')).toBe('3');
  });
});

describe('SendDedupe lưu đĩa', () => {
  it('nạp lại sau khi khởi động lại, bỏ mục hết hạn', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const path = join(mkdtempSync(join(tmpdir(), 'sd-')), 'sent.json');
    let t = 0;
    const a = new SendDedupe(1000, 10, () => t, path);
    a.set('old', 'm0');
    t = 600;
    a.set('k', 'm1');
    await a.persist();
    t = 1100;
    const b = new SendDedupe(1000, 10, () => t, path);
    expect(b.get('k')).toBe('m1');
    expect(b.get('old')).toBeUndefined();
  });

  it('tệp hỏng thì bắt đầu rỗng', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const path = join(mkdtempSync(join(tmpdir(), 'sd-')), 'sent.json');
    writeFileSync(path, '{hỏng');
    expect(new SendDedupe(1000, 10, () => 0, path).get('k')).toBeUndefined();
  });
});
