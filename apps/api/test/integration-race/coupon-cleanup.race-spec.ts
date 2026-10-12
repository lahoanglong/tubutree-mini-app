import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { CouponCleanupCron } from '../../src/modules/coupons/coupon-cleanup.cron';
import { createUser, randCode, warmPool } from './helpers';

/**
 * Job dọn coupon cá nhân hết hạn (C-012): chỉ xoá coupon USER_GROUP có scopeMeta.userId, đã quá hạn
 * giữ lại, chưa dùng và chưa có redemption; xoá theo lô có giới hạn; khoá chống chạy chồng.
 */
describe('CouponCleanupCron (real Postgres)', () => {
  let prisma: PrismaService;
  const tag = randCode(6);
  const DAY = 864e5;
  const NOW = new Date();
  let retention: unknown;
  const cfg = { get: async (_k: string, fallback: unknown) => (retention === undefined ? fallback : retention) };
  let cron: CouponCleanupCron;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    cron = new CouponCleanupCron(prisma, cfg as unknown as SystemConfigService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    retention = undefined;
  });

  const mk = (suffix: string, endedDaysAgo: number, data: Partial<Prisma.CouponUncheckedCreateInput> = {}) =>
    prisma.coupon.create({
      data: {
        code: `C${tag}-${suffix}`,
        type: 'AMOUNT',
        value: 10000,
        startAt: new Date(NOW.getTime() - (endedDaysAgo + 30) * DAY),
        endAt: new Date(NOW.getTime() - endedDaysAgo * DAY),
        perUserLimit: 1,
        usageLimit: 1,
        scope: 'USER_GROUP',
        scopeMeta: { userId: 'u-' + suffix },
        ...data,
      },
    });
  const exists = async (suffix: string) =>
    (await prisma.coupon.count({ where: { code: `C${tag}-${suffix}` } })) === 1;

  it('xoá coupon cá nhân hết hạn quá ngưỡng; giữ coupon đã dùng / có redemption / còn trong ngưỡng / không phải cá nhân', async () => {
    const user = await createUser(prisma);
    await mk('old', 100);
    await mk('usedcount', 100, { usedCount: 1 });
    const withRedemption = await mk('redeemed', 100);
    await prisma.couponRedemption.create({ data: { couponId: withRedemption.id, userId: user.id } });
    await mk('recent', 30);
    await mk('public', 100, { scope: 'PUBLIC', scopeMeta: undefined });
    await mk('nometa', 100, { scopeMeta: { reason: 'x' } });
    await mk('nullmeta', 100, { scopeMeta: undefined });

    const res = await cron.purgeExpiredPersonal(NOW);
    expect(res).toMatchObject({ deleted: expect.any(Number) });

    expect(await exists('old')).toBe(false);
    expect(await exists('usedcount')).toBe(true);
    expect(await exists('redeemed')).toBe(true);
    expect(await exists('recent')).toBe(true);
    expect(await exists('public')).toBe(true);
    expect(await exists('nometa')).toBe(true);
    expect(await exists('nullmeta')).toBe(true);
  });

  it('ngưỡng giữ cấu hình được (coupons.personal_expired_retention_days)', async () => {
    await mk('r120', 120);
    await mk('r50', 50);
    retention = 200;
    await cron.purgeExpiredPersonal(NOW);
    expect(await exists('r120')).toBe(true);
    retention = 40;
    await cron.purgeExpiredPersonal(NOW);
    expect(await exists('r120')).toBe(false);
    expect(await exists('r50')).toBe(false);
  });

  it('giá trị cấu hình rác/quá nhỏ rơi về mặc định hoặc sàn, không xoá coupon mới hết hạn', async () => {
    await mk('fresh', 5);
    await mk('d60', 60);
    retention = 'abc';
    await cron.purgeExpiredPersonal(NOW);
    expect(await exists('d60')).toBe(true); // mặc định 90 ngày
    retention = 0;
    await cron.purgeExpiredPersonal(NOW);
    expect(await exists('fresh')).toBe(true); // sàn 30 ngày
  });

  it('xoá theo lô có giới hạn: maxBatches chặn số lô mỗi lượt, lượt sau xoá tiếp', async () => {
    for (let i = 0; i < 25; i++) await mk(`b${i}`, 200);
    const count = () => prisma.coupon.count({ where: { code: { startsWith: `C${tag}-b` } } });
    const first = await cron.purgeExpiredPersonal(NOW, { batchSize: 10, maxBatches: 2 });
    expect(first).toEqual({ deleted: 20, batches: 2 });
    expect(await count()).toBe(5);
    const second = await cron.purgeExpiredPersonal(NOW, { batchSize: 10, maxBatches: 2 });
    expect(second).toEqual({ deleted: 5, batches: 1 });
    expect(await count()).toBe(0);
  });

  it('khoá chống chạy chồng: lượt thứ hai khi lượt đầu đang giữ khoá bị bỏ qua, không xoá gì', async () => {
    await mk('lock', 200);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let acquired!: () => void;
    const gotLock = new Promise<void>((r) => (acquired = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cron:coupons.cleanup_personal_expired'}))`;
        acquired();
        await held;
      },
      { timeout: 30_000 },
    );
    await gotLock;
    const res = await cron.purgeExpiredPersonal(NOW);
    expect(res).toEqual({ skipped: 'LOCKED' });
    expect(await exists('lock')).toBe(true);
    release();
    await holder;
    const after = await cron.purgeExpiredPersonal(NOW);
    expect(after).toMatchObject({ deleted: expect.any(Number) });
    expect(await exists('lock')).toBe(false);
  });
});
