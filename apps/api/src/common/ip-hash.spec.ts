import { createHash } from 'node:crypto';
import { hashIp } from './ip-hash';

describe('hashIp', () => {
  it('64 ký tự hex, ổn định với cùng IP, bí mật và mục đích', () => {
    const a = hashIp('203.0.113.7', 'secret-a', 'affiliate-click');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('203.0.113.7', 'secret-a', 'affiliate-click')).toBe(a);
  });

  it('IP khác, bí mật khác hay mục đích khác đều ra mã khác', () => {
    const base = hashIp('203.0.113.7', 'secret-a', 'affiliate-click');
    expect(hashIp('203.0.113.8', 'secret-a', 'affiliate-click')).not.toBe(base);
    expect(hashIp('203.0.113.7', 'secret-b', 'affiliate-click')).not.toBe(base);
    expect(hashIp('203.0.113.7', 'secret-a', 'khac')).not.toBe(base);
  });

  it('không phải sha256 trần của IP (kẻ có DB nhưng không có khoá không dò ngược được)', () => {
    const out = hashIp('203.0.113.7', 'secret-a', 'affiliate-click');
    expect(out).not.toBe(createHash('sha256').update('203.0.113.7').digest('hex'));
    expect(out).not.toBe(createHash('sha256').update('affiliate-click|203.0.113.7').digest('hex'));
  });

  it('chưa có bí mật (dev/test) vẫn băm được và ổn định; rỗng coi như chưa có', () => {
    const dev = hashIp('203.0.113.7', undefined, 'affiliate-click');
    expect(dev).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('203.0.113.7', '', 'affiliate-click')).toBe(dev);
    expect(dev).not.toBe(hashIp('203.0.113.7', 'secret-a', 'affiliate-click'));
  });
});
