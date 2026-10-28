import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { LoyaltyController } from './loyalty.controller';
import type { LoyaltyService } from './loyalty.service';
import { PosCreditDto, PosCreditListQuery, ScanMemberDto } from './dto/loyalty-staff.dto';

async function errorKeys<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  const errs = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('LoyaltyController — route nhân viên (POS)', () => {
  it.each(['scanMember', 'posCredit'] as const)('%s gắn @Roles(STAFF, ADMIN) — khách thường bị RolesGuard chặn', (m) => {
    const roles = Reflect.getMetadata(ROLES_KEY, LoyaltyController.prototype[m]);
    expect(roles).toEqual(expect.arrayContaining(['STAFF', 'ADMIN']));
    expect(roles).not.toContain('CUSTOMER');
  });

  it('sổ audit tích điểm tại quầy chỉ ADMIN xem được (nhân viên không tự soát sổ của mình)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, LoyaltyController.prototype.posCredits)).toEqual(['ADMIN']);
  });

  it('GET me/loyalty/rewards/mine là route khách, không giới hạn role', () => {
    const h = LoyaltyController.prototype.myRedemptions;
    expect(Reflect.getMetadata(PATH_METADATA, h)).toBe('me/loyalty/rewards/mine');
    expect(Reflect.getMetadata(METHOD_METADATA, h)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(ROLES_KEY, h)).toBeUndefined();
  });

  it('route khách (trạng thái điểm danh/đổi quà) KHÔNG giới hạn role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, LoyaltyController.prototype.checkInStatus)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, LoyaltyController.prototype.redeemReward)).toBeUndefined();
  });
});

describe('LoyaltyController — điểm danh', () => {
  it('không còn POST /me/loyalty/check-in: điểm danh thật đi qua /me/daily-check-in để chuỗi chung được cập nhật', () => {
    expect((LoyaltyController.prototype as unknown as Record<string, unknown>).checkIn).toBeUndefined();
  });
});

describe('LoyaltyController.preview — xem trước cho khách chưa đăng nhập', () => {
  it('GET loyalty/preview là route công khai, không đọc userId, có throttle', () => {
    const h = LoyaltyController.prototype.preview;
    expect(Reflect.getMetadata(PATH_METADATA, h)).toBe('loyalty/preview');
    expect(Reflect.getMetadata(METHOD_METADATA, h)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, h)).toBe(true);
    expect(Reflect.getMetadata(ROLES_KEY, h)).toBeUndefined();
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', h)).toBe(60);
    expect(Reflect.getMetadata('public-cache-policy', h)).toBe('CATALOG');
    expect(h.length).toBe(0);
  });

  it('các route /me/loyalty/* còn lại KHÔNG công khai', () => {
    for (const m of ['overview', 'rewards', 'myRedemptions', 'redeemReward', 'checkInStatus'] as const) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, LoyaltyController.prototype[m])).toBeUndefined();
    }
  });
});

describe('LoyaltyController.redeemReward — Idempotency-Key', () => {
  it('khoá thiếu hoặc quá ngắn → 400, không gọi service', () => {
    const loyalty = { redeemReward: jest.fn() };
    const ctrl = new LoyaltyController(loyalty as unknown as LoyaltyService);
    expect(() => ctrl.redeemReward('u1', 'reward-freeship', 'ab')).toThrow(BadRequestException);
    expect(() => ctrl.redeemReward('u1', 'reward-freeship', undefined)).toThrow(BadRequestException);
    expect(loyalty.redeemReward).not.toHaveBeenCalled();
  });

  it('khoá hợp lệ → chuyển cho service cùng userId và rewardId', () => {
    const loyalty = { redeemReward: jest.fn().mockReturnValue('ok') };
    const ctrl = new LoyaltyController(loyalty as unknown as LoyaltyService);
    expect(ctrl.redeemReward('u1', 'reward-freeship', 'key-00000001')).toBe('ok');
    expect(loyalty.redeemReward).toHaveBeenCalledWith('u1', 'reward-freeship', 'key-00000001');
  });
});

describe('ScanMemberDto', () => {
  it('mã hợp lệ → không lỗi', async () => {
    expect(await errorKeys(ScanMemberDto, { memberCode: 'TUBUAB12CD34' })).toHaveLength(0);
  });

  it.each(['', 'AB', 'x'.repeat(41)])('memberCode "%s" rỗng/quá ngắn/quá dài → lỗi', async (memberCode) => {
    expect((await errorKeys(ScanMemberDto, { memberCode })).length).toBeGreaterThan(0);
  });

  it('không nhận orderTotal ở route tra cứu (tách tra cứu khỏi cộng điểm)', async () => {
    expect(await errorKeys(ScanMemberDto, { memberCode: 'TUBUAB12CD34', orderTotal: 100000 })).toContain(
      'whitelistValidation',
    );
  });
});

describe('PosCreditDto', () => {
  const VALID = { memberCode: 'TUBUAB12CD34', orderTotal: 250000, receiptId: 'HD-2026-0001' };

  it('hợp lệ → không lỗi', async () => {
    expect(await errorKeys(PosCreditDto, VALID)).toHaveLength(0);
  });

  it('thiếu receiptId (khoá idempotency) → lỗi', async () => {
    const { receiptId: _omit, ...rest } = VALID;
    expect((await errorKeys(PosCreditDto, rest)).length).toBeGreaterThan(0);
  });

  it('receiptId ký tự lạ → lỗi', async () => {
    expect((await errorKeys(PosCreditDto, { ...VALID, receiptId: 'HD 1; DROP' })).length).toBeGreaterThan(0);
  });

  it('orderTotal khổng lồ (tràn Int4 / farm điểm) → lỗi max', async () => {
    expect(await errorKeys(PosCreditDto, { ...VALID, orderTotal: 1_000_000_000_000 })).toContain('max');
  });

  it('orderTotal không phải số nguyên → lỗi', async () => {
    expect(await errorKeys(PosCreditDto, { ...VALID, orderTotal: 1000.5 })).toContain('isInt');
  });

  it('note quá dài → lỗi', async () => {
    expect(await errorKeys(PosCreditDto, { ...VALID, note: 'x'.repeat(201) })).toContain('maxLength');
  });
});

describe('PosCreditListQuery', () => {
  it('lọc theo ngày VN + nhân viên hợp lệ → không lỗi', async () => {
    expect(await errorKeys(PosCreditListQuery, { day: '2026-09-27', staffUserId: 'cku1staff' })).toHaveLength(0);
    expect(await errorKeys(PosCreditListQuery, {})).toHaveLength(0);
  });

  it.each(['27/09/2026', '2026-9-27', "2026-09-27' OR 1=1"])('day "%s" sai định dạng → lỗi', async (day) => {
    expect((await errorKeys(PosCreditListQuery, { day })).length).toBeGreaterThan(0);
  });
});
