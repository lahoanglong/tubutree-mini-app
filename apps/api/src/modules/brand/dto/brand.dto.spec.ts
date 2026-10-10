import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DEALER_REWARD_THRESHOLD_MAX, DealerRewardDto, UpdateDealerRewardDto } from './brand.dto';

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
