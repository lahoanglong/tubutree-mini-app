import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ClaimCouponDto, CouponsController } from './coupons.controller';
import type { CouponClaimService } from './coupon-claim.service';

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
    const ctrl = new CouponsController({ claim } as unknown as CouponClaimService);
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
