import type { PrismaClient } from '@prisma/client';
import { assertPoints1dApplied, formatResults, parseArgs, seedReference, WITH_BUSINESS_DEFAULTS_FLAG } from '../../../prisma/seed-reference';

describe('seed-reference: dòng lệnh', () => {
  it('không cờ thì không nạp giá trị kinh doanh', () => {
    expect(parseArgs([])).toEqual({ withBusinessDefaults: false });
  });

  it('có cờ (kể cả sau dấu -- mà pnpm/npm chuyển tiếp) thì nạp', () => {
    expect(parseArgs([WITH_BUSINESS_DEFAULTS_FLAG])).toEqual({ withBusinessDefaults: true });
    expect(parseArgs(['--', WITH_BUSINESS_DEFAULTS_FLAG])).toEqual({ withBusinessDefaults: true });
  });

  it('cờ gõ sai là lỗi, không lặng lẽ chạy không cờ', () => {
    expect(() => parseArgs(['--with-business-default'])).toThrow(/không hợp lệ/);
    expect(() => parseArgs([WITH_BUSINESS_DEFAULTS_FLAG, '--force'])).toThrow(/--force/);
  });

  it('báo một dòng các nhóm chưa nạp kèm cách nạp, không in từng nhóm như "đủ sẵn"', () => {
    const lines = formatResults([
      { group: 'system_configs', total: 118, created: 3 },
      { group: 'membership_tiers', total: 4, created: 0, skipped: true },
      { group: 'missions', total: 4, created: 0, skipped: true },
    ]);
    expect(lines).toEqual([
      '[seed-reference] system_configs: +3 mới, 115 đã có',
      `[seed-reference] chưa nạp: membership_tiers, missions (thiếu ${WITH_BUSINESS_DEFAULTS_FLAG}; A8 yêu cầu chạy có cờ ở lần deploy đầu). Chạy lại với ${WITH_BUSINESS_DEFAULTS_FLAG}.`,
    ]);
  });

  describe('chỉ chạy sau migration points_1d (seed gieo loyalty.vnd_per_point_redeem = 1 làm migration bỏ qua phép nhân)', () => {
    const prismaWith = (n: number | null) =>
      ({ $queryRaw: jest.fn().mockResolvedValue(n === null ? [] : [{ n }]), systemConfig: { createMany: jest.fn() } }) as unknown as PrismaClient;

    it.each([[0], [null]])('migration chưa hoàn tất (%s dòng) → từ chối, nói rõ phải migrate deploy trước', async (n) => {
      const prisma = prismaWith(n);
      await expect(assertPoints1dApplied(prisma)).rejects.toThrow(/20261018210000_points_1d.*migrate deploy/s);
      await expect(seedReference(prisma)).rejects.toThrow(/migrate deploy/);
      expect((prisma as unknown as { systemConfig: { createMany: jest.Mock } }).systemConfig.createMany).not.toHaveBeenCalled();
    });

    it('migration đã hoàn tất → cho qua', async () => {
      await expect(assertPoints1dApplied(prismaWith(1))).resolves.toBeUndefined();
    });
  });
});
