import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { giftAttachDecision } from '../../src/modules/checkout/checkout-pickup';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WasteGiftAttachService } from '../../src/modules/waste-exchange/catalog/waste-gift-attach.service';
import { WasteGiftRedemptionsService } from '../../src/modules/waste-exchange/catalog/waste-gift-redemptions.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { createOrder, createUser as createItUser, deleteItData, warmPool } from './helpers';
import { cleanupWaste, createGiftRedemption, createWarehouse, createWasteGift, raceWithHold } from './fixtures/waste-fixtures';

/**
 * W179-C (G2) — Đua gắn quà hiện vật 0đ trên Postgres thật (`tubutree_it`):
 * 1. Hai lần đặt đơn đồng thời (>= 99.000đ) cùng nhìn thấy một quà READY -> quà chỉ gắn vào ĐÚNG MỘT đơn;
 * 2. Đơn bị huỷ -> `onOrderReleased` trả quà về READY (`attachedOrderId = null`) và gắn lại được vào đơn kế tiếp >= 99.000đ;
 * 3. Đặt đơn gắn quà + khoá `users FOR UPDATE` (thứ tự khoá: `waste_gift_redemptions -> users`) × admin huỷ quà (`waste_gift_redemptions -> users`)
 *    chạy đồng thời -> KHÔNG deadlock (`40P01`), quà hoặc gắn vào đơn hoặc bị huỷ hoàn điểm đúng 1 lần.
 */
