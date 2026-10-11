import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LoyaltyService, DEFAULT_REWARD_CATALOG } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { applyPointsDelta } from '../../src/modules/loyalty/points-ledger';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createUser, randCode, summarize, warmPool } from './helpers';

const DAY = 864e5;

/**
 * PD-3 Điểm Xanh hai lô trên Postgres thật (spec mục 2; T5, T7): mỗi lô một cột số dư, một sổ chung có
 * cột `lot`. Bất biến: pointsBalance == SUM(delta) lô STANDARD, pointsConvertedBalance == SUM(delta)
 * lô CONVERTED, kiểm sau mọi ca bằng findPointsLotDrift (cùng truy vấn với scripts/reconcile-points.ts).
 */
describe('PD-3 Điểm Xanh hai lô (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let expiry: LoyaltyExpiryService;
  const touched: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        LoyaltyExpiryService,
        { provide: NotificationsService, useValue: { notify: async () => undefined } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    loyalty = moduleRef.get(LoyaltyService);
    expiry = moduleRef.get(LoyaltyExpiryService);
    await warmPool(prisma);
  });

  afterEach(async () => {
    // T5: bất biến theo lô của mọi user ca vừa chạm.
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function newUser(data: Parameters<typeof createUser>[1] = {}) {
    const u = await createUser(prisma, data);
    touched.push(u.id);
    return u;
  }

  /** Dòng sổ dựng thẳng (có createdAt cố định) + số dư khớp sổ của đúng lô. */
  async function ledgerRow(
    userId: string,
    delta: number,
    lot: 'STANDARD' | 'CONVERTED',
    createdAt: Date,
    expiresAt: Date | null = null,
  ) {
    await prisma.pointsTransaction.create({
      data: { userId, delta, lot, reason: `IT_${lot}_${delta}`, refType: 'IT', createdAt, expiresAt },
    });
    await prisma.user.update({
      where: { id: userId },
      data: lot === 'CONVERTED' ? { pointsConvertedBalance: { increment: delta } } : { pointsBalance: { increment: delta } },
    });
  }

  it('T5: luồng điểm hiện có (điểm danh, đổi voucher) ghi lô STANDARD và không chạm lô quy đổi', async () => {
    const reward = DEFAULT_REWARD_CATALOG[0]!;
    const user = await newUser();
    await prisma.$transaction((tx) =>
      applyPointsDelta(tx, { userId: user.id, delta: reward.pointsCost * 3, lot: 'CONVERTED', reason: 'XU_TO_POINTS:IT', refType: 'IT' }),
    );

    await loyalty.dailyCheckIn(user.id);
    // Lô quy đổi đủ cho 3 voucher nhưng lô thường chỉ có điểm danh: đổi voucher phải bị từ chối.
    await expect(loyalty.redeemReward(user.id, reward.id)).rejects.toThrow(/Bạn cần/);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsConvertedBalance).toBe(reward.pointsCost * 3);
    const rows = await prisma.pointsTransaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.refType, r.lot])).toEqual([
      ['IT', 'CONVERTED'],
      ['CHECKIN', 'STANDARD'],
    ]);

    // Đủ điểm thường → đổi được, chỉ trừ pointsBalance.
    await prisma.$transaction((tx) =>
      applyPointsDelta(tx, { userId: user.id, delta: reward.pointsCost, lot: 'STANDARD', reason: 'IT_TOPUP', refType: 'IT' }),
    );
    await loyalty.redeemReward(user.id, reward.id);
    const after2 = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after2.pointsConvertedBalance).toBe(reward.pointsCost * 3);
    expect(after2.pointsBalance).toBe(after.pointsBalance);
  });

  it('T5: 10 lệnh trừ lô CONVERTED song song, đủ cho 2 → đúng 2 thành công, không âm, lô thường không đổi', async () => {
    const user = await newUser({ pointsBalance: 0 });
    await ledgerRow(user.id, 50, 'STANDARD', new Date());
    await ledgerRow(user.id, 5, 'CONVERTED', new Date());

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        prisma.$transaction((tx) =>
          applyPointsDelta(tx, { userId: user.id, delta: -2, lot: 'CONVERTED', reason: `IT_SPEND:${i}`, refType: 'IT' }),
        ),
      ),
    );
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    const applied = s.fulfilled.filter((r) => r.value.applied).length;
    expect(applied).toBe(2);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsConvertedBalance).toBe(1);
    expect(after.pointsBalance).toBe(50);
  });

  it('T5: hoàn lô CONVERTED 5 lần song song cùng khoá (skipDuplicates + converted_refund_unique) → cộng đúng 1 lần', async () => {
    const user = await newUser();
    const orderRef = `o_${randCode(8)}`;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) =>
          applyPointsDelta(tx, {
            userId: user.id,
            delta: 7,
            lot: 'CONVERTED',
            reason: `ORDER_REFUND_CONVERTED:${orderRef}`,
            refType: 'ORDER',
            refId: orderRef,
            skipDuplicates: true,
          }),
        ),
      ),
    );
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(s.fulfilled.filter((r) => r.value.applied)).toHaveLength(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsConvertedBalance).toBe(7);
    expect(await prisma.pointsTransaction.count({ where: { userId: user.id } })).toBe(1);
  });

  it('T7: cron hết hạn chỉ trừ phần STANDARD hết hạn; lô quy đổi cũ hơn không làm lệch FIFO; chạy 2 lần không trừ đôi', async () => {
    const now = Date.now();
    const at = (days: number) => new Date(now + days * DAY);
    const user = await newUser();
    await ledgerRow(user.id, 100, 'CONVERTED', at(-200)); // lô quy đổi cũ nhất, không hạn
    await ledgerRow(user.id, 50, 'STANDARD', at(-150), at(-1)); // thưởng đã hết hạn...
    await ledgerRow(user.id, -50, 'STANDARD', at(-100)); // ...nhưng đã bị tiêu hết bằng điểm thường
    await ledgerRow(user.id, 30, 'STANDARD', at(-90), at(-1)); // thưởng hết hạn còn nguyên → phải trừ 30
    await ledgerRow(user.id, -20, 'CONVERTED', at(-80)); // tiêu lô quy đổi, không được ăn lô thường
    await ledgerRow(user.id, 40, 'STANDARD', at(-10), at(300));
    await ledgerRow(user.id, 100, 'STANDARD', at(-5), at(300));
    // FIFO trên mọi dòng (sai) cho expiredNow = 80: dòng -50 ăn lô quy đổi, lô 50 hết hạn trông còn nguyên.

    await expiry.expirePoints();
    await expiry.expirePoints();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsBalance).toBe(170 - 30);
    expect(after.pointsConvertedBalance).toBe(80);
    const expired = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'POINTS_EXPIRED' } });
    expect(expired.map((r) => [r.delta, r.lot])).toEqual([[-30, 'STANDARD']]);
  });

  it('T7: nhiều lượt hết hạn chạy ĐỒNG THỜI cho một user (nhiều instance, chạy tay lúc cron) chỉ trừ một lần', async () => {
    const now = Date.now();
    const at = (days: number) => new Date(now + days * DAY);
    const user = await newUser();
    await ledgerRow(user.id, 30, 'STANDARD', at(-90), at(-1)); // hết hạn, còn nguyên → trừ 30 đúng một lần
    await ledgerRow(user.id, 100, 'STANDARD', at(-5), at(300)); // chưa hết hạn, đủ số dư để lượt thừa trừ tiếp
    await ledgerRow(user.id, 50, 'CONVERTED', at(-5));

    const expireUser = (expiry as unknown as { expireUser: (id: string, at: Date) => Promise<number> }).expireUser.bind(expiry);
    const results = await Promise.all(Array.from({ length: 6 }, () => expireUser(user.id, new Date())));

    expect(results.reduce((a, b) => a + b, 0)).toBe(30);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.pointsBalance).toBe(100);
    expect(after.pointsConvertedBalance).toBe(50);
    const expired = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: 'POINTS_EXPIRED' } });
    expect(expired.map((r) => [r.delta, r.lot])).toEqual([[-30, 'STANDARD']]);
  });
});
