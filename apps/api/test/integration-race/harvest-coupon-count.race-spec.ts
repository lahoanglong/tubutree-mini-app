import { Prisma, PrismaClient } from '@prisma/client';
import { countHarvestCoupons, harvestCouponCountSql } from '../../src/modules/game/harvest-coupon-count';
import { HARVEST_COUPON_CODE_PREFIXES } from '../../src/modules/game/game.constants';
import { createUser, randCode } from './helpers';

/**
 * Đếm trần mã thu hoạch bằng một câu SQL theo partial index `coupons_user_group_userId_idx`, thay cho hai lần
 * `coupon.count` với `scopeMeta.path` (quét cả bảng trong tx Serializable). Số đếm phải bằng cách cũ trên cùng dữ liệu.
 */
describe('countHarvestCoupons (real Postgres)', () => {
  let db: PrismaClient;
  const dayStart = new Date(Date.now() - 6 * 3_600_000);
  const monthStart = new Date(Date.now() - 20 * 86_400_000);
  const hours = (h: number) => new Date(Date.now() - h * 3_600_000);

  beforeAll(() => {
    db = new PrismaClient();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  /** Cách đếm cũ trong game.service.ts / game-garden.service.ts, giữ nguyên để so sánh. */
  async function oldCount(userId: string) {
    const where = {
      OR: HARVEST_COUPON_CODE_PREFIXES.map((prefix) => ({ code: { startsWith: prefix } })),
      scopeMeta: { path: ['userId'], equals: userId },
    };
    return {
      day: await db.coupon.count({ where: { ...where, startAt: { gte: dayStart } } }),
      month: await db.coupon.count({ where: { ...where, startAt: { gte: monthStart } } }),
    };
  }

  const coupon = (userId: string, code: string, startAt: Date, over: Record<string, unknown> = {}) =>
    db.coupon.create({
      data: {
        code: `${code}-${randCode(6)}`,
        type: 'AMOUNT',
        value: 30000,
        minOrder: 199000,
        startAt,
        endAt: new Date(Date.now() + 30 * 86_400_000),
        scope: 'USER_GROUP',
        scopeMeta: { userId },
        ...over,
      },
    });

  it('bằng cách đếm cũ trên cùng dữ liệu: HARVEST/GARDEN của đúng khách; không đếm GAME, mã khách khác, mã trước đầu tháng', async () => {
    const user = await createUser(db as never);
    const other = await createUser(db as never);
    await coupon(user.id, 'HARVEST30000', hours(1)); // trong ngày
    await coupon(user.id, 'GARDEN30000', hours(2)); // trong ngày
    await coupon(user.id, 'HARVEST30000', hours(24 * 10)); // trong tháng, ngoài ngày
    await coupon(user.id, 'GARDEN30000', hours(24 * 15)); // trong tháng, ngoài ngày
    await coupon(user.id, 'HARVEST30000', hours(24 * 40)); // ngoài tháng
    await coupon(user.id, 'GAME30000', hours(1)); // vòng quay/nhiệm vụ: không thuộc trần
    await coupon(user.id, 'XHARVEST1', hours(1)); // tiền tố phải ở ĐẦU mã
    await coupon(other.id, 'HARVEST30000', hours(1)); // khách khác
    await coupon(user.id, 'HARVEST30000', hours(3), { scope: 'PUBLIC', scopeMeta: undefined }); // mã công khai trùng tiền tố

    const expected = await oldCount(user.id);
    expect(expected).toEqual({ day: 2, month: 4 });
    const got = await db.$transaction((tx) => countHarvestCoupons(tx, user.id, dayStart, monthStart));
    expect(got).toEqual(expected);
    expect(await db.$transaction((tx) => countHarvestCoupons(tx, other.id, dayStart, monthStart))).toEqual(await oldCount(other.id));
  });

  it('khách chưa có mã nào → 0 và 0 (count(*) luôn trả đúng một dòng)', async () => {
    const user = await createUser(db as never);
    await expect(db.$transaction((tx) => countHarvestCoupons(tx, user.id, dayStart, monthStart))).resolves.toEqual({ day: 0, month: 0 });
  });

  it('EXPLAIN: câu đếm đi bằng coupons_user_group_userId_idx, không Seq Scan trên coupons', async () => {
    class Rollback extends Error {
      constructor(readonly plan: string) {
        super('rollback');
      }
    }
    // Bảng nhỏ nên planner thích quét tuần tự: tắt seqscan trong một transaction rồi ROLLBACK để chứng minh câu thật "đi được" index.
    const plan = await db
      .$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
        const rows = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${harvestCouponCountSql('u-explain', dayStart, monthStart)}`);
        throw new Rollback(rows.map((r) => r['QUERY PLAN']).join('\n'));
      })
      .then(
        () => '',
        (err: unknown) => {
          if (err instanceof Rollback) return err.plan;
          throw err;
        },
      );
    expect(plan).toContain('coupons_user_group_userId_idx');
    expect(plan).not.toMatch(/Seq Scan on coupons/);
  });
});
