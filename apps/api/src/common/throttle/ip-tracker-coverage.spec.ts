import 'reflect-metadata';
import type { Request } from 'express';
import { AffiliateController } from '../../modules/affiliate/affiliate.controller';
import { UserThrottlerGuard } from '../../modules/ai-advisor/ai-advisor.controller';

const a = { ip: '2001:db8:1:2:aaaa::1' } as unknown as Request;
const b = { ip: '2001:db8:1:2:bbbb::9' } as unknown as Request;
const other = { ip: '2001:db8:1:3::1' } as unknown as Request;

describe('khoá throttle theo IP gom IPv6 /64', () => {
  it('affiliate click: hai địa chỉ cùng /64 cùng khoá, khác /64 khác khoá', () => {
    const tracker = Reflect.getMetadata('THROTTLER:TRACKERdefault', AffiliateController.prototype.click) as (r: unknown) => string;
    expect(typeof tracker).toBe('function');
    expect(tracker(a)).toBe(tracker(b));
    expect(tracker(a)).not.toBe(tracker(other));
    expect(tracker({ ip: '::ffff:9.9.9.9' })).toBe('ip:9.9.9.9');
  });

  it('ai-advisor: không có user thì rơi về khoá /64', async () => {
    const guard = Object.create(UserThrottlerGuard.prototype) as { getTracker(r: unknown): Promise<string> };
    expect(await guard.getTracker(a)).toBe(await guard.getTracker(b));
    expect(await guard.getTracker(a)).not.toBe(await guard.getTracker(other));
    expect(await guard.getTracker({ user: { sub: 'u1' }, ip: '1.1.1.1' })).toBe('u1');
  });
});
