import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PUBLIC_CACHE_POLICY_KEY } from '../../common/decorators/public-cache.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ClaimCouponDto, CouponsController } from './coupons.controller';
import type { CouponClaimService } from './coupon-claim.service';
import type { CouponCollectService } from './coupon-collect.service';

async function errorKeys(plain: Record<string, unknown>): Promise<string[]> {
  const errs = await validate(plainToInstance(ClaimCouponDto, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('CouponsController — POST /coupons/claim', () => {
  it('khách nào đã đăng nhập cũng gọi được (không giới hạn role), có throttle riêng chặn dò mã', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CouponsController.prototype.claim)).toBeUndefined();
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', CouponsController.prototype.claim);
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', CouponsController.prototype.claim);
    expect(limit).toBe(10);
    expect(ttl).toBe(60_000);
  });

  it('chuyển đúng userId và mã cho service', async () => {
    const claim = jest.fn().mockResolvedValue({ code: 'X' });
    const ctrl = new CouponsController({ claim } as unknown as CouponClaimService, {} as CouponCollectService);
    await ctrl.claim('u1', { code: 'abc' });
    expect(claim).toHaveBeenCalledWith('u1', 'abc');
  });

  it.each([{}, { code: '' }, { code: '   ' }, { code: 'x'.repeat(65) }, { code: 123 }])('mã không hợp lệ %j → lỗi', async (plain) => {
    expect((await errorKeys(plain)).length).toBeGreaterThan(0);
  });

  it('mã hợp lệ (chữ thường, khoảng trắng đầu cuối) → không lỗi; trường lạ bị chặn', async () => {
    expect(await errorKeys({ code: ' shopee-ab12 ' })).toHaveLength(0);
    expect(await errorKeys({ code: 'ABC', userId: 'u2' })).toContain('whitelistValidation');
  });
});

describe('CouponsController — GET /coupons/collectable', () => {
  const handler = CouponsController.prototype.collectable;

  it('công khai (khách chưa đăng nhập xem được), cache CATALOG, có throttle', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, handler)).toBe('CATALOG');
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(60);
  });

  it('trả đúng danh sách của service', async () => {
    const collectable = jest.fn().mockResolvedValue([{ code: 'X' }]);
    const ctrl = new CouponsController({} as CouponClaimService, { collectable } as unknown as CouponCollectService);
    expect(await ctrl.collectable()).toEqual([{ code: 'X' }]);
  });
});

describe('CouponsController — GET /coupons/collectable/mine', () => {
  const handler = CouponsController.prototype.collectableMine;

  it('cần đăng nhập (không @Public), không cache chung, có throttle', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata('__httpCode__', handler)).toBeUndefined();
    expect(Reflect.getMetadata('__headers__', handler)).toEqual([{ name: 'Cache-Control', value: 'private, no-store' }]);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(60);
  });

  it('chuyển đúng userId cho service', async () => {
    const mine = jest.fn().mockResolvedValue({ claimed: ['X'], newCustomerOnly: [] });
    const ctrl = new CouponsController({} as CouponClaimService, { mine } as unknown as CouponCollectService);
    expect(await ctrl.collectableMine('u1')).toEqual({ claimed: ['X'], newCustomerOnly: [] });
    expect(mine).toHaveBeenCalledWith('u1');
  });
});
