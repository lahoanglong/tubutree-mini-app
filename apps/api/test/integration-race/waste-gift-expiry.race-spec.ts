import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
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
import { WasteGiftExpiryCron } from '../../src/modules/waste-exchange/catalog/waste-gift-expiry.cron';
import { startOfVnDay } from '../../src/common/vn-time';
import { createUser, deleteItData, setConfig, warmPool } from './helpers';
import { cleanupWaste, createGiftRedemption, createWarehouse, createWasteGift, createWasteItem, createWasteRequest, raceWithHold } from './fixtures/waste-fixtures';

const phone = () => '09' + String(randomInt(10_000_000, 99_999_999));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const pastDeadline = () => new Date(startOfVnDay().getTime() - HOUR);
const ALREADY = 'Lượt đổi quà này đã được trao hoặc đã huỷ.';
const OVERDUE = 'Quà đã quá hạn nhận, hệ thống sẽ huỷ và hoàn điểm cho khách.';
function noDeadlock(results: PromiseSettledResult<unknown>[]) {
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []));
  expect(errors.join()).not.toMatch(/40P01|deadlock|P2034/);
}

/** Cron huỷ quà hiện vật quá hạn nhận trên Postgres thật: hoàn đúng điểm, chỉ một lần, không giẫm lên quầy trao quà. */
describe('waste-gift-expiry race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: WasteGiftRedemptionsService;
  let cron: WasteGiftExpiryCron;
  let staff: { id: string };
  let warehouseId = '';
  let itemId = '';
  let savedEnabled: { value: unknown } | null = null;
  const clearConfigCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();
  const giftExpired = jest.fn().mockResolvedValue(undefined);
  const userIds: string[] = [];
  const giftIds: string[] = [];

  const newCase = async (o: { claimExpiresAt: Date | null; stock?: number | null } = { claimExpiresAt: pastDeadline() }) => {
    const customer = await createUser(prisma, { pointsBalance: 100_000, phone: phone() });
    userIds.push(customer.id);
    const gift = await createWasteGift(prisma, { stock: o.stock === undefined ? 0 : o.stock, pointsCost: 30_000 });
    giftIds.push(gift.id);
    const redemption = await createGiftRedemption(prisma, { userId: customer.id, giftId: gift.id, pointsCost: 30_000, claimExpiresAt: o.claimExpiresAt });
    return { customer, gift, redemption };
  };
  const balanceOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { pointsBalance: true } })).pointsBalance;
  const stockOf = async (id: string) => (await prisma.wasteGift.findUniqueOrThrow({ where: { id }, select: { stock: true } })).stock;
  const refundRows = (id: string) => prisma.pointsTransaction.count({ where: { refType: 'GIFT_REFUND', refId: id } });
  const redemptionOf = (id: string) => prisma.wasteGiftRedemption.findUniqueOrThrow({ where: { id } });
  const eventCount = (id: string, kind: string) => prisma.wasteEvent.count({ where: { giftRedemptionId: id, kind } });
  const noticesFor = (id: string) => giftExpired.mock.calls.filter((c) => (c[1] as { id: string }).id === id).length;

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
        WasteGiftExpiryCron,
        { provide: WasteNotifierService, useValue: { giftCancelled: jest.fn().mockResolvedValue(undefined), giftExpired } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(WasteGiftRedemptionsService);
    cron = moduleRef.get(WasteGiftExpiryCron);
    savedEnabled = await prisma.systemConfig.findUnique({ where: { key: 'waste.enabled' }, select: { value: true } });
    await setConfig(prisma, 'waste.enabled', false);
    clearConfigCache();
    warehouseId = (await createWarehouse(prisma)).id;
    itemId = (await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1000 })).id;
    staff = await createUser(prisma, { role: 'STAFF' });
    userIds.push(staff.id);
  });

  afterAll(async () => {
    if (savedEnabled) await setConfig(prisma, 'waste.enabled', savedEnabled.value as never);
    else await prisma.systemConfig.deleteMany({ where: { key: 'waste.enabled' } });
    clearConfigCache();
    await prisma.wasteUserFlags.deleteMany({ where: { userId: { in: userIds } } });
    await cleanupWaste(prisma, { giftIds, pointIds: [warehouseId], itemIds: [itemId] });
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  beforeEach(() => giftExpired.mockClear());

  const redemptionLock = (id: string) => Prisma.sql`SELECT "id" FROM "waste_gift_redemptions" WHERE "id" = ${id} FOR UPDATE`;

  it('an overdue READY gift is cancelled, the exact pointsCost refunded, stock returned, one SYSTEM event, one notice', async () => {
    const { customer, gift, redemption } = await newCase();

    await svc.expireOverdue();

    const row = await redemptionOf(redemption.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelReason).toBe('Quá hạn nhận');
    expect(row.refundedPoints).toBe(30_000);
    expect(row.cancelledByUserId).toBeNull();
    expect(await balanceOf(customer.id)).toBe(130_000);
    expect(await refundRows(redemption.id)).toBe(1);
    expect(await stockOf(gift.id)).toBe(1);
    const events = await prisma.wasteEvent.findMany({ where: { giftRedemptionId: redemption.id, kind: 'GIFT_EXPIRED' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorRole).toBe('SYSTEM');
    expect(events[0]!.meta).toMatchObject({ before: { status: 'READY' }, after: { status: 'CANCELLED', refundedPoints: 30_000 } });
    expect(noticesFor(redemption.id)).toBe(1);
    expect(giftExpired).toHaveBeenCalledWith(customer.id, { id: redemption.id, giftName: redemption.giftName }, 30_000);
  });

  it('a gift still inside its deadline, a gift without a deadline, and an already FULFILLED one are left alone', async () => {
    const inTime = await newCase({ claimExpiresAt: new Date(Date.now() + HOUR) });
    const noDeadline = await newCase({ claimExpiresAt: null });
    const fulfilled = await newCase();
    await prisma.wasteGiftRedemption.update({ where: { id: fulfilled.redemption.id }, data: { status: 'FULFILLED', fulfilledAt: new Date() } });

    await svc.expireOverdue();

    for (const c of [inTime, noDeadline]) {
      expect((await redemptionOf(c.redemption.id)).status).toBe('READY');
      expect(await balanceOf(c.customer.id)).toBe(100_000);
      expect(await refundRows(c.redemption.id)).toBe(0);
      expect(await stockOf(c.gift.id)).toBe(0);
      expect(noticesFor(c.redemption.id)).toBe(0);
    }
    expect((await redemptionOf(fulfilled.redemption.id)).status).toBe('FULFILLED');
    expect(await refundRows(fulfilled.redemption.id)).toBe(0);
    expect(noticesFor(fulfilled.redemption.id)).toBe(0);
  });

  it('the cron run twice: one refund, one event, one notice', async () => {
    const { customer, redemption } = await newCase();

    const first = await cron.run();
    const second = await cron.run();

    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(second.expired).toBe(0);
    expect(await refundRows(redemption.id)).toBe(1);
    expect(await balanceOf(customer.id)).toBe(130_000);
    expect(await eventCount(redemption.id, 'GIFT_EXPIRED')).toBe(1);
    expect(noticesFor(redemption.id)).toBe(1);
  });

  it('two sweeps at the same time (no advisory lock between them): the row-level guard still gives one refund and one notice', async () => {
    const { customer, redemption } = await newCase();

    const results = await raceWithHold(prisma, redemptionLock(redemption.id), () => svc.expireOverdue(), () => svc.expireOverdue());

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await refundRows(redemption.id)).toBe(1);
    expect(await balanceOf(customer.id)).toBe(130_000);
    expect(await eventCount(redemption.id, 'GIFT_EXPIRED')).toBe(1);
    expect(noticesFor(redemption.id)).toBe(1);
    noDeadlock(results);
  });

  it('waste.enabled is off for this whole spec: the cron still cancels and refunds', async () => {
    const { customer, redemption } = await newCase();

    expect(await cron.run()).toMatchObject({ failed: 0 });

    expect((await redemptionOf(redemption.id)).status).toBe('CANCELLED');
    expect(await balanceOf(customer.id)).toBe(130_000);
  });

  it.each([
    ['blocked customer', async (userId: string) => void (await prisma.wasteUserFlags.create({ data: { userId, blockedAt: new Date() } }))],
    [
      'customer with a REVERSED request',
      async (userId: string) =>
        void (await createWasteRequest(prisma, { userId, method: 'DROP_OFF', status: 'REVERSED', pointId: warehouseId, lines: [{ itemId, declaredQty: 1, receivedQty: 1 }] })),
    ],
    [
      'anonymized account',
      async (userId: string) => void (await prisma.user.update({ where: { id: userId }, data: { metadata: { anonymizedAt: new Date().toISOString() } } })),
    ],
  ])('%s: the cron leaves the overdue gift READY, no refund, no event, no notice; the admin decides', async (_name, arrange) => {
    const held = await newCase();
    const normal = await newCase();
    await arrange(held.customer.id);

    const res = await svc.expireOverdue();

    expect(res.held).toBeGreaterThanOrEqual(1);
    const row = await redemptionOf(held.redemption.id);
    expect(row.status).toBe('READY');
    expect(await balanceOf(held.customer.id)).toBe(100_000);
    expect(await refundRows(held.redemption.id)).toBe(0);
    expect(await stockOf(held.gift.id)).toBe(0);
    expect(await eventCount(held.redemption.id, 'GIFT_EXPIRED')).toBe(0);
    expect(noticesFor(held.redemption.id)).toBe(0);
    expect((await redemptionOf(normal.redemption.id)).status).toBe('CANCELLED');
    expect(await balanceOf(normal.customer.id)).toBe(130_000);
    expect(noticesFor(normal.redemption.id)).toBe(1);
  });

  it('the cron sweeps first, then the desk hands over: the row stays CANCELLED, one refund, the desk is a 409', async () => {
    const { customer, gift, redemption } = await newCase({ claimExpiresAt: new Date(Date.now() + HOUR) });
    const later = new Date(Date.now() + 2 * DAY);

    const results = await raceWithHold(
      prisma,
      redemptionLock(redemption.id),
      () => svc.expireOverdue(later),
      () => svc.fulfilById(staff.id, redemption.id, { code: redemption.code! }),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    const err = (results[1] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(ConflictException);
    expect([ALREADY, OVERDUE]).toContain((err as ConflictException).message);
    const row = await redemptionOf(redemption.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.fulfilledAt).toBeNull();
    expect(await refundRows(redemption.id)).toBe(1);
    expect(await balanceOf(customer.id)).toBe(130_000);
    expect(await stockOf(gift.id)).toBe(1);
    expect(await eventCount(redemption.id, 'GIFT_FULFILLED')).toBe(0);
    noDeadlock(results);
  });

  it('the desk hands over first, then the cron sweeps: the row stays FULFILLED, no refund, no notice', async () => {
    const { customer, gift, redemption } = await newCase({ claimExpiresAt: new Date(Date.now() + HOUR) });
    const later = new Date(Date.now() + 2 * DAY);

    const results = await raceWithHold(
      prisma,
      redemptionLock(redemption.id),
      () => svc.fulfilById(staff.id, redemption.id, { code: redemption.code! }),
      () => svc.expireOverdue(later),
    );

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const row = await redemptionOf(redemption.id);
    expect(row.status).toBe('FULFILLED');
    expect(await refundRows(redemption.id)).toBe(0);
    expect(await balanceOf(customer.id)).toBe(100_000);
    expect(await stockOf(gift.id)).toBe(0);
    expect(await eventCount(redemption.id, 'GIFT_EXPIRED')).toBe(0);
    expect(noticesFor(redemption.id)).toBe(0);
    noDeadlock(results);
  });

  it('the desk refuses an overdue gift up front: the row is untouched until the cron cancels it', async () => {
    const { redemption } = await newCase();

    await expect(svc.fulfilById(staff.id, redemption.id, { code: redemption.code! })).rejects.toThrow(new ConflictException(OVERDUE));

    expect((await redemptionOf(redemption.id)).status).toBe('READY');
  });

  it('a deadline earlier today (VN) is still open: the desk hands over, the cron leaves it; the next VN midnight is when the cron cancels it', async () => {
    const earlierToday = new Date(startOfVnDay().getTime() + 1000);
    const handed = await newCase({ claimExpiresAt: earlierToday });
    const swept = await newCase({ claimExpiresAt: earlierToday });

    await svc.expireOverdue();
    expect((await redemptionOf(swept.redemption.id)).status).toBe('READY');
    expect(noticesFor(swept.redemption.id)).toBe(0);

    await svc.fulfilById(staff.id, handed.redemption.id, { code: handed.redemption.code! });
    expect((await redemptionOf(handed.redemption.id)).status).toBe('FULFILLED');

    await svc.expireOverdue(new Date(startOfVnDay().getTime() + DAY - 1000));
    expect((await redemptionOf(swept.redemption.id)).status).toBe('READY');

    await svc.expireOverdue(new Date(startOfVnDay().getTime() + DAY));
    const row = await redemptionOf(swept.redemption.id);
    expect(row.status).toBe('CANCELLED');
    expect(await balanceOf(swept.customer.id)).toBe(130_000);
    expect(await refundRows(swept.redemption.id)).toBe(1);
    expect((await redemptionOf(handed.redemption.id)).status).toBe('FULFILLED');
    expect(await refundRows(handed.redemption.id)).toBe(0);
  });
});
