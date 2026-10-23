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
