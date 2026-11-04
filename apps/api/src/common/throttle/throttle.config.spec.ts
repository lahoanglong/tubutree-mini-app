import type { Request } from 'express';
import { throttleIpKey, throttleIpTracker } from './throttle.config';

describe('throttleIpKey (W5)', () => {
  it('IPv4 giữ nguyên', () => expect(throttleIpKey('1.2.3.4')).toBe('1.2.3.4'));
  it('::ffff:a.b.c.d đổi về a.b.c.d', () => {
    expect(throttleIpKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(throttleIpKey('::FFFF:1.2.3.4')).toBe('1.2.3.4');
  });
  it('IPv6 cùng tiền tố /64 chung một khoá', () => {
    expect(throttleIpKey('2001:db8::1')).toBe(throttleIpKey('2001:db8::ffff'));
    expect(throttleIpKey('2001:db8:0:0:aaaa:bbbb:cccc:dddd')).toBe(throttleIpKey('2001:db8::1'));
  });
  it('IPv6 khác /64 thì khác khoá', () => {
    expect(throttleIpKey('2001:db8:0:1::1')).not.toBe(throttleIpKey('2001:db8:0:2::1'));
  });
  it('chuỗi không phải IP (unknown) giữ nguyên', () => expect(throttleIpKey('unknown')).toBe('unknown'));
  it('throttleIpTracker lấy req.ip rồi chuẩn hoá, thiếu thì dùng socket', () => {
    expect(throttleIpTracker({ ip: '2001:db8::1' } as unknown as Request)).toBe(throttleIpKey('2001:db8::ffff'));
    expect(throttleIpTracker({ ip: '::ffff:9.9.9.9' } as unknown as Request)).toBe('9.9.9.9');
    expect(throttleIpTracker({ socket: { remoteAddress: '::ffff:8.8.8.8' } } as unknown as Request)).toBe('8.8.8.8');
    expect(throttleIpTracker({} as unknown as Request)).toBe('unknown');
  });
});
