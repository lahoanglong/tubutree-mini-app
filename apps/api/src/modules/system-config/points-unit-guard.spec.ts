import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DEAD_CONFIG_KEYS, isDeadConfigKey } from './dead-config-keys';
import { SystemConfigService } from './system-config.service';
import { CTV_MONTHLY_MILESTONES } from '../affiliate/ctv-milestones';
import { QUESTS } from '../storefront/storefront-quest.service';
import { CreateEventDto } from '../feed/community-feed.controller';
import { POINTS_GRANT_HARD_MAX, RewardPointsService } from '../wallet/reward-points.service';
import { SeasonPassService } from '../game/season-pass.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * PD-3 T16 — CHẶN LỖI ĐƠN VỊ xu ↔ Điểm Xanh (R1). Từ points-1d 1 Điểm Xanh = 1đ (trước đó 1.000đ), 1 xu = 1đ: số điểm
 * cũ ghi vào khoá mới là chia 1.000 lần, số điểm mới ghi vào chỗ còn đọc đơn vị cũ là nhân 1.000 lần, nên mỗi khoá có max riêng.
 */

const SRC_ROOT = join(__dirname, '../..');
const SEED_PATH = join(__dirname, '../../../prisma/seed.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Mã chạy thật (bỏ spec, bỏ dead-config-keys.ts, bỏ comment). */
function runtimeSource(): string {
  return walk(SRC_ROOT)
    .filter((p) => !p.endsWith('/modules/system-config/dead-config-keys.ts'))
    .map((p) => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
    .join('\n');
}
const isReferenced = (source: string, key: string) => ['\'', '"', '`'].some((q) => source.includes(`${q}${key}${q}`));

/** Đọc mảng SYSTEM_CONFIGS trong prisma/seed.ts (import seed.ts sẽ chạy main() → cần DB). */
function seededConfigs(): { key: string; value: unknown; createOnly?: boolean }[] {
  const src = readFileSync(SEED_PATH, 'utf-8');
  const start = src.indexOf('const SYSTEM_CONFIGS: ConfigSeed[] = [');
  const open = src.indexOf('[', src.indexOf('=', start));
  const end = src.indexOf('\n];', open);
  const factory = new Function('Prisma', `return ${src.slice(open, end + 2)};`) as (p: unknown) => unknown;
  return factory({ Decimal: Number, JsonNull: null }) as { key: string; value: unknown; createOnly?: boolean }[];
}

/** Khoá xu cũ (spec mục 4 "CẢNH BÁO RỦI RO ĐƠN VỊ" 1). */
const LEGACY_XU_KEYS = [
  'coins.referrer_reward',
  'coins.referral_milestones',
  'community.post_reward',
  'community.answer_reward',
  'community.best_answer_reward',
  'game.tree_xu_price',
  'game.plot_unlock_xu_base',
  'game.xu_per_seed',
  'wallet.xu_convert_multiplier',
];

/** Khoá tính bằng Điểm Xanh mà admin sửa được (spec mục 4 điểm 3). */
const POINTS_NUMBER_KEYS: Record<string, { max: number }> = {
  'referral.referrer_reward_points': { max: 100_000 },
  'community.post_reward_points': { max: 20_000 },
  'community.answer_reward_points': { max: 20_000 },
  'community.best_answer_reward_points': { max: 20_000 },
  'game.tree_points_price': { max: 500_000 },
  'game.first_harvest_points': { max: 10_000 },
  'waste.mailin_min_points': { max: 1_000_000 },
  'waste.pickup_min_points': { max: 1_000_000 },
  'waste.customer_monthly_cap_points': { max: 2_000_000 },
  'waste.staff_daily_cap_points': { max: 20_000_000 },
};

/** Khoá điểm không nằm trong nhóm thưởng nhưng cũng có biên (giá một lượt quay). */
const SPIN_COST_BOUND: Record<string, { max: number }> = { 'game.spin_buy_cost_points': { max: 1_000_000 } };

function configService() {
  const findUnique = jest.fn().mockResolvedValue(null);
  const upsert = jest.fn().mockResolvedValue({});
  const base: Record<string, unknown> = {
    systemConfig: { findUnique, upsert },
    systemConfigHistory: { create: jest.fn() },
  };
  base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));
  return { svc: new SystemConfigService(base as unknown as PrismaService), upsert };
}