describe('W179-C gift attach races (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let giftAttach: WasteGiftAttachService;
  let giftRedemptions: WasteGiftRedemptionsService;
  const userIds: string[] = [];
  const reg = { pointIds: [] as string[], itemIds: [] as string[], giftIds: [] as string[], storefrontIds: [] as string[] };

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const errorsOf = (rs: PromiseSettledResult<unknown>[]) =>
    rs.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));

  async function seedVerifiedUser(role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER', pointsBalance = 0) {
    const u = await createItUser(prisma, {
      phone: phone(),
      role,
      pointsBalance,
      phoneVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    });
    userIds.push(u.id);
    return u;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        WasteConfigService,
        WasteAccessService,
        RewardPointsService,
        WasteGiftAttachService,
        {
          provide: WasteGiftRedemptionsService,
          useFactory: (p: PrismaService, a: WasteAccessService, c: WasteConfigService, r: RewardPointsService) =>
            new WasteGiftRedemptionsService(p, a, c, r, {
              giftCancelled: async () => undefined,
              giftExpired: async () => undefined,
            } as never),
          inject: [PrismaService, WasteAccessService, WasteConfigService, RewardPointsService],
        },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    giftAttach = moduleRef.get(WasteGiftAttachService);
    giftRedemptions = moduleRef.get(WasteGiftRedemptionsService);
    await warmPool(prisma);
    await createWarehouse(prisma);
  });

  afterAll(async () => {
    await cleanupWaste(prisma, reg);
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  /** Mô phỏng đúng thứ tự câu lệnh trong `placeOrderInner` (checkout.service.ts:658-678). */
  async function placeOrderAttachTx(userId: string, orderId: string, netGoodsVnd: number, spendPoints = 0) {
    return prisma.$transaction(async (tx) => {
      const pending = await giftAttach.listPending(userId, tx);
      if (pending.length > 0) {
        const uRow = await tx.user.findUnique({ where: { id: userId }, select: { phoneVerifiedAt: true } });
        const { attachIds } = giftAttachDecision({
          hasTubuShipment: true,
          phoneVerified: uRow?.phoneVerifiedAt != null,
          netGoodsVnd,
          pending,
          excludedIds: new Set(),
        });
        if (attachIds.length > 0) {
          await giftAttach.attachInTx(tx, userId, attachIds, orderId);
        }
      }
      if (spendPoints > 0) {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
        await tx.user.updateMany({
          where: { id: userId, pointsBalance: { gte: spendPoints } },
          data: { pointsBalance: { decrement: spendPoints } },
        });
      }
    });
  }

  it('(1) two concurrent placeOrder txs (>= 99.000đ) with 1 READY gift: gift attaches to EXACTLY ONE order', async () => {
    const u = await seedVerifiedUser('CUSTOMER');
    const gift = await createWasteGift(prisma, { stock: 5, pointsCost: 10_000 });
    reg.giftIds.push(gift.id);
    const red = await createGiftRedemption(prisma, { userId: u.id, giftId: gift.id, status: 'READY', pointsCost: 10_000 });
    const o1 = await createOrder(prisma, { userId: u.id, status: 'CONFIRMED', subtotal: 120_000, total: 120_000 });
    const o2 = await createOrder(prisma, { userId: u.id, status: 'CONFIRMED', subtotal: 150_000, total: 150_000 });

    const lockRow = Prisma.sql`SELECT "id" FROM "waste_gift_redemptions" WHERE "id" = ${red.id} FOR UPDATE`;
    const rs = await raceWithHold(
      prisma,
      lockRow,
      () => placeOrderAttachTx(u.id, o1.id, 120_000),
      () => placeOrderAttachTx(u.id, o2.id, 150_000),
    );
    expect(errorsOf(rs)).toEqual([]);

    const fresh = await prisma.wasteGiftRedemption.findUniqueOrThrow({ where: { id: red.id } });
    expect([o1.id, o2.id]).toContain(fresh.attachedOrderId);
    const attachedCount = await prisma.wasteGiftRedemption.count({
      where: { id: red.id, attachedOrderId: { in: [o1.id, o2.id] } },
    });
    expect(attachedCount).toBe(1);
  });

  it('(2) order CANCELLED releases the gift back to vault, and a subsequent >= 99.000đ order re-attaches it', async () => {
    const u = await seedVerifiedUser('CUSTOMER');
    const gift = await createWasteGift(prisma, { stock: 5, pointsCost: 10_000 });
    reg.giftIds.push(gift.id);
    const red = await createGiftRedemption(prisma, { userId: u.id, giftId: gift.id, status: 'READY', pointsCost: 10_000 });
    const o1 = await createOrder(prisma, { userId: u.id, status: 'CONFIRMED', subtotal: 120_000, total: 120_000 });

    await placeOrderAttachTx(u.id, o1.id, 120_000);
    expect((await prisma.wasteGiftRedemption.findUniqueOrThrow({ where: { id: red.id } })).attachedOrderId).toBe(o1.id);

    await prisma.order.update({ where: { id: o1.id }, data: { status: 'CANCELLED', reversalEffectsAt: new Date() } });
    expect(await giftAttach.onOrderReleased(o1.id)).toBe(1);
    expect((await prisma.wasteGiftRedemption.findUniqueOrThrow({ where: { id: red.id } })).attachedOrderId).toBeNull();

    const o2 = await createOrder(prisma, { userId: u.id, status: 'CONFIRMED', subtotal: 110_000, total: 110_000 });
    await placeOrderAttachTx(u.id, o2.id, 110_000);
    expect((await prisma.wasteGiftRedemption.findUniqueOrThrow({ where: { id: red.id } })).attachedOrderId).toBe(o2.id);
  });

  it('(3) placeOrder (gift attach + users FOR UPDATE) × admin cancel gift: zero deadlock (40P01), consistent final state', async () => {
    const admin = await seedVerifiedUser('ADMIN');
    for (const dir of ['ORDER_FIRST', 'CANCEL_FIRST'] as const) {
      const u = await seedVerifiedUser('CUSTOMER', 5_000);
      const gift = await createWasteGift(prisma, { stock: 5, pointsCost: 10_000 });
      reg.giftIds.push(gift.id);
      const red = await createGiftRedemption(prisma, { userId: u.id, giftId: gift.id, status: 'READY', pointsCost: 10_000 });
      const o = await createOrder(prisma, { userId: u.id, status: 'CONFIRMED', subtotal: 120_000, total: 120_000 });

      const lockRow = Prisma.sql`SELECT "id" FROM "waste_gift_redemptions" WHERE "id" = ${red.id} FOR UPDATE`;
      const runOrder = () => placeOrderAttachTx(u.id, o.id, 120_000, 1_000);
      const runCancel = () => giftRedemptions.cancel(admin.id, red.id, { reason: 'Kiểm kho huỷ' } as never);
      const rs =
        dir === 'ORDER_FIRST'
          ? await raceWithHold(prisma, lockRow, runOrder, runCancel)
          : await raceWithHold(prisma, lockRow, runCancel, runOrder);

      expect(errorsOf(rs).join(' | ')).not.toMatch(/40P01|P2034|deadlock/i);
      const finalRed = await prisma.wasteGiftRedemption.findUniqueOrThrow({ where: { id: red.id } });
      const refunds = await prisma.pointsTransaction.count({ where: { userId: u.id, refType: 'GIFT_REFUND', refId: red.id } });
      expect(finalRed.status === 'CANCELLED' ? refunds : 0).toBe(refunds);
      expect(refunds).toBeLessThanOrEqual(1);
    }
  });
});
