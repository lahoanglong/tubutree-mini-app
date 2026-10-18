import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { WasteAdminGiftsService } from '../../src/modules/waste-exchange/catalog/waste-admin-gifts.service';
import { createUser, deleteItData, randCode, warmPool } from './helpers';
import { cleanupWaste, createWarehouse, createWasteGift, raceWithHold } from './fixtures/waste-fixtures';

const phone = () => '09' + String(randomInt(10_000_000, 99_999_999));
const key = () => `rk-${randCode(12)}`;
function noDeadlock(results: PromiseSettledResult<unknown>[]) {
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
  expect(errors.join()).not.toMatch(/40P01|deadlock|P2034/);
}

/**
 * WasteAdminGiftsService.update so với LoyaltyService.redeemReward trên Postgres thật: sửa tồn kho cùng lúc có người đổi quà.
 */
describe('waste-admin-gifts race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let gifts: WasteAdminGiftsService;
  let loyalty: LoyaltyService;
  const userIds: string[] = [];
  const giftIds: string[] = [];

  const newCase = async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const customer = await createUser(prisma, { pointsBalance: 100_000, phone: phone() });
    userIds.push(admin.id, customer.id);
    const gift = await createWasteGift(prisma, { kind: 'GIFT', pointsCost: 10_000, stock: 1 });
    giftIds.push(gift.id);
    return { admin, customer, gift };
  };
  const balanceOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { pointsBalance: true } })).pointsBalance;
  const stockOf = async (id: string) => (await prisma.wasteGift.findUniqueOrThrow({ where: { id }, select: { stock: true } })).stock;
  const updateEvent = async (giftId: string) => {
    const events = await prisma.wasteEvent.findMany({ where: { kind: 'GIFT_UPDATED', meta: { path: ['giftId'], equals: giftId } } });
    expect(events).toHaveLength(1);
    return events[0]!.meta as { before: { stock: number }; after: { stock: number } };
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, RewardPointsService, LoyaltyService, WasteAdminGiftsService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    gifts = moduleRef.get(WasteAdminGiftsService);
    loyalty = moduleRef.get(LoyaltyService);
    await createWarehouse(prisma);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "waste_events" WHERE "kind" = 'GIFT_UPDATED' AND "meta"->>'giftId' = ANY(${giftIds}::text[])`;
    await cleanupWaste(prisma, { giftIds });
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  const giftLock = (id: string) => Prisma.sql`SELECT "id" FROM "waste_gifts" WHERE "id" = ${id} FOR UPDATE`;

  it('stock edit then redeem: the edit logs the stock it found, the redeem takes one from the new stock', async () => {
    const { admin, customer, gift } = await newCase();

    const results = await raceWithHold(
      prisma,
      giftLock(gift.id),
      () => gifts.update(admin.id, gift.id, { stock: 5 }),
      () => loyalty.redeemReward(customer.id, gift.id, key()),
    );

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await stockOf(gift.id)).toBe(4);
    const meta = await updateEvent(gift.id);
    expect(meta.before.stock).toBe(1);
    expect(meta.after.stock).toBe(5);
    expect(await balanceOf(customer.id)).toBe(90_000);
    noDeadlock(results);
  });

  it('redeem then stock edit: the edit reads the stock the redeem left and its value stands', async () => {
    const { admin, customer, gift } = await newCase();

    const results = await raceWithHold(
      prisma,
      giftLock(gift.id),
      () => loyalty.redeemReward(customer.id, gift.id, key()),
      () => gifts.update(admin.id, gift.id, { stock: 5 }),
    );

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await stockOf(gift.id)).toBe(5);
    const meta = await updateEvent(gift.id);
    expect(meta.before.stock).toBe(0);
    expect(meta.after.stock).toBe(5);
    expect(await balanceOf(customer.id)).toBe(90_000);
    noDeadlock(results);
  });
});