describe('PD-3 T16 (a): không còn mã nào đọc khoá xu cũ', () => {
  const source = runtimeSource();

  // L3: góp quỹ trồng cây đọc game.tree_points_price, mở lô bằng xu và đổi Ví → xu trả 410.
  it('mọi khoá xu cũ không còn được đọc ngoài dead-config-keys.ts, và đều nằm trong DEAD_CONFIG_KEYS', () => {
    expect(LEGACY_XU_KEYS.filter((k) => isReferenced(source, k))).toEqual([]);
    expect(LEGACY_XU_KEYS.filter((k) => !isDeadConfigKey(k))).toEqual([]);
  });

  it('seed không gieo khoá xu cũ đã chuyển', () => {
    const seeded = seededConfigs().map((r) => r.key);
    expect(seeded.filter((k) => Object.prototype.hasOwnProperty.call(DEAD_CONFIG_KEYS, k))).toEqual([]);
    for (const k of ['coins.referrer_reward', 'coins.referral_milestones']) expect(seeded).not.toContain(k);
  });
});

describe('PD-3 T16 (b) + (f): khoá *_points có biên giá trị; seed nằm trong biên', () => {
  it.each(Object.entries(POINTS_NUMBER_KEYS))('%s: nhận đúng max, từ chối max+1 và giá trị xu (×1.000)', async (key, { max }) => {
    const { svc } = configService();
    await expect(svc.set(key, max, 'admin')).resolves.toBeUndefined();
    await expect(svc.set(key, max + 1, 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set(key, Math.max(max, 1) * 1000, 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set(key, -1, 'admin')).rejects.toThrow(BadRequestException);
  });

  // Review B1 (minor): 2.5 nằm trong biên nhưng RewardPointsService.grant / cột INTEGER không nhận số lẻ, nên thưởng
  // âm thầm không bao giờ được cấp (500 bị nuốt ở thưởng giới thiệu, quỹ cây báo "chưa khả dụng").
  it.each([...Object.keys(POINTS_NUMBER_KEYS), 'game.spin_buy_cost_points'])(
    '%s: số lẻ bị từ chối lúc ghi (Điểm Xanh là số nguyên), số nguyên cùng khoảng vẫn nhận',
    async (key) => {
      const { svc, upsert } = configService();
      await expect(svc.set(key, 2.5, 'admin')).rejects.toThrow(BadRequestException);
      await expect(svc.set(key, 2.5, 'admin')).rejects.toThrow(/số nguyên/);
      expect(upsert).not.toHaveBeenCalled();
      await expect(svc.set(key, 2, 'admin')).resolves.toBeUndefined();
    },
  );

  it("(f) set('referral.referrer_reward_points', 5_000_000) → 400, không ghi (giá trị gấp 1.000 lần)", async () => {
    const { svc, upsert } = configService();
    await expect(svc.set('referral.referrer_reward_points', 5_000_000, 'admin')).rejects.toThrow(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('mọi khoá số đuôi _points được seed đều có biên và giá trị seed nằm trong biên', async () => {
    const rows = seededConfigs().filter((r) => /_points$/.test(r.key) && typeof r.value === 'number');
    expect(rows.map((r) => r.key)).toEqual(
      expect.arrayContaining([
        'referral.referrer_reward_points',
        'community.post_reward_points',
        'community.answer_reward_points',
        'community.best_answer_reward_points',
      ]),
    );
    for (const r of rows) {
      const { svc } = configService();
      await expect(svc.set(r.key, r.value as number, 'admin')).resolves.toBeUndefined();
      const max = (POINTS_NUMBER_KEYS[r.key] ?? SPIN_COST_BOUND[r.key])?.max;
      expect({ key: r.key, hasBound: max !== undefined }).toEqual({ key: r.key, hasBound: true });
      await expect(svc.set(r.key, max! + 1, 'admin')).rejects.toThrow(BadRequestException);
    }
  });

  it('khoá điểm mới seed createOnly (không đè giá trị migration chép từ DB hoặc admin đã sửa)', () => {
    const rows = seededConfigs();
    for (const key of [...Object.keys(POINTS_NUMBER_KEYS), 'referral.milestones_points'].filter((k) => k !== 'game.tree_points_price')) {
      expect({ key, createOnly: rows.find((r) => r.key === key)?.createOnly }).toEqual({ key, createOnly: true });
    }
  });

  it('OQ-11: loyalty.vnd_per_point_redeem khoá cứng 1 (đổi tỉ giá làm lô quy đổi mất/tăng giá trị)', async () => {
    const { svc } = configService();
    await expect(svc.set('loyalty.vnd_per_point_redeem', 1, 'admin')).resolves.toBeUndefined();
    await expect(svc.set('loyalty.vnd_per_point_redeem', 1000, 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set('loyalty.vnd_per_point_redeem', 2, 'admin')).rejects.toThrow(BadRequestException);
  });

  it('referral.milestones_points: từ chối dạng xu cũ {bonus} và bonusPoints quá lớn; nhận dạng đúng', async () => {
    const { svc } = configService();
    await expect(svc.set('referral.milestones_points', [{ count: 3, bonus: 20000 }], 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set('referral.milestones_points', [{ count: 3, bonusPoints: 500_001 }], 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set('referral.milestones_points', [{ count: 0, bonusPoints: 20_000 }], 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set('referral.milestones_points', [{ count: 3, bonusPoints: 20_000 }, { count: 5, bonusPoints: 40_000 }], 'admin')).resolves.toBeUndefined();
  });

  it('seasonpass.tiers: từ chối type XU và POINTS quá lớn; nhận SEEDS/POINTS hợp lệ', async () => {
    const { svc } = configService();
    const tier = (premium: unknown) => [{ xp: 30, free: { type: 'SEEDS', amount: 20 }, premium }];
    await expect(svc.set('seasonpass.tiers', tier({ type: 'XU', amount: 5000 }), 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set('seasonpass.tiers', tier({ type: 'POINTS', amount: 100_001 }), 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set('seasonpass.tiers', tier({ type: 'POINTS', amount: 100_001 }), 'admin')).rejects.toThrow(/tối đa 100\.000 Điểm Xanh/);
    await expect(svc.set('seasonpass.tiers', tier({ type: 'POINTS', amount: 5_000 }), 'admin')).resolves.toBeUndefined();
  });

  it('seed Season Pass không còn phần XU', () => {
    const tiers = seededConfigs().find((r) => r.key === 'seasonpass.tiers')!.value as { free: { type: string }; premium: { type: string } }[];
    expect(tiers.flatMap((t) => [t.free.type, t.premium.type]).filter((t) => t === 'XU')).toEqual([]);
  });
});

/**
 * PF-3 mục 3: loyalty.point_expire_months quyết định hạn của MỌI điểm thưởng mới. Không có biên thì admin đặt được 0
 * (điểm hết hạn ngay lúc cộng), số âm (hạn trong quá khứ) hay số khổng lồ (hạn không bao giờ tới); trước biên này mọi
 * nguồn cộng điểm phải tự rơi về 12 tháng khi gặp giá trị hỏng (points-expiry-date.ts).
 */
describe('PF-3: loyalty.point_expire_months có biên 1–120 tháng, số nguyên', () => {
  const KEY = 'loyalty.point_expire_months';

  it.each([1, 6, 12, 24, 120])('nhận %i tháng', async (months) => {
    const { svc, upsert } = configService();
    await expect(svc.set(KEY, months, 'admin')).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, -12, 121, 1000, 12_000])('từ chối %i tháng (ngoài 1–120), không ghi', async (months) => {
    const { svc, upsert } = configService();
    await expect(svc.set(KEY, months, 'admin')).rejects.toThrow(BadRequestException);
    await expect(svc.set(KEY, months, 'admin')).rejects.toThrow(/1–120/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([0.5, 1.5, 12.9])('từ chối số lẻ %p (hạn tính theo tháng nguyên)', async (months) => {
    const { svc, upsert } = configService();
    await expect(svc.set(KEY, months, 'admin')).rejects.toThrow(/số nguyên/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '12', true, [12]])('từ chối giá trị không phải số: %p', async (bad) => {
    const { svc, upsert } = configService();
    await expect(svc.set(KEY, bad as never, 'admin')).rejects.toThrow(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('thông báo lỗi tiếng Việt nêu tên khoá, khoảng hợp lệ, đơn vị tháng và giá trị vừa nhập', async () => {
    const { svc } = configService();
    await expect(svc.set(KEY, 0, 'admin')).rejects.toThrow(/loyalty\.point_expire_months.*1–120.*tháng.*0/);
  });

  it('giá trị seed nằm trong biên (seed không tự vi phạm biên mình đặt)', async () => {
    const seeded = seededConfigs().find((r) => r.key === KEY);
    expect(seeded).toBeDefined();
    expect(Number.isInteger(seeded!.value)).toBe(true);
    const { svc } = configService();
    await expect(svc.set(KEY, seeded!.value as number, 'admin')).resolves.toBeUndefined();
  });

  it('không migration nào gieo giá trị cho khoá này (chỉ seed.ts)', () => {
    const migrations = join(__dirname, '../../../prisma/migrations');
    const offenders = readdirSync(migrations)
      .map((dir) => join(migrations, dir, 'migration.sql'))
      .filter((file) => {
        try {
          return readFileSync(file, 'utf-8').includes(KEY);
        } catch {
          return false;
        }
      });
    expect(offenders).toEqual([]);
  });
});

describe('PD-3 T16 (c) (d) (e): chặn lúc chạy', () => {
  function rewardsWith(config: Record<string, unknown> = {}) {
    const createManyAndReturn = jest.fn().mockResolvedValue([{ id: 'p' }]);
    const prisma = {
      pointsTransaction: {
        createManyAndReturn,
        aggregate: jest.fn().mockResolvedValue({ _sum: { delta: null } }),
        count: jest.fn().mockResolvedValue(0),
      },
      coinTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { delta: null } }),
        count: jest.fn().mockResolvedValue(0),
      },
      user: { update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue({ referralCode: 'R' }) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prisma));
    const cfg = { get: jest.fn(async (k: string, fb?: unknown) => (k in config ? config[k] : fb)) };
    return { rewards: new RewardPointsService(prisma as never, cfg as never), createManyAndReturn, prisma };
  }

  it('(c) RewardPointsService.grant(…, 20.000.000) ném lỗi 500, không ghi', async () => {
    const { rewards, createManyAndReturn } = rewardsWith();
    await expect(rewards.grant('u1', 20_000_000, 'REFERRAL_ORDER2:x', 'REFERRAL', 'o1:o2')).rejects.toThrow(InternalServerErrorException);
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(POINTS_GRANT_HARD_MAX).toBe(2_000_000);
  });

  it('(d) referral.milestones_points dạng cũ {bonus: 20000} → mốc bị bỏ qua (không cấp, không hiển thị)', async () => {
    const { rewards } = rewardsWith({ 'referral.milestones_points': [{ count: 3, bonus: 20000 }] });
    expect((await rewards.getReferralOverview('u1')).milestones).toEqual([]);
  });

  it('(e) seasonpass.tiers type XU → claim từ chối, không cấp, không đánh dấu đã nhận', async () => {
    const grant = jest.fn();
    const prisma = {
      season: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      userSeasonPass: { findUnique: jest.fn().mockResolvedValue({ xp: 100, claimedFree: [], claimedPremium: [] }), updateMany: jest.fn() },
      subscription: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(),
    };
    const cfg = { get: jest.fn(async () => [{ xp: 1, free: { type: 'SEEDS', amount: 1 }, premium: { type: 'XU', amount: 5000 } }]) };
    const svc = new SeasonPassService(prisma as never, cfg as never, { grant } as never);
    await expect(svc.claim('u1', 0, 'premium')).rejects.toThrow(BadRequestException);
    expect(grant).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sự kiện cộng đồng: DTO nhận rewardPoints ≤ 1.000.000, từ chối 1.000.001 và từ chối trường rewardXu cũ', async () => {
    const base = { title: 'Thi', startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-10T00:00:00Z' };
    const errs = async (extra: Record<string, unknown>) =>
      (await validate(plainToInstance(CreateEventDto, { ...base, ...extra }), { whitelist: true, forbidNonWhitelisted: true })).map(
        (e) => e.property,
      );
    expect(await errs({ rewardPoints: 1_000_000 })).toEqual([]);
    expect(await errs({ rewardPoints: 1_000_001 })).toEqual(['rewardPoints']);
    expect(await errs({ rewardXu: 500000 })).toEqual(['rewardXu']);
  });
});

describe('PD-3 T16 (g): bảng thưởng cứng trong mã đúng spec mục 4', () => {
  it('mốc doanh số CTV 50.000 / 200.000 / 600.000 / 2.000.000 điểm, tổng 2.850.000, mốc lớn nhất = trần một lần cấp', () => {
    expect(CTV_MONTHLY_MILESTONES.map((m) => m.rewardPoints)).toEqual([50_000, 200_000, 600_000, 2_000_000]);
    expect(CTV_MONTHLY_MILESTONES.reduce((s, m) => s + m.rewardPoints, 0)).toBe(2_850_000);
    expect(Math.max(...CTV_MONTHLY_MILESTONES.map((m) => m.rewardPoints))).toBe(POINTS_GRANT_HARD_MAX);
    for (const m of CTV_MONTHLY_MILESTONES) expect(m).not.toHaveProperty('rewardXu');
  });

  it('nhiệm vụ gian hàng 2.000 / 2.000 / 2.000 / 1.000 / 5.000 điểm, tổng 12.000 (OQ-7)', () => {
    expect(QUESTS.map((q) => q.rewardPoints)).toEqual([2_000, 2_000, 2_000, 1_000, 5_000]);
    expect(QUESTS.reduce((s, q) => s + q.rewardPoints, 0)).toBe(12_000);
    for (const q of QUESTS) expect(q).not.toHaveProperty('rewardXu');
  });
});
