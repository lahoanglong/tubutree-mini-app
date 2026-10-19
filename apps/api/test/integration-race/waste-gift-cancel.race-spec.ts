import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteGiftRedemptionsService } from '../../src/modules/waste-exchange/catalog/waste-gift-redemptions.service';
import { createUser, deleteItData, randCode, warmPool } from './helpers';
import { cleanupWaste, createGiftRedemption, createWarehouse, createWasteGift, raceWithHold } from './fixtures/waste-fixtures';

const phone = () => '09' + String(randomInt(10_000_000, 99_999_999));
const key = () => `rk-${randCode(12)}`;
function noDeadlock(results: PromiseSettledResult<unknown>[]) {
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
  expect(errors.join()).not.toMatch(/40P01|deadlock|P2034/);
}

const ALREADY = 'Lượt đổi quà này đã được trao hoặc đã huỷ.';
const SOLD_OUT = 'Quà này đã hết hoặc đã ngừng đổi';

/**
 * WasteGiftRedemptionsService.cancel / fulfilById trên Postgres thật: huỷ hai lần, huỷ so với trao quà, huỷ so với đổi lại cùng quà.
 */
describe('waste-gift-cancel race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: WasteGiftRedemptionsService;
  let loyalty: LoyaltyService;
  let adminA: { id: string };
  let adminB: { id: string };
  let staff1: { id: string };
  let staff2: { id: string };
  let warehouseId: string;
  const userIds: string[] = [];
  const giftIds: string[] = [];

  const newCase = async (giftOver: Parameters<typeof createWasteGift>[1] = {}) => {
    const customer = await createUser(prisma, { pointsBalance: 100_000, phone: phone() });
    userIds.push(customer.id);
    const gift = await createWasteGift(prisma, { stock: 0, pointsCost: 30_000, ...giftOver });
    giftIds.push(gift.id);
    const redemption = await createGiftRedemption(prisma, { userId: customer.id, giftId: gift.id, pointsCost: 30_000 });
    return { customer, gift, redemption };
  };
  const balanceOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { pointsBalance: true } })).pointsBalance;
  const stockOf = async (id: string) => (await prisma.wasteGift.findUniqueOrThrow({ where: { id }, select: { stock: true } })).stock;
  const refundRows = (redemptionId: string) => prisma.pointsTransaction.count({ where: { refType: 'GIFT_REFUND', refId: redemptionId } });
  const redemptionOf = (id: string) => prisma.wasteGiftRedemption.findUniqueOrThrow({ where: { id } });
  const cancelBy = (adminId: string, redemptionId: string) => () => svc.cancel(adminId, redemptionId, { reason: 'IT huỷ' });
  const fulfilBy = (staffId: string, r: { id: string; code: string | null }) => () => svc.fulfilById(staffId, r.id, { code: r.code! });

  function expectConflict(result: PromiseSettledResult<unknown>) {
    expect(result.status).toBe('rejected');
    const err = (result as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(ALREADY);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        WasteConfigService,
        WasteAccessService,
        RewardPointsService,
        LoyaltyService,
        WasteGiftRedemptionsService,
        { provide: WasteNotifierService, useValue: { giftCancelled: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(WasteGiftRedemptionsService);
    loyalty = moduleRef.get(LoyaltyService);
    warehouseId = (await createWarehouse(prisma)).id;
    adminA = await createUser(prisma, { role: 'ADMIN' });
    adminB = await createUser(prisma, { role: 'ADMIN' });
    staff1 = await createUser(prisma, { role: 'STAFF' });
    staff2 = await createUser(prisma, { role: 'STAFF' });
    userIds.push(adminA.id, adminB.id, staff1.id, staff2.id);
  });

  afterAll(async () => {
    await cleanupWaste(prisma, { giftIds });
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  const redemptionLock = (id: string) => Prisma.sql`SELECT "id" FROM "waste_gift_redemptions" WHERE "id" = ${id} FOR UPDATE`;
  const userLock = (id: string) => Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${id} FOR UPDATE`;

  it('cancel A then cancel B: one refund, the second is a 409', async () => {
    const { customer, gift, redemption } = await newCase();

    const results = await raceWithHold(prisma, redemptionLock(redemption.id), cancelBy(adminA.id, redemption.id), cancelBy(adminB.id, redemption.id));

    expect(results[0].status).toBe('fulfilled');
    expectConflict(results[1]);
    expect(await refundRows(redemption.id)).toBe(1);
    expect(await balanceOf(customer.id)).toBe(130_000);
    expect(await stockOf(gift.id)).toBe(1);
    expect((await redemptionOf(redemption.id)).cancelledByUserId).toBe(adminA.id);
    noDeadlock(results);
  });

  it('cancel B then cancel A: one refund, the second is a 409', async () => {
    const { customer, gift, redemption } = await newCase();

    const results = await raceWithHold(prisma, redemptionLock(redemption.id), cancelBy(adminB.id, redemption.id), cancelBy(adminA.id, redemption.id));

    expect(results[0].status).toBe('fulfilled');
    expectConflict(results[1]);
    expect(await refundRows(redemption.id)).toBe(1);
    expect(await balanceOf(customer.id)).toBe(130_000);
    expect(await stockOf(gift.id)).toBe(1);
    expect((await redemptionOf(redemption.id)).cancelledByUserId).toBe(adminB.id);
    noDeadlock(results);
  });

  it('cancel then fulfil: the row stays CANCELLED and the hand-over is a 409', async () => {
    const { redemption } = await newCase();

    const results = await raceWithHold(prisma, redemptionLock(redemption.id), cancelBy(adminA.id, redemption.id), fulfilBy(staff1.id, redemption));

    expect(results[0].status).toBe('fulfilled');
    expectConflict(results[1]);
    const row = await redemptionOf(redemption.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.fulfilledPointId).toBeNull();
    expect(row.fulfilledAt).toBeNull();
    noDeadlock(results);
  });

  it('fulfil then cancel: the row stays FULFILLED, no refund, stock untouched, the cancel is a 409', async () => {
    const { gift, redemption } = await newCase();

    const results = await raceWithHold(prisma, redemptionLock(redemption.id), fulfilBy(staff1.id, redemption), cancelBy(adminA.id, redemption.id));

    expect(results[0].status).toBe('fulfilled');
    expectConflict(results[1]);
    const row = await redemptionOf(redemption.id);
    expect(row.status).toBe('FULFILLED');
    expect(row.fulfilledPointId).toBe(warehouseId);
    expect(await refundRows(redemption.id)).toBe(0);
    expect(await stockOf(gift.id)).toBe(0);
    noDeadlock(results);
  });

  it('cancel then redeem: the refund and the stock return land first, so the same customer can redeem again', async () => {
    const { customer, gift, redemption } = await newCase();

    const results = await raceWithHold(prisma, userLock(customer.id), cancelBy(adminA.id, redemption.id), () => loyalty.redeemReward(customer.id, gift.id, key()));

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');
    expect(await balanceOf(customer.id)).toBe(100_000);
    expect(await stockOf(gift.id)).toBe(0);
    expect(await refundRows(redemption.id)).toBe(1);
    expect(await prisma.wasteGiftRedemption.count({ where: { userId: customer.id, giftId: gift.id, status: 'READY' } })).toBe(1);
    noDeadlock(results);
  });

  it('redeem then cancel: the redeem meets stock 0 and is refused, then the cancel commits', async () => {
    const { customer, gift, redemption } = await newCase();

    const results = await raceWithHold(prisma, userLock(customer.id), () => loyalty.redeemReward(customer.id, gift.id, key()), cancelBy(adminA.id, redemption.id));

    expect(results[0].status).toBe('rejected');
    const err = (results[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(SOLD_OUT);
    expect(results[1].status).toBe('fulfilled');
    expect(await balanceOf(customer.id)).toBe(130_000);
    expect(await stockOf(gift.id)).toBe(1);
    noDeadlock(results);
  });

  it('fulfil A then fulfil B: the first staff wins, the second is a 409, one event', async () => {
    const { redemption } = await newCase();

    const results = await raceWithHold(prisma, redemptionLock(redemption.id), fulfilBy(staff1.id, redemption), fulfilBy(staff2.id, redemption));

    expect(results[0].status).toBe('fulfilled');
    expectConflict(results[1]);
    expect((await redemptionOf(redemption.id)).fulfilledByUserId).toBe(staff1.id);
    expect(await prisma.wasteEvent.count({ where: { giftRedemptionId: redemption.id, kind: 'GIFT_FULFILLED' } })).toBe(1);
    noDeadlock(results);
  });

  it('fulfil B then fulfil A: the first staff wins, the second is a 409, one event', async () => {
    const { redemption } = await newCase();

    const results = await raceWithHold(prisma, redemptionLock(redemption.id), fulfilBy(staff2.id, redemption), fulfilBy(staff1.id, redemption));

    expect(results[0].status).toBe('fulfilled');
    expectConflict(results[1]);
    expect((await redemptionOf(redemption.id)).fulfilledByUserId).toBe(staff2.id);
    expect(await prisma.wasteEvent.count({ where: { giftRedemptionId: redemption.id, kind: 'GIFT_FULFILLED' } })).toBe(1);
    noDeadlock(results);
  });

  it('cancel on an unlimited-stock gift: refund written, stock stays null', async () => {
    const { customer, gift, redemption } = await newCase({ stock: null });

    const [result] = await Promise.allSettled([cancelBy(adminA.id, redemption.id)()]);

    expect(result!.status).toBe('fulfilled');
    expect(await balanceOf(customer.id)).toBe(130_000);
    expect(await refundRows(redemption.id)).toBe(1);
    const rows = await prisma.$queryRaw<{ stock: number | null }[]>`SELECT "stock" FROM "waste_gifts" WHERE "id" = ${gift.id}`;
    expect(rows[0]!.stock).toBeNull();
    noDeadlock([result!]);
  });
});
