import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DEALER_REWARD_THRESHOLD_MAX, DealerRewardDto, PromotionDto, UpdatePromotionDto, UpdateDealerRewardDto } from './brand.dto';

async function errorKeys<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  const errs = await validate(plainToInstance(cls, plain), { whitelist: true });
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('DealerRewardDto threshold (C-055): BigInt column, bounded number at the API', () => {
  const BASE = { type: 'TOUR', title: 'Tour Nhật Bản' };

  it('accepts a threshold above INT4 (3 billion)', async () => {
    expect(await errorKeys(DealerRewardDto, { ...BASE, threshold: 3_000_000_000 })).toEqual([]);
    expect(await errorKeys(UpdateDealerRewardDto, { threshold: 3_000_000_000 })).toEqual([]);
  });

  it('rejects a threshold above the cap with a validation error (400), not a DB error', async () => {
    expect(await errorKeys(DealerRewardDto, { ...BASE, threshold: DEALER_REWARD_THRESHOLD_MAX + 1 })).toContain('max');
    expect(await errorKeys(UpdateDealerRewardDto, { threshold: DEALER_REWARD_THRESHOLD_MAX + 1 })).toContain('max');
  });

  it('cap stays inside Number.MAX_SAFE_INTEGER so number <-> BigInt is lossless', () => {
    expect(DEALER_REWARD_THRESHOLD_MAX).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('PromotionDto themeColor (D15-01): chủ nhãn không được chèn CSS qua màu khuyến mãi', () => {
  const BASE = { title: 'Giảm 10%', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z' };
  const INJECTION = 'red;position:fixed;inset:0;z-index:9999;background:url(https://evil.example/x.png)';

  it.each(['#16a34a', '#FFF', '#abc', '#A1B2C3'])('nhận màu hex hợp lệ %s', async (themeColor) => {
    expect(await errorKeys(PromotionDto, { ...BASE, themeColor })).toEqual([]);
    expect(await errorKeys(UpdatePromotionDto, { themeColor })).toEqual([]);
  });

  it('không gửi themeColor vẫn hợp lệ (trường tuỳ chọn)', async () => {
    expect(await errorKeys(PromotionDto, BASE)).toEqual([]);
    expect(await errorKeys(UpdatePromotionDto, { title: 'Đổi tên' })).toEqual([]);
  });

  it.each([INJECTION, 'red', '#12', '#12345', '#1234567', '16a34a', 'rgb(0,0,0)', '#16a34a;color:red', '#16a34a\n', ''])(
    'từ chối giá trị %j',
    async (themeColor) => {
      expect(await errorKeys(PromotionDto, { ...BASE, themeColor })).toContain('matches');
      expect(await errorKeys(UpdatePromotionDto, { themeColor })).toContain('matches');
    },
  );
});
